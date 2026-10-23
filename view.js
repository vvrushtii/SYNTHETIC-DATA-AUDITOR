/* Synthetic Data Auditor — view-model: turns app state + stored audit results into exactly what the pages render. No DOM here. */
(function (g) {
'use strict';
const SDA = g.SDA = g.SDA || {};
const fmt = (v, d) => typeof v === 'number' && isFinite(v) ? v.toFixed(d === undefined ? 3 : d) : '—';
const fmtPct = (v, d) => typeof v === 'number' && isFinite(v) ? v.toFixed(d === undefined ? 1 : d) + '%' : '—';
const nf = n => n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US');
const bytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const when = iso => { try { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; } };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

const TONE = { Pass: 'green', Completed: 'green', Ready: 'blue', Running: 'blue', Warning: 'amber', Partial: 'amber', Moderate: 'amber', Blocked: 'red', Failed: 'red', High: 'red', 'Not Run': 'grey', Pending: 'grey', Inconclusive: 'grey', Unavailable: 'grey', 'Not Applicable': 'grey', 'Not applicable': 'grey', Skipped: 'grey', 'Sample-based': 'blue', Low: 'green', Draft: 'violet', Demo: 'violet', 'Not run': 'grey',
  Implemented: 'green', 'Partially implemented': 'amber', 'Browser only': 'amber',
  'Potentially Relevant': 'blue', 'Not Indicated by Known Context': 'grey', Undetermined: 'amber', 'Needs Human Review': 'red',
  'Catalogue Only': 'grey', 'Draft Rules': 'amber', 'Verified Subset': 'green', 'Needs Update': 'red', 'Not Supported': 'dark',
  Accepted: 'green', Rejected: 'red', 'Needs More Information': 'amber', 'Project-reviewed': 'green', 'Unverified draft': 'amber', 'Needs re-review': 'red',
  Sufficient: 'green', Insufficient: 'red', 'Binding law': 'navy', 'Voluntary framework': 'violet', 'Technical standard': 'dark', 'Regulator guidance': 'teal' };
const ICON = { Pass: 'check', Completed: 'check', Ready: 'play', Running: 'refresh', Warning: 'alert', Partial: 'alert', Moderate: 'alert', Blocked: 'x', Failed: 'x', High: 'x', 'Not Run': 'dash', Pending: 'clock', Inconclusive: 'dash', Unavailable: 'dash', 'Not applicable': 'dash', Skipped: 'dash', 'Sample-based': 'layers', Low: 'check', Demo: 'flask', Implemented: 'check', 'Partially implemented': 'alert', 'Browser only': 'alert', 'Potentially Relevant': 'check', 'Not Indicated by Known Context': 'dash', Undetermined: 'help', 'Needs Human Review': 'user', 'Catalogue Only': 'book', 'Draft Rules': 'alert', 'Verified Subset': 'check', 'Needs Update': 'refresh', 'Not Supported': 'x', Accepted: 'check', Rejected: 'x', 'Needs More Information': 'help', 'Project-reviewed': 'check', 'Unverified draft': 'alert', 'Needs re-review': 'refresh', Sufficient: 'check', Partial2: 'alert', Insufficient: 'x', Historical: 'archive', 'Binding law': 'scale', 'Voluntary framework': 'book', 'Technical standard': 'book' };
const bd = (label, toneOverride, icon) => ({ label, tone: toneOverride || TONE[label] || 'grey', icon: icon || ICON[label] || 'dash' });
SDA.bd = bd;

const PAGES = [
  { id: 'overview', group: 'Workspace', label: 'Overview', icon: 'grid', title: 'Synthetic Data Quality, Privacy & Compliance Auditor', desc: 'Evaluate synthetic data quality, downstream utility, empirical privacy risks, and governance considerations in one reproducible workflow.' },
  { id: 'new', group: 'Workspace', label: 'New Audit', icon: 'upload', title: 'New Audit', desc: 'Upload a real and a synthetic CSV, review the data, choose the tests and run the audit.' },
  { id: 'clean', group: 'Workspace', label: 'Data Cleaning', icon: 'wand', title: 'Data Cleaning', desc: 'Prepare a cleaned copy of your data. Every step is previewed, logged and reversible; the uploaded files never change.' },
  { id: 'validation', group: 'Evaluate', label: 'Data Validation', icon: 'shield', title: 'Data Validation', desc: 'Can this pair be evaluated consistently? Schema, types, missing values, duplicates and target checks.' },
  { id: 'fidelity', group: 'Evaluate', label: 'Fidelity', icon: 'sliders', title: 'Fidelity', desc: 'How closely does the synthetic data reproduce the real data’s statistical structure?' },
  { id: 'utility', group: 'Evaluate', label: 'Utility', icon: 'target', title: 'Utility', desc: 'Do models trained on synthetic data still work on real data? TRTR versus TSTR.' },
  { id: 'privacy', group: 'Evaluate', label: 'Privacy Tests', icon: 'lock', title: 'Privacy Tests', desc: 'Empirical attack evidence, setup and caveats — one record per attack.' },
  { id: 'ensemble', group: 'Evaluate', label: 'Ensemble Risk', icon: 'layers', title: 'Ensemble Risk', desc: 'A transparent interpretation of the available privacy evidence — not a legal verdict.' },
  { id: 'governance', group: 'Govern', label: 'Governance & Compliance', icon: 'scale', title: 'Governance & Compliance', desc: 'Evidence-to-rule mapping backed by a versioned Compliance Knowledge Base, with human review.' },
  { id: 'compare', group: 'Outputs', label: 'Dataset Comparison', icon: 'columns', title: 'Dataset Comparison', desc: 'Compare audits on shared scales; unavailable values are never treated as zero.' },
  { id: 'reports', group: 'Outputs', label: 'Reports & Exports', icon: 'file', title: 'Reports & Exports', desc: 'Generate the audit report and machine-readable exports from the stored results.' }
];
SDA.pages = PAGES;

const kindOf = a => a.source === 'demo' ? bd('Demo data', 'violet', 'flask') : bd('Current audit', 'blue', 'bolt');
const histBd = bd('Historical baseline', 'hist', 'archive');
const latestOf = S => S.audits.length ? S.audits.slice().sort((p, q) => q.createdAt.localeCompare(p.createdAt))[0] : null;

/* ───────── shared small builders ───────── */
function bar(label, sub, v, lo, hi, text, cls, tip) { const na = v === null || v === undefined || !isFinite(v); return { label, sub, w: na ? 0 : clamp((v - lo) / (hi - lo) * 100, 0, 100), text: na ? 'N/A' : text, cls: na ? 'na' : cls, na, tip: tip || (label + ': ' + (na ? 'not available — never plotted as zero' : text)) }; }
function metricHelp(key) {
  return {
    shapes: { def: 'Average, over columns, of how closely each column’s distribution matches: KS Complement (1 − Kolmogorov–Smirnov distance) for numerical columns and TV Complement (1 − total-variation distance) for categorical ones.', dir: 'Higher is better; 1.0 = identical distributions.', lim: 'Looks at one column at a time. Says nothing about relationships between columns, privacy or downstream utility.' },
    trends: { def: 'Average, over column pairs, of how well pairwise relationships are kept: Pearson correlation similarity (1 − |Δr| ÷ 2) for numerical pairs, contingency-table similarity for the rest (numerical columns binned into 10 equal-width bins).', dir: 'Higher is better; 1.0 = identical pairwise structure.', lim: 'Pairwise only — higher-order structure can still be lost. Computed on at most the first 40 columns.' },
    overall: { def: 'Mean of Column Shapes and Column Pair Trends.', dir: 'Higher is better.', lim: 'One number can hide badly preserved columns — always read the per-column table. High values do not imply privacy or utility.' },
    corr: { def: 'Mean absolute difference between real and synthetic Pearson correlations over unique off-diagonal pairs of numerical (non-declared-categorical) columns.', dir: 'Lower is better; 0 = identical correlations.', lim: 'Linear association only; numeric-coded categories must be declared or they are treated as continuous.' }
  }[key];
}
const VAL_EXPLAIN = {
  file: 'Checks that each file can be read as a table: it has data rows, a header row, unique and non-blank column names, and rows with a consistent number of fields. Unreadable files fail; duplicate column names are blocked because columns could not be matched safely.',
  schema: 'Compares column names across the two files. Columns are matched by name, never by position. Columns present in only one file make metrics non-comparable, so they block the audit unless you explicitly choose to evaluate shared columns only.',
  types: 'Compares the inferred type of each matched column (numerical, categorical, boolean, datetime). A numerical column that is categorical in the other file is blocked. Columns you declare as categorical are treated as categories in both files. Small integer-coded columns are flagged as possible numeric-coded categories.',
  missing: 'Counts empty cells and the tokens NA, N/A, NaN, null, none, nil, ? and #N/A. Large gaps between real and synthetic missing rates, or columns that are almost entirely empty, raise a warning. Missing values are never filled or removed in the uploaded data.',
  dups: 'Counts exact duplicate rows in each file. A synthetic file with far more duplicates than the real one is flagged. Duplicates are reported here, never deleted; removing them is an explicit step in Data Cleaning.',
  values: 'Flags columns with a single value (they carry no information) and numerical values more than 3 × IQR beyond the quartiles. Unusual values may be genuine, so nothing is changed; use Data Cleaning to apply an explicit rule.',
  target: 'If you declared a target, checks that it exists in both files and suits the chosen task: classification needs overlapping class labels; regression needs a numerical target. A target problem blocks only the utility test. With no target, utility evaluation is skipped.'
};

/* provenance line shown on every result page */
function receipt(a) {
  if (!a) return { has: false, items: [] };
  const fp = f => f && f.fingerprint ? f.fingerprint.hex.slice(0, 10) : null; const pv = a.provenance;
  const items = [{ k: 'Run', v: a.id }, { k: 'Source', v: a.source === 'demo' ? 'live · simulated demo data' : 'live · computed from your upload' }, ].concat(a.provenance && a.provenance.dataVersions ? [{ k: 'Real data', v: a.provenance.dataVersions.real }, { k: 'Synthetic data', v: a.provenance.dataVersions.synth }] : [{ k: 'Data', v: a.prep && a.prep.log && a.prep.log.length ? 'prepared copy' : 'raw uploads' }]);
  if (fp(a.files.real)) items.push({ k: 'Real', v: fp(a.files.real) }, { k: 'Synthetic', v: fp(a.files.synth) });
  items.push({ k: 'Engine', v: pv ? pv.engine : 'SDA (version not recorded)' }, { k: 'Seed', v: String(a.settings ? a.settings.seed : '—') }, { k: 'Ran', v: when(a.createdAt) });
  return { has: true, items, legacy: !pv };
}

/* ───────── main builder ───────── */
function build(S, A) {
  const cur = S.audits.find(a => a.id === S.currentId) || null;
  const gov = cur ? SDA.kb.buildGovernance(cur, S.kbState) : null;
  const vm = { act: A, cur: cur ? { id: cur.id, name: cur.name } : null, flash: S.flash, busy: !!S.busy };
  vm.pg = {}; PAGES.forEach(p => vm.pg[p.id] = S.page === p.id);
  const meta = PAGES.find(p => p.id === S.page);
  vm.nav = PAGES.map(p => { let dot = null; if (cur) { const r = cur.results; const st = { validation: r.validation && r.validation.status, fidelity: r.fidelity && r.fidelity.status, utility: r.utility && r.utility.status, privacy: r.privacy && r.privacy.status, ensemble: r.ensemble && r.ensemble.category }[p.id]; if (st) dot = bd(st === 'Pass' ? 'Pass' : st); } return { id: p.id, label: p.label, icon: p.icon, cls: 'nav-item' + (S.page === p.id ? ' on' : ''), go: A.go(p.id), cur: S.page === p.id ? 'page' : 'false', dot: dot ? dot.tone : '', hasDot: !!dot, dotLabel: dot ? dot.label : '' }; });
  vm.navGroups = ['Workspace', 'Evaluate', 'Govern', 'Outputs'].map(gl => ({ label: gl, items: vm.nav.filter(n => PAGES.find(p => p.id === n.id).group === gl) }));
  vm.hasAudits = S.audits.length > 0;
  // header
  const head = { title: meta.title, desc: meta.desc, crumb: meta.label, eyebrow: meta.id === 'overview' ? 'Synthetic Data Auditor · Workspace' : meta.group, hasAudits: S.audits.length > 0, noAudits: S.audits.length === 0, currentId: S.currentId || '', auditOptions: S.audits.length ? S.audits.map(a => ({ id: a.id, label: a.name + ' · ' + a.id + (a.source === 'demo' ? ' (demo)' : '') })) : [{ id: '', label: 'No audit selected' }], status: null, kind: null, actions: [], line: { has: false, label: '', tone: 'grey', text: '' } };
  if (S.busy === 'run') head.status = bd('Running'); else if (S.page === 'new' && !cur) head.status = S.draft.validated ? (S.draft.validation.canRun ? bd('Ready') : bd('Blocked')) : bd('Draft', 'violet', 'edit'); else if (cur) head.status = bd(cur.status === 'Ready' ? 'Ready' : cur.status);
  if (cur && S.page !== 'new') head.kind = kindOf(cur);
  const act = (label, kind, icon, onClick, o) => Object.assign({ label, cls: 'btn ' + (kind === 'primary' ? 'btn-primary' : 'btn-ghost'), icon, onClick, disabled: false, title: '' }, o || {});
  const resultPage = ['validation', 'fidelity', 'utility', 'privacy', 'ensemble', 'governance'].indexOf(S.page) >= 0;
  if (S.page === 'overview') {
    const ra = cur || latestOf(S);
    if (ra) {
      const gen = ra.info && ra.info.generator ? String(ra.info.generator).trim() : '';
      head.title = ra.name + (gen && ra.name.toLowerCase().indexOf(gen.toLowerCase().split(' (')[0].split(' +')[0]) < 0 ? ', synthesised with ' + gen : '');
      head.eyebrow = 'Overview · ' + (ra.source === 'demo' ? 'demo audit (simulated data)' : 'current audit');
      head.desc = '';
      const stl = { Completed: ['Completed', 'green'], Partial: ['Completed with gaps', 'amber'], Failed: ['Failed', 'red'], Blocked: ['Blocked', 'red'], Ready: ['Not run', 'grey'] }[ra.status] || [ra.status, 'grey'];
      head.line = { has: true, label: stl[0], tone: stl[1], text: nf(ra.files.real.rows) + ' real × ' + ra.files.real.cols + ' columns · ' + nf(ra.files.synth.rows) + ' synthetic rows · finished ' + when(ra.createdAt) };
      if (!head.status) head.status = bd(ra.status);
      if (!head.kind) head.kind = kindOf(ra);
      head.actions.push(act('Start a new audit', 'primary', 'plus', A.newAudit));
      head.actions.push(act('Open the report', 'ghost', 'file', A.openPage(ra.id, 'reports')));
    } else {
      head.actions.push(act('Load demo pair', 'ghost', 'flask', A.loadDemoClean, { title: 'Loads a simulated demo dataset pair (clearly labelled demo data)' }));
      head.actions.push(act('Start New Audit', 'primary', 'plus', A.newAudit));
    }
  }
  else if (S.page === 'new') { head.actions.push(act('Load demo pair', 'ghost', 'flask', A.loadDemoClean, { title: 'Loads a simulated demo dataset pair (clearly labelled demo data)' })); head.actions.push(act('Reset form', 'ghost', 'refresh', A.resetDraft)); }
  else if (resultPage) { head.actions.push(act('Run Evaluation', 'ghost', 'play', A.rerun, { disabled: !cur || S.busy === 'run', title: cur ? (A.hasRaw(cur.id) ? 'Re-run the selected modules on the data still held in this tab' : 'Raw data is not kept after a reload — this opens New Audit so you can re-upload') : 'Select an audit first' })); head.actions.push(act('Export Report', 'primary', 'download', A.go('reports'), { disabled: !cur })); }
  else if (S.page === 'compare') head.actions.push(act('New Audit', 'primary', 'plus', A.newAudit));
  else if (S.page === 'reports') head.actions.push(act('Download PDF', 'primary', 'download', A.exportPdf, { disabled: !cur }));
  head.receipt = cur && (resultPage || S.page === 'reports') ? receipt(cur) : { has: false, items: [] };
  vm.head = head;
  if (S.page === 'overview') vm.ov = ovVM(S, A, cur, gov);
  if (S.page === 'new') vm.na = naVM(S, A);
  if (S.page === 'clean') vm.cl = clVM(S, A);
  if (S.page === 'validation') vm.va = vaVM(S, A, cur);
  if (S.page === 'fidelity') vm.fi = fiVM(S, A, cur);
  if (S.page === 'utility') vm.ut = utVM(S, A, cur);
  if (S.page === 'privacy') vm.pr = prVM(S, A, cur);
  if (S.page === 'ensemble') vm.en = enVM(S, A, cur);
  if (S.page === 'governance') vm.gv = gvVM(S, A, cur, gov);
  if (S.page === 'compare') vm.cm = cmVM(S, A);
  if (S.page === 'reports') { vm.rp = rpVM(S, A, cur, gov); const t = S.ui.rpTab || 'report'; vm.rpTabs = [['report', 'Report'], ['registry', 'Results registry'], ['history', 'History']].map(x => ({ label: x[1], cls: 'tab' + (t === x[0] ? ' on' : ''), go: A.setUi('rpTab', x[0]) })); vm.rpT = { report: t === 'report', registry: t === 'registry', history: t === 'history' }; }
  vm.empty = { title: 'No audit selected', text: 'Results appear here after you run an audit. Upload a real and a synthetic CSV, or load the clearly labelled demo pair to try the full workflow.', newAudit: A.newAudit, demo: A.loadDemoClean };
  return vm;
}

/* ───────── Overview ───────── */
function ovVM(S, A, cur, gov) {
  const inc = S.audits.filter(a => S.includeDemo || a.source !== 'demo'); const excluded = S.audits.length - inc.length;
  const fidA = inc.filter(a => a.results.fidelity && a.results.fidelity.status === 'Completed' && a.results.fidelity.overall !== null);
  const utilA = inc.filter(a => a.results.utility && a.results.utility.status === 'Completed' && a.results.utility.headline.retention !== null);
  const groups = {}; utilA.forEach(a => { const k = a.results.utility.task + '|' + a.results.utility.primary; (groups[k] = groups[k] || []).push(a); });
  const bestKey = Object.keys(groups).sort((p, q) => groups[q].length - groups[p].length)[0]; const comp = bestKey ? groups[bestKey] : [];
  const privA = inc.filter(a => a.results.privacy && (a.results.privacy.status === 'Completed' || a.results.privacy.status === 'Partial'));
  let pending = 0, mapped = 0; inc.forEach(a => { const G = SDA.kb.buildGovernance(a, S.kbState); mapped += G.mappings.length; pending += G.mappings.filter(m => m.reviewStatus === 'Pending' || m.reviewStatus === 'Needs More Information').length; });
  const noteDemo = excluded ? excluded + ' demo audit' + (excluded > 1 ? 's' : '') + ' excluded' : '';
  const kpis = [
    { icon: 'layers', label: 'Dataset pairs evaluated', value: String(inc.length), sub: inc.length ? 'Current audits in this browser' + (noteDemo ? ' · ' + noteDemo : '') : (noteDemo ? noteDemo + '. Nothing evaluated yet.' : 'No audit has been run yet.'), status: bd(inc.length ? 'Completed' : 'Not Run', inc.length ? 'blue' : 'grey', inc.length ? 'check' : 'dash'), statusText: inc.length ? 'Live data' : 'Empty' },
    { icon: 'sliders', label: 'Average fidelity (Overall Quality)', value: fidA.length ? fmt(mean(fidA.map(a => a.results.fidelity.overall))) : '—', sub: fidA.length ? 'Mean of ' + fidA.length + ' audit' + (fidA.length > 1 ? 's' : '') + ' · same metric definition, 0–1' : 'Needs a completed fidelity run.', status: bd(fidA.length ? 'Completed' : 'Not Run'), statusText: fidA.length ? 'Comparable' : 'No data' },
    { icon: 'target', label: 'Average utility retention', value: comp.length ? fmtPct(mean(comp.map(a => a.results.utility.headline.retention))) : '—', sub: comp.length ? SDA.metricMeta[comp[0].results.utility.primary].label + ' · ' + comp[0].results.utility.task + ' · ' + comp.length + ' audit' + (comp.length > 1 ? 's' : '') + (utilA.length > comp.length ? ' (' + (utilA.length - comp.length) + ' not comparable, left out)' : '') : 'Only averaged across completed runs of the same task and metric.', status: bd(comp.length ? 'Completed' : 'Not Run'), statusText: comp.length ? 'Like-for-like' : 'No data' },
    { icon: 'lock', label: 'Privacy assessments completed', value: String(privA.length), sub: privA.length ? privA.reduce((s, a) => s + a.results.privacy.completed, 0) + ' attack runs completed' : 'No privacy test has completed.', status: bd(privA.length ? 'Completed' : 'Not Run'), statusText: privA.length ? 'Empirical' : 'None' },
    { icon: 'scale', label: 'Governance findings to review', value: String(pending), sub: mapped ? pending + ' of ' + mapped + ' mappings still pending human review' : 'No mappings yet — select frameworks in governance context.', status: pending ? bd('Needs Human Review') : bd(mapped ? 'Completed' : 'Not Run'), statusText: pending ? 'Review' : mapped ? 'Reviewed' : 'None' }
  ];
  // charts
  const base = SDA.baseline.rows;
  const rowsFid = base.map(r => bar(r.name, 'Historical baseline', r.overall, 0, 1, fmt(r.overall), 'hist', r.name + ' — historical baseline, Overall Quality ' + fmt(r.overall))).concat(fidA.map(a => bar(a.name, a.source === 'demo' ? 'Demo audit' : 'Current audit', a.results.fidelity.overall, 0, 1, fmt(a.results.fidelity.overall), a.source === 'demo' ? 'demo' : 'cur')));
  const rowsUtil = base.map(r => bar(r.name, 'Historical baseline', r.retention, 0, 120, fmtPct(r.retention), 'hist')).concat(utilA.map(a => bar(a.name, (a.source === 'demo' ? 'Demo audit' : 'Current audit') + ' · ' + SDA.metricMeta[a.results.utility.primary].label, a.results.utility.headline.retention, 0, 120, fmtPct(a.results.utility.headline.retention), a.source === 'demo' ? 'demo' : 'cur')));
  const rowsPriv = base.map(r => bar(r.name, 'Historical baseline', r.mia, 0.4, 1, r.mia === null ? 'N/A' : fmt(r.mia), 'hist', r.mia === null ? r.name + ' — MIA pending verification' : '')).concat(privA.map(a => { const m = a.results.privacy.attacks.find(x => x.id === 'mia' && x.status === 'Completed'); return bar(a.name, a.source === 'demo' ? 'Demo audit' : 'Current audit', m ? m.metrics.auc : null, 0.4, 1, m ? fmt(m.metrics.auc) : '', a.source === 'demo' ? 'demo' : 'cur'); }));
  const latest = (S.audits.slice().sort((p, q) => q.createdAt.localeCompare(p.createdAt))[0]) || null; const covA = cur || latest;
  let cov = { has: false };
  if (covA && covA.results.privacy && covA.results.privacy.attacks && covA.results.privacy.attacks.length) {
    const E = covA.results.ensemble.coverage || { completed: 0, failed: 0, notRun: 0, pending: 4, planned: 6 }; const tot = E.completed + E.failed + E.notRun + E.pending;
    const segs = [['Completed', E.completed, 'seg-ok'], ['Failed', E.failed, 'seg-bad'], ['Not run', E.notRun, 'seg-nr'], ['Not available', E.pending, 'seg-pend']].map(s => ({ label: s[0], count: s[1], w: tot ? s[1] / tot * 100 : 0, cls: 'seg ' + s[2], show: s[1] > 0 }));
    cov = { has: true, audit: covA.name, segs, text: E.completed + ' of ' + E.planned + ' privacy attack types tested for “' + covA.name + '”.' };
  }
  // key findings
  const findings = [];
  const f0 = fidA.length ? fidA[0] : null, tgt = covA && covA.source !== 'demo' || S.includeDemo ? covA : null;
  const src = tgt || (inc.length ? inc[0] : null);
  if (src) {
    const r = src.results, tag = kindOf(src);
    if (r.validation) findings.push({ tag, tone: TONE[r.validation.status], title: 'Validation ' + r.validation.status.toLowerCase(), text: r.validation.warnings.length ? r.validation.warnings.length + ' warning(s) and ' + r.validation.blockers.length + ' blocker(s) on “' + src.name + '”.' : 'No warnings on “' + src.name + '”.', evidence: 'Validation › check cards', go: A.openPage(src.id, 'validation') });
    if (r.fidelity && r.fidelity.status === 'Completed') { const worst = r.fidelity.perColumn.filter(p => p.score !== null).sort((a, b) => a.score - b.score)[0]; findings.push({ tag, tone: worst && worst.score < 0.8 ? 'amber' : 'green', title: 'Overall Quality ' + fmt(r.fidelity.overall), text: worst ? 'Weakest column: “' + worst.name + '” (' + worst.metric + ' ' + fmt(worst.score) + '). Average correlation difference ' + fmt(r.fidelity.avgCorrDiff) + '.' : '', evidence: 'Fidelity › Feature-level table', go: A.openPage(src.id, 'fidelity') }); }
    if (r.utility && r.utility.status === 'Completed') findings.push({ tag, tone: r.utility.headline.retention >= 90 ? 'green' : r.utility.headline.retention >= 75 ? 'amber' : 'red', title: 'Utility retention ' + fmtPct(r.utility.headline.retention), text: SDA.metricMeta[r.utility.primary].label + ': TRTR ' + fmt(r.utility.headline.trtr) + ' vs TSTR ' + fmt(r.utility.headline.tstr) + ' (' + r.utility.task + ', target “' + r.utility.target + '”).', evidence: 'Utility › TRTR vs TSTR table', go: A.openPage(src.id, 'utility') });
    if (r.ensemble && r.ensemble.category) findings.push({ tag, tone: r.ensemble.tone, title: r.ensemble.label, text: r.ensemble.rationale[0] || '', evidence: 'Ensemble Risk › component evidence', go: A.openPage(src.id, 'ensemble') });
    const G = SDA.kb.buildGovernance(src, S.kbState); if (G.mappings.length || G.gaps.length) findings.push({ tag, tone: 'amber', title: G.mappings.length + ' governance review prompts · ' + G.gaps.length + ' evidence gaps', text: G.mappings.filter(m => m.ruleVerification !== 'Project-reviewed').length + ' rest on unverified draft rules. Not a compliance verdict.', evidence: 'Governance › Mappings & gaps', go: A.openPage(src.id, 'governance') });
  } else {
    const lo = base.slice().sort((a, b) => a.retention - b.retention)[0], hi = base.slice().sort((a, b) => b.retention - a.retention)[0];
    const th = histBd;
    findings.push({ tag: th, tone: 'amber', title: 'Lowest utility retention: ' + lo.name + ' (' + lo.retention + '%)', text: 'Highest was ' + hi.name + ' (' + hi.retention + '%). Retention depends on task and model — compare like with like.', evidence: 'Compare Datasets › historical baseline', go: A.go('compare') });
    findings.push({ tag: th, tone: 'grey', title: 'Pair Trends not reported for Amazon / Google', text: 'Shown as N/A, never as zero. Breast Cancer MIA is marked “pending verification”.', evidence: 'Compare Datasets › comparison table', go: A.go('compare') });
    findings.push({ tag: th, tone: 'blue', title: 'All five baseline MIA values sit near 0.5', text: 'Range 0.498–0.509 for the four reported pairs under the initial distance-based attack. AUC near 0.5 is not proof of safety.', evidence: 'Privacy Tests › interpretation', go: A.go('privacy') });
  }
  // benchmark: the same three headline metrics on one shared layout, every dataset as a dot
  const selId = cur ? cur.id : (latest ? latest.id : null);
  const pt = (name, kind, v, lo, hi, text, id) => { const na = v === null || v === undefined || !isFinite(v); const x = na ? 0 : (v - lo) / (hi - lo) * 100; return { name, kind, cls: 'bm-pt bm-' + kind + (id && id === selId ? ' bm-sel' : '') + (x > 78 ? ' bm-er' : x < 14 ? ' bm-el' : ''), x: clamp(x, 0, 100), clipped: !na && (x < 0 || x > 100), na, text: na ? 'N/A' : text, lab: !!id && id === selId, tip: name + ' · ' + (kind === 'hist' ? 'historical baseline' : kind === 'demo' ? 'demo audit' : 'current audit') + ' · ' + (na ? 'not available' : text) }; };
  const ticks = (lo, hi, list, f) => list.map(v => ({ l: f(v), x: (v - lo) / (hi - lo) * 100 }));
  const zone = (lo, hi, a, b, cls, label) => ({ cls: 'bm-z ' + cls, l: (a - lo) / (hi - lo) * 100, w: (b - a) / (hi - lo) * 100, label });
  const kindA = a => a.source === 'demo' ? 'demo' : 'cur';
  const benchRows = [
    { id: 'fid', label: 'Overall Quality', sub: 'Fidelity · 0 to 1 · higher is closer to real', lo: 0.7, hi: 1, tk: [0.7, 0.8, 0.9, 1], f: v => v.toFixed(2),
      zones: [[0.7, 0.8, 'z-far', 'Large gap'], [0.8, 0.9, 'z-mid', 'Moderate gap'], [0.9, 1, 'z-ok', 'Close']], ref: null,
      pts: base.map(r => pt(r.name, 'hist', r.overall, 0.7, 1, fmt(r.overall))).concat(fidA.map(a => pt(a.name, kindA(a), a.results.fidelity.overall, 0.7, 1, fmt(a.results.fidelity.overall), a.id))) },
    { id: 'util', label: 'Utility retention', sub: 'TSTR as % of TRTR · dashed line = real-trained (100%) · tasks and models differ', lo: 40, hi: 120, tk: [40, 60, 80, 100, 120], f: v => v + '%',
      zones: [[40, 75, 'z-far', 'Below 75%'], [75, 90, 'z-mid', '75 to 90%'], [90, 120, 'z-ok', '90% and above']], ref: { x: 75, label: '100% = real-trained' },
      pts: base.map(r => pt(r.name, 'hist', r.retention, 40, 120, fmtPct(r.retention))).concat(utilA.map(a => pt(a.name, kindA(a), a.results.utility.headline.retention, 40, 120, fmtPct(a.results.utility.headline.retention), a.id))) },
    { id: 'mia', label: 'Membership inference ROC-AUC', sub: 'Lower is better · dashed line = 0.5, random guessing · not proof of safety', lo: 0.4, hi: 1, tk: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], f: v => v.toFixed(1),
      zones: [[0.4, 0.55, 'z-ok', 'Below Moderate'], [0.55, 0.65, 'z-mid', 'Moderate'], [0.65, 1, 'z-far', 'High']], ref: { x: (0.5 - 0.4) / 0.6 * 100, label: '0.5 chance' },
      pts: base.map(r => pt(r.name, 'hist', r.mia, 0.4, 1, r.mia === null ? '' : fmt(r.mia))).concat(privA.map(a => { const m = a.results.privacy.attacks.find(x => x.id === 'mia' && x.status === 'Completed'); return pt(a.name, kindA(a), m ? m.metrics.auc : null, 0.4, 1, m ? fmt(m.metrics.auc) : '', a.id); })) }
  ].map(r => { const shown = r.pts.filter(p => !p.na); const placed = []; shown.slice().sort((p, q) => p.x - q.x).forEach(p => { const near = placed.filter(q => Math.abs(q.x - p.x) < 2.4).length; p.dy = [0, -10, 10, -20, 20, -30, 30][near % 7]; placed.push(p); }); const missing = r.pts.filter(p => p.na).map(p => p.name); return { id: r.id, label: r.label, sub: r.sub, ticks: ticks(r.lo, r.hi, r.tk, r.f), zones: r.zones.map(z => zone(r.lo, r.hi, z[0], z[1], z[2], z[3])), hasRef: !!r.ref, ref: r.ref || { x: 0, label: '' }, pts: shown, naNote: missing.length ? 'Not plotted (N/A, never zero): ' + missing.join(', ') : '', hasNa: missing.length > 0, clipNote: shown.some(p => p.clipped) ? 'Values outside the axis are pinned to its edge; hover for the exact figure.' : '', hasClip: shown.some(p => p.clipped) }; });
  const benchTable = base.map(r => ({ name: r.name, kind: histBd, fid: fmt(r.overall), util: fmtPct(r.retention), mia: r.mia === null ? 'N/A' : fmt(r.mia) })).concat(inc.map(a => { const R = a.results, m = R.privacy && R.privacy.attacks ? R.privacy.attacks.find(x => x.id === 'mia' && x.status === 'Completed') : null; return { name: a.name, kind: kindOf(a), fid: R.fidelity && R.fidelity.overall !== null && R.fidelity.status === 'Completed' ? fmt(R.fidelity.overall) : 'N/A', util: R.utility && R.utility.status === 'Completed' && R.utility.headline.retention !== null ? fmtPct(R.utility.headline.retention) : 'N/A', mia: m ? fmt(m.metrics.auc) : 'N/A' }; }));
  const selA = S.audits.find(a => a.id === selId) || null;
  const bench = { rows: benchRows, table: benchTable, hasSel: !!selA && inc.includes(selA), selName: selA ? selA.name : '', selKind: selA ? kindOf(selA) : null };
  // the audit shown on the Overview: the selected one, else the most recent
  const runA = cur || latest;
  const runG = runA ? (runA === cur ? gov : SDA.kb.buildGovernance(runA, S.kbState)) : null;
  const stand = runA ? standVM(runA, A) : [];
  const attn = runA ? attnVM(runA, runG, A) : [];
  const cover = runA ? coverVM(runA, runG) : [];
  // recent audits: status filter + table, every row is a stored audit
  const grp = a => a.status === 'Completed' ? 'done' : (a.status === 'Failed' || a.status === 'Blocked') ? 'failed' : 'incomplete';
  const allA = S.audits.slice().sort((p, q) => q.createdAt.localeCompare(p.createdAt));
  const cnt = { all: allA.length, done: allA.filter(a => grp(a) === 'done').length, incomplete: allA.filter(a => grp(a) === 'incomplete').length, failed: allA.filter(a => grp(a) === 'failed').length };
  const flt = (S.ui && S.ui.ovFilter) || 'all';
  const filters = [['all', 'All'], ['done', 'Completed'], ['incomplete', 'Incomplete'], ['failed', 'Failed']].map(f => ({ label: f[1], n: cnt[f[0]], on: flt === f[0], cls: 'segc-b' + (flt === f[0] ? ' on' : ''), go: A.setUi('ovFilter', f[0]) }));
  const rows = allA.filter(a => flt === 'all' || grp(a) === flt).slice(0, 8).map(a => {
    const ES = SDA.engineStatuses(a, null), C = SDA.CANON;
    const parts = [['fidelity', 'Fidelity'], ['utility', 'Utility'], ['privacy', 'Privacy tests']].map(p => { const e = ES.find(x => x.id === p[0]); const st = e ? e.status : C.skip; return st === C.done ? null : p[1] + (st === C.partial ? ' partly run' : st === C.fail ? ' failed' : st === C.blocked ? ' blocked' : ' not run'); }).filter(Boolean);
    const bad = ES.find(x => x.status === C.fail || x.status === C.blocked);
    const note = grp(a) === 'done' ? (ES.some(x => x.sampled) ? 'Sample-based results' : 'All selected tests ran') : (parts.join(', ') || 'See the audit for details') + (bad && bad.reason ? ' · ' + bad.reason.slice(0, 90) : '');
    const st = a.status === 'Completed' ? bd('Completed') : a.status === 'Partial' ? bd('Incomplete', 'amber', 'alert') : a.status === 'Failed' ? bd('Failed') : a.status === 'Blocked' ? bd('Blocked') : bd('Ready');
    return { name: a.name, sub: a.id + (a.source === 'demo' ? ' · demo data' : ''), gen: a.info && a.info.generator && String(a.info.generator).trim() ? String(a.info.generator).trim() : '—', st, note, date: when(a.createdAt), open: A.open(a.id), isSel: !!runA && a.id === runA.id };
  });
  return { has: !!runA, standSub: runA ? (runA === cur ? 'The selected audit' : 'The most recent audit. Pick another in the top bar.') : '', stand, attn, hasAttn: attn.length > 0, cover, filters, rows, noRows: rows.length === 0, recSub: cnt.all + ' audit' + (cnt.all === 1 ? '' : 's') + ' · ' + cnt.done + ' completed · ' + cnt.incomplete + ' incomplete · ' + cnt.failed + ' failed · stored in this browser only', hasRecent: cnt.all > 0, bench, kpis, hasData: inc.length > 0, noDataText: S.audits.length ? 'Only demo audits exist. Switch on “Include demo audits” to count them in the KPIs.' : 'No current audit yet. Upload a real and a synthetic CSV to start, or load the clearly labelled demo pair.', rowsFid, rowsUtil, rowsPriv, cov, findings, includeDemo: S.includeDemo, toggleDemo: A.toggleDemo, hasDemo: S.audits.some(a => a.source === 'demo'), histBd, newAudit: A.newAudit, demo: A.loadDemoClean };
}

/* Overview builders: every value comes from the stored audit; nothing is invented. */
function standVM(a, A) {
  const r = a.results, F = r.fidelity, U = r.utility, P = r.privacy, E = r.ensemble;
  // fidelity
  const fidOk = !!F && F.status === 'Completed' && typeof F.overall === 'number';
  const scored = fidOk ? (F.perColumn || []).filter(p => typeof p.score === 'number') : [];
  const low = scored.filter(p => p.score < 0.8), worst = scored.slice().sort((p, q) => p.score - q.score)[0];
  const fid = fidOk
    ? { label: 'Fidelity', title: F.overall >= 0.9 ? 'Close to the real data' : F.overall >= 0.8 ? 'Some gap from the real data' : 'Far from the real data', bd: F.overall >= 0.9 ? bd('Close', 'green', 'check') : F.overall >= 0.8 ? bd('Moderate gap', 'amber', 'alert') : bd('Large gap', 'red', 'alert'), value: fmt(F.overall, 2), unit: 'Overall Quality, 0 to 1',
        text: (low.length ? low.length + ' of ' + scored.length + ' columns score below 0.80.' : 'No column scores below 0.80.') + (worst ? ' Weakest: “' + worst.name + '” (' + worst.metric + ' ' + fmt(worst.score) + ').' : ''), cta: 'See the column detail' }
    : { label: 'Fidelity', title: 'Not measured', bd: bd(F && F.status ? F.status : 'Not Run'), value: '—', unit: '', text: (F && (F.reason || F.error)) || 'Fidelity was not run for this audit.', cta: 'Open fidelity' };
  fid.go = A.openPage(a.id, 'fidelity'); fid.cls = 'st';
  // utility
  const utOk = !!U && U.status === 'Completed' && U.headline && typeof U.headline.retention === 'number';
  const ret = utOk ? U.headline.retention : null;
  const ut = utOk
    ? { label: 'Utility', title: ret >= 90 ? 'Models trained on it hold up' : ret >= 75 ? 'Models lose some accuracy' : 'Models trained on it fall short', bd: ret >= 90 ? bd('Holds up', 'green', 'check') : ret >= 75 ? bd('Some loss', 'amber', 'alert') : bd('Large loss', 'red', 'alert'), value: fmtPct(ret), unit: 'of real-data ' + SDA.metricMeta[U.primary].label + ' kept',
        text: 'Trained on synthetic, tested on real: ' + fmt(U.headline.tstr) + ' vs ' + fmt(U.headline.trtr) + ' (' + U.task + ', target “' + U.target + '”).', cta: 'Compare TRTR and TSTR' }
    : { label: 'Utility', title: 'Not measured', bd: bd(U && U.status ? U.status : 'Not Run'), value: '—', unit: '', text: (U && (U.reason || U.error)) || 'Utility was not run for this audit.', cta: 'Open utility' };
  ut.go = A.openPage(a.id, 'utility'); ut.cls = 'st';
  // privacy: kept separate on purpose, and never summarised from fidelity or utility
  const done = P && P.attacks ? P.attacks.filter(x => x.status === 'Completed').length : 0, planned = SDA.attackCatalogue.length;
  const ran = !!P && !!P.attacks && P.attacks.length > 0;
  const eOk = !!E && !!E.category && !E.insufficient;
  const pr = !ran
    ? { label: 'Privacy', title: 'Not measured', bd: bd(P && P.status ? P.status : 'Not Run'), value: '—', unit: '', text: (P && (P.reason || P.error)) || 'No privacy test was run for this audit.', cta: 'Open privacy tests' }
    : { label: 'Privacy', title: eOk ? E.label : 'Not enough evidence yet', bd: eOk ? bd(E.label, E.tone, E.tone === 'green' ? 'check' : 'alert') : bd('Insufficient evidence', 'grey', 'dash'), value: done + ' of ' + planned, unit: 'attack types completed',
        text: eOk ? ((E.rationale && E.rationale[0]) || '') : 'No risk category is shown until more tests have run.', cta: eOk ? 'See the ensemble reasoning' : 'See what is missing' };
  pr.go = A.openPage(a.id, 'ensemble'); pr.cls = 'st st-ring';
  return [fid, ut, pr];
}

function attnVM(a, gov, A) {
  const r = a.results, F = r.fidelity, U = r.utility, P = r.privacy, E = r.ensemble, V = r.validation;
  const out = [];
  const it = (tag, text, link, page) => out.push({ bd: tag, text, link, go: page === 'new' ? A.newAudit : A.openPage(a.id, page) });
  const ES = SDA.engineStatuses(a, gov), C = SDA.CANON;
  ES.filter(x => x.status === C.fail || x.status === C.blocked).forEach(x => it(bd(x.status, 'red', 'x'), x.label + ': ' + (x.reason || x.status.toLowerCase()), x.label, x.id === 'preparation' ? 'validation' : x.id));
  [['fidelity', 'Fidelity', 'fidelity'], ['utility', 'Utility', 'utility'], ['privacy', 'Privacy tests', 'privacy']].forEach(m => { const e = ES.find(x => x.id === m[0]); if (e && e.status === C.skip) it(bd('Not run', 'grey', 'dash'), m[1] + ' did not run' + (e.reason ? ': ' + e.reason.replace(/\.$/, '') : '') + '.' + (m[0] === 'privacy' ? ' This audit has no privacy evidence; fidelity and utility cannot stand in for it.' : ''), m[1], m[2]); });
  const done = P && P.attacks ? P.attacks.filter(x => x.status === 'Completed').length : 0, planned = SDA.attackCatalogue.length;
  if (P && P.attacks && P.attacks.length) {
    if (!E || !E.category || E.insufficient) it(bd('Insufficient', 'grey', 'dash'), 'Only ' + done + ' of ' + planned + ' attack types have run, so no privacy risk category can be given yet.', 'Ensemble risk', 'ensemble');
    else it(bd(E.label, E.tone, E.tone === 'green' ? 'check' : 'alert'), (E.rationale && E.rationale[0]) || E.label, 'Ensemble risk', 'ensemble');
    const mia = P.attacks.find(x => x.id === 'mia' && x.status === 'Completed');
    if (mia && mia.metrics && typeof mia.metrics.auc === 'number') it(bd('Note', 'blue', 'info'), 'The membership attack scored ROC-AUC ' + fmt(mia.metrics.auc) + (Math.abs(mia.metrics.auc - 0.5) < 0.05 ? ', near chance' : '') + '. That is a result for this one attack, not proof that the data is private.', 'Privacy tests', 'privacy');
  }
  if (V && V.warnings && V.warnings.length) it(bd('Warning', 'amber', 'alert'), V.warnings.length + ' validation warning' + (V.warnings.length === 1 ? '' : 's') + '. ' + (V.warnings[0].text || ''), 'Validation', 'validation');
  if (F && F.status === 'Completed' && Array.isArray(F.perColumn)) {
    const lowC = F.perColumn.filter(p => typeof p.score === 'number' && p.score < 0.8).sort((p, q) => p.score - q.score);
    if (lowC.length) it(bd('Drift', 'amber', 'alert'), lowC.slice(0, 3).map(p => p.name).join(', ') + (lowC.length > 3 ? ' and ' + (lowC.length - 3) + ' more' : '') + ' differ most from the real data.', 'Fidelity', 'fidelity');
  }
  if (U && U.status === 'Completed' && U.headline && typeof U.headline.retention === 'number' && U.headline.retention < 90) it(bd('Utility', U.headline.retention < 75 ? 'red' : 'amber', 'alert'), 'Utility retention is ' + fmtPct(U.headline.retention) + ', below the 90% reading band. Compare the task and model before drawing conclusions.', 'Utility', 'utility');
  if (gov) {
    const fw = (a.context && a.context.frameworks) || [];
    const pend = gov.mappings.filter(m => m.reviewStatus === 'Pending' || m.reviewStatus === 'Needs More Information').length;
    const und = gov.applicability ? gov.applicability.filter(x => /undetermined/i.test(x.status || '')).length : 0;
    if (!fw.length) it(bd('Review', 'grey', 'dash'), 'No governance frameworks were selected, so no regulation mappings were produced.', 'Governance', 'governance');
    else if (pend || und) it(bd('Review', 'amber', 'user'), ((pend ? pend + ' regulation mapping' + (pend === 1 ? '' : 's') + ' wait' + (pend === 1 ? 's' : '') + ' for a reviewer. ' : '') + (und ? und + ' framework' + (und === 1 ? ' has' : 's have') + ' undetermined applicability and need an answer.' : '')).trim(), 'Governance', 'governance');
  }
  return out;
}

function coverVM(a, gov) {
  const C = SDA.CANON, ES = SDA.engineStatuses(a, gov), es = id => ES.find(x => x.id === id);
  const tone = { Completed: bd('Completed', 'green', 'check'), Partial: bd('Partial', 'amber', 'alert'), Failed: bd('Failed', 'red', 'x'), Blocked: bd('Blocked', 'red', 'x'), Skipped: bd('Not run', 'grey', 'dash'), 'Not applicable': bd('Not available', 'grey', 'dash') };
  const row = (name, st, text) => { const b = tone[st] || tone.Skipped; return { name, bd: b, text: text || b.label }; };
  const out = [];
  const v = es('validation'); out.push(row('Validation', v ? v.status : C.skip));
  const pp = es('preparation'); out.push(row('Data cleaning', pp ? pp.status : C.skip, pp && pp.status === C.done ? 'Cleaned copy used' : 'Raw uploads used'));
  const f = es('fidelity'); out.push(row('Fidelity', f ? f.status : C.skip));
  const u = es('utility'); out.push(row('Utility', u ? u.status : C.skip));
  const pv = es('privacy'), names = { mia: 'Membership inference', exact: 'Exact-match test', shadow: 'Shadow-model inference', attr: 'Attribute inference', single: 'Singling-out', link: 'Linkability' };
  SDA.attackCatalogue.forEach(c => {
    const hit = pv && pv.attacks ? pv.attacks.find(x => x.id === c.id) : null;
    if (hit) out.push(row(names[c.id] || c.short, hit.status));
    else out.push(row(names[c.id] || c.short, c.implemented ? C.skip : C.na, c.implemented ? 'Not run' : 'Not available in this version'));
  });
  const e = es('ensemble'), E = a.results.ensemble;
  out.push(e && e.status === C.done ? row('Ensemble risk', C.done, E && E.label ? E.label : 'Completed') : e && e.status === C.partial ? { name: 'Ensemble risk', bd: bd('Insufficient evidence', 'grey', 'dash'), text: 'Insufficient evidence' } : row('Ensemble risk', C.skip));
  const g = es('governance');
  if (gov && g && g.status !== C.skip) { const pend = gov.mappings.filter(m => m.reviewStatus === 'Pending' || m.reviewStatus === 'Needs More Information').length; out.push(pend ? { name: 'Governance', bd: bd('Review pending', 'amber', 'clock'), text: pend + ' of ' + gov.mappings.length + ' awaiting review' } : row('Governance', g.status)); }
  else out.push({ name: 'Governance', bd: bd('Not run', 'grey', 'dash'), text: 'No frameworks selected' });
  out.push({ name: 'Report', bd: bd('Ready', 'blue', 'play'), text: 'Ready to export' });
  return out;
}

/* ───────── New Audit: upload → profile → data version → configure tests → governance ───────── */
const STEPS = [['Upload', 'Two CSV files'], ['Profile', 'Schema and data quality'], ['Data version', 'Raw upload or cleaned copy'], ['Tests', 'Target, privacy profile, settings'], ['Context', 'Governance answers']];
function naVM(S, A) {
  const D = S.draft, N = SDA.kb.noneValues;
  const slot = (which, title, meta) => {
    const errs = meta && meta.check ? meta.check.errors : [], warns = meta && meta.check ? meta.check.warnings : []; const bad = !!meta && (meta.status === 'error' || errs.length > 0);
    return { which, title, inputId: 'file-' + which, has: !!meta, ok: !!meta && !bad, bad, name: meta ? meta.name : '', size: meta ? bytes(meta.size) : '', rows: meta ? nf(meta.rows) : '', cols: meta ? meta.cols : '',
      status: !meta ? bd('Not Run', 'grey', 'dash') : bad ? bd('Failed', 'red', 'x') : warns.length ? bd('Warning') : bd('Completed', 'green', 'check'), statusText: !meta ? 'No file' : bad ? 'Cannot be audited' : warns.length ? 'Read with warnings' : 'Checked',
      errors: errs.length ? errs : (meta && meta.status === 'error' ? [meta.error] : []), warnings: warns, hasErrors: bad, hasWarnings: warns.length > 0, fp: meta && meta.fingerprint ? meta.fingerprint.hex.slice(0, 12) + '…' : meta ? 'computing…' : '', fpAlgo: meta && meta.fingerprint ? meta.fingerprint.algo : '', delim: meta && meta.delimiter ? (meta.delimiter === '\t' ? 'tab' : meta.delimiter) : '',
      pick: A.pickFile(which), remove: A.removeFile(which), drop: A.dropFile(which), over: A.dragOver, hasNot: !meta, replaceLabel: meta ? 'Replace' : 'Choose CSV', demo: meta && meta.demo, hint: meta && meta.warn || '' };
  };
  const steps = STEPS.map((x, i) => { const n = i + 1; return { n, label: x[0], sub: x[1], cls: 'step' + (D.step === n ? ' on' : '') + (stepDone(D, n) ? ' done' : ''), done: stepDone(D, n), go: A.setStep(n) }; });
  const headers = D.realMeta && D.realMeta.headers || [];
  const hints = D.hints || { cat: [], ids: [] };
  const st = D.settings, info = D.info, gv = D.gov;
  const chipsFor = (field, opts) => opts.map(o => { const on = (gv[field] || []).indexOf(o) >= 0; return { label: o, on, cls: 'chip' + (on ? ' on' : '') + (N.indexOf(o) >= 0 ? ' chip-unk' : ''), toggle: A.toggleChip(field, o) }; });
  const O = SDA.kb.options;
  const fwChips = SDA.kb.frameworks.map(f => { const on = (gv.frameworks || []).indexOf(f.id) >= 0; return { label: f.name, sub: f.instrument, on, cls: 'chip' + (on ? ' on' : ''), toggle: A.toggleChip('frameworks', f.id) }; });
  const sugg = SDA.kb.suggest(gv).filter(id => (gv.frameworks || []).indexOf(id) < 0).map(id => SDA.kb.frameworks.find(f => f.id === id).name);
  const v = D.validation;
  const messages = [];
  if (v) { v.blockers.forEach(t => messages.push({ tone: 'red', icon: 'x', kind: 'Blocked', text: t })); }
  const missing = [];
  if (!info.name.trim()) missing.push('Dataset name is empty, so a default name will be used.');
  if (!info.target.trim() && st.doUtility) missing.push('No target column: predictive utility will be skipped (no score is invented).');
  if (!(gv.frameworks || []).length) missing.push('No frameworks selected: governance mappings will not be produced.');
  if ((gv.regions || []).length === 0) missing.push('No region given: legal applicability will stay “Undetermined”.');
  if (st.protocol === 'random' && st.doPrivacy) missing.push('Membership protocol is a random proxy: a low attack score cannot support a “Low observed concern” category.');
  const files = !!(D.realMeta && D.realMeta.status !== 'error' && !(D.realMeta.check && D.realMeta.check.errors.length) && D.synthMeta && D.synthMeta.status !== 'error' && !(D.synthMeta.check && D.synthMeta.check.errors.length));
  const modOn = st.doFidelity || st.doUtility || st.doPrivacy;
  const attackList = SDA.attackCatalogue.map(a => ({ id: a.id, name: a.name, desc: a.description, implemented: a.implemented, checked: a.id === 'mia' ? st.attackMia : a.id === 'exact' ? st.attackExact : false, name2: a.id === 'mia' ? 'settings.attackMia' : a.id === 'exact' ? 'settings.attackExact' : 'x', status: a.implemented ? bd('Available', 'green', 'check') : bd('Not available', 'grey', 'dash') }));
  const primaryOpts = (info.task === 'regression' ? [['rmse', 'RMSE (lower is better)'], ['mae', 'MAE (lower is better)'], ['r2', 'R² (higher is better)']] : [['accuracy', 'Accuracy'], ['f1', 'F1 (macro)'], ['precision', 'Precision (macro)'], ['recall', 'Recall (macro)'], ['rocAuc', 'ROC-AUC']]).map(o => ({ id: o[0], label: o[1] }));
  // profile
  const prof = v ? { has: true, status: bd(v.status), canRun: v.canRun, checks: v.checks.map(c => ({ label: c.label, bd: bd(c.status), summary: c.summary })), mismatch: v.realOnly.length > 0 || v.synthOnly.length > 0, memberCol: (v.realOnly.find(c => /member/i.test(c)) || ''), hasMemberHint: v.realOnly.some(c => /member/i.test(c)), useMember: A.useMembership((v.realOnly.find(c => /member/i.test(c)) || '')), realOnly: v.realOnly.join(', ') || 'none', synthOnly: v.synthOnly.join(', ') || 'none', onPrepared: D.use.real === 'cleaned' || D.use.synth === 'cleaned', rows: nf(v.rows.real) + ' real · ' + nf(v.rows.synth) + ' synthetic rows', cols: v.plan.evalCols.length + ' columns evaluated · ' + v.plan.excluded.length + ' excluded' } : { has: false };
  // data version: raw upload or the cleaned working copy from Data Cleaning
  const ver = k => { const m = k === 'real' ? D.realMeta : D.synthMeta; const n = S.cl.steps[k].length; const pr = S.cl.prof[k]; const cur = pr && pr.cur; const useC = D.use[k] === 'cleaned' && n > 0;
    return { k, title: k === 'real' ? 'Real / reference dataset' : 'Synthetic dataset', name: m ? m.name : 'Not uploaded', hasFile: !!m, hasClean: n > 0, rawOn: !useC, cleanOn: useC, rawCls: 'vopt' + (useC ? '' : ' on'), cleanCls: 'vopt' + (useC ? ' on' : '') + (n ? '' : ' off'), rawText: m ? nf(m.rows) + ' rows × ' + m.cols + ' columns' : '', cleanText: n && cur ? n + ' step' + (n === 1 ? '' : 's') + ' · ' + nf(cur.rows) + ' rows × ' + cur.cols + ' columns' : 'No cleaning steps yet', pickRaw: A.useVersion(k, 'raw'), pickClean: A.useVersion(k, 'cleaned'), open: A.openClean(k), using: useC ? 'Cleaned copy' : 'Raw upload', useBd: useC ? bd('Cleaned copy', 'blue', 'wand') : bd('Raw upload', 'grey', 'file') }; };
  const versions = [ver('real'), ver('synth')]; const anyClean = versions.some(x => x.useBd.label === 'Cleaned copy');
  const prep = { versions, anyClean, note: anyClean ? 'Results will describe the cleaned version shown here. Cleaning can change fidelity, utility and privacy results; the report records the version and every step.' : 'Results will describe the raw uploads. Open Data Cleaning to prepare a cleaned copy first.' };
  // tests
  const sg = D.suggestion; const tgtSet = !!info.target.trim();
  const tsk = D.taskHint; const sugBox = { has: !!sg && sg.col !== info.target, text: sg ? sg.col + ' · ' + sg.task + ' · ' + sg.detail : '', why: sg ? 'Suggested from the ' + sg.reason + '. Confirm it fits your use before running.' : '', use: A.useSuggestion, none: !sg && !tgtSet && headers.length > 0, task: tsk ? 'Suggested task: ' + tsk.task + ' (' + tsk.why + '). Change it if that is wrong.' : '', hasTask: !!tsk && tgtSet };
  const busyRun = S.busy === 'run';
  return {
    steps, step: D.step, s1: D.step === 1, s2: D.step === 2, s3: D.step === 3, s4: D.step === 4, s5: D.step === 5, stepTitle: STEPS[D.step - 1][0], stepN: D.step,
    slots: [slot('real', 'Real / reference dataset', D.realMeta), slot('synth', 'Synthetic dataset', D.synthMeta)], demoOn: !!D.demo,
    loadClean: A.loadDemoClean, loadLeaky: A.loadDemoLeaky,
    draft: D, headers, hasHeaders: headers.length > 0, hintCat: hints.cat.map(c => ({ name: c, add: A.addToList('info.categorical', c) })), hintIds: hints.ids.map(c => ({ name: c, add: A.addToList('info.idCols', c) })), hasHintCat: hints.cat.length > 0, hasHintIds: hints.ids.length > 0,
    prof, profLabel: v ? 'Profile again' : 'Profile now', missingCount: missing.length, missingLabel: 'Missing information (' + missing.length + ')', profile: A.validate, profiling: S.busy === 'validate', canProfile: files && !S.busy, prep, sug: sugBox, tgtSet, skipUtility: A.skipUtility,
    modes: [{ id: 'quick', label: 'Quick', desc: 'Capped samples, 600 attack queries. Seconds.', on: st.mode === 'quick', cls: 'mode' + (st.mode === 'quick' ? ' on' : ''), pick: A.setMode('quick') }, { id: 'full', label: 'Full', desc: 'Larger samples, 2,500 attack queries. Slower, tighter estimates.', on: st.mode === 'full', cls: 'mode' + (st.mode === 'full' ? ' on' : ''), pick: A.setMode('full') }],
    attackList, primaryOpts, isReg: info.task === 'regression', st, info, hasTarget: tgtSet, protoColumn: st.protocol === 'column', protoOrdered: st.protocol === 'ordered',
    chips: { regions: chipsFor('regions', O.regions), subjectRegions: chipsFor('subjectRegions', O.regions), categories: chipsFor('dataCategories', O.categories), purposes: chipsFor('purposes', O.purposes), recipients: chipsFor('recipients', O.recipients), safeguards: chipsFor('safeguards', O.safeguards), frameworks: fwChips },
    industries: O.industries, orgTypes: O.orgTypes, gov: gv, suggested: sugg, hasSuggested: sugg.length > 0, suggestedText: sugg.join(', '), addSuggested: A.addSuggested,
    editing: !!D.editingAuditId, saveContext: A.saveContext, cancelEdit: A.cancelEdit,
    next: A.next, back: A.back, canBack: D.step > 1, canNext: D.step < 5, nextLabel: D.step < 5 ? 'Continue to ' + STEPS[D.step][0].toLowerCase() : '',
    runBtn: { label: busyRun ? 'Running…' : 'Run audit', disabled: !files || !!S.busy || !modOn || (D.validated && !v.canRun), run: A.run },
    cancelBtn: { show: busyRun, run: A.cancelRun },
    runHint: !files ? 'Add two readable CSV files to start.' : D.validated && !v.canRun ? 'Profiling found blocking issues. Fix them in the files or the Profile step, then profile again.' : !modOn ? 'Switch on at least one engine in Tests.' : !D.validated ? 'The pair will be profiled first; engines run only if profiling permits.' : 'Ready. ' + (anyClean ? 'Engines run on the cleaned copy; the uploads are unchanged.' : 'Engines run on the raw uploads.'),
    progress: { show: busyRun || S.busy === 'validate', pct: S.progress.pct, label: S.progress.label, style: 'width:' + S.progress.pct + '%' },
    validated: D.validated, vStatus: v ? bd(v.status) : null, messages, hasMessages: messages.length > 0, missing, hasMissing: missing.length > 0, openValidation: A.openDraftValidation,
    govNote: 'Used to suggest frameworks and screen applicability. It does not determine legal compliance. “Unknown” and “Not provided” are valid answers and are reported as gaps, never as failures.'
  };
}
function stepDone(D, n) { if (n === 1) return !!(D.realMeta && D.synthMeta); if (n === 2) return !!D.validated; if (n === 3) return !!D.validated && D.step > 3; if (n === 4) return !!D.validated && (!!D.info.target || !D.settings.doUtility); if (n === 5) return (D.gov.frameworks || []).length > 0 || (D.gov.regions || []).length > 0; return false; }

/* ───────── Validation ───────── */
function vaVM(S, A, cur) {
  const useDraft = !!(S.ui.vaDraft && S.draft.validation);
  const v = useDraft ? S.draft.validation : (cur ? cur.results.validation : (S.draft.validation || null));
  if (!v) return { has: false };
  const draftOnly = useDraft || !cur;
  const cards = v.checks.map(c => ({ id: c.id, label: c.label, bd: bd(c.status), summary: c.summary, icon: { file: 'file', schema: 'columns', types: 'type', missing: 'drop', dups: 'copy', values: 'sliders', target: 'target' }[c.id] || 'shield' }));
  const rows = v.schema.filter(r => S.ui.vaFilter !== 'issues' || r.status !== 'Pass').map(r => ({ name: r.name, realType: r.realType, synthType: r.synthType, missReal: r.missReal === null ? '—' : r.missReal + '%', missSynth: r.missSynth === null ? '—' : r.missSynth + '%', compat: r.catCompat, bd: bd(r.status), notes: r.notes.join(' '), hasNotes: r.notes.length > 0, excluded: r.excluded }));
  const mx = Math.max(5, Math.max.apply(null, v.missingChart.map(m => Math.max(m.real, m.synth)).concat([0])));
  const mk = key => v.missingChart.map(m => ({ name: m.name, w: m[key] / mx * 100, text: m[key] + '%', tip: m.name + ': ' + m[key] + '% missing' }));
  const dup = (lab, d) => ({ label: lab, count: nf(d.count), rate: fmtPct(d.rate, 2) });
  return { has: true, draftOnly, backToAudit: A.go('validation'), srcBd: draftOnly ? bd('Draft', 'violet', 'edit') : kindOf(cur), cards, blockers: v.blockers, hasBlockers: v.blockers.length > 0, warnings: v.warnings, hasWarnings: v.warnings.length > 0, status: bd(v.status), canRun: v.canRun,
    overall: v.canRun ? (v.status === 'Warning' ? 'Evaluation may proceed — warnings are listed below.' : 'All checks passed.') : 'Downstream evaluation is blocked. Nothing was removed or changed in your files.',
    rows, filterAll: S.ui.vaFilter !== 'issues', rowCount: rows.length, total: v.schema.length, missReal: mk('real'), missSynth: mk('synth'), missMax: mx, dups: [dup('Real', v.duplicates.real), dup('Synthetic', v.duplicates.synth)],
    realOnly: v.realOnly, synthOnly: v.synthOnly, hasRealOnly: v.realOnly.length > 0, hasSynthOnly: v.synthOnly.length > 0, helper: v.helperCols || [], hasHelper: (v.helperCols || []).length > 0, helperName: (v.helperCols || [])[0] || '', orderMismatch: !v.orderMatch,
    prep: prepVM(useDraft || !cur ? draftPrep(S) : cur),
    details: v.checks.map(c => ({ label: c.label, bd: bd(c.status), explain: VAL_EXPLAIN[c.id], lines: c.details })), rowsText: nf(v.rows.real) + ' real rows · ' + nf(v.rows.synth) + ' synthetic rows', dlSchema: A.dlTable('validation_schema.csv'), dlPlot: A.dlPlot('validation_missing_values.svg'), canDl: !draftOnly };
}

function prepVM(a) {
  const P = a && a.prep; if (!P) return { recorded: false, applied: false, log: [], computedOn: 'Not recorded for this audit.', versions: [] };
  const log = (P.log || []).map(l => ({ step: l.step, file: l.file, label: l.label, cols: l.columns.join(', ') || 'all columns', change: l.rowsRemoved ? nf(l.rowsBefore) + ' → ' + nf(l.rowsAfter) + ' rows' : l.colsBefore !== undefined && l.colsBefore !== l.colsAfter ? l.colsBefore + ' → ' + l.colsAfter + ' columns' : nf(l.cellsChanged) + ' cells changed', why: l.rationale }));
  const raw = P.rawValidation; const dv = a.provenance && a.provenance.dataVersions;
  const versions = dv ? [{ label: 'Real', text: dv.real }, { label: 'Synthetic', text: dv.synth }] : [];
  return { recorded: true, applied: log.length > 0, log, versions, hasVersions: versions.length > 0, computedOn: log.length ? 'These results describe the cleaned data. The uploaded files were never modified.' : 'No cleaning was applied: these results describe the raw uploads.', hasRaw: !!raw, raw: raw ? raw.checks.map(c => ({ label: c.label, bd: bd(c.status), summary: c.summary })) : [] };
}
function draftPrep(S) {
  const log = []; [['real', 'Real'], ['synth', 'Synthetic']].forEach(([k, lab]) => { if (S.draft.use[k] === 'cleaned') (S.cl.log[k] || []).forEach(l => log.push(Object.assign({}, l, { file: lab }))); });
  return { prep: { log, versions: S.draft.use, rawValidation: log.length ? S.draft.rawValidation : null }, provenance: { dataVersions: { real: S.draft.use.real === 'cleaned' && S.cl.steps.real.length ? 'cleaned copy (' + S.cl.steps.real.length + ' steps)' : 'raw upload', synth: S.draft.use.synth === 'cleaned' && S.cl.steps.synth.length ? 'cleaned copy (' + S.cl.steps.synth.length + ' steps)' : 'raw upload' } } };
}

/* ───────── Data Cleaning workspace ───────── */
const CL_OPS = [['missing', 'Missing values'], ['dedupe', 'Duplicates'], ['convert', 'Convert type'], ['labels', 'Labels'], ['range', 'Range rule'], ['trim', 'Trim spaces'], ['emptyrows', 'Blank rows'], ['dropcols', 'Remove columns']];
function clVM(S, A) {
  const D = S.draft, C = S.cl;
  const okMeta = m => !!m && m.status !== 'error' && !(m.check && m.check.errors.length);
  const avail = { real: okMeta(D.realMeta), synth: okMeta(D.synthMeta) };
  if (!avail.real && !avail.synth) return { has: false, pickReal: A.pickFile('real'), pickSynth: A.pickFile('synth'), demo: A.loadDemoHere, busy: S.busy === 'upload', realName: D.realMeta ? D.realMeta.name : '', realErr: D.realMeta && !avail.real ? (D.realMeta.error || (D.realMeta.check && D.realMeta.check.errors[0]) || '') : '', hasRealErr: !!(D.realMeta && !avail.real) };
  const k = avail[C.which] ? C.which : (avail.real ? 'real' : 'synth'); const meta = k === 'real' ? D.realMeta : D.synthMeta;
  const tabs = [['real', 'Original (real)'], ['synth', 'Synthetic']].map(([id, lab]) => { const m = id === 'real' ? D.realMeta : D.synthMeta; const n = C.steps[id].length; return { id, label: lab, file: m ? m.name : 'not uploaded', cls: 'dsw' + (k === id ? ' on' : ''), disabled: !avail[id], go: A.clWhich(id), steps: n ? n + ' step' + (n === 1 ? '' : 's') : 'unchanged' }; });
  const P = C.prof[k] || { raw: null, cur: null }; const raw = P.raw, cur = P.cur || raw;
  const steps = C.steps[k]; const n = steps.length; const log = C.log[k] || [];
  if (!raw) return { has: true, ready: false, tabs, k };
  const stat = (label, a, b, lowerBetter) => ({ label, before: nf(a), after: nf(b), changed: a !== b, cls: 'cs' + (a !== b ? (lowerBetter && b < a ? ' good' : ' chg') : ''), delta: a === b ? '' : (b > a ? '+' : '−') + nf(Math.abs(b - a)) });
  const stats = [stat('Rows', raw.rows, cur.rows), stat('Columns', raw.cols, cur.cols), stat('Missing cells', raw.missingCells, cur.missingCells, true), stat('Duplicate rows', raw.dupRows, cur.dupRows, true)];
  const issues = cur.issues.map(i => ({ kind: i.kind, text: i.text, count: nf(i.count), fix: A.clFix(i.id) }));
  const F = C.form; const op = F.op; const cols = cur.columns;
  const chips = (filter) => cols.filter(filter || (() => true)).map(c => { const on = (F.cols || []).indexOf(c.name) >= 0; return { name: c.name, sub: c.type + (c.missing ? ' · ' + nf(c.missing) + ' missing' : ''), on, cls: 'chip' + (on ? ' on' : ''), toggle: A.clCol(c.name) }; });
  const colOpts = filter => [{ id: '', label: 'Choose a column' }].concat(cols.filter(filter || (() => true)).map(c => ({ id: c.name, label: c.name + ' (' + c.type + ')' })));
  const pv = C.preview; const e = pv && pv.entry;
  const pvx = pv ? { ok: !!pv.ok && !e.noop, err: !pv.ok, noop: !!pv.ok && e.noop, error: pv.error || '', material: !!(pv.ok && e.material), why: e ? e.materialWhy : '',
    effect: e ? [nf(e.rowsBefore) + ' → ' + nf(e.rowsAfter) + ' rows' + (e.rowsRemoved ? ' (−' + nf(e.rowsRemoved) + ')' : ''), e.colsBefore !== e.colsAfter ? e.colsBefore + ' → ' + e.colsAfter + ' columns' : '', e.cellsChanged ? nf(e.cellsChanged) + ' value' + (e.cellsChanged === 1 ? '' : 's') + ' changed' : '', e.columns.length ? 'in ' + e.columns.slice(0, 4).join(', ') + (e.columns.length > 4 ? ' +' + (e.columns.length - 4) : '') : ''].filter(Boolean).join(' · ') : '',
    examples: e ? e.examples.map(t => ({ t })) : [], hasEx: !!(e && e.examples.length), label: e ? e.label : '' } : null;
  const form = { op, has: !!op, f: F, ops: CL_OPS.map(([id, l]) => ({ id, label: l, cls: 'opb' + (op === id ? ' on' : ''), pick: A.clOp(id) })),
    isMissing: op === 'missing', isConvert: op === 'convert', isLabels: op === 'labels', isRange: op === 'range', isDrop: op === 'dropcols', isSimple: op === 'dedupe' || op === 'trim' || op === 'emptyrows',
    simpleText: { dedupe: 'Removes rows that repeat an earlier row exactly, keeping the first. Duplicates can be legitimate, so check the count first.', trim: 'Removes leading and trailing spaces from every value. Text inside a value is untouched.', emptyrows: 'Removes rows where every value is missing.' }[op] || '',
    chips: op === 'missing' ? chips(c => c.missing > 0) : op === 'dropcols' ? chips() : [], hasChips: op === 'missing' ? cols.some(c => c.missing > 0) : op === 'dropcols',
    isConst: F.method === 'constant', isDate: F.to === 'date', colOpts: op === 'range' ? colOpts(c => c.type === 'numerical') : op === 'labels' ? colOpts(c => c.type === 'categorical' || c.type === 'boolean') : colOpts(),
    preview: A.clPreview, apply: A.clApply, canPreview: !S.busy, canApply: !!pvx && pvx.ok && !S.busy, confirm: C.confirm, doConfirm: A.clConfirm, cancelConfirm: A.clCancelConfirm, pv: pvx, hasPv: !!pvx, close: A.clOp('') };
  const T = C.table[k]; const view = C.view === 'before' ? 'before' : 'after';
  const table = T ? { heads: (view === 'before' ? T.hb : T.ha).map(h => ({ h })), rows: view === 'before' ? T.before : T.after, note: view === 'before' ? 'Uploaded original · first ' + T.before.length + ' of ' + nf(raw.rows) + ' rows' + (T.hb.length < raw.cols ? ' · ' + T.hb.length + ' of ' + raw.cols + ' columns' : '') + (n ? ' · struck-through rows are removed in the working copy' : '') : (n ? 'Working copy' : 'Working copy (no steps yet, identical to the upload)') + ' · first ' + T.after.length + ' of ' + nf(cur.rows) + ' rows' + (T.ha.length < cur.cols ? ' · ' + T.ha.length + ' of ' + cur.cols + ' columns' : '') + (n ? ' · changed values are highlighted' : ''), tabs: [['after', 'After'], ['before', 'Before']].map(([id, l]) => ({ label: l, cls: 'tab' + (view === id ? ' on' : ''), go: A.clView(id) })) } : null;
  const steplog = log.map(l => ({ step: l.step, label: l.label, effect: l.rowsRemoved ? '−' + nf(l.rowsRemoved) + ' rows' : l.colsBefore !== l.colsAfter ? '−' + (l.colsBefore - l.colsAfter) + ' column' + (l.colsBefore - l.colsAfter === 1 ? '' : 's') : nf(l.cellsChanged) + ' value' + (l.cellsChanged === 1 ? '' : 's'), at: when(l.at), material: !!l.material }));
  const cp = C.compat[k]; const otherLab = k === 'real' ? 'synthetic' : 'real';
  const checks = [{ label: 'Rows and columns', bd: cur.rows > 0 ? bd('Pass') : bd('Failed'), text: nf(cur.rows) + ' rows × ' + cur.cols + ' columns' }, { label: 'Column names', bd: bd('Pass'), text: 'Unique and non-empty' },
    { label: 'Missing values', bd: cur.missingCells ? bd('Warning', 'amber', 'alert') : bd('Pass'), text: cur.missingCells ? nf(cur.missingCells) + ' missing cells remain' : 'None' }, { label: 'Duplicate rows', bd: cur.dupRows ? bd('Warning', 'amber', 'alert') : bd('Pass'), text: cur.dupRows ? nf(cur.dupRows) + ' remain' : 'None' }];
  if (cp) checks.push({ label: 'Schema vs ' + otherLab + ' file', bd: cp.ok ? bd('Pass') : bd('Warning', 'amber', 'alert'), text: cp.ok ? 'Same columns and compatible types (' + cp.vs + ')' : [cp.onlyHere.length ? 'only here: ' + cp.onlyHere.join(', ') : '', cp.onlyOther.length ? 'only in the ' + otherLab + ' file: ' + cp.onlyOther.join(', ') : '', cp.mism.length ? 'type differs: ' + cp.mism.join(', ') : ''].filter(Boolean).join(' · ') + ' (' + cp.vs + ')' });
  const usingClean = D.use[k] === 'cleaned' && n > 0;
  return { has: true, ready: true, k, isReal: k === 'real', tabs, fileName: meta ? meta.name : '', outName: SDA.clean.fileName(meta ? meta.name : 'dataset.csv'), stats, issues, hasIssues: issues.length > 0, issueCount: issues.length, form, table, log: steplog, hasLog: n > 0, n,
    version: n ? bd('Working copy · ' + n + ' step' + (n === 1 ? '' : 's'), 'blue', 'wand') : bd('Uploaded original', 'grey', 'file'),
    undo: A.clUndo, reset: A.clReset, dl: A.dlCleaned(k), dlLog: A.dlCleanLog(k), canDl: n > 0 && !S.busy, dlLabel: k === 'real' ? 'Download cleaned dataset' : 'Download cleaned synthetic dataset',
    use: A.useCleaned, canUse: (C.steps.real.length > 0 || C.steps.synth.length > 0) && !S.busy, usingClean, usingText: 'Audit uses: real — ' + (D.use.real === 'cleaned' && C.steps.real.length ? 'cleaned copy' : 'raw upload') + ' · synthetic — ' + (D.use.synth === 'cleaned' && C.steps.synth.length ? 'cleaned copy' : 'raw upload'),
    checks, busy: S.busy === 'clean' };
}

/* ───────── Fidelity ───────── */
function heatGrid(cols, M, kind) {
  const n = cols.length; const cells = [{ cls: 'hc corner', text: '', bg: 'transparent', fg: 'inherit', tip: '' }];
  cols.forEach(c => cells.push({ cls: 'hc lab col', text: c, bg: 'transparent', fg: 'inherit', tip: c }));
  cols.forEach((rc, i) => { cells.push({ cls: 'hc lab row', text: rc, bg: 'transparent', fg: 'inherit', tip: rc }); cols.forEach((cc, j) => { const v = M[i][j]; cells.push({ cls: 'hc', text: n <= 9 && v !== null ? v.toFixed(2) : '', bg: SDA.heatColor(v, kind), fg: v !== null && (kind === 'diff' ? v > 0.3 : Math.abs(v) > 0.6) ? '#fff' : '#14213D', tip: rc + ' × ' + cc + ': ' + (v === null ? 'N/A' : v.toFixed(3)) }); }); });
  return { tpl: 'grid-template-columns: minmax(64px, auto) repeat(' + n + ', minmax(16px, 1fr))', cells };
}
function fiVM(S, A, cur) {
  const F = cur && cur.results.fidelity; if (!F || F.status !== 'Completed') return { has: false, reason: !cur ? 'none' : F ? (F.status === 'Failed' ? 'failed' : 'notrun') : 'notrun', failed: F && F.status === 'Failed', error: F && F.error, why: F && F.reason };
  const band = s => bd(s === null ? 'Unavailable' : s >= 0.9 ? 'Close' : s >= 0.8 ? 'Moderate gap' : 'Large gap', s === null ? 'grey' : s >= 0.9 ? 'green' : s >= 0.8 ? 'amber' : 'red', s === null ? 'dash' : s >= 0.9 ? 'check' : 'alert');
  const kpi = (key, label, v, extra, lowerBetter) => { const h = metricHelp(key); return { label, value: fmt(v), bd: lowerBetter ? (v === null ? band(null) : bd(v <= 0.05 ? 'Close' : v <= 0.1 ? 'Moderate gap' : 'Large gap', v <= 0.05 ? 'green' : v <= 0.1 ? 'amber' : 'red', v <= 0.05 ? 'check' : 'alert')) : band(v), extra, def: h.def, dir: h.dir, lim: h.lim }; };
  const kpis = [kpi('shapes', 'Column Shapes', F.columnShapes, F.perColumn.length + ' columns'), kpi('trends', 'Column Pair Trends', F.pairTrends, F.pairTrendsNote || F.pairs.length + ' pairs'), kpi('overall', 'Overall Quality Score', F.overall, 'mean of the two'), kpi('corr', 'Avg. correlation difference', F.avgCorrDiff, F.corr.pairsCompared + ' numerical pairs', true)];
  const cols = F.perColumn.map(p => p.name); const sel = cols.indexOf(S.ui.fidCol) >= 0 ? S.ui.fidCol : cols[0];
  const d = F.dists[sel]; const sm = F.summary.find(s => s.name === sel); const pc = F.perColumn.find(p => p.name === sel);
  let hist = null, cats = null, selStats = [];
  if (d.kind === 'numeric') {
    const mx = Math.max.apply(null, d.real.concat(d.synth).concat([1e-9]));
    hist = { bins: d.real.map((r, i) => ({ rh: r / mx * 100, sh: d.synth[i] / mx * 100, tip: (+d.edges[i].toPrecision(4)) + ' – ' + (+d.edges[i + 1].toPrecision(4)) + ' · real ' + (r * 100).toFixed(1) + '% · synthetic ' + (d.synth[i] * 100).toFixed(1) + '%' })), xmin: +d.edges[0].toPrecision(4), xmid: +((d.edges[0] + d.edges[d.edges.length - 1]) / 2).toPrecision(4), xmax: +d.edges[d.edges.length - 1].toPrecision(4), ymax: (mx * 100).toFixed(1) + '%', n: nf(d.nReal) + ' real · ' + nf(d.nSynth) + ' synthetic non-missing values' };
    const R = sm.real, Sy = sm.synth, row = (lab, k) => ({ stat: lab, real: R ? fmt(R[k], 4) : '—', synth: Sy ? fmt(Sy[k], 4) : '—', diff: R && Sy ? fmt(Sy[k] - R[k], 4) : '—' });
    selStats = [row('Count', 'n'), row('Mean', 'mean'), row('Std. deviation', 'std'), row('Minimum', 'min'), row('25th percentile', 'q25'), row('Median', 'median'), row('75th percentile', 'q75'), row('Maximum', 'max')];
    selStats[0] = { stat: 'Count (non-missing)', real: nf(R && R.n), synth: nf(Sy && Sy.n), diff: '—' };
  } else {
    const mx = Math.max.apply(null, d.cats.map(c => Math.max(c.real, c.synth)).concat([1e-9]));
    cats = { rows: d.cats.map(c => ({ label: c.label, rw: c.real / mx * 100, sw: c.synth / mx * 100, rt: (c.real * 100).toFixed(1) + '%', st: (c.synth * 100).toFixed(1) + '%', diff: (c.diff * 100).toFixed(1) + ' pp' })), n: d.nCats + ' distinct values' + (d.nCats > 12 ? ' (top 12 shown, rest grouped as Other)' : '') };
    selStats = [{ stat: 'Distinct values', real: nf(sm.real.unique), synth: nf(sm.synth.unique), diff: '—' }, { stat: 'Most frequent', real: String(sm.real.mode), synth: String(sm.synth.mode), diff: sm.real.mode === sm.synth.mode ? 'same' : 'differs' }, { stat: 'Largest category gap', real: '—', synth: '—', diff: fmt(pc.maxCatDiff * 100, 1) + ' pp' }];
  }
  const sumRows = F.summary.filter(s => s.kind === 'numeric' && s.real && s.synth).map(s => ({ name: s.name, mean: fmt(s.real.mean, 3) + ' / ' + fmt(s.synth.mean, 3), sd: fmt(s.real.std, 3) + ' / ' + fmt(s.synth.std, 3), med: fmt(s.real.median, 3) + ' / ' + fmt(s.synth.median, 3), rng: fmt(s.real.min, 2) + '–' + fmt(s.real.max, 2) + ' / ' + fmt(s.synth.min, 2) + '–' + fmt(s.synth.max, 2), q: fmt(s.real.q25, 2) + ', ' + fmt(s.real.q75, 2) + ' / ' + fmt(s.synth.q25, 2) + ', ' + fmt(s.synth.q75, 2), pick: A.pickCol(s.name) }));
  const sk = S.ui.fidSort, sd = S.ui.fidDir === 'asc' ? 1 : -1;
  const keyOf = { name: p => p.name, kind: p => p.kind, score: p => p.score === null ? 2 : p.score, std: p => Math.abs(p.stdDiff || 0), miss: p => Math.abs(p.missReal - p.missSynth) };
  const feat = F.perColumn.slice().sort((a, b) => { const x = keyOf[sk](a), y = keyOf[sk](b); return (x < y ? -1 : x > y ? 1 : 0) * sd; }).map(p => ({ name: p.name, kind: p.kind === 'numeric' ? 'Numerical' : 'Categorical', metric: p.metric, score: fmt(p.score), w: p.score === null ? 0 : p.score * 100, band: band(p.score), disc: p.kind === 'numeric' ? (p.stdDiff === null ? '—' : 'mean Δ ' + (p.stdDiff >= 0 ? '+' : '') + p.stdDiff.toFixed(2) + ' σ') : 'max category gap ' + fmt(p.maxCatDiff * 100, 1) + ' pp', miss: p.missReal + '% / ' + p.missSynth + '%', pick: A.pickCol(p.name) }));
  const heads = [['name', 'Column'], ['kind', 'Type'], ['score', 'Score'], ['std', 'Discrepancy'], ['miss', 'Missing real / synth']].map(h => ({ key: h[0], label: h[1], on: sk === h[0], arrow: sk === h[0] ? (S.ui.fidDir === 'asc' ? '↑' : '↓') : '', click: A.sortFid(h[0]) }));
  const ranked = F.perColumn.filter(p => p.score !== null).slice().sort((a, b) => b.score - a.score); const mkR = arr => arr.map(p => ({ name: p.name, w: p.score * 100, text: fmt(p.score), kind: p.kind === 'numeric' ? 'KS' : 'TV' }));
  const topDiffs = F.corr.topDiffs.map((t, i) => ({ rank: i + 1, pair: t.a + ' × ' + t.b, real: fmt(t.real, 3), synth: fmt(t.synth, 3), diff: fmt(t.diff, 3), w: clamp(t.diff / Math.max(F.corr.topDiffs[0].diff, 1e-9) * 100, 0, 100) }));
  const v = cur.results.validation; const h = cur.results.fidelity.health;
  return { has: true, kpis, cols, sel, selType: d.kind === 'numeric' ? 'Numerical column — overlaid histogram (20 equal-width bins)' : 'Categorical column — grouped share per category', isNum: d.kind === 'numeric', isCat: d.kind === 'categorical', hist, cats, selStats, selScore: fmt(pc.score), selBand: band(pc.score), selMetric: pc.metric, sumRows, hasSum: sumRows.length > 0, feat, heads, sortKey: sk, sortDir: S.ui.fidDir, toggleDir: A.toggleFidDir, most: mkR(ranked.slice(0, 5)), least: mkR(ranked.slice().reverse().slice(0, 5)),
    tab: S.ui.fidTab, tabs: [['dist', 'Distributions'], ['corr', 'Correlation'], ['feat', 'Feature-level'], ['health', 'Data health']].map(t => ({ id: t[0], label: t[1], cls: 'tab' + (S.ui.fidTab === t[0] ? ' on' : ''), go: A.setUi('fidTab', t[0]) })), tDist: S.ui.fidTab === 'dist', tCorr: S.ui.fidTab === 'corr', tFeat: S.ui.fidTab === 'feat', tHealth: S.ui.fidTab === 'health',
    heat: { real: heatGrid(F.corr.cols, F.corr.real, 'corr'), synth: heatGrid(F.corr.cols, F.corr.synth, 'corr'), diff: heatGrid(F.corr.cols, F.corr.diff, 'diff') }, hasCorr: F.corr.cols.length > 1, corrNote: F.corrNote, truncated: F.corr.truncated, heatCols: F.corr.cols.length, totalNum: F.corr.totalColumns, avgCorr: fmt(F.avgCorrDiff), pairsCompared: F.corr.pairsCompared, topDiffs, hasTopDiffs: topDiffs.length > 0,
    health: { missR: fmtPct(h.missingRealPct, 2), missS: fmtPct(h.missingSynthPct, 2), dupR: v ? nf(v.duplicates.real.count) + ' (' + fmtPct(v.duplicates.real.rate, 2) + ')' : '—', dupS: v ? nf(v.duplicates.synth.count) + ' (' + fmtPct(v.duplicates.synth.rate, 2) + ')' : '—', cellsR: v ? nf(v.health.realMissingCells) + ' of ' + nf(v.health.realCells) : '—', cellsS: v ? nf(v.health.synthMissingCells) + ' of ' + nf(v.health.synthCells) : '—' },
    sampleText: F.settings.sampled ? 'Computed on ' + nf(F.settings.sampledReal) + ' real and ' + nf(F.settings.sampledSynth) + ' synthetic rows sampled with seed ' + F.settings.seed + ' (of ' + nf(F.settings.rowsReal) + ' / ' + nf(F.settings.rowsSynth) + ').' : 'Computed on all ' + nf(F.settings.rowsReal) + ' real and ' + nf(F.settings.rowsSynth) + ' synthetic rows.', metricNote: F.settings.metricNote,
    dl: { cols: A.dlTable('fidelity_columns.csv'), pairs: A.dlTable('fidelity_pairs.csv'), corr: A.dlTable('fidelity_correlation_top_differences.csv'), summary: A.dlTable('fidelity_numeric_summary.csv'), dist: A.dlPlot('fidelity_dist_' + sel.replace(/[^\w]+/g, '_') + '.svg'), scores: A.dlPlot('fidelity_column_scores.svg'), real: A.dlPlot('fidelity_corr_real.svg'), synth: A.dlPlot('fidelity_corr_synthetic.svg'), diff: A.dlPlot('fidelity_corr_difference.svg') }, kind: kindOf(cur) };
}

/* ───────── Utility ───────── */
function utVM(S, A, cur) {
  const U = cur && cur.results.utility; if (!U || U.status !== 'Completed') return { has: false, failed: U && U.status === 'Failed', error: U && U.error, why: U && U.reason, none: !cur };
  const reg = U.task === 'regression'; const MM = SDA.metricMeta;
  const prim = U.metricKeys.indexOf(S.ui.utMetric) >= 0 ? S.ui.utMetric : U.primary;
  const retTone = r => r === null ? 'grey' : r >= 90 ? 'green' : r >= 75 ? 'amber' : 'red';
  const rows = U.metricKeys.map(k => {
    const t = U.trtr[k], s = U.tstr[k], r = U.retention[k]; const mx = reg && k !== 'r2' ? Math.max(t, s) * 1.15 : 1; const wf = v => v === null || v === undefined ? 0 : (k === 'r2' ? clamp(v, 0, 1) : clamp(v / mx, 0, 1)) * 100;
    return { key: k, label: MM[k].label, dir: bd(MM[k].dir === 'higher' ? 'Higher is better' : 'Lower is better', 'grey', MM[k].dir === 'higher' ? 'up' : 'down'), trtr: fmt(t, 4), tstr: fmt(s, 4), tw: wf(t), sw: wf(s), ret: r.value === null ? 'N/A' : fmtPct(r.value), retBd: bd(r.value === null ? 'Unavailable' : r.value >= 90 ? 'Close' : r.value >= 75 ? 'Moderate gap' : 'Large gap', retTone(r.value), r.value === null ? 'dash' : r.value >= 90 ? 'check' : 'alert'), retW: r.value === null ? 0 : clamp(r.value / 120 * 100, 0, 100), formula: r.formula, note: r.note, primary: k === prim, scaleNote: reg && k === 'r2' ? 'R² can be negative; bars show 0 or more only.' : '' };
  });
  const head = rows.find(r => r.key === prim);
  const cm = (m, labels) => { const n = labels.length; const rowMax = m.map(r => r.reduce((a, b) => a + b, 0) || 1); const cells = [{ cls: 'cmc lab corner', text: 'actual ↓ / predicted →', bg: 'transparent', fg: 'inherit', tip: '' }]; labels.forEach(l => cells.push({ cls: 'cmc lab col', text: l, bg: 'transparent', fg: 'inherit', tip: 'Predicted ' + l })); m.forEach((r, i) => { cells.push({ cls: 'cmc lab row', text: labels[i], bg: 'transparent', fg: 'inherit', tip: 'Actual ' + labels[i] }); r.forEach((v, j) => { const p = v / rowMax[i]; cells.push({ cls: 'cmc', text: String(v), bg: 'rgba(38,50,79,' + (0.08 + 0.8 * p).toFixed(2) + ')', fg: p > 0.55 ? '#fff' : '#14213D', tip: 'Actual ' + labels[i] + ', predicted ' + labels[j] + ': ' + v + ' (' + (p * 100).toFixed(1) + '% of actual ' + labels[i] + ')' }); }); }); return { tpl: 'grid-template-columns: minmax(70px, auto) repeat(' + n + ', minmax(44px, 1fr))', cells }; };
  const out = { has: true, reg, isClass: !reg, kind: kindOf(cur), rows, prim, primLabel: MM[prim].label, primOpts: U.metricKeys.map(k => ({ id: k, label: MM[k].label })), headTrtr: head.trtr, headTstr: head.tstr, headRet: head.ret, headBd: head.retBd, headDir: head.dir.label,
    cfg: [['Model', U.model], ['Target column', U.target], ['Task type', U.task], ['Training / test split', U.split.realTrain + ' real train · ' + U.split.realTest + ' real test (' + Math.round(U.split.testFraction * 100) + '%' + (U.split.stratified ? ', stratified' : '') + ') · ' + U.split.synthTrain + ' synthetic train'], ['Random seed', String(U.seed)], ['Preprocessing', U.preprocessing], ['Features', U.featureCount + ' columns → ' + U.encodedFeatures + ' encoded inputs'], ['Rows without a target', U.rowsMissingTarget.real + ' real / ' + U.rowsMissingTarget.synth + ' synthetic (left out of supervised steps only)'], ['Split strategy', U.splitStrategy || 'Not recorded'], ['Retention formula', U.retentionFormula || 'TSTR ÷ TRTR × 100 (higher is better) or TRTR ÷ TSTR × 100 (lower is better)']].map(r => ({ k: r[0], v: r[1] })),
    diag: (U.warnings || []).map(w => ({ text: w.text, tone: w.level === 'warn' ? 'amber' : 'blue', icon: w.level === 'warn' ? 'alert' : 'info' })), hasDiag: (U.warnings || []).length > 0,
    tabs: [['metrics', 'TRTR vs TSTR'], [reg ? 'pred' : 'cm', reg ? 'Predictions' : 'Confusion matrices']].concat(reg ? [] : [['class', 'Per-class']]).map(t => ({ id: t[0], label: t[1], cls: 'tab' + (S.ui.utTab === t[0] ? ' on' : ''), go: A.setUi('utTab', t[0]) })), tMetrics: S.ui.utTab === 'metrics' || (reg && S.ui.utTab === 'cm') || (!reg && S.ui.utTab === 'pred'), tCm: !reg && S.ui.utTab === 'cm', tClass: !reg && S.ui.utTab === 'class', tPred: reg && S.ui.utTab === 'pred',
    sampled: U.sampled, dl: { metrics: A.dlTable('utility_metrics.csv'), perClass: A.dlTable('utility_per_class.csv'), plot: A.dlPlot('utility_trtr_vs_tstr.svg') }, setPrim: A.setUiEvent('utMetric') };
  if (!reg) {
    out.majority = fmt(U.majorityBaseline); out.testCounts = U.testClassCounts.map(c => c.label + ': ' + c.n).join(' · '); out.cmR = cm(U.confusion.trtr, U.labels); out.cmS = cm(U.confusion.tstr, U.labels); out.manyClasses = U.labels.length > 12;
    out.perClass = U.labels.map((l, i) => ({ label: l, support: U.perClass.trtr[i].support, rp: fmt(U.perClass.trtr[i].precision), rr: fmt(U.perClass.trtr[i].recall), rf: fmt(U.perClass.trtr[i].f1), sp: fmt(U.perClass.tstr[i].precision), sr: fmt(U.perClass.tstr[i].recall), sf: fmt(U.perClass.tstr[i].f1) }));
  } else {
    const pts = U.scatter; let lo = Infinity, hi = -Infinity; pts.forEach(p => { for (let i = 0; i < 3; i++) { if (p[i] < lo) lo = p[i]; if (p[i] > hi) hi = p[i]; } }); const sp = (hi - lo) || 1; const X = v => ((v - lo) / sp * 280 + 10).toFixed(1), Y = v => (290 - (v - lo) / sp * 280).toFixed(1);
    out.scR = pts.map(p => ({ x: X(p[0]), y: Y(p[1]) })); out.scS = pts.map(p => ({ x: X(p[0]), y: Y(p[2]) })); out.axLo = fmt(lo, 1); out.axHi = fmt(hi, 1); out.testStd = fmt(U.testStd, 2);
  }
  return out;
}

/* ───────── Privacy ───────── */
function prVM(S, A, cur) {
  const P = cur && cur.results.privacy; if (!P || !P.attacks || !P.attacks.length) return { has: false, none: !cur, why: P && P.reason };
  const E = cur.results.ensemble;
  const cards = P.attacks.concat(P.pending.map(p => Object.assign({}, p, { pend: true }))).map(a => {
    const c = { cls: a.status === 'Not applicable' ? 'card card-pend' : 'card', id: a.id, name: a.name, desc: a.description, bd: bd(a.status === 'Completed' ? 'Completed' : a.status), status: a.status, isMia: a.id === 'mia' && a.status === 'Completed', isExact: a.id === 'exact' && a.status === 'Completed', done: a.status === 'Completed', failed: a.status === 'Failed', notRun: a.status === 'Not Run', pending: a.status === 'Pending', msg: a.error || a.reason || (a.status === 'Not applicable' ? 'Not available in this version. No result is shown for it.' : ''), hasMsg: !!(a.error || a.reason || a.status === 'Pending') };
    if (a.status === 'Completed') {
      c.setup = a.setup; c.seed = String(a.seed); c.validity = a.validity === 'labelled' ? bd('Labelled membership', 'green', 'check') : a.validity === 'attested' ? bd('Attested membership', 'green', 'check') : a.validity === 'proxy' ? bd('Proxy membership', 'amber', 'alert') : bd('Direct comparison', 'green', 'check');
      c.params = Object.keys(a.params).map(k => ({ k: ({ scoring: 'Distance / scoring method', members: 'Members scored', nonMembers: 'Non-members scored', syntheticRecords: 'Synthetic records searched', memberFraction: 'Member fraction', columns: 'Columns used', ciMethod: 'AUC interval', mode: 'Mode', comparison: 'Comparison', syntheticRows: 'Synthetic rows tested', baselineRows: 'Baseline real rows', referenceRows: 'Reference real rows', matching: 'Matching rule' })[k] || k, v: Array.isArray(a.params[k]) ? a.params[k].join(', ') : String(a.params[k]) }));
      c.caveats = a.caveats || []; c.warnings = a.warnings || [];
      const T = a.threatModel; c.hasThreat = !!T; c.threat = T ? [['Attacker access', T.access], ['Member / non-member construction', T.construction], ['Distance / matching', T.distance], ['Preprocessing', T.preprocessing], ['Leakage control', T.separation], ['Sample sizes', T.samples], ['Attack seed', String(T.seed)]].map(x => ({ k: x[0], v: x[1] })) : [];
      if (a.id === 'mia') {
        const m = a.metrics; c.metrics = [{ k: 'ROC-AUC', v: fmt(m.auc), sub: m.aucCI ? '95% CI ' + fmt(m.aucCI[0]) + '–' + fmt(m.aucCI[1]) : '' }, { k: 'TPR @ 10% FPR', v: fmt(m.tpr10), sub: 'chance level = 0.100' }, { k: 'Median distance — members', v: fmt(m.medianDcrMembers, 4), sub: m.zeroDistanceMembers + ' exact (distance 0)' }, { k: 'Median distance — non-members', v: fmt(m.medianDcrNonMembers, 4), sub: m.zeroDistanceNonMembers + ' exact (distance 0)' }];
        c.rocPts = a.roc.map(p => (p[0] * 100).toFixed(2) + ',' + (100 - p[1] * 100).toFixed(2)).join(' '); const mx = Math.max.apply(null, a.hist.members.concat(a.hist.nonMembers).concat([1e-9]));
        c.hist = a.hist.members.map((v, i) => ({ mh: v / mx * 100, nh: a.hist.nonMembers[i] / mx * 100, tip: 'distance ' + (a.hist.max * i / 20).toFixed(3) + '–' + (a.hist.max * (i + 1) / 20).toFixed(3) + ' · members ' + (v * 100).toFixed(1) + '% · non-members ' + (a.hist.nonMembers[i] * 100).toFixed(1) + '%' })); c.histMax = a.hist.max.toFixed(3);
        c.interp = 'AUC ' + fmt(m.auc) + ' ' + (m.auc < 0.55 ? 'is close to the 0.5 of random guessing for this attack and setup' : m.auc < 0.65 ? 'shows a modest ability to tell members from non-members' : 'shows that members sit systematically closer to the synthetic data than non-members') + '. At 10% false positives the attack finds ' + fmtPct(m.tpr10 * 100, 0) + ' of members (chance: 10%).';
        c.dlRoc = A.dlPlot('privacy_mia_roc.svg'); c.dlHist = A.dlPlot('privacy_mia_distance_hist.svg');
      } else if (a.id === 'exact') {
        const m = a.metrics; c.metrics = [{ k: 'Synthetic rows copying a real row', v: fmtPct(m.synthMatchRate, 2), sub: m.synthMatches + ' of ' + a.params.syntheticRows }, { k: 'Natural baseline (real vs real)', v: fmtPct(m.baselineMatchRate, 2), sub: m.baselineMatches + ' of ' + a.params.baselineRows }, { k: 'Excess over baseline', v: (m.excessPp >= 0 ? '+' : '') + fmt(m.excessPp, 2) + ' pp', sub: 'the signal used by the ensemble' }];
        c.interp = m.excessPp < 1 ? 'The synthetic data copies real rows no more often than real rows collide with each other. No verbatim copying is indicated.' : 'The synthetic data reproduces real rows more often than natural collisions would explain. Inspect the matching rows securely.';
      }
    }
    return c;
  });
  const done = P.attacks.filter(a => a.status === 'Completed');
  const table = P.attacks.concat(P.pending.map(p => Object.assign({}, p))).map(a => ({ name: a.short, bd: bd(a.status), auc: a.metrics && a.metrics.auc !== undefined ? fmt(a.metrics.auc) : '—', tpr: a.metrics && a.metrics.tpr10 !== undefined ? fmt(a.metrics.tpr10) : '—', excess: a.metrics && a.metrics.excessPp !== undefined ? fmt(a.metrics.excessPp, 2) + ' pp' : '—', sample: a.sampleSizes ? (a.sampleSizes.members !== undefined ? a.sampleSizes.members + ' / ' + a.sampleSizes.nonMembers : a.sampleSizes.synthetic + ' / ' + a.sampleSizes.baseline) : '—', seed: a.seed === undefined ? '—' : String(a.seed), note: a.error || a.reason || (a.status === 'Not applicable' ? 'Not available in this version' : a.setup ? a.setup.slice(0, 90) + (a.setup.length > 90 ? '…' : '') : '') }));
  const comps = (E.components || []).map(c => ({ label: c.label, w: c.score * 100, text: fmt(c.value, c.fmt) + c.unit, level: bd(c.level), cls: c.levelIdx === 2 ? 'lv-high' : c.levelIdx === 1 ? 'lv-mod' : 'lv-low' }));
  return { has: true, kind: kindOf(cur), cards, table, comps, hasComps: comps.length > 0, doneCount: done.length, total: P.attacks.length + P.pending.length, summary: done.length + ' of ' + (P.attacks.length + P.pending.length) + ' attack types tested · ' + P.attacks.filter(a => a.status === 'Failed').length + ' failed · ' + P.attacks.filter(a => a.status === 'Not Run').length + ' not run · ' + P.pending.length + ' pending', dl: A.dlTable('privacy_attacks.csv'), dlComp: A.dlPlot('ensemble_signals.svg') };
}

/* ───────── Ensemble ───────── */
function enVM(S, A, cur) {
  const E = cur && cur.results.ensemble; if (!E || !E.category) return { has: false, none: !cur };
  const R = SDA.ensembleRules; const C = E.coverage;
  const segs = [['Completed', C.completed, 'seg-ok'], ['Failed', C.failed, 'seg-bad'], ['Not run', C.notRun, 'seg-nr'], ['Not available', C.pending, 'seg-pend']].map(s => ({ label: s[0], count: s[1], w: s[1] / (C.completed + C.failed + C.notRun + C.pending) * 100, cls: 'seg ' + s[2], show: s[1] > 0 }));
  const comps = E.components.map(c => ({ label: c.label, raw: fmt(c.value, c.fmt) + c.unit, ci: c.ci ? '95% CI ' + fmt(c.ci[0]) + '–' + fmt(c.ci[1]) : '', lvl: bd(c.level), score: fmt(c.score, 2), w: c.score * 100, cls: c.levelIdx === 2 ? 'lv-high' : c.levelIdx === 1 ? 'lv-mod' : 'lv-low', validity: c.validity === 'proxy' ? 'Proxy membership' : c.validity === 'labelled' ? 'Labelled membership' : c.validity === 'attested' ? 'Attested membership' : 'Direct comparison', thr: c.thresholds, mod: R.signals.find(s => s.id === c.id).moderate, high: R.signals.find(s => s.id === c.id).high, chance: R.signals.find(s => s.id === c.id).chance, strong: R.signals.find(s => s.id === c.id).strong }));
  const drivers = E.components.filter(c => c.levelIdx === Math.max.apply(null, E.components.map(x => x.levelIdx))).map(c => c.label);
  return { has: true, kind: kindOf(cur), category: E.category, label: E.label, tone: E.tone, insufficient: E.insufficient, icon: E.tone === 'red' ? 'x' : E.tone === 'amber' ? 'alert' : E.tone === 'green' ? 'check' : 'dash', rationale: E.rationale, conflicts: E.conflicts, hasConflicts: E.conflicts.length > 0, uncertainty: E.uncertainty, followUps: E.followUps, comps, hasComps: comps.length > 0, drivers: drivers.join(', '), hasDrivers: !!drivers.length && !E.insufficient && (E.category === 'High' || E.category === 'Moderate'),
    coverage: { segs, completed: C.completed, failed: C.failed, notRun: C.notRun, pending: C.pending, planned: C.planned, text: C.completed + ' of ' + C.planned + ' attack types tested' }, rulesVersion: R.version,
    thresholds: R.signals.map(s => ({ label: s.label, chance: s.chance + s.unit, moderate: '≥ ' + s.moderate + s.unit, high: '≥ ' + s.high + s.unit, strong: s.strong + s.unit })), principles: R.principles, minCompleted: R.minCompleted,
    scale: [{ lab: 'Low observed concern', tone: 'green', text: 'Every completed signal is below its Moderate threshold, ≥ 2 tests completed, and the membership setup is labelled or attested.' }, { lab: 'Moderate observed concern', tone: 'amber', text: 'At least one signal reached Moderate; none reached High.' }, { lab: 'High observed concern', tone: 'red', text: 'At least one signal reached its High threshold.' }, { lab: 'Inconclusive', tone: 'grey', text: 'Too few completed tests, a failed membership attack, or only proxy membership evidence for a “Low” statement. Shown as “Insufficient Evidence for a Reliable Risk Category”.' }], dl: A.dlTable('ensemble_components.csv'), dlPlot: A.dlPlot('ensemble_signals.svg'),
    fid: cur.results.fidelity && cur.results.fidelity.status === 'Completed' ? fmt(cur.results.fidelity.overall) : null };
}

/* ───────── Governance ───────── */
function gvVM(S, A, cur, gov) {
  const KB = SDA.kb; const fw = KB.frameworks.map(f => KB.frameworkView(f, S.kbState));
  const tabs = [['frameworks', 'A · Frameworks', fw.length], ['kb', 'B · Knowledge base', KB.rules.length], ['applic', 'C · Applicability', gov ? gov.applicability.length : 0], ['map', 'D · Mappings', gov ? gov.mappings.length : 0], ['recs', 'E · Recommendations', gov ? gov.recs.length : 0], ['gaps', 'F · Evidence gaps', gov ? gov.gaps.length : 0], ['review', 'G · Human review', gov ? gov.mappings.length : 0]].map(t => ({ id: t[0], label: t[1], count: t[2], cls: 'tab' + (S.ui.gvTab === t[0] ? ' on' : ''), go: A.setUi('gvTab', t[0]) }));
  const vm = { tabs, tFw: S.ui.gvTab === 'frameworks', tKb: S.ui.gvTab === 'kb', tAp: S.ui.gvTab === 'applic', tMap: S.ui.gvTab === 'map', tRec: S.ui.gvTab === 'recs', tGap: S.ui.gvTab === 'gaps', tRev: S.ui.gvTab === 'review', hasAudit: !!cur, kbVersion: KB.version, disclaimer: SDA.disclaimer, editCtx: A.editContext, kind: cur ? kindOf(cur) : null };
  // A
  const typeFilter = S.ui.fwType;
  vm.fwFilters = [['all', 'All'], ['Binding law', 'Binding laws'], ['Voluntary framework', 'Voluntary frameworks'], ['Technical standard', 'Technical standards']].map(t => ({ label: t[1], cls: 'chip' + (typeFilter === t[0] ? ' on' : ''), go: A.setUi('fwType', t[0]) }));
  vm.fwCards = fw.filter(f => typeFilter === 'all' || f.instrument === typeFilter).map(f => ({ name: f.name, long: f.long, jurisdiction: f.jurisdiction, inst: bd(f.instrument), status: bd(f.status), version: f.version, effective: f.effective, freshness: f.freshness, stale: !f.lastChecked, url: f.url, url2: f.url2, hasUrl2: !!f.url2, body: f.body, rules: f.ruleCount, reviewed: f.reviewedCount, hasRules: f.ruleCount > 0, note: f.note, hasNote: !!f.note }));
  vm.fwLegend = [['Catalogue Only', 'Listed with an official source; no reviewed rules are active.'], ['Draft Rules', 'Rule records exist but are unverified; they produce review prompts only.'], ['Verified Subset', 'Specific provisions were project-reviewed; coverage is limited to those entries.'], ['Needs Update', 'Source or version may have changed, or a review date has expired.'], ['Not Supported', 'Not supported in this version.']].map(x => ({ bd: bd(x[0]), text: x[1] }));
  vm.fwCounts = { binding: fw.filter(f => f.instrument === 'Binding law').length, vol: fw.filter(f => f.instrument === 'Voluntary framework').length, std: fw.filter(f => f.instrument === 'Technical standard').length, withRules: fw.filter(f => f.ruleCount).length };
  // B
  const fwSel = S.ui.kbFw; vm.kbFilters = [{ label: 'All frameworks', cls: 'chip' + (fwSel === 'all' ? ' on' : ''), go: A.setUi('kbFw', 'all') }].concat(fw.filter(f => f.ruleCount).map(f => ({ label: f.name, cls: 'chip' + (fwSel === f.id ? ' on' : ''), go: A.setUi('kbFw', f.id) })));
  vm.rules = KB.rules.filter(r => fwSel === 'all' || r.fw === fwSel).map(r => { const rv = KB.ruleView(r, S.kbState); const form = Object.assign({ reviewer: '', note: '' }, (S.kbForm || {})[r.id]); return { id: r.id, framework: rv.frameworkName, inst: bd(rv.instrument), provision: rv.provision, title: rv.title, summary: rv.summary, url: rv.url, urlNote: rv.urlNote, version: rv.version, effective: rv.effectiveStatus + (rv.effectiveVerified ? '' : ' (not independently verified)'), conditions: rv.conditions, sourceType: rv.sourceType, reviewDate: rv.reviewDate || 'Not yet reviewed', ver: bd(rv.verification), reviewed: rv.verification === 'Project-reviewed', stale: !!rv.stale, reviewer: rv.reviewer || '—', note: rv.reviewNote || '', form, onReviewer: A.kbField(r.id, 'reviewer'), onNote: A.kbField(r.id, 'note'), mark: A.kbMark(r.id), reset: A.kbReset(r.id), canMark: (form.reviewer || '').trim().length > 1 }; });
  vm.kbStats = { total: KB.rules.length, reviewed: vm.rules.filter(r => r.reviewed).length, shown: vm.rules.length };
  vm.kbTotals = KB.rules.filter(r => KB.ruleView(r, S.kbState).verification === 'Project-reviewed').length;
  vm.kbSplit = [['Compliance Knowledge Base', 'The controlled library the auditor may use: framework entries, provision identifiers, plain-English summaries, official source links, versions, applicability conditions and review status. It does not decide anything by itself.'], ['Compliance Mapper', 'The reasoning layer: it checks your context, evaluates versioned mapping rules over measured evidence, records why a rule matched, lists missing evidence and proposes actions. It never invents provisions.'], ['Risk Interpretation Engine', 'Technical: turns attack metrics into an empirical risk category under documented thresholds. Not a legal verdict.'], ['Human review', 'A reviewer can accept, reject, defer or comment on every mapping; the original machine-generated finding is never overwritten.']].map(x => ({ t: x[0], d: x[1] }));
  if (!gov) return vm;
  // C
  const ctx = cur.context || {}; const dash = a => Array.isArray(a) && a.length ? a.join(', ') : '';
  const ans = (label, val) => ({ label, value: val || 'Not provided', provided: !!val && !/^(Unknown|Not provided)$/i.test(val) });
  vm.answers = [ans('Organisation / processing regions', dash(ctx.regions)), ans('Data-subject regions', dash(ctx.subjectRegions)), ans('Industry', ctx.industry), ans('Organisation type', ctx.orgType), ans('Data categories', dash(ctx.dataCategories)), ans('Intended purpose', [dash(ctx.purposes), ctx.purposeText].filter(Boolean).join(' — ')), ans('Data source & processing context', ctx.sourceText), ans('Recipients / access', [dash(ctx.recipients), ctx.recipientsText].filter(Boolean).join(' — ')), ans('Existing safeguards', dash(ctx.safeguards)), ans('Documentation', ctx.docsText)].map(a => Object.assign(a, { cls: a.provided ? '' : 'notprov' }));
  vm.applic = gov.applicability.map(a => ({ name: a.name, inst: bd(a.instrument), status: bd(a.status), reasons: a.reasons, missing: a.missing, hasMissing: a.missing.length > 0 }));
  vm.hasApplic = vm.applic.length > 0; vm.suggested = gov.suggested.map(id => KB.frameworks.find(f => f.id === id).name).join(', '); vm.hasSuggested = gov.suggested.length > 0;
  // D with filters
  const mf = S.ui.mapFw, ms = S.ui.mapSuf, mr = S.ui.mapRev;
  const mapped = gov.mappings.filter(m => (mf === 'all' || m.frameworkId === mf) && (ms === 'all' || m.sufficiency === ms) && (mr === 'all' || m.reviewStatus === mr));
  vm.maps = mapped.map(m => ({ id: m.id, finding: m.finding, evidence: m.evidence, kind: m.evidenceKind, framework: m.framework, inst: bd(m.instrument), provision: m.provision, ptitle: m.provisionTitle, why: m.why, suf: bd(m.sufficiency === 'Partial' ? 'Partial' : m.sufficiency, m.sufficiency === 'Sufficient' ? 'green' : m.sufficiency === 'Partial' ? 'amber' : 'red', m.sufficiency === 'Sufficient' ? 'check' : m.sufficiency === 'Partial' ? 'alert' : 'x'), action: m.action, url: m.url, rule: bd(m.ruleVerification), caveat: m.caveat, hasCaveat: !!m.caveat, review: bd(m.reviewStatus, TONE[m.reviewStatus] || 'grey', m.reviewStatus === 'Pending' ? 'clock' : undefined), applic: m.applicability }));
  vm.mapFwOpts = [{ id: 'all', label: 'All frameworks' }].concat(Array.from(new Set(gov.mappings.map(m => m.frameworkId))).map(id => ({ id, label: KB.frameworks.find(f => f.id === id).name })));
  vm.mapCount = mapped.length; vm.mapTotal = gov.mappings.length; vm.hasMaps = gov.mappings.length > 0; vm.noMapsMatch = gov.mappings.length > 0 && mapped.length === 0;
  vm.withheld = gov.withheld; vm.hasWithheld = gov.withheld.length > 0; vm.dlMaps = A.dlTable('governance_mappings.csv');
  // E
  vm.recs = gov.recs.map(r => ({ id: r.id, title: r.title, kind: r.kind, kindBd: bd(r.kind === 'Detected' ? 'Detected' : 'Not provided', r.kind === 'Detected' ? 'red' : 'amber', r.kind === 'Detected' ? 'alert' : 'help'), detected: r.detected, why: r.why.split('\n'), review: r.review, controls: r.controls, urls: r.urls.map((u, i) => ({ u, n: i + 1 })), human: r.human, draft: r.draft, priority: bd(r.priority + ' priority', r.priority === 'High' ? 'red' : r.priority === 'Medium' ? 'amber' : 'grey', 'flag') }));
  vm.hasRecs = vm.recs.length > 0;
  // F
  const kinds = ['Failed check', 'Contradictory evidence', 'Test not run', 'Incomplete tests', 'Not provided', 'Stale / unverified rule', 'Unsupported mapping'];
  vm.gaps = gov.gaps.slice().sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind)).map(x => ({ kind: bd(x.kind, x.genuine ? 'red' : x.kind === 'Contradictory evidence' ? 'amber' : 'grey', x.genuine ? 'x' : x.kind === 'Not provided' ? 'help' : x.kind === 'Contradictory evidence' ? 'alert' : 'dash'), text: x.text, genuine: x.genuine, note: x.genuine ? 'Genuine failure' : 'Not a failure — information or evidence missing' }));
  vm.gapStats = { genuine: gov.gaps.filter(x => x.genuine).length, notprov: gov.gaps.filter(x => !x.genuine).length };
  // G
  vm.revCounts = ['Pending', 'Accepted', 'Rejected', 'Needs More Information', 'Completed'].map(k => ({ label: k, n: gov.reviewCounts[k] || 0, bd: bd(k, TONE[k] || 'grey', k === 'Pending' ? 'clock' : undefined) }));
  vm.reviews = gov.mappings.map(m => { const f = Object.assign({ status: m.reviewStatus, reviewer: '', comment: '' }, (S.rvForm || {})[m.id]); return { id: m.id, title: m.framework + ' ' + m.provision + ' — ' + m.finding, status: bd(m.reviewStatus, TONE[m.reviewStatus] || 'grey', m.reviewStatus === 'Pending' ? 'clock' : undefined), form: f, onStatus: A.rvField(m.id, 'status'), onReviewer: A.rvField(m.id, 'reviewer'), onComment: A.rvField(m.id, 'comment'), save: A.rvSave(m.id), canSave: (f.reviewer || '').trim().length > 1 && (f.comment || '').trim().length > 0, history: (m.history || []).slice().reverse().map(h => ({ at: when(h.at), by: h.by, from: h.from, to: h.to, comment: h.comment })), hasHistory: (m.history || []).length > 0 }; });
  vm.hasReviews = vm.reviews.length > 0;
  return vm;
}

