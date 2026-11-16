"""Synthetic Data Auditor - backend API.

Runs the full evaluation (cleaning, optional generation, fidelity, utility and all six privacy
attacks) for datasets uploaded from the dashboard, using the same pipeline as the 41-dataset study.

Privacy rules this server keeps:
  * Uploaded files exist only inside the job's temporary folder, which is deleted as soon as the
    job ends (completed, failed, cancelled or timed out).
  * Only the metrics (the sda-result record) are kept, in memory, for RESULT_TTL_S seconds so the
    dashboard can fetch them. They contain column names and statistics, no data rows.
  * Saved audit records (the dashboard's past audits: metrics and column summaries, never data rows)
    are stored under a private browser key, hashed before use, until the user deletes them.
  * No request bodies, data values or client IP addresses are logged.

Endpoints
  GET    /api/health            status, limits, queue length, library versions
  POST   /api/jobs              upload and queue a job (multipart form)
  GET    /api/jobs/{id}         status, per-step progress, queue position, result when done
  DELETE /api/jobs/{id}         cancel a queued/running job, or forget a finished one
  GET    /api/records           list the saved audit records of this browser key (header X-SDA-Key)
  GET    /api/records/{id}      one saved record
  PUT    /api/records/{id}      save or replace a record (JSON: {"meta": {...}, "record": {...}})
  DELETE /api/records/{id}      delete one record; DELETE /api/records deletes all of them
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from collections import deque

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

HERE = os.path.dirname(os.path.abspath(__file__))


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


MAX_UPLOAD_MB = env_int("MAX_UPLOAD_MB", 50)
MAX_ROWS = env_int("MAX_ROWS", 30000)          # larger tables are sampled (seeded), as in the study
MAX_COLUMNS = env_int("MAX_COLUMNS", 120)
MAX_QUEUE = env_int("MAX_QUEUE", 10)
JOBS_PER_HOUR = env_int("JOBS_PER_HOUR", 6)    # per client
JOB_TIMEOUT_S = env_int("JOB_TIMEOUT_S", 1800)
RESULT_TTL_S = env_int("RESULT_TTL_S", 3600)
ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
JOBS_DIR = os.environ.get("JOBS_DIR") or os.path.join(tempfile.gettempdir(), "sda-jobs")
os.makedirs(JOBS_DIR, exist_ok=True)
RECORDS_DIR = os.environ.get("RECORDS_DIR") or os.path.join(tempfile.gettempdir(), "sda-records")
RECORDS_PERSISTENT = bool(os.environ.get("RECORDS_DIR"))   # set to a mounted volume in production
os.makedirs(RECORDS_DIR, exist_ok=True)
RECORD_MAX_KB = env_int("RECORD_MAX_KB", 2048)
RECORDS_PER_KEY = env_int("RECORDS_PER_KEY", 300)
RECORD_WRITES_PER_HOUR = env_int("RECORD_WRITES_PER_HOUR", 300)
EVAL_STEPS = ["fidelity", "utility", "mia_distance", "exact_match", "mia_shadow", "singling_out", "linkability",
              "attribute_inference"]
ON_RECORDS_CHANGED = None   # hook: modal_app.py sets this to commit the storage volume

app = FastAPI(title="Synthetic Data Auditor API", version="1.0",
              description="Full six-attack audits for the Synthetic Data Auditor dashboard.")
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST", "PUT", "DELETE"],
                   allow_headers=["*"], max_age=600)

JOBS: dict[str, dict] = {}
LOCK = threading.Lock()
Q: "queue.Queue[str]" = queue.Queue()
HITS: dict[str, deque] = {}


def client_key(request: Request) -> str:
    """A hash of the client address, kept in memory only for the rate limit (never logged or stored)."""
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
    return hashlib.sha256(("sda-rate-" + ip).encode()).hexdigest()[:16]


def rate_limited(key: str, limit: int | None = None) -> bool:
    now = time.time()
    d = HITS.setdefault(key, deque())
    while d and now - d[0] > 3600:
        d.popleft()
    if len(d) >= (limit or JOBS_PER_HOUR):
        return True
    d.append(now)
    return False


def queued_ids():
    return [j for j, v in sorted(JOBS.items(), key=lambda kv: kv[1]["created"]) if v["status"] == "queued"]


def public(job_id: str) -> dict:
    j = JOBS[job_id]
    out = {"id": job_id, "status": j["status"], "mode": j["mode"], "created": j["created"],
           "started": j.get("started"), "finished": j.get("finished"), "steps": j.get("steps") or [],
           "error": j.get("error"), "data_deleted": j.get("data_deleted", False)}
    if j["status"] == "queued":
        q = queued_ids()
        out["position"] = q.index(job_id) + 1 if job_id in q else None
    if j["status"] == "completed":
        out["result"] = j.get("result")
    return out


def remove_dir(job_id: str):
    shutil.rmtree(os.path.join(JOBS_DIR, job_id), ignore_errors=True)
    if job_id in JOBS:
        JOBS[job_id]["data_deleted"] = True


def read_json(p):
    try:
        with open(p) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def run_job(job_id: str):
    jd = os.path.join(JOBS_DIR, job_id)
    with LOCK:
        j = JOBS[job_id]
        if j["status"] != "queued":          # cancelled while waiting
            remove_dir(job_id)
            return
        j["status"], j["started"] = "running", time.time()
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG", "LC_ALL", "PYTHONPATH", "TMPDIR",
                                                         "OMP_NUM_THREADS", "NUMBA_CACHE_DIR", "MPLCONFIGDIR")}
    proc = subprocess.Popen([sys.executable, os.path.join(HERE, "worker.py"), jd], cwd=jd, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    j["proc"] = proc
    try:
        while proc.poll() is None:
            time.sleep(1)
            pr = read_json(os.path.join(jd, "progress.json"))
            if pr:
                j["steps"] = pr["steps"]
            if j.get("cancel"):
                proc.kill()
                break
            if time.time() - j["started"] > JOB_TIMEOUT_S:
                proc.kill()
                j["timed_out"] = True
                break
        proc.wait()
        pr = read_json(os.path.join(jd, "progress.json"))
        if pr:
            j["steps"] = pr["steps"]
        res, err = read_json(os.path.join(jd, "result.json")), read_json(os.path.join(jd, "error.json"))
        if j.get("cancel"):
            j["status"], j["error"] = "cancelled", "Cancelled by the user."
        elif j.get("timed_out"):
            j["status"], j["error"] = "failed", f"Stopped after the {JOB_TIMEOUT_S // 60}-minute limit."
        elif res is not None and proc.returncode == 0:
            j["status"], j["result"] = "completed", res
        else:
            j["status"] = "failed"
            j["error"] = (err or {}).get("error") or f"The job stopped unexpectedly (exit code {proc.returncode})."
        for s in j.get("steps") or []:
            if s["status"] in ("running", "pending") and j["status"] != "completed":
                s["status"] = "stopped"
    finally:
        j.pop("proc", None)
        j["finished"] = time.time()
        remove_dir(job_id)                    # the uploaded data never outlives the job


def worker_loop():
    while True:
        job_id = Q.get()
        try:
            run_job(job_id)
        except Exception as e:                # never let one job stop the queue
            if job_id in JOBS:
                JOBS[job_id].update(status="failed", error=f"Server error: {type(e).__name__}", finished=time.time())
            remove_dir(job_id)
        finally:
            Q.task_done()


def janitor_loop():
    while True:
        time.sleep(60)
        now = time.time()
        with LOCK:
            for k in [k for k, v in JOBS.items() if v.get("finished") and now - v["finished"] > RESULT_TTL_S]:
                JOBS.pop(k, None)
        for name in os.listdir(JOBS_DIR):     # leftovers from a restart
            if name not in JOBS:
                shutil.rmtree(os.path.join(JOBS_DIR, name), ignore_errors=True)


threading.Thread(target=worker_loop, daemon=True).start()
threading.Thread(target=janitor_loop, daemon=True).start()


async def save_upload(up: UploadFile, dest: str) -> list[str]:
    """Stream an upload to disk with a size cap; return its header row."""
    limit = MAX_UPLOAD_MB * 1024 * 1024
    size = 0
    with open(dest, "wb") as f:
        while True:
            chunk = await up.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise HTTPException(413, f"'{up.filename}' is larger than {MAX_UPLOAD_MB} MB")
            f.write(chunk)
    if size == 0:
        raise HTTPException(400, f"'{up.filename}' is empty")
    with open(dest, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        try:
            header = next(csv.reader(io.StringIO(f.readline())))
        except StopIteration:
            raise HTTPException(400, f"'{up.filename}' has no header row")
    header = [h.strip() for h in header]
    if len(header) < 2:
        raise HTTPException(400, f"'{up.filename}' needs at least 2 columns (is it comma-separated?)")
    if len(header) > MAX_COLUMNS:
        raise HTTPException(400, f"'{up.filename}' has {len(header)} columns; the limit is {MAX_COLUMNS}")
    return header


def versions():
    out = {}
    import importlib.metadata as md
    for lib in ("sdv", "sdmetrics", "anonymeter", "scikit-learn", "pandas", "numpy", "scipy"):
        try:
            out[lib] = md.version(lib)
        except Exception:
            out[lib] = None
    return out


@app.get("/api/health")
def health():
    running = sum(1 for v in JOBS.values() if v["status"] == "running")
    return {"status": "ok", "service": "synthetic-data-auditor", "api_version": "1.0",
            "queue": {"queued": len(queued_ids()), "running": running, "max_queue": MAX_QUEUE},
            "limits": {"max_upload_mb": MAX_UPLOAD_MB, "max_rows": MAX_ROWS, "max_columns": MAX_COLUMNS,
                       "jobs_per_hour": JOBS_PER_HOUR, "job_timeout_minutes": JOB_TIMEOUT_S // 60,
                       "result_kept_minutes": RESULT_TTL_S // 60},
            "generators": {"gc": "SDV GaussianCopula", "pcc": "Project copula (per class)"},
            "data_policy": "Uploaded files are deleted when the job ends; only metrics are kept, in memory, for "
                           f"{RESULT_TTL_S // 60} minutes. Saved audits (metrics and column summaries, no data rows) "
                           "are kept in a private list per browser until deleted.",
            "records": {"enabled": True, "persistent": RECORDS_PERSISTENT, "max_kb": RECORD_MAX_KB,
                        "max_records": RECORDS_PER_KEY},
            "versions": versions()}


@app.post("/api/jobs", status_code=202)
async def create_job(request: Request,
                     mode: str = Form(...), target: str = Form(...), task: str = Form(...),
                     generator: str = Form("gc"), name: str = Form(""), sensitive_columns: str = Form(""),
                     membership_column: str = Form(""), steps: str = Form(""),
                     real: UploadFile = File(...), synthetic: UploadFile | None = File(None),
                     holdout: UploadFile | None = File(None)):
    if mode not in ("generate", "audit"):
        raise HTTPException(400, "mode must be 'generate' or 'audit'")
    if task not in ("classification", "regression"):
        raise HTTPException(400, "task must be 'classification' or 'regression'")
    if mode == "generate" and generator not in ("gc", "pcc"):
        raise HTTPException(400, "generator must be 'gc' (SDV GaussianCopula) or 'pcc' (project copula)")
    if mode == "audit" and synthetic is None:
        raise HTTPException(400, "Audit mode needs the synthetic file")
    want = [s.strip() for s in steps.split(",") if s.strip()]
    if [s for s in want if s not in EVAL_STEPS]:
        raise HTTPException(400, "steps must be a comma-separated subset of: " + ", ".join(EVAL_STEPS))
    if len(queued_ids()) >= MAX_QUEUE:
        raise HTTPException(503, "The server queue is full. Please try again in a few minutes.")
    if rate_limited(client_key(request)):
        raise HTTPException(429, f"Limit of {JOBS_PER_HOUR} jobs per hour reached. Please try again later.")

    job_id = uuid.uuid4().hex
    jd = os.path.join(JOBS_DIR, job_id)
    inp = os.path.join(jd, "inputs")
    os.makedirs(inp)
    try:
        hdr = await save_upload(real, os.path.join(inp, "real.csv"))
        target = target.strip()
        if target not in hdr:
            raise HTTPException(400, f"Target column '{target}' is not in the real file")
        mcol = membership_column.strip()
        if mcol and mcol not in hdr:
            raise HTTPException(400, f"Membership column '{mcol}' is not in the real file")
        if mode == "audit":
            shdr = await save_upload(synthetic, os.path.join(inp, "synthetic.csv"))
            need = [h for h in hdr if h != mcol]
            miss = [h for h in need if h not in shdr]
            if miss:
                raise HTTPException(400, "The synthetic file is missing column(s) of the real file: " + ", ".join(miss[:10]))
            if holdout is not None and holdout.filename:
                if mcol:
                    raise HTTPException(400, "Give either a holdout file or a membership column, not both")
                hh = await save_upload(holdout, os.path.join(inp, "holdout.csv"))
                miss = [h for h in hdr if h not in hh]
                if miss:
                    raise HTTPException(400, "The holdout file is missing column(s) of the real file: " + ", ".join(miss[:10]))
        sens = [s.strip() for s in sensitive_columns.split(",") if s.strip()]
        bad = [s for s in sens if s not in hdr]
        if bad:
            raise HTTPException(400, "Sensitive column(s) not in the real file: " + ", ".join(bad))
        job = {"mode": mode, "target": target, "task": task, "generator": generator if mode == "generate" else None,
               "name": name.strip()[:80] or "Uploaded dataset", "sensitive_columns": sens,
               "membership_column": mcol or None, "max_rows": MAX_ROWS, "steps": want or None}
        with open(os.path.join(jd, "job.json"), "w") as f:
            json.dump(job, f)
    except Exception:
        shutil.rmtree(jd, ignore_errors=True)
        raise
    with LOCK:
        JOBS[job_id] = {"status": "queued", "mode": mode, "created": time.time(), "steps": []}
    Q.put(job_id)
    return public(job_id)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "Unknown job (finished results are kept for "
                                 f"{RESULT_TTL_S // 60} minutes, and are lost if the server restarts)")
    return public(job_id)


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(404, "Unknown job")
    j = JOBS[job_id]
    if j["status"] in ("queued", "running"):
        j["cancel"] = True
        if j["status"] == "queued":
            j.update(status="cancelled", error="Cancelled by the user.", finished=time.time())
            remove_dir(job_id)
        return {"id": job_id, "status": "cancelling" if j["status"] == "running" else "cancelled"}
    with LOCK:
        JOBS.pop(job_id, None)
    return {"id": job_id, "status": "deleted"}


@app.get("/")
def index():
    return JSONResponse({"service": "Synthetic Data Auditor API", "docs": "/docs", "health": "/api/health"})


# ───────────────────────── saved audit records (past audits) ─────────────────────────
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{24,128}$")
ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
REC_LOCK = threading.Lock()


def owner_dir(key: str | None) -> str:
    """The folder for one browser key. The key itself is never stored, only a hash of it."""
    if not key or not KEY_RE.match(key):
        raise HTTPException(401, "Missing or invalid X-SDA-Key header")
    d = os.path.join(RECORDS_DIR, hashlib.sha256(("sda-records-" + key).encode()).hexdigest()[:40])
    os.makedirs(d, exist_ok=True)
    return d


def record_path(d: str, rec_id: str) -> str:
    if not ID_RE.match(rec_id or "") or rec_id.startswith("."):
        raise HTTPException(400, "Invalid record id")
    return os.path.join(d, rec_id + ".json")


def records_changed():
    if ON_RECORDS_CHANGED:
        try:
            ON_RECORDS_CHANGED()
        except Exception:
            pass


@app.get("/api/records")
def list_records(x_sda_key: str | None = Header(None)):
    d = owner_dir(x_sda_key)
    out = []
    for name in os.listdir(d):
        if name.endswith(".json"):
            doc = read_json(os.path.join(d, name))
            if doc:
                out.append({"id": doc.get("id"), "saved_at": doc.get("saved_at"), "meta": doc.get("meta") or {}})
    out.sort(key=lambda r: r.get("saved_at") or 0, reverse=True)
    return {"records": out, "max_records": RECORDS_PER_KEY, "persistent": RECORDS_PERSISTENT}


@app.get("/api/records/{rec_id}")
def get_record(rec_id: str, x_sda_key: str | None = Header(None)):
    doc = read_json(record_path(owner_dir(x_sda_key), rec_id))
    if doc is None:
        raise HTTPException(404, "No saved record with this id")
    return doc


@app.put("/api/records/{rec_id}")
async def put_record(rec_id: str, request: Request, x_sda_key: str | None = Header(None)):
    d = owner_dir(x_sda_key)
    p = record_path(d, rec_id)
    raw = await request.body()
    if len(raw) > RECORD_MAX_KB * 1024:
        raise HTTPException(413, f"The record is larger than {RECORD_MAX_KB} KB")
    try:
        body = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "The body must be JSON")
    if not isinstance(body, dict) or not isinstance(body.get("record"), dict):
        raise HTTPException(400, 'The body must be {"meta": {...}, "record": {...}}')
    if rate_limited("rec-" + hashlib.sha256(x_sda_key.encode()).hexdigest()[:16], RECORD_WRITES_PER_HOUR):
        raise HTTPException(429, "Too many saves this hour. Please try again later.")
    with REC_LOCK:
        if not os.path.exists(p) and len([n for n in os.listdir(d) if n.endswith(".json")]) >= RECORDS_PER_KEY:
            raise HTTPException(409, f"This list already holds {RECORDS_PER_KEY} audits. Delete some to save more.")
        meta = body.get("meta") if isinstance(body.get("meta"), dict) else {}
        doc = {"id": rec_id, "saved_at": time.time(), "meta": meta, "record": body["record"]}
        tmp = p + ".tmp"
        with open(tmp, "w") as f:
            json.dump(doc, f)
        os.replace(tmp, p)
    records_changed()
    return {"id": rec_id, "saved_at": doc["saved_at"]}


@app.delete("/api/records/{rec_id}")
def delete_record(rec_id: str, x_sda_key: str | None = Header(None)):
    p = record_path(owner_dir(x_sda_key), rec_id)
    if not os.path.exists(p):
        raise HTTPException(404, "No saved record with this id")
    os.remove(p)
    records_changed()
    return {"id": rec_id, "status": "deleted"}


@app.delete("/api/records")
def delete_all_records(x_sda_key: str | None = Header(None)):
    d = owner_dir(x_sda_key)
    n = 0
    for name in os.listdir(d):
        if name.endswith(".json"):
            os.remove(os.path.join(d, name))
            n += 1
    records_changed()
    return {"deleted": n}
