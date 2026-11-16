# Synthetic Data Auditor

Audit a synthetic dataset against its real source: data validation, fidelity, utility, privacy tests, ensemble risk, governance mapping and a downloadable report.

There are two ways to run an audit:

- **New Audit.** The browser runs validation, cleaning, fidelity, utility and 2 privacy attacks (distance-based membership inference and exact match). It then sends the evaluated columns, with the same member / non-member split, to the backend API (`backend/`, hosted on Modal), which runs the other 4 attacks (shadow-model membership inference, singling-out, linkability, attribute inference). Every audit therefore covers all 6 attacks when the server is reachable.
- **Generate & Audit.** One real CSV is uploaded; the server generates synthetic data (SDV GaussianCopula or the project copula) and runs the full pipeline `pipeline/sda_pipeline.py` on it.

Files sent to the server are deleted when the job ends. Finished audits (metrics and column summaries, never rows) are saved on the server under a private per-browser key and listed on the **Past Audits** page.

The 41-dataset study (Benchmark page, bundled in `benchmark.js`) is for the project team only: open the site with `?team` at the end of the address to see it.

## Architecture

| Part | Where it runs | File |
|---|---|---|
| Dashboard (all pages) | Browser | `index.html` |
| Component runtime (includes React, MIT licence) | Browser | `support.js` |
| Validation, cleaning, fidelity, utility (TRTR vs TSTR), membership inference, exact-match test, ensemble risk | Browser | `engine.js` |
| Compliance knowledge base and mapper | Browser | `kb.js` |
| PDF, HTML, CSV and JSON report generation | Browser | `export.js` |
| Results → page view-model, Past Audits page | Browser | `view.js` |
| Six-attack benchmark results for 41 UCI datasets (metrics only, computed offline by `pipeline/sda_pipeline.py`) | Browser (static data) | `benchmark.js` |
| Theme switch, search palette, chart tooltips | Browser | `fx.js` |
| Site settings: backend API address | Browser | `config.js` |
| Generate & Audit page (upload, progress, results) | Browser | `index.html`, `view.js` |
| Backend API: job queue, uploads, deletion after each run, saved past audits | Modal (or any Docker host) | `backend/app.py` |
| One audit job, run in its own process | Modal (or any Docker host) | `backend/worker.py` |
| Evaluation pipeline (same code as the 41-dataset study) | Modal, Colab | `pipeline/sda_pipeline.py` |
| Hosting config (security headers) | Vercel | `vercel.json` |

The website has no build step, so this folder is deployed to Vercel as it is. The backend is a Docker image (`backend/Dockerfile`); see `backend/README.md`.

**Data handling**
- Uploaded files are read in memory only and cleared when the tab is closed or reloaded.
- Audit results (metrics and column summaries, not rows) are saved on the server under a random private key made in the visitor's browser (`sda.v1.key`), with a local copy in `localStorage`. The Past Audits page lists, opens and deletes them, and lets a visitor copy the key to open the same list on another device.
- For the 4 server attacks and for Generate & Audit, the backend keeps the uploaded CSVs only inside the job's temporary folder and deletes it when the job ends (finished, failed, cancelled or timed out). It never logs data values or IP addresses and limits each visitor to 6 jobs per hour.

**Updating the benchmark:** after a new pipeline run, rebuild the bundled file with `python3 tools/make_benchmark_js.py <results folder> benchmark.js` and commit `benchmark.js`.
- `.gitignore` blocks `*.csv`, `*.xlsx` and other data files so datasets can't be committed by mistake.

**Settings:** the website needs no environment variables. Put the backend's address in `config.js` (`backendUrl`), (team members can also type one on the Generate & Audit page with `?team`). Backend settings (allowed origins, limits, records folder) are environment variables; see `backend/README.md`.

## Run locally

```bash
python3 -m http.server 8000
```

Run that in this folder, then open http://localhost:8000. Opening `index.html` directly from the file system won't work; it must be served.

## Deploy to Vercel

### Option 1: from GitHub (recommended, auto-redeploys on every push)

1. Create a new **empty** GitHub repository (for example `synthetic-data-auditor`).
2. Upload the **contents of this `website` folder** to it: on the repository page choose *Add file → Upload files* and drag in every file here, including `.gitignore` and `vercel.json`. Do not upload any dataset folders. `.gitignore` is hidden in Finder: press **Cmd + Shift + .** to show it.
3. Go to https://vercel.com/new, choose **Import Git Repository**, and pick the repository.
4. In the import screen, set:
   - **Framework Preset:** `Other`
   - **Root Directory:** `./` (or `website` if you uploaded the whole project folder)
   - **Build Command:** leave empty / off
   - **Output Directory:** leave empty (`.`)
   - **Environment Variables:** none
5. Click **Deploy**. Vercel gives you a public address like `https://synthetic-data-auditor.vercel.app`.

### Option 2: Vercel command-line tool

```bash
npm i -g vercel
vercel deploy --prod
```

Run these in this folder. The command-line tool needs Node.js (https://nodejs.org). Answer the prompts: link to your account, no build command, output directory `.`.

### After deploying, check

1. The page loads and the favicon shows.
2. **Try the demo pair → Run audit** finishes and the Overview fills in.
3. **Reports & Exports → Download PDF** saves a PDF that opens.
4. On a phone, the page fits without sideways scrolling.

## What was tested before release

- **Real pairs from the project:** Adult (48,842 rows each) and Wine Quality (6,497 rows each). All modules completed; PDF reports were valid (12 and 11 pages).
- **Demo pair:** run through the full workflow in the browser.
- **Phone width (375 px):** no horizontal overflow.
- **Pages checked visually:** Overview, Fidelity, Governance, Reports, in light and dark mode.

## Limitations

- The engines are JavaScript re-implementations of the notebook methods (SDMetrics-style column shapes and pair trends, scikit-learn-style models). Numbers can differ from the Colab baselines.
- Fidelity is computed on a seeded sample of up to 5,000 rows by default. Very large files (for example Covertype, 75 MB) are slow, because everything runs in the visitor's browser tab.
- In the browser, shadow-model MIA, attribute inference, singling-out and linkability are shown as not applicable; they run on the server page.
- The backend on Modal has 2 CPUs and 8 GB and runs one job at a time; large tables (tens of thousands of rows) take 10-20 minutes. After 5 minutes without requests it stops, and the next request takes up to about a minute to start it again.
- Governance mappings are a screening aid for reviewers, not legal advice.

## Backend

The backend lives in `backend/` and is documented in `backend/README.md` (deployment to Modal, API, settings, tests). In short:

1. From `backend/`, run `uvx modal setup`, then `ALLOWED_ORIGINS=https://<your-site>.vercel.app uvx modal deploy modal_app.py`.
2. Wait for the first build (about 5-10 minutes), then open `https://<workspace>--sda-api-web.modal.run/api/health`.
3. Put that address in `config.js` as `backendUrl`.