/* ───────── Compare ───────── */
function cmVM(S, A) {
  const f = S.cmp; const rows = [];
  SDA.baseline.rows.forEach(r => rows.push({ key: 'h:' + r.name, name: r.name, src: 'hist', kindBd: histBd, domain: r.domain, task: 'Not recorded', generator: 'Not recorded', status: 'Historical', statusBd: bd('Historical', 'hist', 'archive'), overall: r.overall, shapes: r.shapes, trends: r.trends, corr: r.corrDiff, ret: r.retention, mia: r.mia, cov: null, ens: null, gov: null, date: '', canOpen: false, open: null, flag: r.flag || '' }));
  S.audits.forEach(a => { const R = a.results, P = R.privacy; const G = SDA.kb.buildGovernance(a, S.kbState); const mia = P && P.attacks && P.attacks.find(x => x.id === 'mia' && x.status === 'Completed'); rows.push({ key: a.id, name: a.name, src: a.source === 'demo' ? 'demo' : 'cur', kindBd: kindOf(a), domain: a.info.domain || 'Not provided', task: a.info.target ? a.info.task : 'No target', generator: a.info.generator || 'Not provided', status: a.status, statusBd: bd(a.status), overall: R.fidelity && R.fidelity.status === 'Completed' ? R.fidelity.overall : null, shapes: R.fidelity && R.fidelity.status === 'Completed' ? R.fidelity.columnShapes : null, trends: R.fidelity && R.fidelity.status === 'Completed' ? R.fidelity.pairTrends : null, corr: R.fidelity && R.fidelity.status === 'Completed' ? R.fidelity.avgCorrDiff : null, ret: R.utility && R.utility.status === 'Completed' ? R.utility.headline.retention : null, retMetric: R.utility && R.utility.status === 'Completed' ? SDA.metricMeta[R.utility.primary].label + ' (' + R.utility.task + ')' : '', mia: mia ? mia.metrics.auc : null, cov: P && P.attacks ? (R.ensemble.coverage ? R.ensemble.coverage.completed : 0) : null, ens: R.ensemble && R.ensemble.category ? R.ensemble.category : null, gov: G.mappings.length, date: a.createdAt, canOpen: true, open: A.open(a.id), flag: '' }); });
  const uniq = k => Array.from(new Set(rows.map(r => r[k]))).filter(Boolean).sort();
  const opt = (name, k, all) => ({ name, key: k, opts: [{ id: '', label: all }].concat(uniq(k).map(v => ({ id: v, label: v }))) });
  const q = (f.q || '').toLowerCase();
  let vis = rows.filter(r => (!q || r.name.toLowerCase().indexOf(q) >= 0) && (!f.domain || r.domain === f.domain) && (!f.task || r.task === f.task) && (!f.generator || r.generator === f.generator) && (!f.status || r.status === f.status) && (!f.source || r.src === f.source));
  const sortKey = { name: r => r.name.toLowerCase(), fid: r => r.overall === null ? -1 : -r.overall, ret: r => r.ret === null ? 1e9 : -r.ret, mia: r => r.mia === null ? 1e9 : -r.mia, date: r => r.date ? -Date.parse(r.date) : 0 }[f.sort] || (r => r.name);
  vis = vis.slice().sort((a, b) => { const x = sortKey(a), y = sortKey(b); return x < y ? -1 : x > y ? 1 : 0; });
  const cls = r => r.src === 'hist' ? 'hist' : r.src === 'demo' ? 'demo' : 'cur';
  const chart = (title, sub, getter, lo, hi, textFn, na) => ({ title, sub, rows: vis.map(r => { const v = getter(r); const b = bar(r.name, r.src === 'hist' ? 'Historical baseline' : r.src === 'demo' ? 'Demo audit' : 'Current audit', v, lo, hi, v === null || v === undefined ? '' : textFn(v), cls(r)); if (b.na) { b.text = na || 'N/A'; } return b; }) });
  const maxGov = Math.max(1, Math.max.apply(null, vis.map(r => r.gov || 0)));
  const charts = [chart('Fidelity — Overall Quality', 'Scale 0–1 · same definition for every row', r => r.overall, 0, 1, fmt), chart('Utility retention', 'Scale 0–120% · only compare like with like (task, model, metric differ between rows)', r => r.ret, 0, 120, fmtPct), chart('Membership-inference ROC-AUC', 'Axis starts at 0.40 · dashed line = 0.5 (random guessing)', r => r.mia, 0.4, 1, fmt, 'N/A'), chart('Privacy-test coverage', 'Attack types tested (of 6) · baseline runs did not record coverage', r => r.cov === null ? null : r.cov, 0, 6, v => v + ' of 6', 'Not recorded'), chart('Governance mappings', 'Review prompts per audit · baseline runs have none recorded', r => r.gov === null ? null : r.gov, 0, maxGov, v => String(v), 'Not recorded')];
  const trs = vis.map(r => ({ key: r.key, name: r.name, kindBd: r.kindBd, domain: r.domain, task: r.task, generator: r.generator, statusBd: r.statusBd, overall: r.overall === null ? 'N/A' : fmt(r.overall), shapes: r.shapes === null ? 'N/A' : fmt(r.shapes), trends: r.trends === null ? 'N/A' : fmt(r.trends), corr: r.corr === null ? 'N/A' : fmt(r.corr), ret: r.ret === null ? 'N/A' : fmtPct(r.ret), retMetric: r.retMetric || (r.src === 'hist' ? 'metric not recorded' : ''), mia: r.mia === null ? 'N/A' : fmt(r.mia), cov: r.cov === null ? 'Not recorded' : r.cov + ' of 6', ens: r.ens ? bd(r.ens === 'Inconclusive' ? 'Inconclusive' : r.ens, r.ens === 'High' ? 'red' : r.ens === 'Moderate' ? 'amber' : r.ens === 'Low' ? 'green' : 'grey') : null, hasEns: !!r.ens, gov: r.gov === null ? 'Not recorded' : String(r.gov), canOpen: r.canOpen, open: r.open, flag: r.flag, hasFlag: !!r.flag, date: r.date ? when(r.date) : '—',
    nOverall: r.overall === null, nShapes: r.shapes === null, nTrends: r.trends === null, nCorr: r.corr === null, nRet: r.ret === null, nMia: r.mia === null }));
  return { filters: { q: f.q, domain: opt('Domain', 'domain', 'All domains'), task: opt('Task', 'task', 'All tasks'), generator: opt('Generator', 'generator', 'All generators'), status: opt('Audit status', 'status', 'All statuses'), source: { opts: [{ id: '', label: 'All sources' }, { id: 'hist', label: 'Historical baseline' }, { id: 'cur', label: 'Current audits' }, { id: 'demo', label: 'Demo audits' }] }, sort: f.sort, valDomain: f.domain, valTask: f.task, valGen: f.generator, valStatus: f.status, valSource: f.source }, clear: A.clearCmp, charts, rows: trs, count: trs.length, total: rows.length, hasRows: trs.length > 0, histNote: SDA.baseline.note, hasCurrent: S.audits.length > 0 };
}

