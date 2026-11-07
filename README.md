# Evaluation pipeline (Python)

One script runs the project's whole method for a dataset and writes one JSON result file.

| Step | What runs | Same as the project notebooks? |
|---|---|---|
| Clean | trim text, `?`/empty → missing, strip trailing `.` from labels (Adult), drop configured ID columns, drop exact duplicates | Adds the label fix and duplicate removal |
| Split | 80% members / 20% holdout, `random_state=42`, stratified on the target | Yes (the MIA notebooks' split) |
| Generate | SDV `GaussianCopulaSynthesizer(enforce_min_max_values=True, enforce_rounding=True)` fitted on **members only**, `len(members)` rows | Yes (the MIA notebooks' generator) |
| Fidelity | SDMetrics QualityReport + mean absolute correlation difference (upper triangle) | Yes; metadata now built explicitly, so it no longer fails on SDV 2.x |
| Utility | Random forest, 100 trees, seed 42. TRTR = train on members, TSTR = train on synthetic, **both tested on the holdout** | Fixes leakage: the notebooks' test rows were also in the generator's training data |
| Privacy | 6 attacks, holdout = non-members / control set | Distance MIA as before, plus 5 more |

## The six attacks

| Attack | Method | Reported as |
|---|---|---|
| Distance MIA | Distance from each real record to its nearest synthetic record (standardised numeric + one-hot) | ROC-AUC with bootstrap 95% CI, TPR at 10% FPR |
| Exact match | Share of member rows reproduced exactly, compared with holdout rows (chance level) | % and excess over holdout |
| Shadow-model MIA | Attacker knows the generator and settings and holds half of the holdout. Six shadow GaussianCopulas trained on random halves of that pool; distance features; gradient-boosting classifier | ROC-AUC with 95% CI |
| Singling-out | Anonymeter `SinglingOutEvaluator`, univariate and multivariate (4 columns) | Risk with 95% CI |
| Linkability | Anonymeter `LinkabilityEvaluator`; non-target columns split into two halves | Risk with 95% CI |
| Attribute inference | Anonymeter `InferenceEvaluator`; each sensitive column guessed from all others | Risk per column and the maximum |

AUC 0.5 means the attacker does no better than guessing. Anonymeter risk is attack success above the control-set success, so 0 means no measurable leak.

## Run

```bash
pip install sdv sdmetrics scikit-learn ucimlrepo
pip install --no-deps anonymeter && pip install numba polars pyarrow joblib

python sda_pipeline.py --config datasets.json --name "Heart Disease (Cleveland)" --out results
python sda_pipeline.py --config datasets.json --group new --out results --skip-done
python summarize.py results          # results/summary.csv and summary.md
```

Or open `run_in_colab.ipynb` in Colab.

UCI datasets download automatically. The project's own cleaned files go in `data/existing/` (copy them from the Drive folder `original dataset`). `data/` and `results/` are git-ignored: datasets and synthetic outputs never go to Git.

## datasets.json fields

`name`, `group` (`existing`/`new`), `source` (`csv` path or `uci_id`), `target`, `task` (`classification`/`regression`), optional `drop_columns`, `sensitive_columns` (secrets for attribute inference, default the target), `strip_label_dots`, `max_rows` (seeded sample for very large data).

A failed step is recorded with its error and the run continues; a failed dataset never stops the batch.
