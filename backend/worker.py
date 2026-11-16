"""Run one audit job in its own process.

    python worker.py <job_dir>

<job_dir>/job.json holds the settings, <job_dir>/inputs/ the uploaded CSVs. The worker writes
<job_dir>/progress.json after every step and <job_dir>/result.json (schema sda-result/1.0) at the end.
All data files live under <job_dir>; the server deletes that folder as soon as the job ends.
Nothing here logs data values.
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(HERE, "..", "pipeline")]   # Docker image: next to this file; repository: ../pipeline
import sda_pipeline as P  # noqa: E402  (the same pipeline the 41-dataset study used)

MEMBER_COL = "__sda_member__"
MIN_ROWS = 50
MIN_HOLDOUT = 20
P.GENERATORS["user"] = {"folder": "user_supplied", "short": "Uploaded synthetic data",
                        "label": "Synthetic data uploaded by the user (generator unknown to the auditor)"}
STEP_LABELS = {"clean": "Cleaning", "generate": "Generating synthetic data", "prepare": "Checking the synthetic file",
               "fidelity": "Fidelity", "utility": "Utility", "mia_distance": "Membership inference (distance)",
               "exact_match": "Exact-match test", "mia_shadow": "Membership inference (shadow models)",
               "singling_out": "Singling-out attack", "linkability": "Linkability attack",
               "attribute_inference": "Attribute-inference attack", "assemble": "Writing the result"}
NO_HOLDOUT = ("No holdout rows were provided, so this test was not run. Privacy attacks and the utility test need real "
              "rows the generator never saw. This is not evidence of low risk.")


def write_json(p, obj):
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, default=str)
    os.replace(tmp, p)


class Progress:
    def __init__(self, job_dir, steps):
        self.p = os.path.join(job_dir, "progress.json")
        self.steps = [{"key": s, "label": STEP_LABELS[s], "status": "pending", "seconds": None} for s in steps]
        self.save()

    def set(self, key, status, seconds=None):
        for s in self.steps:
            if s["key"] == key:
                s["status"], s["seconds"] = status, seconds
        self.save()

    def save(self):
        write_json(self.p, {"steps": self.steps, "updated": time.time()})


def read_upload(p):
    """Uploaded CSV as text columns exactly as given (the cleaning step decides types)."""
    return pd.read_csv(p, low_memory=False)


def normalise_synthetic(syn: pd.DataFrame, schema: dict, target: str, task: str) -> tuple[pd.DataFrame, list]:
    """Bring an uploaded synthetic table into the cleaned real table's columns and value forms."""
    notes = []
    syn = syn.copy()
    syn.columns = [str(c).strip() for c in syn.columns]
    missing = [c for c in schema["columns"] if c not in syn.columns]
    if missing:
        raise ValueError(f"The synthetic file is missing {len(missing)} column(s) of the cleaned real data: "
                         + ", ".join(missing[:10]) + (" ..." if len(missing) > 10 else ""))
    extra = [c for c in syn.columns if c not in schema["columns"]]
    if extra:
        notes.append(f"Ignored {len(extra)} synthetic column(s) that are not in the cleaned real data")
    syn = syn[schema["columns"]]
    for c in schema["columns"]:
        s = syn[c]
        if s.dtype == bool:
            s = s.map({True: "True", False: "False"})
        if s.dtype == object:
            t = s.astype("string").str.strip().replace({"?": pd.NA, "": pd.NA, "NA": pd.NA, "nan": pd.NA})
            s = t.astype(object).where(t.notna(), np.nan)
        if c in schema["numerical"]:
            conv = pd.to_numeric(s, errors="coerce")
            bad = int(conv.isna().sum() - s.isna().sum())
            if bad > 0:
                notes.append(f"Column '{c}': {bad} synthetic value(s) were not numbers and were treated as missing")
            s = conv
        else:  # categorical: same text form as the cleaned real data (e.g. class 1.0 -> "1")
            s = s.map(lambda v: v if pd.isna(v) else (str(int(v)) if isinstance(v, (int, float, np.integer, np.floating))
                                                       and float(v).is_integer() else str(v)))
        syn[c] = s
    return syn, notes


def save_part(root, cfg, gen, name, status, result=None, notes=None, seconds=0.0, error=None):
    st = P.Step(name)
    st.status, st.result, st.notes, st.seconds, st.error = status, result or {}, notes or [], seconds, error
    return P._save_part(root, cfg, gen, st)


def add_note(root, cfg, gen, step, note):
    p = P.path(root, "part", cfg, gen, step)
    d = json.load(open(p))
    d.setdefault("notes", []).append(note)
    write_json(p, d)