/* ───────── Reports ───────── */
function rpVM(S, A, cur, gov) {
  if (!cur) return { has: false };
  const model = SDA.exp.reportModel(cur, gov); const sts = model.statuses.map(s => ({ title: s.title, bd: bd(s.status === 'Ready' ? 'Completed' : s.status === 'Not run' ? 'Not Run' : s.status, s.status === 'Ready' ? 'green' : s.status === 'Partial' ? 'amber' : s.status === 'Blocked' || s.status === 'Failed' ? 'red' : 'grey', s.status === 'Ready' ? 'check' : s.status === 'Partial' ? 'alert' : s.status === 'Blocked' || s.status === 'Failed' ? 'x' : 'dash'), label: s.status, note: s.note }));
  const T = SDA.exp.tables(cur, gov); const P = SDA.exp.plots(cur); const log = (S.exportLog[cur.id] || []).slice().reverse().slice(0, 8).map(l => ({ kind: l.kind, at: when(l.at), file: l.file }));
  const ready = sts.filter(s => s.label === 'Ready').length;
  return { has: true, kind: kindOf(cur), audit: { id: cur.id, name: cur.name, created: when(cur.createdAt), status: bd(cur.status), files: nf(cur.files.real.rows) + ' real · ' + nf(cur.files.synth.rows) + ' synthetic rows', modules: model.statuses.length }, sts, ready, total: sts.length, partial: model.partial, partialNote: 'Some sections did not run or did not complete. They are marked in the exported report and no values are invented for them.', busy: !!S.busy, busyLabel: S.progress.label,
    pdf: A.exportPdf, json: A.exportJson, zip: A.exportZip, html: A.exportHtml, csvList: Object.keys(T).map(k => ({ file: k, rows: T[k].split('\n').length - 2, dl: A.dlTable(k) })), plotCount: Object.keys(P).length, csvCount: Object.keys(T).length, log, hasLog: log.length > 0,
    del: { ask: S.confirmDel === cur.id, start: A.askDelete, cancel: A.cancelDelete, confirm: A.deleteAudit }, disclaimer: SDA.disclaimer,
    reg: regVM(S, A, cur, gov) };
}

