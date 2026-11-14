"""
Synthetic Data Auditor - evaluation pipeline (version 3, staged).

The study runs in stages. Each stage reads the files the previous one wrote,
so it can run on its own (one Colab notebook per stage) or all at once
from the command line. Every stage is seeded, so a re-run gives the same numbers.

  Stage 1  original  -> cleaned     01_original_datasets/  -> 02_cleaned_datasets/
  Stage 2  cleaned   -> synthetic   80/20 split (stratified, random_state=42);
                                    the generator is fitted on the 80% TRAINING rows
                                    only and samples the same number of rows
                                    -> 03_synthetic_datasets/<generator>/
  Stage 3  evaluation, one step per aspect, each reading cleaned + synthetic:
             fidelity            SDMetrics QualityReport (training rows vs synthetic)
             utility             random forest; TRTR = train on training rows,
                                 TSTR = train on synthetic; both tested on the 20%
                                 HOLDOUT the generator never saw
             mia_distance        closest-synthetic-record distance attack
             mia_shadow          shadow-model membership attack
             exact_match         verbatim copies, training vs holdout rows
             singling_out        Anonymeter
             linkability         Anonymeter
             attribute_inference Anonymeter
           -> results_json/parts/<generator>/<dataset>/<step>.json
  Stage 4  assemble one result file per dataset and generator
           -> results_json/<generator>/<dataset>.json  (schema sda-result/1.0)

Generators
  gc   SDV GaussianCopulaSynthesizer(enforce_min_max_values=True, enforce_rounding=True)
  pcc  Project copula: the team's hand-written rank Gaussian copula with empirical
       marginals (notebooks for datasets 6-11), fitted separately within each class
       of the target for classification tasks.

Usage
  python sda_pipeline.py --config datasets.json --root STUDY_FOLDER                 # everything
  python sda_pipeline.py --config datasets.json --root STUDY_FOLDER --name "Hepatitis" --gen pcc
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import shutil
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
PIPELINE_VERSION = "3.0"
DIRS = {"original": "01_original_datasets", "cleaned": "02_cleaned_datasets", "synthetic": "03_synthetic_datasets",
        "results": "results_json"}
GENERATORS = {
    "gc": {"folder": "sdv_gaussian_copula", "short": "SDV GaussianCopula",
           "label": "SDV GaussianCopulaSynthesizer(enforce_min_max_values=True, enforce_rounding=True), fitted on training rows only"},
    "pcc": {"folder": "project_copula", "short": "Project copula (per class)",
            "label": "Project copula: rank Gaussian copula with empirical marginals, fitted per class (team notebooks), on training rows only"},
}
EVAL_STEPS = ["fidelity", "utility", "mia_distance", "exact_match", "mia_shadow", "singling_out", "linkability",
              "attribute_inference"]


def _seed(seed=SEED):
    """Seed the global RNGs. Anonymeter draws its attack targets from them."""
    np.random.seed(seed)
    random.seed(seed)
    try:
        import polars as pl
        pl.set_random_seed(seed)
    except Exception:
        pass


def _stable_univariate_queries():
    """Anonymeter 1.1 builds univariate singling-out queries (from a polars group_by) and
    its random-guess baseline queries (from unique()) in an order that changes between
    runs, so the same seed gave different queries. Same functions with the order kept
    (maintain_order=True); nothing else changes."""
    try:
        import polars as pl
        import anonymeter.evaluators.singling_out_evaluator as so
    except Exception:
        return
    if getattr(so, "_sda_stable", False):
        return

    def univariate_singling_out_queries(df, n_queries, rng):
        queries = []
        schema = df.schema
        for col in df.columns:
            if df.select(pl.col(col).is_null().sum()).item() == 1:
                queries.append(pl.col(col).is_null())
            if schema[col].is_numeric() and df[col].drop_nulls().len() > 0:
                queries.extend([pl.col(col) <= df[col].min(), pl.col(col) >= df[col].max()])
            rare = df.group_by(col, maintain_order=True).len().filter(pl.col("len") == 1).select(col).to_series().to_list()
            if rare:
                queries.extend([pl.col(col) == val for val in rare])
        rng.shuffle(queries)
        uq = so.UniqueSinglingOutQueries(max_size=n_queries)
        uq.check_and_extend(queries, df)
        return uq.queries

    def _random_queries(df, n_queries, n_cols, rng):   # baseline queries: same, with ordered unique values
        unique_values = {col: df[col].unique(maintain_order=True).to_list() for col in df.columns}
        column_types = {col: so._convert_polars_dtype(df[col].dtype) for col in df.columns}
        return [so._random_query(unique_values=unique_values, cols=rng.choice(df.columns, size=n_cols, replace=False).tolist(),
                                 column_types=column_types, rng=rng) for _ in range(n_queries)]

    so.univariate_singling_out_queries = univariate_singling_out_queries
    so._random_queries = _random_queries
    so._sda_stable = True


class _fixed_rng:
    """Anonymeter builds its random-guess baseline with an unseeded np.random.default_rng();
    while an attack runs, unseeded calls get a fixed seed so every run repeats exactly."""
    def __enter__(self):
        _stable_univariate_queries()
        self._orig = np.random.default_rng
        orig = self._orig
        np.random.default_rng = lambda seed=None, *a, **k: orig(SEED if seed is None else seed, *a, **k)
        return self

    def __exit__(self, *exc):
        np.random.default_rng = self._orig
        return False


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
def attack_shadow(members, holdout, syn, cols, n_shadows=6, k=5, gen_fn=None):
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
        sh = (gen_fn or fit_sample)(pool.iloc[inn][members.columns].reset_index(drop=True), half, seed=SEED + s + 1)
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
    res.update({"method": "shadow generators (same generator as the one audited) + distance features + gradient boosting",
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
                                      n_cols=min(4, len(cols)) if mode == "multivariate" else 1, seed=SEED)
            _seed()
            with _fixed_rng():
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
    _seed()
    with _fixed_rng():
        ev.evaluate(n_jobs=-1)
    r = _risk(ev)
    r.update({"method": "Anonymeter LinkabilityEvaluator (n_neighbors=10)", "aux_cols": [list(aux[0]), list(aux[1])]})
    return r


def attack_inference(members, holdout, syn, cols, n_attacks, secrets):
    from anonymeter.evaluators import InferenceEvaluator
    ori, s, ctl = _anon_frames(members, holdout, syn, cols)
    out = {"method": "Anonymeter InferenceEvaluator (all other columns as attacker knowledge; numeric secrets in regression mode)", "by_secret": {}}
    for sec in secrets:
        if sec not in cols:
            continue
        aux = [c for c in cols if c != sec]
        try:
            # numeric secrets are guessed as numbers (a guess counts when close), others as exact categories
            ev = InferenceEvaluator(ori=ori, syn=s, control=ctl, aux_cols=aux, secret=sec, n_attacks=n_attacks,
                                    regression=bool(pd.api.types.is_numeric_dtype(ori[sec])))
            _seed()
            with _fixed_rng():
                ev.evaluate(n_jobs=-1)
            out["by_secret"][sec] = _risk(ev)
        except Exception as e:
            out["by_secret"][sec] = {"error": f"{type(e).__name__}: {e}"}
    risks = [v["risk"] for v in out["by_secret"].values() if isinstance(v, dict) and v.get("risk") is not None]
    out["max_risk"] = _f(max(risks)) if risks else None
    return out


# ---------------------------------------------------------------------------
# second generator: the team's project copula, fitted per class
# ---------------------------------------------------------------------------
def _copula_block(df: pd.DataFrame, n: int, rng) -> pd.DataFrame:
    """Rank Gaussian copula with empirical marginals, as in the team notebooks:
    numeric columns -> ranks -> normal scores -> correlation (made positive
    definite) -> correlated normal samples -> mapped back onto each column's
    sorted observed values. Non-numeric columns are sampled from their observed
    frequencies. Missing values are put back at the observed rate."""
    from scipy.stats import norm, rankdata
    m = len(df)
    out = pd.DataFrame(index=range(n))
    num = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    cat = [c for c in df.columns if c not in num]
    data = df[num].replace([np.inf, -np.inf], np.nan)
    miss = data.isna().mean()
    data = data.fillna(data.median()).fillna(0)
    const = [c for c in num if data[c].nunique() <= 1]
    vary = [c for c in num if c not in const]
    for c in const:
        out[c] = data[c].iloc[0] if m else np.nan
    if vary:
        z = np.column_stack([norm.ppf(np.clip((rankdata(data[c].to_numpy()) - 0.5) / m, 1e-6, 1 - 1e-6)) for c in vary])
        C = np.atleast_2d(np.corrcoef(z, rowvar=False)) if len(vary) > 1 else np.ones((1, 1))
        C = np.nan_to_num(C); C = (C + C.T) / 2; np.fill_diagonal(C, 1.0)
        w, v = np.linalg.eigh(C); C = v @ np.diag(np.clip(w, 1e-8, None)) @ v.T
        s = np.sqrt(np.maximum(np.diag(C), 1e-12)); C = C / np.outer(s, s); np.fill_diagonal(C, 1.0)
        p = norm.cdf(rng.multivariate_normal(np.zeros(len(vary)), C, size=n, check_valid="ignore"))
        for j, c in enumerate(vary):
            obs = np.sort(data[c].to_numpy())
            out[c] = np.interp(p[:, j] * (m - 1), np.arange(m), obs)
    for c in num:
        whole = df[c].dropna()
        if len(whole) and np.all(np.mod(whole.to_numpy(float), 1) == 0):
            out[c] = np.round(out[c].astype(float))
        if miss.get(c, 0) > 0:
            out.loc[rng.random(n) < miss[c], c] = np.nan
    for c in cat:
        f = df[c].value_counts(normalize=True, dropna=False)
        out[c] = f.index.to_numpy(dtype=object)[rng.choice(len(f), size=n, p=f.to_numpy())] if len(f) else np.nan
    return out[list(df.columns)]


def fit_sample_pcc(train: pd.DataFrame, n_rows: int, cfg: dict, seed=SEED) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    tgt = cfg["target"]
    if cfg["task"] != "classification":
        out = _copula_block(train, n_rows, rng)
    else:
        feats = [c for c in train.columns if c != tgt]
        counts = train[tgt].value_counts()
        alloc = np.floor(counts / counts.sum() * n_rows).astype(int)
        for k in (counts / counts.sum() * n_rows - alloc).sort_values(ascending=False).index[: n_rows - alloc.sum()]:
            alloc[k] += 1                     # exact class counts, as in the team notebooks
        parts = []
        for k, nk in alloc.items():
            if nk == 0:
                continue
            grp = train[train[tgt] == k][feats]
            # a class with fewer than 5 rows cannot support its own copula; its rows are
            # drawn from the copula of the whole training table instead (no row copying)
            blk = _copula_block(grp.reset_index(drop=True) if len(grp) >= 5 else train[feats].reset_index(drop=True), nk, rng)
            blk[tgt] = k
            parts.append(blk)
        out = pd.concat(parts, ignore_index=True)
        out = out.iloc[rng.permutation(len(out))].reset_index(drop=True)
    return out[list(train.columns)]


def generate(gen: str, train: pd.DataFrame, n_rows: int, cfg: dict, seed=SEED) -> pd.DataFrame:
    if gen == "gc":
        return fit_sample(train, n_rows, seed=seed)
    if gen == "pcc":
        return fit_sample_pcc(train, n_rows, cfg, seed=seed)
    raise ValueError(f"unknown generator {gen!r}")


# ---------------------------------------------------------------------------
# files: one layout for Colab (Drive) and local runs
# ---------------------------------------------------------------------------
def slug_of(cfg):
    return cfg.get("slug") or "".join(ch.lower() if ch.isalnum() else "_" for ch in cfg["name"]).strip("_")


def _csv(p):
    """A data file may be stored compressed (<name>.csv.gz, used in Drive for files over ~3 MB).
    Use the compressed copy when the plain CSV is absent; pandas reads and writes .gz transparently."""
    return p + ".gz" if not os.path.exists(p) and os.path.exists(p + ".gz") else p


def path(root, kind, cfg=None, gen=None, step=None):
    s = slug_of(cfg) if cfg else None
    if kind == "original":
        return _csv(os.path.join(root, DIRS["original"], f"{s}_original.csv"))
    if kind == "cleaned":
        return _csv(os.path.join(root, DIRS["cleaned"], f"{s}_cleaned.csv"))
    if kind == "meta":
        return os.path.join(root, DIRS["cleaned"], "_meta", f"{s}.json")
    if kind == "meta_all":
        return os.path.join(root, DIRS["cleaned"], "cleaning_metadata.json")
    if kind == "bundle":
        return os.path.join(root, DIRS["results"], f"all_results_{GENERATORS[gen]['folder']}.json")
    if kind == "synthetic":
        return _csv(os.path.join(root, DIRS["synthetic"], GENERATORS[gen]["folder"], f"{s}_synthetic_{gen}.csv"))
    if kind == "part":
        return os.path.join(root, DIRS["results"], "parts", GENERATORS[gen]["folder"], s, f"{step}.json")
    if kind == "result":
        return os.path.join(root, DIRS["results"], GENERATORS[gen]["folder"], f"{s}.json")
    raise ValueError(kind)


def _mk(p):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def write_table(df, p):
    df.to_csv(_mk(p), index=False)


def read_table(p, schema):
    """Read a cleaned or synthetic CSV with the column types recorded at cleaning time.
    Only empty cells are missing; text such as 'None' stays a category."""
    cats = set(schema["categorical"])
    df = pd.read_csv(p, keep_default_na=False, na_values=[""], dtype={c: str for c in cats}, low_memory=False)
    for c in df.columns:
        if c in cats:
            df[c] = df[c].astype(object).where(df[c].notna(), np.nan)
    return df[schema["columns"]]


def load_real(cfg, config_dir="."):
    """Return the source table: the project CSV, or the UCI repository download."""
    src = cfg["source"]
    if src.get("csv"):
        p = src["csv"] if os.path.isabs(src["csv"]) else os.path.join(config_dir, src["csv"])
        return pd.read_csv(p, **src.get("read_csv", {}))
    if src.get("uci_id") is not None:
        from ucimlrepo import fetch_ucirepo
        return fetch_ucirepo(id=src["uci_id"]).data.original.copy()
    raise ValueError("source needs 'csv' or 'uci_id'")


def ensure_original(cfg, root, config_dir="."):
    """01_original_datasets/<slug>_original.csv: the project's own CSV copied unchanged,
    or the UCI download saved as CSV."""
    p = path(root, "original", cfg)
    if not os.path.exists(p):
        src = cfg["source"]
        if src.get("csv"):
            q = src["csv"] if os.path.isabs(src["csv"]) else os.path.join(config_dir, src["csv"])
            shutil.copyfile(q, _mk(p))
        else:
            load_real(cfg).to_csv(_mk(p), index=False)
    return p


def read_original(cfg, root):
    return pd.read_csv(path(root, "original", cfg), low_memory=False, **cfg["source"].get("read_csv", {}))


# ---------------------------------------------------------------------------
# stages
# ---------------------------------------------------------------------------
def stage_clean(cfg, root, config_dir="."):
    ensure_original(cfg, root, config_dir)
    raw = read_original(cfg, root)
    df, log = clean(raw, cfg)
    num = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    schema = {"columns": list(df.columns), "numerical": num, "categorical": [c for c in df.columns if c not in num]}
    write_table(df, path(root, "cleaned", cfg))
    df = read_table(path(root, "cleaned", cfg), schema)          # every later stage sees exactly this table
    meta = {"dataset": cfg["name"], "slug": slug_of(cfg), "rows_original": int(len(raw)), "columns_original": int(raw.shape[1]),
            "rows_after_cleaning": int(len(df)), "schema": schema, "cleaning_log": log, "real_sha256": sha256_df(df)}
    json.dump(meta, open(_mk(path(root, "meta", cfg)), "w"), indent=1)
    pa = path(root, "meta_all")                       # the same metadata for all datasets in one file
    allm = json.load(open(pa)) if os.path.exists(pa) else {}
    allm[slug_of(cfg)] = meta
    json.dump(allm, open(pa, "w"), indent=1)
    return meta


def load_meta(cfg, root):
    """Column types and cleaning log of one dataset: _meta/<slug>.json, else cleaning_metadata.json."""
    p = path(root, "meta", cfg)
    if os.path.exists(p):
        return json.load(open(p))
    return json.load(open(path(root, "meta_all")))[slug_of(cfg)]


def load_clean(cfg, root):
    meta = load_meta(cfg, root)
    df = read_table(path(root, "cleaned", cfg), meta["schema"])
    members, holdout = split(df, cfg)
    return df, members, holdout, meta


def load_synth(cfg, root, gen, meta):
    return read_table(path(root, "synthetic", cfg, gen), meta["schema"])


def _save_part(root, cfg, gen, step: "Step"):
    d = {"status": step.status, "seconds": step.seconds, "error": step.error, "notes": step.notes, "result": step.result}
    json.dump(d, open(_mk(path(root, "part", cfg, gen, step.name)), "w"), indent=1, default=str)
    return d


def stage_generate(cfg, root, gen):
    df, members, holdout, meta = load_clean(cfg, root)
    st = Step("generate")
    t = time.time()
    try:
        syn = generate(gen, members, len(members), cfg)
        write_table(syn, path(root, "synthetic", cfg, gen))
        syn = load_synth(cfg, root, gen, meta)
        st.status, st.result = "completed", {"synthetic_rows": int(len(syn)), "synthetic_missing_cells": int(syn.isna().sum().sum()),
                                             "training_rows": int(len(members)), "holdout_rows": int(len(holdout))}
    except Exception as e:
        st.status, st.error = "failed", f"{type(e).__name__}: {e}"
        st.notes.append(traceback.format_exc(limit=3))
    st.seconds = round(time.time() - t, 2)
    return _save_part(root, cfg, gen, st)


def attack_settings(cfg, members, holdout):
    cols = [c for c in members.columns if c not in cfg.get("exclude_from_attacks", [])]
    # Anonymeter draws its targets from the control set without replacement,
    # so the number of attacks can never exceed the holdout size
    n_att = cfg.get("n_attacks") or int(max(10, min(500, len(holdout) - 1)))
    secrets = cfg.get("sensitive_columns") or [cfg["target"]]
    return cols, n_att, secrets


def stage_evaluate(cfg, root, gen, step, fast=False):
    df, members, holdout, meta = load_clean(cfg, root)
    st = Step(step)
    try:
        syn = load_synth(cfg, root, gen, meta)
    except Exception as e:
        st.status, st.notes = "skipped", [f"No synthetic data for this generator ({type(e).__name__})"]
        return _save_part(root, cfg, gen, st)
    cols, n_att, secrets = attack_settings(cfg, members, holdout)
    gen_fn = lambda train, n, seed=SEED: generate(gen, train, n, cfg, seed=seed)
    fns = {
        "fidelity": lambda: fidelity(members, syn),
        "utility": lambda: utility(members, holdout, syn, cfg),
        "mia_distance": lambda: attack_dcr(members, holdout, syn, cols),
        "exact_match": lambda: attack_exact(members, holdout, syn),
        "mia_shadow": lambda: attack_shadow(members, holdout, syn, cols, n_shadows=3 if fast else 6, gen_fn=gen_fn),
        "singling_out": lambda: attack_singling_out(members, holdout, syn, cols, n_att),
        "linkability": lambda: attack_linkability(members, holdout, syn, cols, n_att, cfg["target"]),
        "attribute_inference": lambda: attack_inference(members, holdout, syn, cols, n_att, secrets),
    }
    _seed()
    run_step(st, fns[step])
    return _save_part(root, cfg, gen, st)


def _versions():
    v = {}
    for m in ("sdv", "sdmetrics", "sklearn", "pandas", "numpy", "scipy", "anonymeter"):
        try:
            import importlib.metadata as md
            v[m] = md.version("scikit-learn" if m == "sklearn" else m)
        except Exception:
            v[m] = None
    return v


def assemble(cfg, root, gen):
    """Merge the stage outputs into one sda-result/1.0 file (what the dashboard imports)."""
    meta = load_meta(cfg, root)
    steps = {}
    for k in ["generate"] + EVAL_STEPS:
        p = path(root, "part", cfg, gen, k)
        steps[k] = json.load(open(p)) if os.path.exists(p) else {"status": "not_run", "seconds": 0, "error": None, "notes": [], "result": {}}
    g = steps["generate"].get("result") or {}
    rec = {"schema": SCHEMA_VERSION, "dataset": cfg["name"], "group": cfg.get("group"),
           "source": {k: v for k, v in cfg["source"].items() if k in ("uci_id",)}, "target": cfg["target"], "task": cfg["task"],
           "domain": cfg.get("domain"), "person_level": cfg.get("person_level"),
           "generator": GENERATORS[gen]["label"], "generator_key": gen,
           "split": "80/20 training/holdout, random_state=42, stratified for classification",
           "engine": "python", "pipeline_version": PIPELINE_VERSION, "versions": _versions(),
           "cleaning_log": meta["cleaning_log"], "rows_original": meta.get("rows_original"),
           "rows_after_cleaning": meta["rows_after_cleaning"], "columns": meta["schema"]["columns"],
           "n_numerical": len(meta["schema"]["numerical"]), "n_categorical": len(meta["schema"]["categorical"]),
           "real_sha256": meta["real_sha256"], "members_rows": g.get("training_rows"), "holdout_rows": g.get("holdout_rows"),
           "steps": steps, "seconds_total": round(sum((s.get("seconds") or 0) for s in steps.values()), 1)}
    json.dump(rec, open(_mk(path(root, "result", cfg, gen)), "w"), indent=1, default=str)
    return rec


def load_result(cfg, root, gen):
    """The sda-result record of one dataset and generator: assembled from the stage outputs when
    they are present, otherwise read from results_json/ (the single file, or the per-generator bundle)."""
    if os.path.exists(path(root, "part", cfg, gen, "generate")):
        return assemble(cfg, root, gen)
    p = path(root, "result", cfg, gen)
    if os.path.exists(p):
        return json.load(open(p))
    b = json.load(open(path(root, "bundle", cfg, gen)))
    return next(r for r in b["results"] if r["dataset"] == cfg["name"])


def run(cfg, root, gens=("gc", "pcc"), steps=None, fast=False, config_dir=".", log=print):
    stage_clean(cfg, root, config_dir)
    for gen in gens:
        g = stage_generate(cfg, root, gen)
        log(f"  [{cfg['name']} | {gen}] generate: {g['status']} ({g['seconds']}s)")
        for step in (steps or EVAL_STEPS):
            d = stage_evaluate(cfg, root, gen, step, fast=fast)
            log(f"  [{cfg['name']} | {gen}] {step}: {d['status']} ({d['seconds']}s){' - ' + d['error'] if d['error'] else ''}")
        assemble(cfg, root, gen)


def load_config(p):
    cfgs = json.load(open(p))
    for c in cfgs:
        c.setdefault("slug", slug_of(c))
    return cfgs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--root", required=True, help="study folder (created if missing)")
    ap.add_argument("--name", action="append", help="dataset name(s); default all")
    ap.add_argument("--group", help="only datasets in this group")
    ap.add_argument("--gen", nargs="+", default=["gc", "pcc"], choices=list(GENERATORS))
    ap.add_argument("--fast", action="store_true")
    a = ap.parse_args()
    cfgs = load_config(a.config)
    if a.name:
        cfgs = [c for c in cfgs if c["name"] in a.name]
    if a.group:
        cfgs = [c for c in cfgs if c.get("group") == a.group]
    for c in cfgs:
        print(f"== {c['name']}", flush=True)
        try:
            run(c, a.root, a.gen, fast=a.fast, config_dir=os.path.dirname(os.path.abspath(a.config)),
                log=lambda s: print(s, flush=True))
        except Exception as e:  # a failed dataset never stops the batch
            print(f"  FAILED: {type(e).__name__}: {e}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