def run(job_dir):
    job = json.load(open(os.path.join(job_dir, "job.json")))
    inp = os.path.join(job_dir, "inputs")
    root = os.path.join(job_dir, "work")
    mode = job["mode"]                                  # "generate" | "audit"
    cfg = {"name": job.get("name") or "Uploaded dataset", "slug": "upload", "group": "upload",
           "target": job["target"], "task": job["task"], "max_rows": int(job.get("max_rows") or 30000),
           "source": {"csv": os.path.join(inp, "real.csv")}, "domain": None, "person_level": None}
    if job.get("sensitive_columns"):
        cfg["sensitive_columns"] = list(job["sensitive_columns"])

    if mode == "generate":
        gen = job["generator"]
        steps = ["clean", "generate"] + P.EVAL_STEPS + ["assemble"]
    else:
        gen = "user"
        steps = ["clean", "prepare"] + P.EVAL_STEPS + ["assemble"]
        cfg["shadow_generator"] = "gc"
        real = read_upload(os.path.join(inp, "real.csv"))
        if os.path.exists(os.path.join(inp, "holdout.csv")):
            hold = read_upload(os.path.join(inp, "holdout.csv"))
            hold.columns = [str(c).strip() for c in hold.columns]
            real.columns = [str(c).strip() for c in real.columns]
            miss = [c for c in real.columns if c not in hold.columns]
            if miss:
                raise ValueError("The holdout file is missing column(s) of the real file: " + ", ".join(miss[:10]))
            both = pd.concat([real.assign(**{MEMBER_COL: 1}), hold[list(real.columns)].assign(**{MEMBER_COL: 0})],
                             ignore_index=True)
            cfg["split_description"] = "Training rows = uploaded real file; holdout rows = uploaded holdout file"
        elif job.get("membership_column"):
            mc = job["membership_column"]
            if mc not in real.columns:
                raise ValueError(f"Membership column '{mc}' was not found in the real file")
            both = real.rename(columns={mc: MEMBER_COL})
            cfg["split_description"] = f"Training and holdout rows as marked in the membership column '{mc}'"
        else:
            both = real.assign(**{MEMBER_COL: 1})
            cfg["split_description"] = "No holdout provided: every real row treated as a training row"
        both.to_csv(os.path.join(inp, "real_combined.csv"), index=False)
        del real
        cfg["source"] = {"csv": os.path.join(inp, "real_combined.csv")}
        cfg["membership_column"] = MEMBER_COL

    prog = Progress(job_dir, steps)

    prog.set("clean", "running")
    t = time.time()
    meta = P.stage_clean(cfg, root, config_dir=inp)
    prog.set("clean", "completed", round(time.time() - t, 2))
    if meta["rows_after_cleaning"] < MIN_ROWS:
        raise ValueError(f"Only {meta['rows_after_cleaning']} rows are left after cleaning; at least {MIN_ROWS} are needed")
    if cfg["target"] not in meta["schema"]["columns"]:
        raise ValueError(f"The target column '{cfg['target']}' was removed during cleaning")

    df, members, holdout, meta = P.load_clean(cfg, root)
    if 0 < len(holdout) < MIN_HOLDOUT:
        raise ValueError(f"Only {len(holdout)} holdout rows after cleaning; at least {MIN_HOLDOUT} are needed for the attacks")
    if len(members) < MIN_ROWS:
        raise ValueError(f"Only {len(members)} training rows after cleaning; at least {MIN_ROWS} are needed")

    if mode == "generate":
        prog.set("generate", "running")
        g = P.stage_generate(cfg, root, gen)
        prog.set("generate", g["status"], g["seconds"])
        if g["status"] != "completed":
            raise RuntimeError("Generation failed: " + (g.get("error") or "unknown error"))
    else:
        prog.set("prepare", "running")
        t = time.time()
        syn, notes = normalise_synthetic(read_upload(os.path.join(inp, "synthetic.csv")), meta["schema"],
                                         cfg["target"], cfg["task"])
        if len(syn) < 10:
            raise ValueError("The synthetic file has fewer than 10 rows")
        P.write_table(syn, P.path(root, "synthetic", cfg, gen))
        syn = P.load_synth(cfg, root, gen, meta)
        save_part(root, cfg, gen, "generate", "completed", seconds=round(time.time() - t, 2),
                  result={"synthetic_rows": int(len(syn)), "synthetic_missing_cells": int(syn.isna().sum().sum()),
                          "training_rows": int(len(members)), "holdout_rows": int(len(holdout))},
                  notes=["Synthetic data was uploaded, not generated on the server."] + notes)
        prog.set("prepare", "completed", round(time.time() - t, 2))

    for step in P.EVAL_STEPS:
        if len(holdout) == 0 and step != "fidelity":
            save_part(root, cfg, gen, step, "not_run", notes=[NO_HOLDOUT])
            prog.set(step, "not_run")
            continue
        prog.set(step, "running")
        d = P.stage_evaluate(cfg, root, gen, step)
        if step == "mia_shadow" and gen == "user" and d["status"] == "completed":
            add_note(root, cfg, gen, step, "The generator behind the uploaded data is unknown, so the attacker's shadow "
                                           "models use SDV GaussianCopula as a stand-in.")
        prog.set(step, d["status"], d["seconds"])

    prog.set("assemble", "running")
    rec = P.assemble(cfg, root, gen)
    rec["source"] = {"upload": True}
    rec["server"] = {"mode": mode, "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                     "data_retention": "Uploaded files and all intermediate data were deleted when this job ended."}
    write_json(os.path.join(job_dir, "result.json"), rec)
    prog.set("assemble", "completed")


if __name__ == "__main__":
    jd = sys.argv[1]
    try:
        run(jd)
    except Exception as e:  # the message goes back to the uploader only; nothing is logged
        write_json(os.path.join(jd, "error.json"), {"error": f"{type(e).__name__}: {e}",
                                                    "where": traceback.extract_tb(e.__traceback__)[-1].name})
        sys.exit(1)
