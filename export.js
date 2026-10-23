/* Synthetic Data Auditor — report model, CSV / JSON / SVG plots / ZIP / PDF / HTML writers. Everything is generated from the stored audit results. */
(function (g) {
'use strict';
const SDA = g.SDA = g.SDA || {};
const f3 = (v, d) => typeof v === 'number' && isFinite(v) ? v.toFixed(d === undefined ? 3 : d) : 'N/A';
const pc = (v, d) => typeof v === 'number' && isFinite(v) ? v.toFixed(d === undefined ? 1 : d) + '%' : 'N/A';
SDA.fmt = { f3, pc };
const DISCLAIMER = 'Governance support only. This report is not legal advice, legal certification, or a guarantee of compliance, and empirical privacy tests are not a formal privacy guarantee.';
SDA.disclaimer = DISCLAIMER;
const sourceLabel = a => a.source === 'demo' ? 'Demo data (simulated, not a real dataset)' : 'Uploaded by user';

/* ───────── report model ───────── */
function sectionStatuses(audit, gov) {
  const r = audit.results, st = audit.settings || {};
  const m = (status, note) => ({ status, note: note || '' });
  const v = r.validation, out = [];
  out.push(Object.assign({ id: 'exec', title: 'Executive summary' }, m('Ready', 'Built from the modules below; lists what did not run.')));
  out.push(Object.assign({ id: 'dataset', title: 'Dataset details' }, m('Ready')));
  out.push(Object.assign({ id: 'scope', title: 'Scope and method' }, audit.provenance ? m('Ready') : m('Partial', 'Audit predates provenance tracking; engine versions and fingerprints were not recorded.')));
  out.push(Object.assign({ id: 'validation', title: 'Data quality, schema and cleaning' }, v ? (v.status === 'Pass' ? m('Ready') : v.status === 'Warning' ? m('Ready', 'Includes warnings.') : m('Blocked', 'Validation ' + v.status.toLowerCase() + '; downstream modules did not run.')) : m('Not run')));
  const mod = (id, title, x, extra) => out.push(Object.assign({ id, title }, !x || x.status === 'Not Run' ? m('Not run', x && x.reason) : x.status === 'Completed' ? m('Ready', extra) : x.status === 'Partial' ? m('Partial', extra || 'Some tests did not complete.') : x.status === 'Blocked' ? m('Blocked', x.reason) : m('Failed', x.error)));
  mod('fidelity', 'Fidelity', r.fidelity); mod('utility', 'Utility (TRTR / TSTR)', r.utility); mod('privacy', 'Privacy attacks', r.privacy, r.privacy && r.privacy.pending && r.privacy.pending.length ? r.privacy.pending.length + ' further attack types are not available in this version.' : '');
  out.push(Object.assign({ id: 'risk', title: 'Risk interpretation' }, r.ensemble && r.ensemble.status === 'Completed' ? (r.ensemble.category === 'Inconclusive' ? m('Partial', 'Insufficient evidence for a reliable category.') : m('Ready')) : m('Not run', 'Needs privacy tests.')));
  out.push(Object.assign({ id: 'governance', title: 'Governance mappings' }, (audit.context && (audit.context.frameworks || []).length) ? m(gov.mappings.length ? 'Ready' : 'Partial', gov.mappings.length ? gov.mappings.length + ' mappings (draft rules unless reviewed).' : 'No mapping produced for the selected frameworks.') : m('Not run', 'No frameworks selected.')));
  out.push(Object.assign({ id: 'sources', title: 'Official source references' }, (audit.context && (audit.context.frameworks || []).length) ? m('Ready') : m('Not run', 'No frameworks selected.')));
  out.push(Object.assign({ id: 'recs', title: 'Recommendations' }, m('Ready', techRecs(audit, gov).length + ' technical · ' + gov.recs.length + ' governance')));
  out.push(Object.assign({ id: 'gaps', title: 'Evidence gaps' }, m('Ready')));
  out.push(Object.assign({ id: 'method', title: 'Methodology' }, m('Ready')));
  out.push(Object.assign({ id: 'limits', title: 'Limitations and disclaimer' }, m('Ready')));
  return out;
}

function techRecs(audit, gov) {
  const r = audit.results || {}, out = []; const add = (priority, text, basis, page) => out.push({ priority, text, basis, page });
  const E = r.ensemble, F = r.fidelity, U = r.utility, P = r.privacy, V = r.validation;
  if (E && E.category === 'High') add('High', 'Do not release this synthetic data as-is. Inspect the records behind the high privacy signal and retrain the generator with stronger protection before re-auditing.', 'Ensemble: ' + E.label, 'ensemble');
  else if (E && E.category === 'Moderate') add('Medium', 'Investigate the moderate privacy signal before wider sharing; compare against a generator with stronger protection.', 'Ensemble: ' + E.label, 'ensemble');
  else if (E && (E.insufficient || !E.category) && E.status !== 'Not Run') add('Medium', 'Strengthen the privacy evidence: run both attacks with a labelled or attested membership setup so a reliable category can be assigned.', 'Ensemble: insufficient evidence', 'privacy');
  const mia = P && P.attacks ? P.attacks.find(a => a.id === 'mia' && a.status === 'Completed') : null;
  if (mia && mia.validity === 'proxy') add('Medium', 'Supply membership labels (or attest the training split). The current membership attack uses a proxy split and cannot support a low-risk statement.', 'MIA protocol: proxy', 'privacy');
  if (F && F.status === 'Completed') { if (F.overall !== null && F.overall < 0.8) add('High', 'Fidelity shows a large gap (Overall Quality ' + f3(F.overall) + '). Review generator settings and the weakest columns before relying on this data.', 'Fidelity overall', 'fidelity');
    const weak = F.perColumn.filter(c => c.score !== null && c.score < 0.8).map(c => c.name); if (weak.length) add('Medium', 'Revisit how the generator models ' + weak.slice(0, 4).join(', ') + (weak.length > 4 ? ' and ' + (weak.length - 4) + ' more' : '') + ' (column score below 0.80).', 'Fidelity per column', 'fidelity'); }
  if (U && U.status === 'Completed') { const ret = U.headline.retention; if (ret !== null && ret < 75) add('High', 'Models trained on the synthetic data keep only ' + pc(ret) + ' of real-data performance. Do not use it for model training without improvement.', 'Utility retention', 'utility'); else if (ret !== null && ret < 90) add('Medium', 'Utility retention is ' + pc(ret) + '. Check whether this is acceptable for the intended use.', 'Utility retention', 'utility');
    (U.warnings || []).filter(w => w.level === 'warn').forEach(w => add(/leakage/.test(w.id) ? 'High' : 'Medium', w.text, 'Utility diagnostics', 'utility')); }
  if (!U || U.status === 'Not Run') add('Low', 'Select a target column to measure predictive utility; it was skipped for this run.', 'Utility skipped', 'new');
  if (U && U.status === 'Failed') add('Medium', 'Utility failed: ' + U.error + ' Fix the cause and re-run.', 'Utility failed', 'utility');
  if (F && F.status === 'Failed') add('Medium', 'Fidelity failed: ' + F.error + ' Fix the cause and re-run.', 'Fidelity failed', 'fidelity');
  if (V && V.warnings.length) add('Low', 'Review the ' + V.warnings.length + ' data-quality warning' + (V.warnings.length === 1 ? '' : 's') + ' from validation; they can affect every metric.', 'Validation', 'validation');
  if (P && P.pending && P.pending.length) add('Low', 'Treat privacy coverage as partial: ' + P.pending.map(x => x.short).join(', ') + ' are not available in this version, so they were not tested.', 'Privacy coverage', 'privacy');
  if (gov) { const pend = gov.mappings.filter(x => x.reviewStatus === 'Pending' || x.reviewStatus === 'Needs More Information').length; if (pend) add('Medium', pend + ' governance mapping' + (pend === 1 ? '' : 's') + ' still need a human review decision.', 'Governance review', 'governance'); }
  const rank = { High: 0, Medium: 1, Low: 2 }; return out.sort((a, b) => rank[a.priority] - rank[b.priority]);
}

function reportModel(audit, gov) {
  const r = audit.results, info = audit.info, S = [], secs = sectionStatuses(audit, gov); const stOf = id => secs.find(s => s.id === id);
  const sec = (id, blocks) => { const s = stOf(id); S.push({ id, title: s.title, status: s.status, note: s.note, blocks }); };
  const notReady = secs.filter(s => s.status !== 'Ready');
  // executive
  const ex = [{ t: 'kv', rows: [['Audit', audit.name + ' (' + audit.id + ')'], ['Overall status', audit.status], ['Data source', sourceLabel(audit)], ['Report generated', new Date().toISOString()], ['Report completeness', notReady.length ? 'PARTIAL — ' + notReady.map(s => s.title + ' (' + s.status + ')').join('; ') : 'All sections ready']] }];
  const key = [];
  if (r.fidelity && r.fidelity.status === 'Completed') key.push('Fidelity: Column Shapes ' + f3(r.fidelity.columnShapes) + ', Column Pair Trends ' + f3(r.fidelity.pairTrends) + ', Overall Quality ' + f3(r.fidelity.overall) + ', average absolute correlation difference ' + f3(r.fidelity.avgCorrDiff) + '.');
  if (r.utility && r.utility.status === 'Completed') key.push('Utility (' + r.utility.task + ', target ' + r.utility.target + '): ' + SDA.metricMeta[r.utility.primary].label + ' TRTR ' + f3(r.utility.headline.trtr) + ' vs TSTR ' + f3(r.utility.headline.tstr) + ' — retention ' + pc(r.utility.headline.retention) + '.');
  if (r.privacy && r.privacy.attacks) r.privacy.attacks.filter(a => a.status === 'Completed').forEach(a => key.push(a.id === 'mia' ? 'Membership inference: ROC-AUC ' + f3(a.metrics.auc) + ', TPR at 10% FPR ' + f3(a.metrics.tpr10) + ' (membership setup: ' + a.validity + ').' : 'Exact-match test: ' + f3(a.metrics.synthMatchRate, 2) + '% of synthetic rows copy a real row vs ' + f3(a.metrics.baselineMatchRate, 2) + '% baseline.'));
  if (r.ensemble && r.ensemble.category) key.push('Empirical risk interpretation: ' + r.ensemble.label + '. Technical risk is separate from legal compliance status.');
  if (gov.mappings.length) key.push(gov.mappings.length + ' governance review prompts across ' + new Set(gov.mappings.map(m => m.framework)).size + ' framework(s); ' + gov.mappings.filter(m => m.ruleVerification !== 'Project-reviewed').length + ' rest on unverified draft rules.');
  ex.push({ t: 'h', text: 'Key results' }); ex.push(key.length ? { t: 'bullets', items: key } : { t: 'note', text: 'No module produced results.' });
  const ES = SDA.engineStatuses(audit, gov);
  ex.push({ t: 'h', text: 'Engine status' }); ex.push({ t: 'table', head: ['Engine', 'Status', 'Detail'], rows: ES.map(x => [x.label, x.status, x.reason]), widths: [2, 2, 7] });
  ex.push({ t: 'note', text: 'Statuses: Completed, Partial, Blocked, Skipped, Failed or Not applicable. Sample-based results are marked. None of these is ever converted into a zero score or a pass.' });
  ex.push({ t: 'note', text: DISCLAIMER }); sec('exec', ex);
  // dataset
  sec('dataset', [{ t: 'kv', rows: [['Dataset name', info.name], ['Domain', info.domain || 'Not provided'], ['Description', info.description || 'Not provided'], ['Generator / method', info.generator || 'Not provided'], ['Real file', audit.files.real.name + ' — ' + audit.files.real.rows.toLocaleString('en-US') + ' rows × ' + audit.files.real.cols + ' columns'], ['Synthetic file', audit.files.synth.name + ' — ' + audit.files.synth.rows.toLocaleString('en-US') + ' rows × ' + audit.files.synth.cols + ' columns'], ['Target column', info.target || 'None declared'], ['Task', info.target ? info.task : 'n/a'], ['Categorical columns', info.categorical || 'None declared'], ['Excluded identifiers', info.idCols || 'None declared']] }]);
  const pv = audit.provenance || {}; const fpx = f => f && f.fingerprint ? f.fingerprint.algo + ' ' + f.fingerprint.hex : 'Not recorded'; const st0 = audit.settings || {}; const PR = audit.prep || {};
  const scope = [{ t: 'kv', rows: [['Result source', audit.source === 'demo' ? 'Live computation on simulated demo data' : 'Live computation on the uploaded files (not historical)'], ['Real data used', (pv.dataVersions ? pv.dataVersions.real : PR.log && PR.log.length ? 'prepared copy' : 'raw upload') + ' — ' + audit.files.real.rows.toLocaleString('en-US') + ' rows × ' + audit.files.real.cols + ' columns'], ['Synthetic data used', (pv.dataVersions ? pv.dataVersions.synth : 'raw upload') + ' — ' + audit.files.synth.rows.toLocaleString('en-US') + ' rows × ' + audit.files.synth.cols + ' columns'], ['Real upload fingerprint', fpx(audit.files.real)], ['Synthetic upload fingerprint', fpx(audit.files.synth)]].concat(audit.files.real.preparedFingerprint ? [['Cleaned real copy fingerprint', audit.files.real.preparedFingerprint.algo + ' ' + audit.files.real.preparedFingerprint.hex]] : []).concat(audit.files.synth.preparedFingerprint ? [['Cleaned synthetic copy fingerprint', audit.files.synth.preparedFingerprint.algo + ' ' + audit.files.synth.preparedFingerprint.hex]] : []).concat([ ['Run ID', audit.id], ['Run time', audit.createdAt + ' (' + (audit.durationMs / 1000).toFixed(1) + ' s)'], ['Random seed', st0.seed], ['Depth / sampling cap', st0.mode + ' / ' + st0.sampleMax + ' rows per file'], ['Utility model', st0.model], ['Membership protocol', st0.protocol + (st0.protocol === 'ordered' ? (st0.attested ? ' (attested)' : ' (not attested)') : '')], ['Shared columns only', st0.matchedOnly ? 'Yes (explicit choice)' : 'No']]) }];
  scope.push({ t: 'h', text: 'Engines and versions' }); scope.push({ t: 'table', head: ['Engine', 'Version'], rows: Object.keys(SDA.engineVersions).map(k => [k, (pv.engineVersions || {})[k] || 'Not recorded']).concat([['knowledge base', gov.kbVersion]]), widths: [3, 3] });
  const F0 = r.fidelity; const samp = [];
  if (F0 && F0.settings) samp.push('Fidelity used ' + F0.settings.sampledReal + ' real / ' + F0.settings.sampledSynth + ' synthetic rows' + (F0.settings.sampled ? ' (seeded sample, seed ' + F0.settings.seed + ')' : ' (all rows)') + '.');
  if (r.utility && r.utility.split) samp.push('Utility: ' + (r.utility.splitStrategy || '') + '; ' + r.utility.split.realTrain + ' real train / ' + r.utility.split.realTest + ' real test / ' + r.utility.split.synthTrain + ' synthetic train rows.');
  (r.privacy && r.privacy.attacks || []).filter(a => a.sampleSizes).forEach(a => samp.push(a.short + ': ' + Object.keys(a.sampleSizes).map(k => a.sampleSizes[k] + ' ' + k).join(', ') + '.'));
  scope.push({ t: 'h', text: 'Sampling and assumptions' }); scope.push({ t: 'bullets', items: samp.concat(['Missing-value tokens read as missing: ' + SDA.missingTokens.join(', ') + ', empty.', 'Columns are matched by name; declared identifiers and excluded features are left out of every engine.']) });
  sec('scope', scope);
  // validation
  const v = r.validation; const vb = [];
  if (v) { vb.push({ t: 'table', head: ['Check', 'Status', 'Summary'], rows: v.checks.map(c => [c.label, c.status, c.summary]), widths: [2, 1, 6] });
    vb.push({ t: 'h', text: 'Schema comparison' }); vb.push({ t: 'table', head: ['Column', 'Real type', 'Synthetic type', 'Missing real %', 'Missing synth %', 'Status'], rows: v.schema.map(s => [s.name, s.realType, s.synthType, s.missReal === null ? '—' : s.missReal, s.missSynth === null ? '—' : s.missSynth, s.status]), widths: [3, 2, 2, 2, 2, 2] });
    const PL = (audit.prep && audit.prep.log) || [];
    vb.push({ t: 'kv', rows: [['Duplicate rows — real', v.duplicates.real.count + ' (' + pc(v.duplicates.real.rate, 2) + ')'], ['Duplicate rows — synthetic', v.duplicates.synth.count + ' (' + pc(v.duplicates.synth.rate, 2) + ')'], ['Uploaded files', 'Never modified. Cleaning, if any, was applied to working copies.']] });
    const RV = audit.prep && audit.prep.rawValidation;
    if (RV) { vb.push({ t: 'h', text: 'Findings on the raw uploads (before cleaning)' }); vb.push({ t: 'table', head: ['Check', 'Status', 'Summary'], rows: RV.checks.map(c => [c.label, c.status, c.summary]), widths: [2, 1, 6] }); }
    vb.push({ t: 'h', text: 'Cleaning log' });
    const dv = (audit.provenance && audit.provenance.dataVersions) || null;
    if (dv) vb.push({ t: 'note', text: 'Every result in this report was computed on: real data — ' + dv.real + '; synthetic data — ' + dv.synth + '. Cleaning can change measured fidelity, utility and privacy results.' });
    vb.push(PL.length ? { t: 'table', head: ['Step', 'File', 'Operation', 'Columns', 'Rows before → after', 'Cells changed', 'Rationale'], rows: PL.map(l => [l.step, l.file, l.label, l.columns.join(', ') || 'all', l.rowsBefore + ' → ' + l.rowsAfter + (l.colsBefore !== undefined && l.colsBefore !== l.colsAfter ? ' (' + l.colsBefore + ' → ' + l.colsAfter + ' cols)' : ''), l.cellsChanged, l.rationale]), widths: [0.7, 1.3, 3, 2.5, 2, 1.3, 5] } : { t: 'note', text: audit.prep ? 'No cleaning was applied. Every metric was computed on the raw uploads.' : 'Cleaning was not recorded for this audit.' });
    vb.push({ t: 'h', text: 'Unresolved issues' }); vb.push(v.warnings.length ? { t: 'bullets', items: v.warnings.map(w => w.text) } : { t: 'note', text: 'No unresolved data-quality warnings.' }); }
  else vb.push({ t: 'note', text: 'Validation was not run.' }); sec('validation', vb);
  // fidelity
  const fb = []; const F = r.fidelity;
  if (F && F.status === 'Completed') {
    fb.push({ t: 'kv', rows: [['Column Shapes', f3(F.columnShapes)], ['Column Pair Trends', f3(F.pairTrends)], ['Overall Quality Score', f3(F.overall)], ['Average |correlation difference|', f3(F.avgCorrDiff)], ['Rows used', F.settings.sampledReal + ' real / ' + F.settings.sampledSynth + ' synthetic' + (F.settings.sampled ? ' (sampled, seed ' + F.settings.seed + ')' : ' (all rows)')], ['Implementation', F.settings.metricNote]] });
    fb.push({ t: 'bars', title: 'Per-column score (1 = identical distribution)', rows: F.perColumn.slice().sort((a, b) => (a.score === null ? 2 : a.score) - (b.score === null ? 2 : b.score)).map(p => ({ label: p.name, value: p.score, text: f3(p.score) + ' · ' + p.metric })) });
    if (F.corr.topDiffs.length) { fb.push({ t: 'h', text: 'Largest correlation differences' }); fb.push({ t: 'table', head: ['Pair', 'Real r', 'Synthetic r', '|Δ|'], rows: F.corr.topDiffs.slice(0, 10).map(d => [d.a + ' × ' + d.b, f3(d.real), f3(d.synth), f3(d.diff)]), widths: [5, 1.5, 1.5, 1.5] }); }
    const unav = []; if (F.pairTrends === null) unav.push('Column Pair Trends: not evaluated (' + (F.pairTrendsNote || 'no evaluable pairs') + '). Overall Quality uses Column Shapes only and is not comparable with two-property scores.'); F.perColumn.filter(p => p.score === null).forEach(p => unav.push(p.name + ': no score (' + (p.note || 'not evaluable') + ').'));
    if (unav.length) { fb.push({ t: 'h', text: 'Unavailable tests' }); fb.push({ t: 'bullets', items: unav }); }
    fb.push({ t: 'note', text: 'High fidelity does not guarantee privacy, complete realism or downstream utility.' });
  } else fb.push({ t: 'note', text: F ? (F.status === 'Failed' ? 'Fidelity evaluation failed: ' + F.error : 'Fidelity was not run' + (F.reason ? ' (' + F.reason + ')' : '') + '.') : 'Fidelity was not run.' });
  sec('fidelity', fb);
  // utility
  const ub = []; const U = r.utility;
  if (U && U.status === 'Completed') {
    ub.push({ t: 'kv', rows: [['Task / target', U.task + ' / ' + U.target], ['Model', U.model], ['Split', U.split.realTrain + ' real train · ' + U.split.realTest + ' real test · ' + U.split.synthTrain + ' synthetic train; test fraction ' + U.split.testFraction + (U.split.stratified ? ' (stratified)' : '')], ['Seed', U.seed], ['Preprocessing', U.preprocessing], ['Headline metric', SDA.metricMeta[U.primary].label + ' — ' + SDA.metricMeta[U.primary].dir + ' is better']].concat(U.majorityBaseline !== undefined ? [['Majority-class accuracy (context)', f3(U.majorityBaseline)]] : []) });
    ub.push({ t: 'table', head: ['Metric', 'Direction', 'TRTR', 'TSTR', 'Retention'], rows: U.metricKeys.map(k => [SDA.metricMeta[k].label, SDA.metricMeta[k].dir + ' is better', f3(U.trtr[k], 4), f3(U.tstr[k], 4), U.retention[k].value === null ? 'N/A' : pc(U.retention[k].value)]), widths: [3, 3, 2, 2, 2] });
    ub.push({ t: 'kv', rows: [['Split strategy', U.splitStrategy || 'Recorded in split above'], ['Retention formula (headline)', U.retentionFormula || ''], ['Rows without a usable target', U.rowsMissingTarget ? U.rowsMissingTarget.real + ' real / ' + U.rowsMissingTarget.synth + ' synthetic (left out of utility only)' : 'n/a']] });
    if ((U.warnings || []).length) { ub.push({ t: 'h', text: 'Diagnostics and limitations' }); ub.push({ t: 'bullets', items: U.warnings.map(w => (w.level === 'warn' ? 'Warning: ' : '') + w.text) }); }
    ub.push({ t: 'note', text: 'Retention = TSTR ÷ TRTR × 100 for higher-is-better metrics, TRTR ÷ TSTR × 100 for lower-is-better metrics. Zero or undefined denominators return N/A. It can exceed 100% and does not replace the absolute metrics.' });
  } else ub.push({ t: 'note', text: U ? (U.status === 'Failed' ? 'Utility evaluation failed: ' + U.error : 'Utility was not run' + (U.reason ? ' (' + U.reason + ')' : '') + '.') : 'Utility was not run.' });
  sec('utility', ub);
  // privacy
  const pb = []; const P = r.privacy;
  if (P && P.attacks && P.attacks.length) {
    pb.push({ t: 'table', head: ['Attack', 'Status', 'Key metrics', 'Setup'], rows: P.attacks.map(a => [a.short, a.status, a.status === 'Completed' ? (a.id === 'mia' ? 'AUC ' + f3(a.metrics.auc) + (a.metrics.aucCI ? ' [' + f3(a.metrics.aucCI[0]) + '–' + f3(a.metrics.aucCI[1]) + ']' : '') + '; TPR@10%FPR ' + f3(a.metrics.tpr10) : 'match ' + f3(a.metrics.synthMatchRate, 2) + '% vs ' + f3(a.metrics.baselineMatchRate, 2) + '%; excess ' + f3(a.metrics.excessPp, 2) + ' pp') : (a.error || a.reason || ''), a.setup || '']), widths: [2, 1.5, 4, 5] });
    P.attacks.filter(a => a.threatModel).forEach(a => { const T = a.threatModel; pb.push({ t: 'h', text: a.short + ' — threat model' }); pb.push({ t: 'kv', rows: [['Attacker access', T.access], ['Member / non-member construction', T.construction], ['Distance / matching', T.distance], ['Preprocessing', T.preprocessing], ['Leakage control', T.separation], ['Sample sizes', T.samples], ['Seed', T.seed]] }); });
    P.attacks.filter(a => a.caveats).forEach(a => { pb.push({ t: 'h', text: a.short + ' — caveats' }); pb.push({ t: 'bullets', items: a.caveats }); });
    pb.push({ t: 'h', text: 'Attack types not available in this version' }); pb.push({ t: 'bullets', items: (P.pending || []).map(p => p.name + ' — not applicable (not tested; no result shown)') });
    pb.push({ t: 'note', text: 'ROC-AUC near 0.5 indicates near-random discrimination for this specific attack and setup; it does not prove that no privacy risk exists.' });
  } else pb.push({ t: 'note', text: 'Privacy tests were not run.' });
  sec('privacy', pb);
  // risk
  const rb = []; const EN = r.ensemble;
  if (EN && EN.category) {
    rb.push({ t: 'kv', rows: [['Empirical privacy-risk category', EN.label], ['Rules version', EN.rulesVersion], ['Coverage', EN.coverage.completed + ' completed · ' + EN.coverage.failed + ' failed · ' + EN.coverage.notRun + ' not run · ' + EN.coverage.pending + ' not available in this version · ' + EN.coverage.planned + ' attack types in total']] });
    rb.push({ t: 'bullets', items: EN.rationale.concat(EN.conflicts) });
    if (EN.components.length) rb.push({ t: 'table', head: ['Signal', 'Raw value', 'Level', 'Normalised (display)', 'Thresholds'], rows: EN.components.map(c => [c.label, f3(c.value, c.fmt) + c.unit, c.level, f3(c.score, 2), c.thresholds]), widths: [3, 1.5, 1.5, 2, 5] });
    rb.push({ t: 'h', text: 'Uncertainty' }); rb.push({ t: 'bullets', items: EN.uncertainty }); rb.push({ t: 'h', text: 'Recommended follow-up tests' }); rb.push({ t: 'bullets', items: EN.followUps });
    rb.push({ t: 'note', text: 'Technical privacy-risk interpretation is separate from legal compliance status. Fidelity and utility do not enter it.' });
  } else rb.push({ t: 'note', text: 'Insufficient Evidence for a Reliable Risk Category: privacy tests have not been run.' });
  sec('risk', rb);
  // governance
  const gb = []; const ctx = audit.context || {};
  if ((ctx.frameworks || []).length) {
    gb.push({ t: 'h', text: 'Applicability screening' }); gb.push({ t: 'table', head: ['Framework', 'Type', 'Status', 'Reason'], rows: gov.applicability.map(a => [a.name, a.instrument, a.status, a.reasons.join(' ')]), widths: [2, 2, 2.5, 6] });
    gb.push({ t: 'h', text: 'Evidence-to-rule mappings' });
    gb.push(gov.mappings.length ? { t: 'table', head: ['Finding', 'Framework / provision', 'Why matched', 'Sufficiency', 'Review'], rows: gov.mappings.map(m => [m.finding + '\n' + m.evidence, m.framework + ' ' + m.provision + (m.caveat ? '\n[' + m.caveat + ']' : ''), m.why, m.sufficiency, m.reviewStatus]), widths: [4, 3, 5, 1.5, 1.5] } : { t: 'note', text: 'No mapping was produced for the selected frameworks and evidence.' });
  } else gb.push({ t: 'note', text: 'No frameworks were selected, so no governance mapping was produced.' });
  gb.push({ t: 'note', text: DISCLAIMER }); sec('governance', gb);
  // sources
  const sb = [];
  const used = (ctx.frameworks || []); sb.push({ t: 'table', head: ['Framework', 'Type', 'Official source', 'KB status', 'Version / date'], rows: gov.frameworks.filter(f => used.indexOf(f.id) >= 0).map(f => [f.name, f.instrument, f.url, f.status, f.version]), widths: [2, 2, 5, 2, 4] });
  sb.push({ t: 'note', text: 'Knowledge base ' + gov.kbVersion + '. Provision links point to the issuing body; every rule shipped as an unverified draft unless a reviewer marked it project-reviewed.' }); sec('sources', sb);
  // recs
  const TR = techRecs(audit, gov);
  sec('recs', [{ t: 'h', text: 'Prioritised next steps' }, TR.length ? { t: 'table', head: ['Priority', 'Recommendation', 'Based on'], rows: TR.map(x => [x.priority, x.text, x.basis]), widths: [1.2, 8, 2.5] } : { t: 'note', text: 'No technical follow-up was triggered by these results.' }, { t: 'h', text: 'Governance recommendations' }].concat(gov.recs.length ? gov.recs.map(rc => ({ t: 'rec', rec: rc })) : [{ t: 'note', text: 'No governance recommendations were triggered by the evidence and context supplied.' }]));
  // gaps
  sec('gaps', [{ t: 'table', head: ['Kind', 'Detail', 'Genuine failure?'], rows: gov.gaps.map(x => [x.kind, x.text, x.genuine ? 'Yes' : 'No — not provided / not run']), widths: [2.5, 8, 2] }]);
  // method
  sec('method', [{ t: 'bullets', items: ['Validation: schema, type, missing-value, duplicate-row, constant/unusual-value and target checks; nothing is modified.', 'Cleaning: optional, user-approved steps on a working copy (missing-value rules, duplicate removal, type conversion, label normalisation, range rules, column removal). Each step is logged with before/after counts and can be replayed from the untouched upload.', 'Fidelity: KS Complement (numerical) and TV Complement (categorical) per column; Pearson correlation similarity and contingency similarity per column pair; Overall = mean of Column Shapes and Column Pair Trends. Reimplemented in JavaScript in the SDMetrics style — not the SDMetrics package.', 'Utility: same held-out real test rows for TRTR and TSTR; preprocessing fit on training data only; retention formula as stated above.', 'Privacy: closest-record-distance membership inference (ROC-AUC, TPR at 10% FPR) and an exact-match test against a real-vs-real baseline.', 'Ensemble interpretation: fixed provisional thresholds, conservative max rule, no weights, Low requires ≥ 2 completed tests and a labelled/attested membership setup.', 'Governance: user-supplied context → applicability screening → deterministic mapping rules over knowledge-base records → human review.'] }]);
  const own = SDA.engineStatuses(audit, gov).filter(x => x.status !== 'Completed').map(x => x.label + ': ' + x.status.toLowerCase() + (x.reason ? ' (' + x.reason + ')' : '') + '.');
  SDA.engineStatuses(audit, gov).filter(x => x.sampled).forEach(x => own.push(x.label + ' results are sample-based (seeded sample, seed ' + (audit.settings ? audit.settings.seed : '—') + '), not computed on every row.'));
  if (audit.prep && audit.prep.log && audit.prep.log.length) own.push('Results describe the cleaned data version recorded above, not the raw uploads.');
  sec('limits', [{ t: 'h', text: 'Specific to this audit' }, own.length ? { t: 'bullets', items: own } : { t: 'note', text: 'Every selected engine completed.' }, { t: 'h', text: 'General' }, { t: 'bullets', items: ['Empirical tests cover only the implemented attacks and the settings used; unimplemented attacks may reveal risks not seen here.', 'No formal privacy guarantee (e.g. differential privacy) is established by any result in this report.', 'Knowledge-base rules are drafts unless marked project-reviewed; project review is not formal legal review.', 'Applicability statuses are screening aids based on user-supplied context, which may be wrong or incomplete.', 'Results from different settings or sampling are not directly comparable.', 'Structured tabular data only.'] }, { t: 'note', text: DISCLAIMER }]);
  return { title: 'Synthetic Data Quality, Privacy & Compliance Audit', audit: { id: audit.id, name: audit.name, status: audit.status, source: sourceLabel(audit) }, partial: notReady.length > 0, sections: S, statuses: secs };
}

/* ───────── CSV tables ───────── */
function csvEsc(x) { if (x === null || x === undefined) return ''; const s = String(x); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
const toCsv = (head, rows) => [head].concat(rows).map(r => r.map(csvEsc).join(',')).join('\n') + '\n';
function tables(audit, gov) {
  const r = audit.results, T = {};
  const sum = []; const add = (m, name, val, note) => sum.push([audit.id, m, name, val === null || val === undefined ? 'N/A' : val, note || '']);
  if (r.validation) r.validation.checks.forEach(c => add('validation', c.label, c.status, c.summary));
  if (r.fidelity && r.fidelity.status === 'Completed') { add('fidelity', 'Column Shapes', r.fidelity.columnShapes); add('fidelity', 'Column Pair Trends', r.fidelity.pairTrends); add('fidelity', 'Overall Quality Score', r.fidelity.overall); add('fidelity', 'Average |correlation difference|', r.fidelity.avgCorrDiff); }
  else add('fidelity', 'status', r.fidelity ? r.fidelity.status : 'Not Run', r.fidelity && (r.fidelity.error || r.fidelity.reason));
  if (r.utility && r.utility.status === 'Completed') r.utility.metricKeys.forEach(k => { add('utility', SDA.metricMeta[k].label + ' TRTR', r.utility.trtr[k]); add('utility', SDA.metricMeta[k].label + ' TSTR', r.utility.tstr[k]); add('utility', SDA.metricMeta[k].label + ' retention %', r.utility.retention[k].value, r.utility.retention[k].note); });
  else add('utility', 'status', r.utility ? r.utility.status : 'Not Run', r.utility && (r.utility.error || r.utility.reason));
  (r.privacy && r.privacy.attacks || []).forEach(a => { if (a.status === 'Completed') Object.keys(a.metrics).forEach(k => { if (typeof a.metrics[k] === 'number') add('privacy:' + a.id, k, a.metrics[k]); }); else add('privacy:' + a.id, 'status', a.status, a.error || a.reason); });
  if (r.ensemble && r.ensemble.category) add('ensemble', 'Risk category', r.ensemble.label);
  T['summary_metrics.csv'] = toCsv(['audit_id', 'module', 'metric', 'value', 'note'], sum);
  if (r.validation) { T['validation_schema.csv'] = toCsv(['column', 'real_type', 'synthetic_type', 'missing_real_pct', 'missing_synth_pct', 'category_compat', 'status', 'notes'], r.validation.schema.map(s => [s.name, s.realType, s.synthType, s.missReal, s.missSynth, s.catCompat, s.status, s.notes.join(' | ')])); }
  if (r.fidelity && r.fidelity.status === 'Completed') {
    T['fidelity_columns.csv'] = toCsv(['column', 'kind', 'metric', 'score', 'band', 'real_mean', 'synth_mean', 'std_diff', 'max_category_diff', 'missing_real_pct', 'missing_synth_pct'], r.fidelity.perColumn.map(p => [p.name, p.kind, p.metric, p.score, p.band, p.realMean, p.synthMean, p.stdDiff, p.maxCatDiff, p.missReal, p.missSynth]));
    T['fidelity_pairs.csv'] = toCsv(['column_a', 'column_b', 'metric', 'score'], r.fidelity.pairs.map(p => [p.a, p.b, p.type, p.score]));
    T['fidelity_correlation_top_differences.csv'] = toCsv(['column_a', 'column_b', 'real_corr', 'synthetic_corr', 'abs_diff'], r.fidelity.corr.topDiffs.map(d => [d.a, d.b, d.real, d.synth, d.diff]));
    T['fidelity_numeric_summary.csv'] = toCsv(['column', 'dataset', 'n', 'mean', 'std', 'min', 'q25', 'median', 'q75', 'max'], r.fidelity.summary.filter(s => s.kind === 'numeric').flatMap(s => [['real', s.real], ['synthetic', s.synth]].filter(x => x[1]).map(x => [s.name, x[0], x[1].n, x[1].mean, x[1].std, x[1].min, x[1].q25, x[1].median, x[1].q75, x[1].max])));
  }
  if (r.utility && r.utility.status === 'Completed') { const U = r.utility; T['utility_metrics.csv'] = toCsv(['metric', 'direction', 'trtr', 'tstr', 'retention_pct', 'note'], U.metricKeys.map(k => [SDA.metricMeta[k].label, SDA.metricMeta[k].dir, U.trtr[k], U.tstr[k], U.retention[k].value, U.retention[k].note])); if (U.perClass) T['utility_per_class.csv'] = toCsv(['protocol', 'class', 'precision', 'recall', 'f1', 'support'], ['trtr', 'tstr'].flatMap(p => U.perClass[p].map(c => [p.toUpperCase(), c.label, c.precision, c.recall, c.f1, c.support]))); }
  if (r.privacy && r.privacy.attacks) T['privacy_attacks.csv'] = toCsv(['attack', 'status', 'roc_auc', 'auc_ci_low', 'auc_ci_high', 'tpr_at_10pct_fpr', 'synthetic_match_pct', 'baseline_match_pct', 'excess_pp', 'validity', 'setup', 'error_or_reason'], r.privacy.attacks.map(a => { const m = a.metrics || {}; return [a.short, a.status, m.auc, m.aucCI && m.aucCI[0], m.aucCI && m.aucCI[1], m.tpr10, m.synthMatchRate, m.baselineMatchRate, m.excessPp, a.validity, a.setup, a.error || a.reason]; }).concat((r.privacy.pending || []).map(p => [p.short, 'Not applicable', null, null, null, null, null, null, null, null, '', 'Not available in this version'])));
  if (r.ensemble && r.ensemble.components) T['ensemble_components.csv'] = toCsv(['signal', 'raw_value', 'level', 'normalised_display_score', 'membership_validity', 'thresholds'], r.ensemble.components.map(c => [c.label, c.value, c.level, c.score, c.validity, c.thresholds]));
  T['governance_applicability.csv'] = toCsv(['framework', 'type', 'status', 'reasons', 'missing_context'], gov.applicability.map(a => [a.name, a.instrument, a.status, a.reasons.join(' '), a.missing.join('; ')]));
  T['governance_mappings.csv'] = toCsv(['mapping_id', 'finding', 'evidence', 'evidence_kind', 'framework', 'instrument', 'provision', 'why_matched', 'sufficiency', 'recommended_action', 'source_url', 'rule_verification', 'applicability', 'review_status'], gov.mappings.map(m => [m.id, m.finding, m.evidence, m.evidenceKind, m.framework, m.instrument, m.provision, m.why, m.sufficiency, m.action, m.url, m.ruleVerification, m.applicability, m.reviewStatus]));
  T['results_registry.csv'] = SDA.registry.csv(SDA.registry.forAudit(audit, gov));
  if (audit.prep && audit.prep.log && audit.prep.log.length) T['cleaning_log.csv'] = toCsv(['step', 'file', 'operation', 'description', 'parameters', 'columns', 'rows_before', 'rows_after', 'columns_before', 'columns_after', 'cells_changed', 'rows_removed', 'applied_at', 'rationale'], audit.prep.log.map(l => [l.step, l.file, l.op || '', l.label, l.params ? JSON.stringify(l.params) : '', l.columns.join('; '), l.rowsBefore, l.rowsAfter, l.colsBefore === undefined ? '' : l.colsBefore, l.colsAfter === undefined ? '' : l.colsAfter, l.cellsChanged, l.rowsRemoved, l.at || '', l.rationale]));
  T['governance_gaps.csv'] = toCsv(['kind', 'detail', 'genuine_failure'], gov.gaps.map(x => [x.kind, x.text, x.genuine ? 'yes' : 'no']));
  return T;
}
function auditJson(audit, gov) {
  return JSON.stringify({ schema: 'synthetic-data-auditor/audit/v1', exportedAt: new Date().toISOString(), engine: { name: SDA.engineName, version: SDA.version }, knowledgeBase: gov.kbVersion, ensembleRules: SDA.ensembleRules.version, disclaimer: DISCLAIMER,
    audit: { id: audit.id, name: audit.name, status: audit.status, source: audit.source, createdAt: audit.createdAt, durationMs: audit.durationMs, files: audit.files, info: audit.info, settings: audit.settings },
    provenance: audit.provenance || null, preparation: audit.prep ? { versions: audit.prep.versions || null, dataVersions: audit.provenance ? audit.provenance.dataVersions || null : null, log: audit.prep.log } : null, engineStatuses: SDA.engineStatuses(audit, gov), registry: SDA.registry.forAudit(audit, gov),
    results: audit.results, governance: { context: audit.context, applicability: gov.applicability, mappings: gov.mappings, recommendations: gov.recs, gaps: gov.gaps, withheld: gov.withheld, reviews: audit.reviews || {} } }, null, 2);
}

/* ───────── SVG plots ───────── */
const C = { real: '#26324F', synth: '#D07A45', ink: '#17181C', mute: '#67666C', grid: '#ECE9E3', red: '#B42318', amber: '#B7791F', green: '#1E7B3F' };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const svgWrap = (w, h, title, inner) => '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" font-family="Helvetica, Arial, sans-serif"><rect width="' + w + '" height="' + h + '" fill="#fff"/><text x="16" y="24" font-size="14" font-weight="700" fill="' + C.ink + '">' + esc(title) + '</text>' + inner + '</svg>';
function svgHBars(title, rows, o) { // rows: {label, value, color, text}
  o = o || {}; const max = o.max || 1, W = 720, rowH = 24, top = 44, left = 190; const H = top + rows.length * rowH + 40;
  let s = ''; for (let i = 0; i <= 4; i++) { const x = left + (W - left - 30) * i / 4; s += '<line x1="' + x + '" y1="' + (top - 6) + '" x2="' + x + '" y2="' + (H - 34) + '" stroke="' + C.grid + '"/><text x="' + x + '" y="' + (H - 18) + '" font-size="10" text-anchor="middle" fill="' + C.mute + '">' + (max * i / 4).toFixed(2) + '</text>'; }
  rows.forEach((r, i) => { const y = top + i * rowH; const w = r.value === null || r.value === undefined ? 0 : Math.max(0, Math.min(1, r.value / max)) * (W - left - 30); s += '<text x="' + (left - 8) + '" y="' + (y + 14) + '" font-size="11" text-anchor="end" fill="' + C.ink + '">' + esc(r.label) + '</text>' + (r.value === null || r.value === undefined ? '<text x="' + left + '" y="' + (y + 14) + '" font-size="11" fill="' + C.mute + '">N/A (not computed)</text>' : '<rect x="' + left + '" y="' + (y + 2) + '" width="' + w + '" height="16" rx="3" fill="' + (r.color || C.real) + '"><title>' + esc(r.text || r.value) + '</title></rect><text x="' + (left + w + 6) + '" y="' + (y + 14) + '" font-size="10.5" fill="' + C.mute + '">' + esc(r.text || r.value.toFixed(3)) + '</text>'); });
  s += '<text x="' + (left + (W - left - 30) / 2) + '" y="' + (H - 4) + '" font-size="10.5" text-anchor="middle" fill="' + C.mute + '">' + esc(o.xlabel || 'Score') + '</text>';
  return svgWrap(W, H, title, s);
}
function svgGroupedColumns(title, labels, a, b, o) { // two series of proportions
  o = o || {}; const W = 760, H = 360, L = 56, B = 70, T = 52, pw = W - L - 20, ph = H - T - B; const max = Math.max.apply(null, a.concat(b).concat([0.0001])) * 1.1; const n = labels.length, gw = pw / n, bw = Math.min(22, gw / 2.4);
  let s = ''; for (let i = 0; i <= 4; i++) { const y = T + ph - ph * i / 4; s += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - 20) + '" y2="' + y + '" stroke="' + C.grid + '"/><text x="' + (L - 6) + '" y="' + (y + 3) + '" font-size="10" text-anchor="end" fill="' + C.mute + '">' + (max * i / 4 * 100).toFixed(0) + '%</text>'; }
  labels.forEach((lab, i) => { const x = L + gw * i + gw / 2; const ha = a[i] / max * ph, hb = b[i] / max * ph; s += '<rect x="' + (x - bw) + '" y="' + (T + ph - ha) + '" width="' + bw + '" height="' + ha + '" fill="' + C.real + '" opacity="0.85"><title>' + esc(lab) + ' — real ' + (a[i] * 100).toFixed(1) + '%</title></rect><rect x="' + x + '" y="' + (T + ph - hb) + '" width="' + bw + '" height="' + hb + '" fill="' + C.synth + '" opacity="0.85"><title>' + esc(lab) + ' — synthetic ' + (b[i] * 100).toFixed(1) + '%</title></rect>'; if (n <= 14 || i % Math.ceil(n / 12) === 0) s += '<text transform="translate(' + (x + 2) + ',' + (T + ph + 12) + ') rotate(35)" font-size="9.5" fill="' + C.mute + '">' + esc(lab) + '</text>'; });
  s += '<text x="' + (L + pw / 2) + '" y="' + (H - 6) + '" font-size="10.5" text-anchor="middle" fill="' + C.mute + '">' + esc(o.xlabel || 'Value') + '</text><text transform="translate(14,' + (T + ph / 2) + ') rotate(-90)" font-size="10.5" text-anchor="middle" fill="' + C.mute + '">Share of rows</text>';
  s += '<rect x="' + (W - 190) + '" y="8" width="10" height="10" fill="' + C.real + '"/><text x="' + (W - 176) + '" y="17" font-size="11" fill="' + C.ink + '">' + esc(o.la || 'Real') + '</text><rect x="' + (W - 130) + '" y="8" width="10" height="10" fill="' + C.synth + '"/><text x="' + (W - 116) + '" y="17" font-size="11" fill="' + C.ink + '">' + esc(o.lb || 'Synthetic') + '</text>';
  return svgWrap(W, H, title, s);
}
function heatColor(v, kind) { if (v === null || v === undefined) return '#EEF1F6'; if (kind === 'diff') { const t = Math.min(1, v / 0.5); const r = Math.round(255 - t * (255 - 180)), gg = Math.round(255 - t * (255 - 35)), b = Math.round(255 - t * (255 - 24)); return 'rgb(' + r + ',' + gg + ',' + b + ')'; } const t = Math.min(1, Math.abs(v)); return v >= 0 ? 'rgb(' + Math.round(255 - t * (255 - 38)) + ',' + Math.round(255 - t * (255 - 50)) + ',' + Math.round(255 - t * (255 - 79)) + ')' : 'rgb(' + Math.round(255 - t * (255 - 208)) + ',' + Math.round(255 - t * (255 - 122)) + ',' + Math.round(255 - t * (255 - 69)) + ')'; }
SDA.heatColor = heatColor;
function svgHeat(title, cols, M, kind) {
  const n = cols.length, cell = Math.max(26, Math.min(44, 520 / Math.max(n, 1))), L = 130, T = 56, W = L + n * cell + 20, H = T + n * cell + 90; let s = '';
  for (let i = 0; i < n; i++) { s += '<text x="' + (L - 6) + '" y="' + (T + i * cell + cell / 2 + 3) + '" font-size="10" text-anchor="end" fill="' + C.ink + '">' + esc(cols[i].slice(0, 18)) + '</text><text transform="translate(' + (L + i * cell + cell / 2) + ',' + (T + n * cell + 8) + ') rotate(50)" font-size="10" fill="' + C.ink + '">' + esc(cols[i].slice(0, 18)) + '</text>'; for (let j = 0; j < n; j++) { const v = M[i][j]; s += '<rect x="' + (L + j * cell) + '" y="' + (T + i * cell) + '" width="' + cell + '" height="' + cell + '" fill="' + heatColor(v, kind) + '" stroke="#fff"><title>' + esc(cols[i] + ' × ' + cols[j] + ': ' + (v === null ? 'N/A' : v.toFixed(3))) + '</title></rect>' + (cell >= 30 && v !== null ? '<text x="' + (L + j * cell + cell / 2) + '" y="' + (T + i * cell + cell / 2 + 3) + '" font-size="9" text-anchor="middle" fill="' + (Math.abs(v) > 0.6 ? '#fff' : C.ink) + '">' + v.toFixed(2) + '</text>' : ''); } }
  s += '<text x="' + (L) + '" y="' + (H - 6) + '" font-size="10.5" fill="' + C.mute + '">' + (kind === 'diff' ? 'Absolute difference |r_real − r_synthetic| (white = 0, dark red ≥ 0.5)' : 'Pearson r (blue positive, orange negative)') + '</text>';
  return svgWrap(W, H, title, s);
}
function svgRoc(title, pts, auc) {
  const W = 460, H = 460, L = 56, T = 48, S = 360; let s = '';
  for (let i = 0; i <= 4; i++) { const x = L + S * i / 4, y = T + S - S * i / 4; s += '<line x1="' + L + '" y1="' + y + '" x2="' + (L + S) + '" y2="' + y + '" stroke="' + C.grid + '"/><line x1="' + x + '" y1="' + T + '" x2="' + x + '" y2="' + (T + S) + '" stroke="' + C.grid + '"/><text x="' + (L - 6) + '" y="' + (y + 3) + '" font-size="10" text-anchor="end" fill="' + C.mute + '">' + (i / 4).toFixed(2) + '</text><text x="' + x + '" y="' + (T + S + 14) + '" font-size="10" text-anchor="middle" fill="' + C.mute + '">' + (i / 4).toFixed(2) + '</text>'; }
  s += '<line x1="' + L + '" y1="' + (T + S) + '" x2="' + (L + S) + '" y2="' + T + '" stroke="' + C.mute + '" stroke-dasharray="4 4"/><polyline fill="none" stroke="' + C.real + '" stroke-width="2" points="' + pts.map(p => (L + p[0] * S).toFixed(1) + ',' + (T + S - p[1] * S).toFixed(1)).join(' ') + '"/>';
  s += '<line x1="' + (L + S * 0.1) + '" y1="' + T + '" x2="' + (L + S * 0.1) + '" y2="' + (T + S) + '" stroke="' + C.amber + '" stroke-dasharray="2 3"/><text x="' + (L + S * 0.1 + 4) + '" y="' + (T + 12) + '" font-size="10" fill="' + C.amber + '">FPR = 10%</text>';
  s += '<text x="' + (L + S / 2) + '" y="' + (H - 12) + '" font-size="11" text-anchor="middle" fill="' + C.mute + '">False-positive rate (non-members flagged)</text><text transform="translate(14,' + (T + S / 2) + ') rotate(-90)" font-size="11" text-anchor="middle" fill="' + C.mute + '">True-positive rate (members flagged)</text><text x="' + (L + S - 8) + '" y="' + (T + S - 12) + '" font-size="12" text-anchor="end" fill="' + C.ink + '">ROC-AUC = ' + auc.toFixed(3) + ' · dashed = random guess</text>';
  return svgWrap(W, H, title, s);
}
function plots(audit) {
  const r = audit.results, P = {};
  if (r.validation) P['validation_missing_values.svg'] = svgGroupedColumns('Missing values by column (real vs synthetic)', r.validation.missingChart.map(x => x.name), r.validation.missingChart.map(x => x.real / 100), r.validation.missingChart.map(x => x.synth / 100), { xlabel: 'Column (values are % of rows missing)' });
  const F = r.fidelity;
  if (F && F.status === 'Completed') {
    P['fidelity_column_scores.svg'] = svgHBars('Per-column fidelity score (1 = identical)', F.perColumn.slice().sort((a, b) => (a.score === null ? 2 : a.score) - (b.score === null ? 2 : b.score)).map(p => ({ label: p.name, value: p.score, text: f3(p.score) + ' ' + p.metric, color: p.kind === 'numeric' ? C.real : C.synth })), { max: 1, xlabel: 'KS Complement (numerical, blue) / TV Complement (categorical, teal)' });
    Object.keys(F.dists).slice(0, 16).forEach(name => { const d = F.dists[name]; if (d.kind === 'numeric') P['fidelity_dist_' + name.replace(/[^\w]+/g, '_') + '.svg'] = svgGroupedColumns('Distribution — ' + name, d.edges.slice(0, -1).map((e, i) => (+e.toPrecision(3)) + ''), d.real, d.synth, { xlabel: name + ' (bin start)' }); else P['fidelity_dist_' + name.replace(/[^\w]+/g, '_') + '.svg'] = svgGroupedColumns('Category shares — ' + name, d.cats.map(c => c.label), d.cats.map(c => c.real), d.cats.map(c => c.synth), { xlabel: name }); });
    if (F.corr.cols.length > 1) { P['fidelity_corr_real.svg'] = svgHeat('Correlation — real', F.corr.cols, F.corr.real, 'corr'); P['fidelity_corr_synthetic.svg'] = svgHeat('Correlation — synthetic', F.corr.cols, F.corr.synth, 'corr'); P['fidelity_corr_difference.svg'] = svgHeat('Absolute correlation difference', F.corr.cols, F.corr.diff, 'diff'); }
  }
  const U = r.utility;
  if (U && U.status === 'Completed') P['utility_trtr_vs_tstr.svg'] = svgHBars('TRTR vs TSTR — ' + U.metricKeys.map(k => SDA.metricMeta[k].label).join(', '), U.metricKeys.flatMap(k => [{ label: SDA.metricMeta[k].label + ' · TRTR', value: U.trtr[k], text: f3(U.trtr[k]), color: C.real }, { label: SDA.metricMeta[k].label + ' · TSTR', value: U.tstr[k], text: f3(U.tstr[k]), color: C.synth }]), { max: U.task === 'regression' ? Math.max(U.trtr.rmse, U.tstr.rmse, U.trtr.mae, U.tstr.mae) * 1.1 : 1, xlabel: U.task === 'regression' ? 'Metric value (RMSE / MAE in target units; R² on its own scale)' : 'Metric value (0–1)' });
  const mia = r.privacy && r.privacy.attacks && r.privacy.attacks.find(a => a.id === 'mia' && a.status === 'Completed');
  if (mia) { P['privacy_mia_roc.svg'] = svgRoc('Membership inference — ROC curve', mia.roc, mia.metrics.auc); P['privacy_mia_distance_hist.svg'] = svgGroupedColumns('Distance to closest synthetic record', mia.hist.members.map((v, i) => (mia.hist.max * i / 20).toFixed(3)), mia.hist.members, mia.hist.nonMembers, { xlabel: 'Distance (bin start)', la: 'Members', lb: 'Non-members' }); }
  if (r.ensemble && r.ensemble.components && r.ensemble.components.length) P['ensemble_signals.svg'] = svgHBars('Ensemble signals — normalised concern (display only)', r.ensemble.components.map(c => ({ label: c.label, value: c.score, text: c.level + ' · raw ' + f3(c.value, c.fmt) + c.unit, color: c.levelIdx === 2 ? C.red : c.levelIdx === 1 ? C.amber : C.green })), { max: 1, xlabel: '0 = chance level, 1 = strong signal' });
  return P;
}

/* ───────── ZIP (store) ───────── */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(); const parts = [], central = []; let offset = 0; const now = new Date();
  const dosT = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosD = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  files.forEach(f => {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dosT, true); lh.setUint16(12, dosD, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dosT, true); ch.setUint16(14, dosD, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name); offset += 30 + name.length + data.length;
  });
  const csize = central.reduce((s, p) => s + p.length, 0); const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  const all = parts.concat(central, [new Uint8Array(end.buffer)]); const total = all.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(total); let o = 0; all.forEach(p => { out.set(p, o); o += p.length; }); return out;
}

