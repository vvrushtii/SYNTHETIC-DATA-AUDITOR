"""Collect pipeline JSON results into one CSV and one Markdown table.

python summarize.py results/  ->  results/summary.csv, results/summary.md
"""
import glob
import json
import os
import sys

import pandas as pd


def g(d, *path):
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


def row(r):
    s = r.get("steps", {})
    res = lambda k: g(s, k, "result") or {}
    u = res("utility")
    task = r.get("task")
    pm = "f1_macro" if task == "classification" else "r2"
    so = res("singling_out")
    failed = [k for k, v in s.items() if v.get("status") == "failed"]
    skipped = [k for k, v in s.items() if v.get("status") in ("skipped", "not_applicable")]
    return {
        "dataset": r.get("dataset"), "group": r.get("group"), "task": task,
        "rows": r.get("rows_after_cleaning"), "columns": len(r.get("columns") or []),
        "fidelity_overall": g(res("fidelity"), "overall_quality"),
        "column_shapes": g(res("fidelity"), "column_shapes"),
        "pair_trends": g(res("fidelity"), "column_pair_trends"),
        "utility_metric": pm,
        "trtr": g(u, "trtr", pm), "tstr": g(u, "tstr", pm), "retention_pct": u.get("retention_pct"),
        "mia_distance_auc": g(res("mia_distance"), "roc_auc"),
        "mia_shadow_auc": g(res("mia_shadow"), "roc_auc"),
        "exact_match_excess_pct": g(res("exact_match"), "excess_over_holdout_pct"),
        "singling_out_uni_risk": g(so, "univariate", "risk"),
        "singling_out_multi_risk": g(so, "multivariate", "risk"),
        "linkability_risk": g(res("linkability"), "risk"),
        "inference_max_risk": g(res("attribute_inference"), "max_risk"),
        "failed_steps": ",".join(failed) or r.get("error") or "",
        "skipped_steps": ",".join(skipped),
        "seconds": r.get("seconds_total"),
    }


def main(d):
    rows = [row(json.load(open(f))) for f in sorted(glob.glob(os.path.join(d, "*.json")))]
    df = pd.DataFrame(rows).sort_values(["group", "dataset"])
    df.to_csv(os.path.join(d, "summary.csv"), index=False)
    fmt = df.copy()
    for c in fmt.columns:
        if fmt[c].dtype.kind == "f":
            fmt[c] = fmt[c].map(lambda x: "" if pd.isna(x) else f"{x:.3f}")
    with open(os.path.join(d, "summary.md"), "w") as fh:
        fh.write(fmt.to_markdown(index=False))
    print(df.to_string(index=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "results")