function regVM(S, A, cur, gov) {
  const recs = SDA.registry.forAudit(cur, gov); const eng = S.ui.regEngine || 'all';
  const engines = ['all'].concat(Array.from(new Set(recs.map(r => r.engine_name))));
  const rows = recs.filter(r => eng === 'all' || r.engine_name === eng).map(r => ({ engine: r.engine_name, metric: r.metric_name, value: r.metric_value === null ? 'null' : typeof r.metric_value === 'number' ? (Math.abs(r.metric_value) >= 100 || Number.isInteger(r.metric_value) ? String(Math.round(r.metric_value * 100) / 100) : r.metric_value.toFixed(4)) : String(r.metric_value), isNull: r.metric_value === null, vcls: r.metric_value === null ? 'na-cell' : '', unit: r.metric_unit, bd: bd(r.status, r.status === 'Completed' ? 'green' : r.status === 'Failed' || r.status === 'Blocked' ? 'red' : r.status === 'Partial' ? 'amber' : 'grey'), sampled: !!r.sample_based, ver: r.engine_version, note: (r.sample_based ? 'Sample-based. ' : '') + (r.evidence_summary || (r.limitations[0] || '')) }));
  return { rows, count: recs.length, shown: rows.length, engines: engines.map(e => ({ id: e, label: e === 'all' ? 'All engines' : e })), eng, csv: A.dlRegistry('csv'), json: A.dlRegistry('json'), legacy: !cur.provenance };
}
SDA.view = { build, fmt, fmtPct, nf, when, bytes };
})(typeof window !== 'undefined' ? window : globalThis);