/* ───────── PDF (Helvetica, text + rules + bars) ───────── */
const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const MAP = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '-', '→': '->', '≥': '>=', '≤': '<=', '−': '-', '≈': '~', '…': '...', 'λ': 'lambda', 'Δ': 'Delta', 'ρ': 'rho', '∅': '(empty)', '‹': '<', '›': '>', '✓': 'ok', '²': '2', '×': 'x', '÷': '/', '·': '-', '§': 'S.', '\n': ' ' };
function pdfClean(s) { s = String(s === null || s === undefined ? '' : s); let o = ''; for (const ch of s) { const m = MAP[ch]; if (m !== undefined) o += m; else { const c = ch.charCodeAt(0); o += c >= 32 && c < 127 ? ch : c > 160 && c < 256 ? ch : '?'; } } return o; }
function tw(s, size, bold) { let w = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); w += (c >= 32 && c <= 126 ? HW[c - 32] : 556); } return w * size / 1000 * (bold ? 1.06 : 1); }
function wrap(s, size, maxW, bold) {
  const lines = []; String(s).split('\n').forEach(par => {
    const words = pdfClean(par).split(/\s+/).filter(Boolean); let line = '';
    if (!words.length) { lines.push(''); return; }
    words.forEach(w => { while (tw(w, size, bold) > maxW && w.length > 4) { let k = w.length; while (k > 1 && tw(w.slice(0, k), size, bold) > maxW) k--; if (line) { lines.push(line); line = ''; } lines.push(w.slice(0, k)); w = w.slice(k); } const t = line ? line + ' ' + w : w; if (tw(t, size, bold) > maxW && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line);
  }); return lines;
}
function PdfDoc(footerText) {
  const PW = 595, PH = 842, M = 46; const pages = []; let cur = null, y = 0;
  const hex = c => { const n = parseInt(c.slice(1), 16); return ((n >> 16) & 255) / 255 + ' ' + ((n >> 8) & 255) / 255 + ' ' + (n & 255) / 255; };
  const esc2 = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const d = {
    newPage() { cur = []; pages.push(cur); y = PH - M - 10; },
    ensure(h) { if (!cur || y - h < M + 24) d.newPage(); },
    text(str, x, yy, size, bold, color) { cur.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + hex(color || '#14213D') + ' rg ' + x.toFixed(1) + ' ' + yy.toFixed(1) + ' Td (' + esc2(pdfClean(str)) + ') Tj ET'); },
    rect(x, yy, w, h, fill, stroke) { cur.push((fill ? hex(fill) + ' rg ' : '') + (stroke ? hex(stroke) + ' RG 0.5 w ' : '') + x.toFixed(1) + ' ' + yy.toFixed(1) + ' ' + w.toFixed(1) + ' ' + h.toFixed(1) + ' re ' + (fill && stroke ? 'B' : fill ? 'f' : 'S')); },
    line(x1, y1, x2, y2, color) { cur.push(hex(color || '#E2E7EF') + ' RG 0.6 w ' + x1 + ' ' + y1 + ' m ' + x2 + ' ' + y2 + ' l S'); },
    para(str, o) { o = o || {}; const size = o.size || 9.5, lh = size * 1.38, x = (o.x || M), w = (o.w || PW - 2 * M - (x - M)); const lines = wrap(str, size, w, o.bold); lines.forEach(l => { d.ensure(lh); y -= lh; d.text(l, x, y, size, o.bold, o.color); }); y -= (o.gap === undefined ? 4 : o.gap); },
    h1(str) { d.ensure(40); y -= 10; d.text(str, M, y - 14, 15, true, '#17181C'); y -= 20; d.line(M, y, PW - M, y, '#C9D3E3'); y -= 8; },
    h2(str) { d.ensure(28); y -= 6; d.text(str, M, y - 11, 11, true, '#26324F'); y -= 18; },
    note(str) { const size = 9, lines = wrap(str, size, PW - 2 * M - 16); const h = lines.length * size * 1.38 + 12; d.ensure(h + 6); d.rect(M, y - h, PW - 2 * M, h, '#F3F5FA', '#D5DCE8'); let yy = y - 6; lines.forEach(l => { yy -= size * 1.38; d.text(l, M + 8, yy + 3, size, false, '#34425A'); }); y -= h + 8; },
    kv(rows) { rows.forEach(r => { const lines = wrap(r[1], 9, PW - 2 * M - 150); const h = Math.max(1, lines.length) * 12.4 + 3; d.ensure(h); d.text(r[0], M, y - 11, 9, true, '#34425A'); lines.forEach((l, i) => d.text(l, M + 150, y - 11 - i * 12.4, 9, false, '#14213D')); y -= h; d.line(M, y + 1, PW - M, y + 1, '#EEF1F6'); }); y -= 6; },
    bullets(items) { items.forEach(it => { const lines = wrap(it, 9.5, PW - 2 * M - 14); lines.forEach((l, i) => { d.ensure(13); y -= 13; if (i === 0) d.text('-', M + 2, y, 9.5, true, '#26324F'); d.text(l, M + 14, y, 9.5, false); }); y -= 2; }); y -= 4; },
    table(head, rows, widths) {
      const tot = widths.reduce((a, b) => a + b, 0), W = PW - 2 * M; const cw = widths.map(w => w / tot * W); const size = 8, lh = 10.2;
      const drawHead = () => { d.ensure(22); d.rect(M, y - 16, W, 16, '#F1EEE8'); let x = M; head.forEach((h, i) => { d.text(h, x + 4, y - 11, 8, true, '#26324F'); x += cw[i]; }); y -= 16; };
      drawHead();
      rows.forEach(r => { const cells = r.map((c, i) => wrap(c === null || c === undefined ? '' : c, size, cw[i] - 8)); const h = Math.max.apply(null, cells.map(c => c.length)) * lh + 6; if (y - h < M + 24) { d.newPage(); drawHead(); } let x = M; cells.forEach((lines, i) => { lines.forEach((l, k) => d.text(l, x + 4, y - 9 - k * lh, size, false, '#14213D')); x += cw[i]; }); y -= h; d.line(M, y, PW - M, y, '#E2E7EF'); });
      y -= 8;
    },
    bars(title, rows) { if (title) d.para(title, { bold: true, size: 9, color: '#34425A', gap: 2 }); rows.forEach(r => { d.ensure(14); y -= 13; d.text(String(r.label).slice(0, 28), M, y + 1, 8.5, false); d.rect(M + 150, y - 1, 200, 9, '#EEF1F6'); if (r.value !== null && r.value !== undefined) d.rect(M + 150, y - 1, Math.max(1, 200 * Math.min(1, Math.max(0, r.value))), 9, '#26324F'); d.text(r.text || '', M + 358, y + 1, 8.5, false, '#34425A'); }); y -= 8; },
    cover(t, sub, lines) { d.newPage(); d.rect(0, PH - 170, PW, 170, '#17181C'); d.text('SYNTHETIC DATA AUDITOR', M, PH - 56, 10, true, '#E39466'); d.text('Quality  -  Privacy  -  Governance', M, PH - 72, 9, false, '#C9D3E3'); wrap(t, 22, PW - 2 * M, true).forEach((l, i) => d.text(l, M, PH - 108 - i * 27, 22, true, '#FFFFFF')); y = PH - 200; d.para(sub, { size: 11, color: '#34425A' }); y -= 6; },
    finish() { const n = pages.length; const objs = []; const add = s => { objs.push(s); return objs.length; };
      add('<< /Type /Catalog /Pages 2 0 R >>'); add('PAGES'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const kids = [];
      pages.forEach((p, i) => { p.push('BT /F1 7.5 Tf ' + hex('#5B6B82') + ' rg ' + M + ' 26 Td (' + esc2(pdfClean(footerText)) + ') Tj ET'); p.push('BT /F1 7.5 Tf ' + hex('#5B6B82') + ' rg ' + (PW - M - 50) + ' 26 Td (Page ' + (i + 1) + ' of ' + n + ') Tj ET'); const stream = p.join('\n'); const c = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream'); const pg = add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + c + ' 0 R >>'); kids.push(pg + ' 0 R'); });
      objs[1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>';
      let out = '%PDF-1.4\n'; const offs = []; objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
      const xref = out.length; out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
      const b = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) b[i] = out.charCodeAt(i) & 255; return b; }
  };
  return d;
}
function pdfReport(model) {
  const d = PdfDoc(model.title + ' - ' + model.audit.id + ' - ' + DISCLAIMER.slice(0, 60) + '...');
  d.cover(model.title, model.audit.name + '   -   ' + model.audit.id + '\n' + model.audit.source + '   -   Status: ' + model.audit.status, []);
  d.note(model.partial ? 'PARTIAL REPORT. Sections that did not run or did not complete are marked below; no values are invented for them.' : 'All report sections are ready.');
  d.table(['Section', 'Status', 'Note'], model.statuses.map(s => [s.title, s.status, s.note || '']), [3, 1.4, 6]);
  d.note(DISCLAIMER);
  model.sections.forEach(s => {
    d.h1(s.title + (s.status !== 'Ready' ? '   [' + s.status + ']' : ''));
    s.blocks.forEach(b => {
      if (b.t === 'p') d.para(b.text); else if (b.t === 'h') d.h2(b.text); else if (b.t === 'kv') d.kv(b.rows); else if (b.t === 'bullets') d.bullets(b.items); else if (b.t === 'note') d.note(b.text);
      else if (b.t === 'table') d.table(b.head, b.rows, b.widths || b.head.map(() => 1)); else if (b.t === 'bars') d.bars(b.title, b.rows);
      else if (b.t === 'rec') { const r = b.rec; d.h2(r.id + ' - ' + r.title + ' [' + r.priority + ' priority' + (r.human ? ', human review needed' : '') + (r.draft ? ', draft rule' : '') + ']'); d.kv([[r.kind, r.detected], ['Why it may matter', r.why], ['What to review', r.review], ['Related controls', r.controls.join('; ')]]); }
    });
  });
  return d.finish();
}

/* ───────── HTML report ───────── */
function htmlReport(model) {
  const e = esc; let h = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + e(model.title) + '</title><style>body{font:15px/1.5 Helvetica,Arial,sans-serif;color:#14213D;max-width:960px;margin:32px auto;padding:0 20px}h1{font-size:26px}h2{border-bottom:1px solid #C9D3E3;padding-bottom:6px;margin-top:36px}h3{margin-top:22px;color:#1F3A6E}table{border-collapse:collapse;width:100%;font-size:13px;margin:10px 0}th,td{border:1px solid #E2E7EF;padding:6px 8px;vertical-align:top;text-align:left}th{background:#F1EEE8}.note{background:#F3F5FA;border:1px solid #D5DCE8;padding:10px 12px;border-radius:6px;font-size:13px}.tag{font-size:12px;background:#FFF3D6;color:#6B4400;padding:2px 8px;border-radius:99px;margin-left:8px}</style></head><body>';
  h += '<h1>' + e(model.title) + '</h1><p>' + e(model.audit.name) + ' · ' + e(model.audit.id) + ' · ' + e(model.audit.source) + ' · Status: ' + e(model.audit.status) + '</p><div class="note">' + (model.partial ? '<b>Partial report.</b> Sections that did not run are marked; no values are invented for them. ' : '') + e(DISCLAIMER) + '</div>';
  h += '<table><tr><th>Section</th><th>Status</th><th>Note</th></tr>' + model.statuses.map(s => '<tr><td>' + e(s.title) + '</td><td>' + e(s.status) + '</td><td>' + e(s.note || '') + '</td></tr>').join('') + '</table>';
  model.sections.forEach(s => {
    h += '<h2>' + e(s.title) + (s.status !== 'Ready' ? '<span class="tag">' + e(s.status) + '</span>' : '') + '</h2>';
    s.blocks.forEach(b => {
      if (b.t === 'p') h += '<p>' + e(b.text) + '</p>'; else if (b.t === 'h') h += '<h3>' + e(b.text) + '</h3>';
      else if (b.t === 'kv') h += '<table>' + b.rows.map(r => '<tr><th style="width:28%">' + e(r[0]) + '</th><td>' + e(r[1]) + '</td></tr>').join('') + '</table>';
      else if (b.t === 'bullets') h += '<ul>' + b.items.map(i => '<li>' + e(i) + '</li>').join('') + '</ul>'; else if (b.t === 'note') h += '<div class="note">' + e(b.text) + '</div>';
      else if (b.t === 'table') h += '<table><tr>' + b.head.map(x => '<th>' + e(x) + '</th>').join('') + '</tr>' + b.rows.map(r => '<tr>' + r.map(c => '<td>' + e(c === null || c === undefined ? '' : c).replace(/\n/g, '<br>') + '</td>').join('') + '</tr>').join('') + '</table>';
      else if (b.t === 'bars') h += '<table>' + b.rows.map(r => '<tr><td style="width:30%">' + e(r.label) + '</td><td><div style="background:#EEF1F6;width:100%"><div style="background:#26324F;height:10px;width:' + (r.value === null || r.value === undefined ? 0 : Math.round(r.value * 100)) + '%"></div></div></td><td style="width:22%">' + e(r.text || '') + '</td></tr>').join('') + '</table>';
      else if (b.t === 'rec') { const r = b.rec; h += '<h3>' + e(r.id + ' — ' + r.title) + '</h3><table><tr><th style="width:28%">' + e(r.kind) + '</th><td>' + e(r.detected) + '</td></tr><tr><th>Why it may matter</th><td>' + e(r.why).replace(/\n/g, '<br>') + '</td></tr><tr><th>What to review</th><td>' + e(r.review) + '</td></tr><tr><th>Controls</th><td>' + e(r.controls.join('; ')) + '</td></tr><tr><th>Priority / reviewer</th><td>' + e(r.priority) + (r.human ? ' · human review needed' : '') + (r.draft ? ' · based on draft rule(s)' : '') + '</td></tr></table>'; }
    });
  });
  return h + '</body></html>';
}

/* ───────── bundle ───────── */
function bundle(audit, gov) {
  const model = reportModel(audit, gov); const files = [];
  files.push({ name: 'report/audit_report.pdf', data: pdfReport(model) }); files.push({ name: 'report/audit_report.html', data: htmlReport(model) });
  files.push({ name: 'data/audit_results.json', data: auditJson(audit, gov) });
  files.push({ name: 'data/results_registry.json', data: JSON.stringify(SDA.registry.forAudit(audit, gov), null, 2) });
  const T = tables(audit, gov); Object.keys(T).forEach(k => files.push({ name: 'tables/' + k, data: T[k] }));
  const P = plots(audit); Object.keys(P).forEach(k => files.push({ name: 'plots/' + k, data: P[k] }));
  files.push({ name: 'README.txt', data: 'Synthetic Data Auditor export for ' + audit.id + ' (' + audit.name + ')\nGenerated ' + new Date().toISOString() + '\n\n' + (model.partial ? 'PARTIAL: ' + model.statuses.filter(s => s.status !== 'Ready').map(s => s.title + ' (' + s.status + ')').join('; ') + '\n\n' : '') + 'report/  PDF + HTML audit report\ndata/    machine-readable JSON (full results + normalised results registry)\ntables/  CSV metric tables\nplots/   SVG plots\n\n' + DISCLAIMER + '\n' });
  return makeZip(files);
}

SDA.exp = { techRecs, reportModel, sectionStatuses, tables, auditJson, plots, makeZip, pdfReport, htmlReport, bundle, svgHBars, svgGroupedColumns, svgHeat, svgRoc, toCsv, crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
