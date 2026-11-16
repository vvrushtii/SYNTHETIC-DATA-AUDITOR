"""End-to-end tests of the backend API on a small made-up dataset (no real data).

    cd backend && python -m pytest -q tests
"""
import os
import sys
import time

import numpy as np
import pandas as pd
import pytest

os.environ.setdefault("JOBS_PER_HOUR", "1000")
os.environ.setdefault("JOBS_DIR", os.path.join(os.path.dirname(__file__), "_jobs"))
os.environ.setdefault("RECORDS_DIR", os.path.join(os.path.dirname(__file__), "_records"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from fastapi.testclient import TestClient  # noqa: E402

import app as api  # noqa: E402

client = TestClient(api.app)


def toy(n, seed):
    rng = np.random.default_rng(seed)
    income = rng.normal(50, 15, n).round(1)
    return pd.DataFrame({
        "age": rng.integers(18, 80, n),
        "income": income,
        "city": rng.choice(["north", "south", "east", "west"], n),
        "score": (income * 0.4 + rng.normal(0, 5, n)).round(2),
        "label": np.where(income + rng.normal(0, 8, n) > 50, "yes", "no"),
    })


@pytest.fixture(scope="module")
def files(tmp_path_factory):
    d = tmp_path_factory.mktemp("data")
    train, hold = toy(400, 1), toy(100, 2)
    p = {k: str(d / f"{k}.csv") for k in ("train", "hold", "copy", "marked", "fresh")}
    train.to_csv(p["train"], index=False)
    hold.to_csv(p["hold"], index=False)
    train.to_csv(p["copy"], index=False)                      # "synthetic" data that just copies the training rows
    pd.concat([train.assign(member=1), hold.assign(member=0)]).to_csv(p["marked"], index=False)
    toy(400, 3).to_csv(p["fresh"], index=False)               # independent draw from the same population
    return p


def post(form, uploads):
    fh = {k: open(v, "rb") for k, v in uploads.items()}
    try:
        return client.post("/api/jobs", data=form, files={k: (os.path.basename(v.name), v, "text/csv") for k, v in fh.items()})
    finally:
        for v in fh.values():
            v.close()


def wait(job_id, timeout=900):
    t = time.time()
    while time.time() - t < timeout:
        j = client.get(f"/api/jobs/{job_id}").json()
        if j["status"] in ("completed", "failed", "cancelled"):
            return j
        time.sleep(2)
    raise TimeoutError(job_id)


def steps(rec):
    return {k: v["status"] for k, v in rec["steps"].items()}


def test_health():
    r = client.get("/api/health").json()
    assert r["status"] == "ok" and r["limits"]["max_rows"] == 30000 and "sdv" in r["versions"]


def test_validation(files):
    base = {"mode": "generate", "target": "label", "task": "classification"}
    assert post({**base, "target": "nope"}, {"real": files["train"]}).status_code == 400
    assert post({**base, "mode": "audit"}, {"real": files["train"]}).status_code == 400
    assert post({**base, "mode": "x"}, {"real": files["train"]}).status_code == 400
    assert post({**base, "generator": "ctgan"}, {"real": files["train"]}).status_code == 400
    assert post({**base, "sensitive_columns": "salary"}, {"real": files["train"]}).status_code == 400


@pytest.mark.parametrize("gen", ["gc", "pcc"])
def test_generate_job(files, gen):
    r = post({"mode": "generate", "target": "label", "task": "classification", "generator": gen, "name": "Toy"},
             {"real": files["train"]})
    assert r.status_code == 202, r.text
    j = wait(r.json()["id"])
    assert j["status"] == "completed", j.get("error")
    rec = j["result"]
    assert rec["schema"] == "sda-result/1.0" and rec["dataset"] == "Toy" and rec["generator_key"] == gen
    assert rec["members_rows"] == 320 and rec["holdout_rows"] == 80
    st = steps(rec)
    assert set(st) == {"generate", "fidelity", "utility", "mia_distance", "exact_match", "mia_shadow",
                       "singling_out", "linkability", "attribute_inference"}
    assert all(v == "completed" for v in st.values()), st
    assert j["data_deleted"] and not os.path.exists(os.path.join(api.JOBS_DIR, j["id"]))
    assert "upload" in rec["source"] and "csv" not in rec["source"]          # no server paths leak


def test_audit_copy_is_flagged(files):
    """Uploading the training rows themselves as 'synthetic' data must light up the privacy tests."""
    r = post({"mode": "audit", "target": "label", "task": "classification"},
             {"real": files["train"], "synthetic": files["copy"], "holdout": files["hold"]})
    j = wait(r.json()["id"])
    assert j["status"] == "completed", j.get("error")
    rec = j["result"]
    assert rec["members_rows"] == 400 and rec["holdout_rows"] == 100 and rec["generator_key"] == "user"
    assert rec["steps"]["exact_match"]["result"]["excess_over_holdout_pct"] > 90
    assert rec["steps"]["mia_distance"]["result"]["roc_auc"] > 0.9
    assert any("stand-in" in n for n in rec["steps"]["mia_shadow"]["notes"])


def test_audit_membership_column(files):
    r = post({"mode": "audit", "target": "label", "task": "classification", "membership_column": "member"},
             {"real": files["marked"], "synthetic": files["fresh"]})
    j = wait(r.json()["id"])
    assert j["status"] == "completed", j.get("error")
    rec = j["result"]
    assert rec["members_rows"] == 400 and rec["holdout_rows"] == 100 and "member" not in rec["columns"]
    assert rec["steps"]["exact_match"]["result"]["excess_over_holdout_pct"] < 5


def test_audit_without_holdout_runs_no_attacks(files):
    r = post({"mode": "audit", "target": "label", "task": "classification"},
             {"real": files["train"], "synthetic": files["fresh"]})
    j = wait(r.json()["id"])
    assert j["status"] == "completed", j.get("error")
    st = steps(j["result"])
    assert st["fidelity"] == "completed"
    assert all(st[k] == "not_run" for k in st if k not in ("generate", "fidelity")), st
    assert "not evidence of low risk" in j["result"]["steps"]["singling_out"]["notes"][0]


def test_bad_synthetic_fails_cleanly(files, tmp_path):
    bad = tmp_path / "bad.csv"
    pd.DataFrame({"age": [1, 2], "label": ["a", "b"], "x": [0, 1]}).to_csv(bad, index=False)
    r = post({"mode": "audit", "target": "label", "task": "classification"},
             {"real": files["train"], "synthetic": str(bad)})
    assert r.status_code == 400 and "missing column" in r.json()["detail"]


def test_cancel(files):
    ids = [post({"mode": "generate", "target": "label", "task": "classification"}, {"real": files["train"]}).json()["id"]
           for _ in range(2)]
    d = client.delete(f"/api/jobs/{ids[1]}").json()        # the second one is still waiting behind the first
    assert d["status"] in ("cancelled", "cancelling")
    j = wait(ids[1])
    assert j["status"] == "cancelled" and j["data_deleted"]
    client.delete(f"/api/jobs/{ids[0]}")
    assert wait(ids[0])["status"] in ("cancelled", "completed")


def test_steps_subset(files):
    """Only the requested evaluation steps run; the rest are reported as not run."""
    r = post({"mode": "audit", "target": "label", "task": "classification", "membership_column": "member",
              "steps": "singling_out,linkability"}, {"real": files["marked"], "synthetic": files["fresh"]})
    assert r.status_code == 202, r.text
    j = wait(r.json()["id"])
    assert j["status"] == "completed", j.get("error")
    st = steps(j["result"])
    assert st["singling_out"] == "completed" and st["linkability"] == "completed"
    assert st["fidelity"] == "not_run" and st["mia_shadow"] == "not_run"
    assert post({"mode": "audit", "target": "label", "task": "classification", "steps": "bogus"},
                {"real": files["train"], "synthetic": files["fresh"]}).status_code == 400


def test_records():
    key, other = "k" * 32, "z" * 32
    h = {"X-SDA-Key": key}
    assert client.get("/api/records").status_code == 401
    assert client.get("/api/records", headers={"X-SDA-Key": "short"}).status_code == 401
    rec = {"meta": {"name": "Toy", "kind": "audit"}, "record": {"id": "a1", "fidelity": {"overall": 0.9}}}
    assert client.put("/api/records/a1", json=rec, headers=h).status_code == 200
    assert client.put("/api/records/..%2Fx", json=rec, headers=h).status_code in (400, 404)
    assert client.put("/api/records/a2", content=b"not json", headers=h).status_code == 400
    lst = client.get("/api/records", headers=h).json()["records"]
    assert [r["id"] for r in lst] == ["a1"] and lst[0]["meta"]["name"] == "Toy"
    assert client.get("/api/records/a1", headers=h).json()["record"]["fidelity"]["overall"] == 0.9
    assert client.get("/api/records", headers={"X-SDA-Key": other}).json()["records"] == []   # private per key
    assert client.get("/api/records/a1", headers={"X-SDA-Key": other}).status_code == 404
    assert client.delete("/api/records/a1", headers=h).json()["status"] == "deleted"
    assert client.get("/api/records", headers=h).json()["records"] == []
    client.put("/api/records/b1", json=rec, headers=h)
    client.put("/api/records/b2", json=rec, headers=h)
    assert client.delete("/api/records", headers=h).json()["deleted"] == 2
    files_on_disk = " ".join(os.listdir(api.RECORDS_DIR))
    assert key not in files_on_disk                                      # only a hash of the key is stored
