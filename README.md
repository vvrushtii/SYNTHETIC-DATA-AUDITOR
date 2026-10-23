# Synthetic Data Auditor

Audit a synthetic dataset against its real source: data validation, fidelity, utility, privacy tests, ensemble risk, governance mapping and a downloadable report.

**Everything runs in the visitor's browser.** Uploaded CSVs are never sent to a server; there is no backend, database or API key.

## Architecture

| Part | Where it runs | File |
|---|---|---|
| Dashboard (all pages) | Browser | `index.html` |
| Component runtime (includes React, MIT licence) | Browser | `support.js` |
| Validation, cleaning, fidelity, utility (TRTR vs TSTR), membership inference, exact-match test, ensemble risk | Browser | `engine.js` |
| Compliance knowledge base and mapper | Browser | `kb.js` |
| PDF, HTML, CSV and JSON report generation | Browser | `export.js` |
| Results → page view-model | Browser | `view.js` |
| Theme switch, search palette, chart tooltips | Browser | `fx.js` |
| Hosting config (security headers) | Vercel | `vercel.json` |

There is no build step, so this folder is deployed as it is.

**Data handling**
- Uploaded files are read in memory only and cleared when the tab is closed or reloaded.
- Audit results (metrics only, not rows) are saved in the visitor's own browser storage (`localStorage`, keys `sda.v1.*`). Visitors can delete an audit from the Reports page or clear site data.
- `.gitignore` blocks `*.csv`, `*.xlsx` and other data files so datasets can't be committed by mistake.

**Environment variables:** none needed. (A future Python backend would add an API address variable; see "Next steps".)

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
- Shadow-model MIA, attribute inference, singling-out and linkability are shown as "not available in this version".
- Governance mappings are a screening aid for reviewers, not legal advice.

## Next steps (optional Python backend)

To reproduce the notebook results exactly (SDMetrics, scikit-learn) and handle very large files, add a FastAPI service with background jobs, a health endpoint and temporary upload storage. Host it on Render, Railway or Fly.io, and point the frontend at it through an API address variable. The browser engines would remain the fallback.
