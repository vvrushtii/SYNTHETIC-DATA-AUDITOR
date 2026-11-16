# Synthetic Data Auditor: backend API

The backend runs the **full audit** for the dashboard's *Full audit (server)* page: cleaning, optional generation, fidelity, utility and all six privacy attacks. It uses the same `pipeline/sda_pipeline.py` as the 41-dataset study, with the same library versions, so a dataset audited here gets the same numbers as in the study. This was checked: Heart Disease (Cleveland) sent through the Docker image matched the study's stored results on all 9 steps, for both generators.

## What it does

| Mode | The user uploads | The server |
|---|---|---|
| `generate` | one real CSV | cleans it, splits it 80/20 (seed 42, stratified), fits the chosen generator on the 80% (`gc` = SDV GaussianCopula, `pcc` = project copula), then evaluates |
| `audit` | real CSV + synthetic CSV, and either a holdout CSV or a membership column (1 = training row, 0 = holdout) | cleans the real rows, aligns the synthetic file to the cleaned columns, then evaluates |

Evaluation = fidelity (SDMetrics), utility (TRTR vs TSTR on the holdout), distance MIA, exact match, shadow-model MIA, singling-out, linkability and attribute inference (Anonymeter).

Without holdout rows, the attacks and the utility test are reported as **not run**, with the note that this is not evidence of low risk. In `audit` mode the user's generator is unknown, so the shadow-model attack uses SDV GaussianCopula as the attacker's stand-in (stated in the result).

## Data handling

- Uploads are written only to the job's temporary folder (`/tmp/sda-jobs/<job id>`), which is **deleted when the job ends**: finished, failed, cancelled or timed out. A cleanup loop also removes leftovers after a restart.
- Each job runs in its own process, so it can be stopped, and its memory is freed afterwards.
- Only the result (metrics, column names, cleaning log; no data rows) is kept, **in memory, for 60 minutes**, so the dashboard can fetch it. A restart forgets it.
- **Past audits**: the dashboard saves each finished audit record (metrics, column summaries, settings; never data rows) through `/api/records`, under a random private key created in the visitor's browser. The server stores only a hash of that key, in `RECORDS_DIR` (on Modal: the volume `sda-records`). Records stay until the visitor deletes them; anyone with the key can read them, so the dashboard tells users to keep it private.
- No request bodies, data values or IP addresses are logged (the access log is off). The rate limit keeps a hash of the client address in memory only.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | status, limits, queue, data policy, library versions |
| `POST` | `/api/jobs` | multipart form: `mode`, `target`, `task` (`classification` or `regression`), `generator` (`gc` or `pcc`, generate mode), `name`, `sensitive_columns` (comma-separated), `membership_column`, files `real`, `synthetic`, `holdout`. Returns `202` with the job. |
| `GET` | `/api/jobs/{id}` | status (`queued`, `running`, `completed`, `failed`, `cancelled`), per-step progress, queue position, and the `sda-result/1.0` record when completed |
| `DELETE` | `/api/jobs/{id}` | cancel a queued or running job, or forget a finished one |
| `GET` | `/api/records` | list the saved past audits for the key in the `X-SDA-Key` header |
| `GET` / `PUT` / `DELETE` | `/api/records/{id}` | read, save (JSON `{"meta": {...}, "record": {...}}`) or delete one saved audit |
| `DELETE` | `/api/records` | delete all saved audits for the key |

`POST /api/jobs` also takes `steps` (comma-separated, e.g. `mia_shadow,singling_out,linkability,attribute_inference`) to run only those evaluation steps. The dashboard uses this after each New Audit: the browser runs fidelity, utility, distance MIA and exact match, and the server adds the other four attacks on the same rows and the same member / non-member split.

Interactive documentation: `/docs` on the running server.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `ALLOWED_ORIGINS` | `*` | Websites allowed to call the API. Set it to your Vercel address, e.g. `https://synthetic-data-auditor.vercel.app` (comma-separate several). |
| `MAX_UPLOAD_MB` | `50` | Largest file accepted |
| `MAX_ROWS` | `30000` | Larger tables are sampled to this many rows (seeded), as in the study |
| `MAX_COLUMNS` | `120` | Widest table accepted |
| `JOBS_PER_HOUR` | `6` | Jobs per visitor per hour |
| `MAX_QUEUE` | `10` | Jobs waiting at once |
| `JOB_TIMEOUT_S` | `1800` | A job is stopped after this many seconds |
| `RESULT_TTL_S` | `3600` | How long a finished result stays available |
| `RECORDS_DIR` | temp folder | Where saved past audits are kept (set to a persistent volume) |
| `RECORD_MAX_KB` | `2048` | Largest saved audit record |
| `RECORDS_PER_KEY` | `300` | Saved audits per browser key |

## Deploy on Modal (free monthly credit)

Hugging Face now needs a paid plan for Docker Spaces, so the recommended host is Modal. `modal_app.py` runs the same `app.py` and `worker.py` with the same library versions in one Modal container (2 CPUs, 8 GB). The container starts when a request arrives and stops after 5 minutes without requests, so it only uses credit while someone is using the dashboard.

On a Mac or Linux terminal, from this `backend` folder:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh     # installs uv, which brings its own Python
source $HOME/.local/bin/env
uvx modal setup                                     # opens the browser to sign in to Modal
ALLOWED_ORIGINS=https://your-site.vercel.app uvx modal deploy modal_app.py
```

The first deploy builds the image on Modal (about 5-10 minutes) and prints the address, `https://<workspace>--sda-api-web.modal.run`. Put it in `config.js` as `backendUrl`. Run the same deploy command again after changing any backend file.

The first request after an idle period starts the container, which takes up to about a minute. If the dashboard page is closed while a job runs, the job can be stopped when the container shuts down.

The Docker image (below) runs on any other host with at least 4 GB of memory.

## Run it yourself

```bash
# from the repository root
docker build -f backend/Dockerfile -t sda-api .
docker run -p 7860:7860 sda-api
# then open http://localhost:7860/api/health and use http://localhost:7860 as the server address
```

Without Docker (Python 3.13):

```bash
pip install torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu
pip install -r backend/requirements.txt && pip install --no-deps anonymeter==1.1.0
cd backend && uvicorn app:app --port 7860
```

## Tests

```bash
cd backend && pip install pytest httpx && python -m pytest -q tests
```

The 9 tests use a small made-up dataset. They check both generators end to end, that an upload which copies the training rows is flagged (exact match > 90 pp, distance AUC > 0.9), the membership-column route, that without a holdout no attack is reported as run, input validation, cancelling, and that the job folder is gone afterwards.
