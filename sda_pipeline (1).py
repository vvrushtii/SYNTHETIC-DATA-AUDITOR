"""
Synthetic Data Auditor - standard evaluation pipeline.

Runs the project's method end to end for one real dataset:

  1. Clean (logged, reversible steps only).
  2. Split real rows into MEMBERS (80%) and HOLDOUT (20%), stratified on the
     target for classification, random_state=42 - the same split the project's
     MIA notebooks use.
  3. Fit SDV GaussianCopulaSynthesizer(enforce_min_max_values=True,
     enforce_rounding=True) on MEMBERS only and sample len(MEMBERS) rows - the
     same generator settings as the project notebooks.
  4. Fidelity: SDMetrics QualityReport (column shapes, column pair trends) and
     mean absolute numeric correlation difference (upper triangle only).
  5. Utility: random forest (100 trees, seed 42). TRTR = train on MEMBERS,
     TSTR = train on SYNTHETIC, both tested on HOLDOUT, which the generator
     never saw.
  6. Privacy - six attacks:
       a. Distance-to-closest-record MIA (the project's existing attack)
       b. Exact-match / copy test
       c. Shadow-model MIA (GaussianCopula shadow generators)
       d. Singling-out        (Anonymeter)
       e. Linkability         (Anonymeter)
       f. Attribute inference (Anonymeter)
     HOLDOUT is the control set / non-member set for every attack.
  7. Write one JSON result file in a fixed schema.

Usage:
  python sda_pipeline.py --config datasets.json --name "Heart Disease" --out results/
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
import traceback
import warnings
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

SEED = 42
SCHEMA_VERSION = "sda-result/1.0"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _f(x):
    """JSON-safe float (None for NaN/inf)."""
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def sha256_df(df: pd.DataFrame) -> str:
    return hashlib.sha256(pd.util.hash_pandas_object(df, index=False).values.tobytes()).hexdigest()


@dataclass
class Step:
    name: str
    status: str = "not_run"          # completed | failed | skipped | not_applicable
    seconds: float = 0.0
    error: str | None = None
    result: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)


def run_step(step: Step, fn, *a, **k):
    t = time.time()
    try:
        out = fn(*a, **k)
        if isinstance(out, tuple) and len(out) == 2 and out[0] in ("skipped", "not_applicable"):
            step.status, step.notes = out[0], [out[1]]
        else:
            step.status, step.result = "completed", out or {}
    except Exception as e:  # failure isolation: one step never stops the run
        step.status, step.error = "failed", f"{type(e).__name__}: {e}"
        step.notes.append(traceback.format_exc(limit=3))
    step.seconds = round(time.time() - t, 2)
    return step


# ---------------------------------------------------------------------------
# 1. cleaning
# ---------------------------------------------------------------------------
def clean(df: pd.DataFrame, cfg: dict):
    log = []
    n0 = len(df)
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]

    drop = [c for c in cfg.get("drop_columns", []) if c in df.columns]
    if drop:
        df = df.drop(columns=drop)
        log.append(f"Dropped configured columns: {drop}")

    for c in df.columns:
        if df[c].dtype == bool:  # SDV rejects booleans in numerical columns
            df[c] = df[c].map({True: "True", False: "False"})
            log.append(f"Stored boolean column '{c}' as categorical text")
    for c in df.columns:
        if df[c].dtype == object:
            s = df[c].astype("string").str.strip()
            s = s.replace({"?": pd.NA, "": pd.NA, "NA": pd.NA, "nan": pd.NA})
            df[c] = s.astype(object).where(s.notna(), np.nan)
    log.append("Trimmed whitespace; '?', '' and 'NA' treated as missing")

    # numeric strings -> numbers (only when every non-missing value parses)
    for c in df.columns:
        if df[c].dtype == object:
            conv = pd.to_numeric(df[c], errors="coerce")
            if conv.notna().sum() == df[c].notna().sum() and df[c].notna().any():
                df[c] = conv
                log.append(f"Converted '{c}' to numeric")

    tgt = cfg["target"]
    if cfg.get("strip_label_dots") and df[tgt].dtype == object:
        df[tgt] = df[tgt].str.rstrip(".")
        log.append("Removed trailing '.' from target labels")
    for k, v in (cfg.get("label_map") or {}).items():
        df[tgt] = df[tgt].replace(k, v)

    if cfg["task"] == "classification" and pd.api.types.is_numeric_dtype(df[tgt]):
        # Class labels coded as numbers (0/1, 1-7) must be modelled as
        # categories; as a numerical column the generator treats them as a
        # continuous value and can collapse to a single class.
        df[tgt] = df[tgt].map(lambda v: v if pd.isna(v) else (str(int(v)) if float(v).is_integer() else str(v)))
        log.append(f"Stored numeric class labels in '{tgt}' as categories")

    before = len(df)
    df = df[df[tgt].notna()]
    if len(df) < before:
        log.append(f"Removed {before-len(df)} rows with missing target")

    miss = df.isna().mean()
    hi = [c for c in df.columns if c != tgt and miss[c] > 0.5]
    if hi:
        df = df.drop(columns=hi)
        log.append(f"Dropped columns >50% missing: {hi}")

    const = [c for c in df.columns if c != tgt and df[c].nunique(dropna=True) <= 1]
    if const:
        df = df.drop(columns=const)
        log.append(f"Dropped constant columns: {const}")

    before = len(df)
    df = df.drop_duplicates().reset_index(drop=True)
    if len(df) < before:
        log.append(f"Removed {before-len(df)} exact duplicate rows")

    if cfg.get("max_rows") and len(df) > cfg["max_rows"]:
        df = df.sample(cfg["max_rows"], random_state=SEED).reset_index(drop=True)
        log.append(f"Seeded random sample of {cfg['max_rows']} rows (from {before})")

    log.append(f"Rows: {n0} -> {len(df)}; columns: {df.shape[1]}")
    return df, log


# ---------------------------------------------------------------------------
# 2-3. split + generator
# ---------------------------------------------------------------------------
def split(df, cfg):
    from sklearn.model_selection import train_test_split
    strat = None
    if cfg["task"] == "classification":
        vc = df[cfg["target"]].value_counts()
        if vc.min() >= 2:
            strat = df[cfg["target"]]
    m, h = train_test_split(df, test_size=0.20, random_state=SEED, stratify=strat)
    return m.reset_index(drop=True), h.reset_index(drop=True)


def sdv_metadata(df):
    # Built explicitly instead of Metadata.detect_from_dataframe(): that method
    # was removed in SDV 2.x (the cause of the project's failed fidelity runs
    # for datasets 6-11), and explicit sdtypes stop SDV from treating a column
    # as an ID/PII field and generating fake values for it.
    from sdv.metadata import Metadata
    cols = {}
    for c in df.columns:
        cols[c] = {"sdtype": "numerical"} if pd.api.types.is_numeric_dtype(df[c]) else {"sdtype": "categorical"}
    md = Metadata.load_from_dict({"tables": {"t": {"columns": cols}}})
    md.validate()
    return md


def fit_sample(train, n_rows, seed=SEED):
    from sdv.single_table import GaussianCopulaSynthesizer
    np.random.seed(seed)
    syn = GaussianCopulaSynthesizer(sdv_metadata(train), enforce_min_max_values=True, enforce_rounding=True)
    try:                       # SDV 1.x: DataFrame in / DataFrame out
        syn.fit(train)
    except Exception as e:     # SDV 2.x: {table_name: DataFrame} in / out
        if "dictionary" not in str(e):
            raise
        syn.fit({"t": train})
    out = syn.sample(num_rows=n_rows)
    if isinstance(out, dict):
        out = out["t"]
    return out[train.columns]


# ---------------------------------------------------------------------------
# shared encoding (numeric standardised, categoricals one-hot)
# ---------------------------------------------------------------------------
class Encoder:
    def __init__(self, ref: pd.DataFrame, cols):
        self.cols = list(cols)
        self.num = [c for c in self.cols if pd.api.types.is_numeric_dtype(ref[c])]
        self.cat = [c for c in self.cols if c not in self.num]
        self.med = ref[self.num].median() if self.num else None
        self.mu = ref[self.num].mean() if self.num else None
        sd = ref[self.num].std(ddof=0) if self.num else None
        self.sd = sd.replace(0, 1) if sd is not None else None
        self.levels = {c: sorted(ref[c].astype(str).unique()) for c in self.cat}

    def __call__(self, df):
        parts = []
        if self.num:
            x = df[self.num].apply(pd.to_numeric, errors="coerce").fillna(self.med)
            parts.append(((x - self.mu) / self.sd).to_numpy(float))
        for c in self.cat:
            v = df[c].astype(str).to_numpy()
            lv = self.levels[c]
            parts.append(np.stack([(v == l) for l in lv], axis=1).astype(float) if lv else np.zeros((len(df), 0)))
        return np.hstack(parts) if parts else np.zeros((len(df), 0))


def nn_dist(a, b, k=1):
    from sklearn.neighbors import NearestNeighbors
    nn = NearestNeighbors(n_neighbors=min(k, len(b))).fit(b)
    d, _ = nn.kneighbors(a)
    return d


def auc_tpr(y, score):
    from sklearn.metrics import roc_auc_score, roc_curve
    auc = roc_auc_score(y, score)
    fpr, tpr, _ = roc_curve(y, score)
    i = int(np.argmin(np.abs(fpr - 0.10)))
    # bootstrap 95% CI for AUC
    rng = np.random.default_rng(SEED)
    y = np.asarray(y); score = np.asarray(score)
    bs = []
    for _ in range(200):
        idx = rng.integers(0, len(y), len(y))
        if len(np.unique(y[idx])) == 2:
            bs.append(roc_auc_score(y[idx], score[idx]))
    lo, hi = (np.percentile(bs, [2.5, 97.5]) if bs else (np.nan, np.nan))
    return {"roc_auc": _f(auc), "roc_auc_ci95": [_f(lo), _f(hi)],
            "tpr_at_10pct_fpr": _f(tpr[i]), "actual_fpr": _f(fpr[i])}


# ---------------------------------------------------------------------------
# 4. fidelity
# ---------------------------------------------------------------------------
def fidelity(real, syn):
    from sdmetrics.reports.single_table import QualityReport
    md = {"columns": {c: {"sdtype": "numerical" if pd.api.types.is_numeric_dtype(real[c]) else "categorical"}
                      for c in real.columns}}
    rep = QualityReport()
    rep.generate(real, syn, md, verbose=False)
    props = rep.get_properties()
    p = dict(zip(props["Property"], props["Score"]))
    shapes = rep.get_details(property_name="Column Shapes")
    num = [c for c in real.columns if pd.api.types.is_numeric_dtype(real[c])]
    corr = None
    if len(num) >= 2:
        d = (real[num].corr() - syn[num].corr()).abs().to_numpy()
        iu = np.triu_indices_from(d, k=1)
        corr = _f(np.nanmean(d[iu]))
    worst = shapes.sort_values("Score").head(5)
    return {
        "metric_engine": "sdmetrics.QualityReport (single table)",
        "overall_quality": _f(rep.get_score()),
        "column_shapes": _f(p.get("Column Shapes")),
        "column_pair_trends": _f(p.get("Column Pair Trends")),
        "mean_abs_correlation_difference_upper_triangle": corr,
        "weakest_columns": [{"column": r.Column, "metric": r.Metric, "score": _f(r.Score)} for r in worst.itertuples()],
    }


# ---------------------------------------------------------------------------
# 5. utility
# ---------------------------------------------------------------------------
def utility(members, holdout, syn, cfg):
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
    from sklearn import metrics as M
    tgt, task = cfg["target"], cfg["task"]
    feats = [c for c in members.columns if c != tgt]
    enc = Encoder(members, feats)
    Xm, Xh, Xs = enc(members), enc(holdout), enc(syn)
    res = {"model": "RandomForest(n_estimators=100, random_state=42)", "task": task,
           "train_real_rows": len(members), "train_synthetic_rows": len(syn), "test_real_rows": len(holdout),
           "test_set": "real holdout never seen by the generator"}
    if task == "classification":
        ym, yh, ys = (members[tgt].astype(str), holdout[tgt].astype(str), syn[tgt].astype(str))
        out = {}
        for k, (X, y) in {"trtr": (Xm, ym), "tstr": (Xs, ys)}.items():
            if y.nunique() < 2:
                out[k] = None; continue
            mdl = RandomForestClassifier(n_estimators=100, random_state=SEED, n_jobs=-1).fit(X, y)
            p = mdl.predict(Xh)
            out[k] = {"accuracy": _f(M.accuracy_score(yh, p)),
                      "f1_macro": _f(M.f1_score(yh, p, average="macro", zero_division=0)),
                      "f1_weighted": _f(M.f1_score(yh, p, average="weighted", zero_division=0)),
                      "balanced_accuracy": _f(M.balanced_accuracy_score(yh, p))}
        res.update(out)
        res["primary_metric"] = "f1_macro"
        if out.get("trtr") and out.get("tstr") and out["trtr"]["f1_macro"]:
            res["retention_pct"] = _f(100 * out["tstr"]["f1_macro"] / out["trtr"]["f1_macro"])
        res["majority_class_baseline_accuracy"] = _f((yh == ym.value_counts().idxmax()).mean())
    else:
        ym, yh, ys = (pd.to_numeric(members[tgt]), pd.to_numeric(holdout[tgt]), pd.to_numeric(syn[tgt]))
        out = {}
        for k, (X, y) in {"trtr": (Xm, ym), "tstr": (Xs, ys)}.items():
            mdl = RandomForestRegressor(n_estimators=100, random_state=SEED, n_jobs=-1).fit(X, y)
            p = mdl.predict(Xh)
            out[k] = {"mae": _f(M.mean_absolute_error(yh, p)),
                      "rmse": _f(math.sqrt(M.mean_squared_error(yh, p))),
                      "r2": _f(M.r2_score(yh, p))}
        res.update(out)
        res["primary_metric"] = "r2"
        tr, ts = out["trtr"]["r2"], out["tstr"]["r2"]
        res["retention_pct"] = _f(100 * ts / tr) if tr and tr > 0 else None
        if not (tr and tr > 0):
            res["retention_note"] = "TRTR R2 <= 0: the real-data model does not beat predicting the mean, so retention is not meaningful"
    return res


# ---------------------------------------------------------------------------
# 6a. DCR membership inference (project's existing attack)
# ---------------------------------------------------------------------------
def attack_dcr(members, holdout, syn, cols):
    enc = Encoder(pd.concat([members, holdout, syn]), cols)
    real = pd.concat([members, holdout], ignore_index=True)
    y = np.r_[np.ones(len(members)), np.zeros(len(holdout))]
    d = nn_dist(enc(real), enc(syn))[:, 0]
    r = auc_tpr(y, -d)
    r.update({"method": "nearest synthetic record distance (Euclidean, standardised numeric + one-hot)",
              "member_mean_distance": _f(d[y == 1].mean()), "nonmember_mean_distance": _f(d[y == 0].mean()),
              "members": len(members), "nonmembers": len(holdout)})
    return r


# ---------------------------------------------------------------------------
# 6b. exact match / copy test
# ---------------------------------------------------------------------------
def attack_exact(members, holdout, syn):
    key = lambda df: pd.util.hash_pandas_object(df.astype(str), index=False)
    s = set(key(syn))
    m_hit = float(np.mean([h in s for h in key(members)]))
    h_hit = float(np.mean([h in s for h in key(holdout)]))
    sm = set(key(members))
    syn_copies = float(np.mean([h in sm for h in key(syn)]))
    return {"member_rows_reproduced_pct": _f(100 * m_hit), "holdout_rows_reproduced_pct": _f(100 * h_hit),
            "synthetic_rows_identical_to_a_member_pct": _f(100 * syn_copies),
            "excess_over_holdout_pct": _f(100 * (m_hit - h_hit)),
            "note": "Holdout rows were never seen by the generator, so their match rate is the chance level."}


# ---------------------------------------------------------------------------
# 6c. shadow-model MIA
# ---------------------------------------------------------------------------
def attack_shadow(members, holdout, syn, cols, n_shadows=6, k=5):
    """
    Attacker knowledge: the generator algorithm and settings (GaussianCopula,
    min/max + rounding) and an auxiliary pool of real records from the same
    population (half of the holdout, disjoint from the evaluation records).

    Shadow training: for each shadow s, a random half of the pool is 'in',
    the rest 'out'; a GaussianCopula is fitted on the 'in' half and sampled.
    Features per record = distances to its k nearest shadow-synthetic rows,
    normalised by the record's distance to its nearest other pool record.
    A gradient-boosting classifier learns in vs out.

    Evaluation: the same features are computed against the released synthetic
    data (sub-sampled to the shadow synthetic size) for held-out members and
    the other half of the holdout (non-members).
    """
    from sklearn.ensemble import HistGradientBoostingClassifier
    rng = np.random.default_rng(SEED)
    hold = holdout.sample(frac=1, random_state=SEED).reset_index(drop=True)
    pool, eval_non = hold.iloc[: len(hold) // 2], hold.iloc[len(hold) // 2:]
    if len(pool) < 25 or len(eval_non) < 25:
        return ("skipped", f"Holdout too small for shadow models ({len(holdout)} rows; need >= 50)")
    eval_mem = members.sample(len(eval_non), random_state=SEED)
    enc = Encoder(pd.concat([members, holdout]), cols)
    P = enc(pool)
    ref_pool = nn_dist(P, P, k=2)[:, 1] + 1e-9

    def feats(Xr, Xs, ref):
        d = nn_dist(Xr, Xs, k=k)
        return np.c_[d[:, 0], d.mean(1), d[:, 0] / ref, d.mean(1) / ref]

    Xtr, ytr = [], []
    half = len(pool) // 2
    for s in range(n_shadows):
        idx = rng.permutation(len(pool))
        inn = idx[:half]
        lab = np.zeros(len(pool)); lab[inn] = 1
        sh = fit_sample(pool.iloc[inn][members.columns].reset_index(drop=True), half, seed=SEED + s + 1)
        Xtr.append(feats(P, enc(sh), ref_pool)); ytr.append(lab)
    clf = HistGradientBoostingClassifier(random_state=SEED).fit(np.vstack(Xtr), np.concatenate(ytr))

    E = pd.concat([eval_mem, eval_non], ignore_index=True)
    XE = enc(E)
    refE = nn_dist(XE, P, k=1)[:, 0] + 1e-9
    yE = np.r_[np.ones(len(eval_mem)), np.zeros(len(eval_non))]
    S = enc(syn)
    scores = []
    for r in range(5):  # match the shadow synthetic size, average over draws
        sub = S[rng.choice(len(S), size=min(half, len(S)), replace=False)]
        scores.append(clf.predict_proba(feats(XE, sub, refE))[:, 1])
    res = auc_tpr(yE, np.mean(scores, 0))
    res.update({"method": "shadow GaussianCopula generators + distance features + gradient boosting",
                "shadow_models": n_shadows, "attacker_pool_rows": len(pool),
                "eval_members": len(eval_mem), "eval_nonmembers": len(eval_non)})
    return res


# ---------------------------------------------------------------------------
# 6d-f. Anonymeter attacks
# ---------------------------------------------------------------------------
def _anon_frames(members, holdout, syn, cols):
    f = lambda d: d[cols].reset_index(drop=True)
    return f(members), f(syn), f(holdout)


def _risk(ev):
    r = ev.risk(confidence_level=0.95)
    res = ev.results()
    return {"risk": _f(r.value), "risk_ci95": [_f(r.ci[0]), _f(r.ci[1])],
            "attack_success_rate": _f(res.attack_rate.value),
            "baseline_success_rate": _f(res.baseline_rate.value),
            "control_success_rate": _f(res.control_rate.value) if res.control_rate is not None else None,
            "n_attacks": int(getattr(res, "n_attacks_ori", getattr(res, "n_attacks", 0)))}


def attack_singling_out(members, holdout, syn, cols, n_attacks):
    from anonymeter.evaluators import SinglingOutEvaluator
    ori, s, ctl = _anon_frames(members, holdout, syn, cols)
    out = {}
    for mode in ("univariate", "multivariate"):
        try:
            ev = SinglingOutEvaluator(ori=ori, syn=s, control=ctl, n_attacks=n_attacks,
                                      n_cols=min(4, len(cols)) if mode == "multivariate" else 1)
            ev.evaluate(mode=mode)
            out[mode] = _risk(ev)
        except Exception as e:
            out[mode] = {"error": f"{type(e).__name__}: {e}"}
    out["method"] = "Anonymeter SinglingOutEvaluator"
    return out


def attack_linkability(members, holdout, syn, cols, n_attacks, target):
    from anonymeter.evaluators import LinkabilityEvaluator
    ori, s, ctl = _anon_frames(members, holdout, syn, cols)
    feats = [c for c in cols if c != target]
    if len(feats) < 2:
        return ("not_applicable", "Needs at least two non-target columns")
    half = len(feats) // 2
    aux = (feats[:half], feats[half:])
    ev = LinkabilityEvaluator(ori=ori, syn=s, control=ctl, n_attacks=n_attacks, aux_cols=aux, n_neighbors=10)
    ev.evaluate(n_jobs=-1)
    r = _risk(ev)
    r.update({"method": "Anonymeter LinkabilityEvaluator (n_neighbors=10)", "aux_cols": [list(aux[0]), list(aux[1])]})
    return r


def attack_inference(members, holdout, syn, cols, n_attacks, secrets):
    from anonymeter.evaluators import InferenceEvaluator
    ori, s, ctl = _anon_frames(members, holdout, syn, cols)
    out = {"method": "Anonymeter InferenceEvaluator (all other columns as attacker knowledge)", "by_secret": {}}
    for sec in secrets:
        if sec not in cols:
            continue
        aux = [c for c in cols if c != sec]
        try:
            ev = InferenceEvaluator(ori=ori, syn=s, control=ctl, aux_cols=aux, secret=sec, n_attacks=n_attacks)
            ev.evaluate(n_jobs=-1)
            out["by_secret"][sec] = _risk(ev)
        except Exception as e:
            out["by_secret"][sec] = {"error": f"{type(e).__name__}: {e}"}
    risks = [v["risk"] for v in out["by_secret"].values() if isinstance(v, dict) and v.get("risk") is not None]
    out["max_risk"] = _f(max(risks)) if risks else None
    return out


# ---------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------
def load_real(cfg):
    src = cfg["source"]
    if src.get("csv"):
        return pd.read_csv(src["csv"], **src.get("read_csv", {}))
    if src.get("uci_id") is not None:
        from ucimlrepo import fetch_ucirepo
        d = fetch_ucirepo(id=src["uci_id"])
        df = d.data.original.copy()
        return df
    raise ValueError("source needs 'csv' or 'uci_id'")


def run(cfg: dict, out_dir: str, fast: bool = False):
    t0 = time.time()
    rec = {"schema": SCHEMA_VERSION, "dataset": cfg["name"], "group": cfg.get("group"),
           "source": cfg["source"], "target": cfg["target"], "task": cfg["task"],
           "generator": "SDV GaussianCopulaSynthesizer(enforce_min_max_values=True, enforce_rounding=True), fitted on members only",
           "split": "80/20 members/holdout, random_state=42, stratified for classification",
           "engine": "python", "versions": {}}
    for m in ("sdv", "sdmetrics", "sklearn", "pandas", "numpy", "anonymeter"):
        try:
            rec["versions"][m] = __import__(m).__version__
        except Exception:
            rec["versions"][m] = None

    steps = {}
    raw = load_real(cfg)
    df, log = clean(raw, cfg)
    rec["cleaning_log"] = log
    rec["rows_after_cleaning"], rec["columns"] = len(df), list(df.columns)
    rec["real_sha256"] = sha256_df(df)

    members, holdout = split(df, cfg)
    rec["members_rows"], rec["holdout_rows"] = len(members), len(holdout)

    gen = Step("generate")
    run_step(gen, lambda: {"rows": len(members)})
    syn = None
    try:
        t = time.time()
        syn = fit_sample(members, len(members))
        gen.status, gen.seconds = "completed", round(time.time() - t, 2)
        gen.result = {"synthetic_rows": len(syn), "synthetic_missing_cells": int(syn.isna().sum().sum())}
        os.makedirs(os.path.join(out_dir, "synthetic"), exist_ok=True)
        syn.to_csv(os.path.join(out_dir, "synthetic", f"{cfg['slug']}_synthetic.csv"), index=False)
    except Exception as e:
        gen.status, gen.error = "failed", f"{type(e).__name__}: {e}"
    steps["generate"] = gen

    cols = [c for c in members.columns if c not in cfg.get("exclude_from_attacks", [])]
    # Anonymeter samples n_attacks targets from the control set without
    # replacement, so it can never exceed the holdout size
    n_att = cfg.get("n_attacks") or int(max(10, min(500, len(holdout) - 1)))
    secrets = cfg.get("sensitive_columns") or [cfg["target"]]

    plan = [
        ("fidelity", lambda: fidelity(members, syn)),
        ("utility", lambda: utility(members, holdout, syn, cfg)),
        ("mia_distance", lambda: attack_dcr(members, holdout, syn, cols)),
        ("exact_match", lambda: attack_exact(members, holdout, syn)),
        ("mia_shadow", lambda: attack_shadow(members, holdout, syn, cols, n_shadows=3 if fast else 6)),
        ("singling_out", lambda: attack_singling_out(members, holdout, syn, cols, n_att)),
        ("linkability", lambda: attack_linkability(members, holdout, syn, cols, n_att, cfg["target"])),
        ("attribute_inference", lambda: attack_inference(members, holdout, syn, cols, n_att, secrets)),
    ]
    for name, fn in plan:
        st = Step(name)
        if syn is None:
            st.status, st.notes = "skipped", ["Synthetic data could not be generated"]
        else:
            run_step(st, fn)
        steps[name] = st
        print(f"  [{cfg['name']}] {name}: {st.status} ({st.seconds}s){' - '+st.error if st.error else ''}", flush=True)

    rec["steps"] = {k: {"status": v.status, "seconds": v.seconds, "error": v.error,
                        "notes": v.notes, "result": v.result} for k, v in steps.items()}
    rec["seconds_total"] = round(time.time() - t0, 1)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"{cfg['slug']}.json"), "w") as fh:
        json.dump(rec, fh, indent=1, default=str)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--name", action="append", help="dataset name(s); default all")
    ap.add_argument("--group", help="only datasets in this group")
    ap.add_argument("--out", default="results")
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--skip-done", action="store_true")
    a = ap.parse_args()
    cfgs = json.load(open(a.config))
    for c in cfgs:
        c.setdefault("slug", "".join(ch.lower() if ch.isalnum() else "_" for ch in c["name"]).strip("_"))
    if a.name:
        cfgs = [c for c in cfgs if c["name"] in a.name]
    if a.group:
        cfgs = [c for c in cfgs if c.get("group") == a.group]
    for c in cfgs:
        if a.skip_done and os.path.exists(os.path.join(a.out, f"{c['slug']}.json")):
            continue
        print(f"== {c['name']}", flush=True)
        try:
            run(c, a.out, fast=a.fast)
        except Exception as e:  # a failed dataset never stops the batch
            os.makedirs(a.out, exist_ok=True)
            with open(os.path.join(a.out, f"{c['slug']}.json"), "w") as fh:
                json.dump({"schema": SCHEMA_VERSION, "dataset": c["name"], "status": "failed",
                           "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc(limit=4)}, fh, indent=1)
            print(f"  FAILED: {e}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
