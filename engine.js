/* Synthetic Data Auditor — computation engine (runs entirely in the browser).
   Sections: utils · csv · typing · validation · fidelity · utility · privacy · ensemble · demo data · orchestrator */
(function (g) {
'use strict';
const SDA = g.SDA = g.SDA || {};
SDA.version = '1.0.0';
SDA.engineName = 'SDA browser engine';

/* ───────────────────────── utils ───────────────────────── */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function normal(rng) { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
function shuffle(arr, rng) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
function range(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; }
function sampleIdx(n, max, rng) { if (n <= max) return range(n); const idx = shuffle(range(n), rng); return idx.slice(0, max).sort((a, b) => a - b); }
const tick = () => new Promise(r => setTimeout(r, 0));
const cancel = { flag: false };
function cancelledError() { const e = new Error('Cancelled by the user.'); e.cancelled = true; return e; }
function yielder(ms) { let t = Date.now(); const lim = ms || 25; return async function () { if (cancel.flag) throw cancelledError(); if (Date.now() - t > lim) { await tick(); t = Date.now(); if (cancel.flag) throw cancelledError(); } }; }
const mean = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : NaN; };
function std(a, m) { if (a.length < 2) return 0; m = m === undefined ? mean(a) : m; let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / (a.length - 1)); }
function quantile(sorted, q) { const n = sorted.length; if (!n) return NaN; const p = (n - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo); }
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function splitList(s) { if (Array.isArray(s)) return s; return String(s || '').split(/[,\n;]+/).map(x => x.trim()).filter(Boolean); }
SDA.cancel = cancel;
SDA.util = { mulberry32, normal, shuffle, range, sampleIdx, tick, yielder, mean, std, quantile, clamp, splitList };

const ST = { PASS: 'Pass', WARN: 'Warning', BLOCK: 'Blocked', FAIL: 'Failed', NOTRUN: 'Not Run' };
const RANK = { 'Not Run': -1, 'Pass': 0, 'Warning': 1, 'Blocked': 2, 'Failed': 3 };
const worst = arr => arr.reduce((a, b) => RANK[b] > RANK[a] ? b : a, 'Pass');
SDA.ST = ST;

/* ───────────────────────── CSV ───────────────────────── */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const n = text.length;
  // delimiter detection on first record (outside quotes)
  const cands = [',', ';', '\t', '|']; const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQ = false;
  for (let i = 0; i < Math.min(n, 30000); i++) { const c = text[i]; if (c === '"') inQ = !inQ; else if (!inQ) { if (c === '\n') break; if (counts[c] !== undefined) counts[c]++; } }
  let d = ','; let best = -1; for (const c of cands) if (counts[c] > best) { best = counts[c]; d = c; }
  const rows = []; let row = []; let i = 0; let unclosed = -1;
  while (i < n) {
    let field;
    if (text.charCodeAt(i) === 34) {
      i++; let s = ''; let seg = i;
      for (;;) {
        const j = text.indexOf('"', i);
        if (j < 0) { unclosed = rows.length + 1; s += text.slice(seg); i = n; break; }
        if (text.charCodeAt(j + 1) === 34) { s += text.slice(seg, j + 1); i = j + 2; seg = i; continue; }
        s += text.slice(seg, j); i = j + 1; break;
      }
      field = s;
      while (i < n && text[i] !== d && text[i] !== '\n' && text[i] !== '\r') { field += text[i]; i++; }
    } else {
      let j = i; while (j < n) { const ch = text[j]; if (ch === d || ch === '\n' || ch === '\r') break; j++; }
      field = text.slice(i, j); i = j;
    }
    row.push(field);
    if (i >= n) { rows.push(row); row = null; break; }
    const ch = text[i];
    if (ch === d) { i++; if (i >= n) { row.push(''); rows.push(row); row = null; break; } continue; }
    if (ch === '\r' && text[i + 1] === '\n') i += 2; else i++;
    rows.push(row); row = [];
  }
  if (row && row.length) rows.push(row);
  const clean = rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
  return { delimiter: d, rows: clean, unclosedAt: unclosed };
}

function makeDataset(name, text, size) {
  const p = parseCSV(text);
  const out = { name, size: size === undefined ? text.length : size, delimiter: p.delimiter, headers: [], cols: [], nrows: 0, ragged: 0, dupHeaders: [], blankHeaders: 0, unclosedAt: p.unclosedAt, _c: {}, _t: {} };
  if (!p.rows.length) return out;
  out.headers = p.rows[0].map(h => h.trim());
  const seen = new Set();
  out.headers.forEach(h => { if (h === '') out.blankHeaders++; if (seen.has(h)) out.dupHeaders.push(h); seen.add(h); });
  const m = out.headers.length; out.cols = out.headers.map(() => []);
  for (let r = 1; r < p.rows.length; r++) {
    const row = p.rows[r]; if (row.length !== m) out.ragged++;
    for (let j = 0; j < m; j++) out.cols[j].push(row[j] === undefined ? '' : row[j]);
  }
  out.nrows = p.rows.length - 1;
  out.idx = {}; out.headers.forEach((h, j) => { if (out.idx[h] === undefined) out.idx[h] = j; });
  return out;
}
SDA.csv = { parse: parseCSV, makeDataset };

/* ───────────────────────── typing ───────────────────────── */
const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '?', 'nil', '#n/a']);
const isMissing = s => MISSING.has(String(s).trim().toLowerCase());
const BOOLS = new Set(['true', 'false', 'yes', 'no', 't', 'f', 'y', 'n']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
SDA.missingTokens = Array.from(MISSING).filter(x => x !== '');

function colInfo(ds, name) {
  if (ds._t[name]) return ds._t[name];
  const j = ds.idx[name]; const raw = ds.cols[j]; const n = raw.length;
  let numeric = true, bool = true, date = true, nonMissing = 0, isInt = true; const distinct = new Set(); let capped = false;
  for (let i = 0; i < n; i++) {
    const v = raw[i]; if (isMissing(v)) continue; nonMissing++; const t = v.trim();
    if (numeric) { const x = +t; if (t === '' || !isFinite(x)) numeric = false; else if (isInt && !Number.isInteger(x)) isInt = false; }
    if (bool && !BOOLS.has(t.toLowerCase())) bool = false;
    if (date && !DATE_RE.test(t)) date = false;
    if (!capped) { distinct.add(t); if (distinct.size > 5000) capped = true; }
  }
  let type = nonMissing === 0 ? 'empty' : bool ? 'boolean' : numeric ? 'numerical' : date ? 'datetime' : 'categorical';
  const info = { name, type, n, missing: n - nonMissing, missingPct: n ? (n - nonMissing) / n * 100 : 0, distinct: distinct.size, distinctCapped: capped, isInt: numeric && isInt, unique: nonMissing > 0 && distinct.size === nonMissing && !capped };
  ds._t[name] = info; return info;
}
const family = t => t === 'numerical' || t === 'datetime' ? 'num' : t === 'empty' ? 'empty' : 'cat';

/* typed column for a given evaluation kind */
function colOf(ds, name, kind) {
  const key = name + '|' + kind; if (ds._c[key]) return ds._c[key];
  const raw = ds.cols[ds.idx[name]]; const n = raw.length; const info = colInfo(ds, name);
  let out;
  if (kind === 'numeric') {
    const a = new Float64Array(n);
    for (let i = 0; i < n; i++) { const v = raw[i]; if (isMissing(v)) { a[i] = NaN; continue; } a[i] = info.type === 'datetime' ? Date.parse(v.trim()) : +v.trim(); }
    out = { name, kind, num: a };
  } else {
    const a = new Array(n); const lower = info.type === 'boolean';
    for (let i = 0; i < n; i++) { const v = raw[i]; if (isMissing(v)) { a[i] = null; continue; } const t = v.trim(); a[i] = lower ? t.toLowerCase() : t; }
    out = { name, kind, cat: a };
  }
  ds._c[key] = out; return out;
}
SDA.typing = { colInfo, colOf, family, isMissing };

/* ───────────────────────── validation ───────────────────────── */
function normCfg(c) {
  c = c || {};
  return {
    target: (c.target || '').trim(), task: c.task || '',
    categorical: splitList(c.categorical), excluded: splitList(c.excluded),
    matchedOnly: !!c.matchedOnly, membershipCol: (c.membershipCol || '').trim()
  };
}
function rowHashCount(ds) {
  const seen = new Set(); let dup = 0; const m = ds.cols.length;
  for (let i = 0; i < ds.nrows; i++) { let k = ''; for (let j = 0; j < m; j++) k += ds.cols[j][i] + '\u0001'; if (seen.has(k)) dup++; else seen.add(k); }
  return dup;
}
const ID_NAME_RE = /(^|[_\s-])(id|uuid|guid|ssn|email|e-mail|phone|mobile|passport|iban|name|address)($|[_\s-])/i;

function validatePair(real, synth, cfgIn) {
  const cfg = normCfg(cfgIn); const decl = new Set(cfg.categorical); const excl = new Set(cfg.excluded);
  if (cfg.membershipCol) excl.add(cfg.membershipCol);
  const res = { ranAt: new Date().toISOString(), checks: [], schema: [], realOnly: [], synthOnly: [], missingChart: [], duplicates: {}, warnings: [], blockers: [], plan: null, orderMatch: true };
  const add = (id, label, status, summary, details) => res.checks.push({ id, label, status, summary, details: details || [] });

  // 1 · files
  let fs = 'Pass'; const fd = [];
  for (const [lab, ds] of [['Real', real], ['Synthetic', synth]]) {
    if (!ds || !ds.nrows || !ds.headers.length) { fs = 'Failed'; fd.push(lab + ': file is empty or has no header row.'); continue; }
    if (ds.dupHeaders.length) { fs = worst([fs, 'Blocked']); fd.push(lab + ': duplicate column names (' + ds.dupHeaders.slice(0, 5).join(', ') + ') make column matching ambiguous.'); }
    if (ds.blankHeaders) { fs = worst([fs, 'Blocked']); fd.push(lab + ': ' + ds.blankHeaders + ' column(s) have no name.'); }
    if (ds.ragged) { fs = worst([fs, 'Warning']); fd.push(lab + ': ' + ds.ragged + ' row(s) have a different number of fields than the header (read as-is, missing fields treated as empty; the uploaded file is not changed).'); }
    if (ds.nrows < 50) { fs = worst([fs, 'Warning']); fd.push(lab + ': only ' + ds.nrows + ' rows — most metrics are unstable at this size.'); }
    fd.push(lab + ': ' + ds.nrows.toLocaleString('en-US') + ' rows × ' + ds.headers.length + ' columns, delimiter “' + (ds.delimiter === '\t' ? 'tab' : ds.delimiter) + '”.');
  }
  add('file', 'File validation', fs, fs === 'Pass' ? 'Both files are readable, non-empty and have unique column names.' : fs === 'Failed' ? 'A file could not be read as a non-empty table.' : fd.filter(x => !/rows ×/.test(x))[0], fd);
  if (fs === 'Failed') {
    for (const [id, label] of [['schema', 'Schema compatibility'], ['types', 'Data-type compatibility'], ['missing', 'Missing-value checks'], ['dups', 'Duplicate-row checks'], ['values', 'Constant and unusual values'], ['target', 'Target / category compatibility']]) add(id, label, 'Not Run', 'Not run — file validation did not pass.');
    res.status = 'Failed'; res.canRun = false; res.blockers.push('File validation failed: nothing can be evaluated until both files are readable tables.'); return res;
  }

  // 2 · schema
  const rset = new Set(real.headers), sset = new Set(synth.headers);
  const shared = real.headers.filter(h => sset.has(h));
  res.helperCols = [];
  res.realOnly = real.headers.filter(h => !sset.has(h) && !(cfg.membershipCol && h === cfg.membershipCol && res.helperCols.push(h))); res.synthOnly = synth.headers.filter(h => !rset.has(h));
  const sOrder = synth.headers.filter(h => rset.has(h));
  res.orderMatch = shared.every((h, i) => sOrder[i] === h);
  let ss = 'Pass'; const sd = [];
  if (!shared.length) { ss = 'Blocked'; sd.push('The two files share no column names.'); }
  if (res.realOnly.length || res.synthOnly.length) {
    ss = worst([ss, cfg.matchedOnly ? 'Warning' : 'Blocked']);
    if (res.realOnly.length) sd.push('Real-only columns: ' + res.realOnly.join(', '));
    if (res.synthOnly.length) sd.push('Synthetic-only columns: ' + res.synthOnly.join(', '));
    sd.push(cfg.matchedOnly ? 'Evaluation will use shared columns only (your explicit setting). No data is modified.' : 'Metrics would not be comparable. Fix the files, or choose “evaluate shared columns only” in the Profile step (affected tests are then qualified).');
  }
  if (!res.orderMatch) { ss = worst([ss, 'Warning']); sd.push('Column order differs; columns are aligned by name, not position.'); }
  if (res.helperCols.length) sd.push('Membership-label column “' + res.helperCols[0] + '” exists only in the real file and is used by the membership attack, not as a feature.');
  add('schema', 'Schema compatibility', ss, ss === 'Pass' ? shared.length + ' columns matched by name.' : sd[0], sd.concat([shared.length + ' matched · ' + res.realOnly.length + ' real-only · ' + res.synthOnly.length + ' synthetic-only']));

  // 3 · types + per-column rows
  const mism = []; const hints = []; const plan = { evalCols: [], excluded: [], dropped: [], target: cfg.target, task: cfg.task, membershipCol: cfg.membershipCol, matchedOnly: cfg.matchedOnly };
  const catCompat = {};
  for (const name of shared) {
    const ri = colInfo(real, name), si = colInfo(synth, name);
    const notes = []; let st = 'Pass';
    const rf = family(ri.type), sf = family(si.type);
    const forcedCat = decl.has(name);
    let kind = forcedCat || rf === 'cat' || sf === 'cat' ? 'categorical' : 'numeric';
    const typeMismatch = !forcedCat && rf !== 'empty' && sf !== 'empty' && rf !== sf;
    if (typeMismatch) { mism.push(name); st = worst([st, cfg.matchedOnly ? 'Warning' : 'Blocked']); notes.push('Type mismatch (' + ri.type + ' vs ' + si.type + '). Declare it categorical, fix the file, or evaluate shared columns only.'); }
    if (ri.type === 'empty' || si.type === 'empty') { st = worst([st, 'Warning']); notes.push('Column is entirely missing in ' + (ri.type === 'empty' && si.type === 'empty' ? 'both files' : ri.type === 'empty' ? 'the real file' : 'the synthetic file') + ' — excluded from metrics.'); }
    // numeric-coded category hint
    if (!forcedCat && ri.type === 'numerical' && ri.isInt && ri.distinct <= 6 && ri.distinct > 1 && name !== cfg.target) hints.push(name);
    // missing
    const gap = Math.abs(ri.missingPct - si.missingPct);
    if (gap > 10) { st = worst([st, 'Warning']); notes.push('Missing-value rate differs by ' + gap.toFixed(1) + ' percentage points.'); }
    // categorical compatibility / range
    let compat = 'n/a (numerical)';
    if (excl.has(name)) compat = 'excluded from evaluation';
    else if (kind === 'categorical' && !typeMismatch && ri.type !== 'empty' && si.type !== 'empty') {
      const rs = new Set(colOf(real, name, 'categorical').cat.filter(x => x !== null)), ssn = new Set(colOf(synth, name, 'categorical').cat.filter(x => x !== null));
      let unseen = 0; ssn.forEach(v => { if (!rs.has(v)) unseen++; }); let absent = 0; rs.forEach(v => { if (!ssn.has(v)) absent++; });
      compat = (rs.size - absent) + '/' + rs.size + ' real categories present · ' + unseen + ' synthetic-only';
      catCompat[name] = { realCats: rs.size, synthCats: ssn.size, unseen, absent };
      if (unseen > 0) { st = worst([st, 'Warning']); notes.push(unseen + ' synthetic categor' + (unseen === 1 ? 'y is' : 'ies are') + ' not present in the real data.'); }
      else if (rs.size && absent / rs.size >= 0.1) { st = worst([st, 'Warning']); notes.push(absent + ' real categories never appear in the synthetic data.'); }
    } else if (kind === 'numeric' && !typeMismatch && ri.type === 'numerical' && si.type === 'numerical') {
      const rn = colOf(real, name, 'numeric').num, sn = colOf(synth, name, 'numeric').num;
      let mn = Infinity, mx = -Infinity; for (let i = 0; i < rn.length; i++) { const v = rn[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      let out = 0, tot = 0; for (let i = 0; i < sn.length; i++) { const v = sn[i]; if (v !== v) continue; tot++; if (v < mn || v > mx) out++; }
      compat = 'range ' + (out / (tot || 1) * 100).toFixed(1) + '% outside real min–max';
      if (tot && out / tot > 0.01) { st = worst([st, 'Warning']); notes.push((out / tot * 100).toFixed(1) + '% of synthetic values lie outside the real min–max range.'); }
    }
    if ((ri.unique && ri.type === 'categorical') || (ID_NAME_RE.test(name) && !excl.has(name) && name !== cfg.target)) {
      if (!excl.has(name)) { st = worst([st, 'Warning']); notes.push('Possible identifier — not excluded automatically. Declare it in “Identifier columns” if it should be left out.'); res.warnings.push({ id: 'ident:' + name, text: 'Column “' + name + '” looks like an identifier (name pattern or all-unique values). It was NOT excluded automatically.' }); }
    }
    const excluded = excl.has(name);
    if (excluded) notes.push('Excluded from evaluation (declared identifier / excluded feature).');
    res.schema.push({ name, realType: ri.type, synthType: si.type, missReal: round(ri.missingPct, 2), missSynth: round(si.missingPct, 2), catCompat: compat, status: st, notes, excluded, kind });
    res.missingChart.push({ name, real: round(ri.missingPct, 2), synth: round(si.missingPct, 2) });
    if (excluded) plan.excluded.push(name);
    else if (ri.type === 'empty' || si.type === 'empty') plan.dropped.push({ name, why: 'entirely missing' });
    else if (typeMismatch && cfg.matchedOnly) plan.dropped.push({ name, why: 'type mismatch' });
    else if (!typeMismatch) plan.evalCols.push({ name, kind, realType: ri.type, synthType: si.type });
  }
  res.realOnly.forEach(n => res.schema.push({ name: n, realType: colInfo(real, n).type, synthType: '—', missReal: round(colInfo(real, n).missingPct, 2), missSynth: null, catCompat: 'n/a', status: cfg.matchedOnly ? 'Warning' : 'Blocked', notes: ['Present only in the real file.'], excluded: false, kind: '' }));
  res.synthOnly.forEach(n => res.schema.push({ name: n, realType: '—', synthType: colInfo(synth, n).type, missReal: null, missSynth: round(colInfo(synth, n).missingPct, 2), catCompat: 'n/a', status: cfg.matchedOnly ? 'Warning' : 'Blocked', notes: ['Present only in the synthetic file.'], excluded: false, kind: '' }));
  const ts = mism.length ? (cfg.matchedOnly ? 'Warning' : 'Blocked') : hints.length ? 'Warning' : 'Pass';
  const td = []; if (mism.length) td.push('Type mismatches: ' + mism.join(', ')); if (hints.length) td.push('Possible numeric-coded categories (≤ 6 integer values): ' + hints.join(', ') + '. Declare them in “Categorical columns” if they are not true numbers — otherwise they are treated as continuous.');
  add('types', 'Data-type compatibility', ts, ts === 'Pass' ? 'All matched columns have compatible types.' : td[0], td);

  // 4 · missing values
  let ms = 'Pass'; const md = [];
  const bigGap = res.schema.filter(r => r.missReal !== null && r.missSynth !== null && Math.abs(r.missReal - r.missSynth) > 10);
  const heavy = res.schema.filter(r => (r.missReal || 0) > 50 || (r.missSynth || 0) > 50);
  const allMissing = res.schema.filter(r => r.realType === 'empty' || r.synthType === 'empty');
  if (bigGap.length) { ms = 'Warning'; md.push('Missing-rate gap > 10 pp: ' + bigGap.map(r => r.name).join(', ')); }
  if (heavy.length) { ms = 'Warning'; md.push('More than 50% missing in: ' + heavy.map(r => r.name).join(', ')); }
  if (allMissing.length) { ms = 'Warning'; md.push('Entirely missing: ' + allMissing.map(r => r.name).join(', ')); }
  const tm = ds => { let c = 0; for (const n of ds.headers) c += colInfo(ds, n).missing; return c; };
  const rm = tm(real), sm = tm(synth);
  md.push('Missing cells — real: ' + rm.toLocaleString('en-US') + ' (' + (rm / (real.nrows * real.headers.length) * 100).toFixed(2) + '%) · synthetic: ' + sm.toLocaleString('en-US') + ' (' + (sm / (synth.nrows * synth.headers.length) * 100).toFixed(2) + '%). Missing tokens recognised: ' + SDA.missingTokens.join(', ') + ' and empty cells.');
  res.health = { realMissingCells: rm, synthMissingCells: sm, realCells: real.nrows * real.headers.length, synthCells: synth.nrows * synth.headers.length };
  add('missing', 'Missing-value checks', ms, ms === 'Pass' ? 'Missing-value patterns are similar in both files.' : md[0], md);

  // 5 · duplicates
  const rd = rowHashCount(real), sd2 = rowHashCount(synth);
  res.duplicates = { real: { count: rd, rate: rd / real.nrows * 100 }, synth: { count: sd2, rate: sd2 / synth.nrows * 100 } };
  let ds2 = 'Pass'; const dd = [];
  if (res.duplicates.synth.rate - res.duplicates.real.rate > 1 || res.duplicates.synth.rate > 10) { ds2 = 'Warning'; dd.push('Synthetic duplicate rate (' + res.duplicates.synth.rate.toFixed(2) + '%) is notably higher than real (' + res.duplicates.real.rate.toFixed(2) + '%).'); }
  dd.push('Exact duplicate rows — real: ' + rd.toLocaleString('en-US') + ' (' + res.duplicates.real.rate.toFixed(2) + '%) · synthetic: ' + sd2.toLocaleString('en-US') + ' (' + res.duplicates.synth.rate.toFixed(2) + '%). Counted here on the inputs to this check; removal is only ever an optional, logged preparation step.');
  add('dups', 'Duplicate-row checks', ds2, ds2 === 'Pass' ? 'Duplicate-row rates are comparable.' : dd[0], dd);

  // 5b · constant columns and unusual values: flagged for review, never changed here
  const consts = [], unusual = [];
  for (const [lab, ds] of [['real', real], ['synthetic', synth]]) ds.headers.forEach(h => { const c = colInfo(ds, h); if (c.type !== 'empty' && c.distinct === 1 && !c.distinctCapped) consts.push(h + ' (' + lab + ')');
    if (c.type === 'numerical') { const a = colOf(ds, h, 'numeric').num; const sorted = Array.from(a).filter(v => v === v).sort((p, q) => p - q); if (sorted.length >= 20) { const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75), r = q3 - q1; if (r > 0) { let k = 0; sorted.forEach(v => { if (v < q1 - 3 * r || v > q3 + 3 * r) k++; }); if (k) unusual.push({ t: h + ' (' + lab + '): ' + k + ' value' + (k === 1 ? '' : 's') + ' beyond 3 × IQR', share: k / sorted.length }); } } } });
  const vd = []; if (consts.length) vd.push('Constant columns (one value only): ' + consts.join(', ') + '. They carry no information for metrics or models.');
  if (unusual.length) vd.push('Unusual values, flagged for review and not removed: ' + unusual.map(u => u.t).join('; ') + '.');
  const vs = consts.length ? 'Warning' : 'Pass';
  add('values', 'Constant and unusual values', vs, vs === 'Pass' ? (unusual.length ? 'No constant columns. Unusual values in ' + unusual.length + ' column' + (unusual.length === 1 ? '' : 's') + ' are flagged for review, not treated as errors.' : 'No constant columns and no unusual values beyond 3 × IQR.') : vd[0], vd.length ? vd : ['Unusual values are flagged with the 3 × IQR rule. They may be genuine, so nothing is changed here; use Data Cleaning to apply an explicit rule.']);

  // 6 · target
  plan.target = cfg.target; plan.task = cfg.task;
  let tst = 'Not Run'; const td2 = []; let tsum = 'No target column declared — utility evaluation will be skipped.';
  plan.targetKind = null; plan.classes = null;
  if (cfg.target) {
    tst = 'Pass';
    if (!rset.has(cfg.target) || !sset.has(cfg.target)) { tst = 'Blocked'; tsum = 'Target “' + cfg.target + '” is missing from ' + (!rset.has(cfg.target) && !sset.has(cfg.target) ? 'both files' : !rset.has(cfg.target) ? 'the real file' : 'the synthetic file') + '.'; td2.push(tsum); }
    else if (!cfg.task) { tst = 'Blocked'; tsum = 'Choose classification or regression for the target.'; td2.push(tsum); }
    else {
      const ri = colInfo(real, cfg.target), si = colInfo(synth, cfg.target);
      if (cfg.task === 'regression') {
        if (family(ri.type) !== 'num' || family(si.type) !== 'num' || ri.type === 'datetime') { tst = 'Blocked'; tsum = 'Regression needs a numerical target in both files (found ' + ri.type + ' / ' + si.type + ').'; td2.push(tsum); }
        else if (ri.distinct <= 5) { tst = 'Warning'; tsum = 'Target has only ' + ri.distinct + ' distinct values — is this really regression?'; td2.push(tsum); }
        plan.targetKind = 'numeric';
      } else {
        const rl = new Set(colOf(real, cfg.target, 'categorical').cat.filter(x => x !== null)), sl = new Set(colOf(synth, cfg.target, 'categorical').cat.filter(x => x !== null));
        plan.classes = Array.from(new Set([...rl, ...sl])).sort();
        const overlap = [...rl].filter(x => sl.has(x));
        td2.push('Real classes: ' + rl.size + ' · synthetic classes: ' + sl.size + ' · shared: ' + overlap.length);
        if (!overlap.length) { tst = 'Blocked'; tsum = 'Real and synthetic targets share no class labels.'; td2.unshift(tsum); }
        else {
          const miss = [...rl].filter(x => !sl.has(x)), extra = [...sl].filter(x => !rl.has(x));
          if (miss.length) { tst = 'Warning'; td2.push('Classes absent from synthetic data: ' + miss.slice(0, 8).join(', ')); }
          if (extra.length) { tst = 'Warning'; td2.push('Classes only in synthetic data: ' + extra.slice(0, 8).join(', ')); }
          if (rl.size > 30) { tst = 'Warning'; td2.push('More than 30 distinct target values — consider regression or check the column choice.'); }
          if (rl.size < 2) { tst = 'Blocked'; td2.unshift('Target has fewer than 2 classes in the real data.'); }
          tsum = tst === 'Pass' ? 'Target “' + cfg.target + '” exists with matching class labels in both files.' : td2[0];
        }
        plan.targetKind = 'categorical';
      }
      if (tst === 'Pass') tsum = 'Target “' + cfg.target + '” is compatible for ' + cfg.task + '.';
    }
  }
  add('target', 'Target / category compatibility', tst, tsum, td2.concat(Object.keys(catCompat).length ? [Object.keys(catCompat).length + ' categorical columns compared for category overlap (see schema table).'] : []));

  // overall
  // a target problem blocks only the utility test; the other engines can still run
  const tgtBlocked = tst === 'Blocked'; plan.utilityBlocked = tgtBlocked ? tsum : null;
  const stat = worst(res.checks.filter(c => c.status !== 'Not Run').map(c => c.id === 'target' && tgtBlocked ? 'Warning' : c.status));
  res.status = stat; res.canRun = stat !== 'Blocked' && stat !== 'Failed';
  res.checks.filter(c => (c.status === 'Blocked' && c.id !== 'target') || c.status === 'Failed').forEach(c => res.blockers.push(c.label + ': ' + c.summary));
  res.checks.filter(c => c.status === 'Warning').forEach(c => res.warnings.push({ id: c.id, text: c.label + ': ' + c.summary }));
  if (tgtBlocked) res.warnings.push({ id: 'target', text: 'Utility is blocked: ' + tsum + ' Fidelity and privacy can still run.' });
  // utility-target unusable → not a global blocker unless Blocked above
  plan.evalCols = plan.evalCols.filter(c => c.name !== cfg.membershipCol);
  res.plan = plan; res.rows = { real: real.nrows, synth: synth.nrows }; res.cols = { real: real.headers.length, synth: synth.headers.length };
  return res;
}
function round(x, d) { if (x === null || x === undefined || !isFinite(x)) return x === undefined ? null : x; const p = Math.pow(10, d); return Math.round(x * p) / p; }
SDA.util.round = round;
SDA.validate = validatePair;

/* ───────────────────────── sampling helper ───────────────────────── */
function evalFrame(real, synth, plan, seed, maxRows, extraCols) {
  const rng = mulberry32(seed || 42);
  const ri = sampleIdx(real.nrows, maxRows, rng), si = sampleIdx(synth.nrows, maxRows, rng);
  const cols = plan.evalCols.slice();
  const build = (ds, idx) => cols.map(c => { const full = colOf(ds, c.name, c.kind); const o = { name: c.name, kind: c.kind }; if (c.kind === 'numeric') { o.num = new Float64Array(idx.length); for (let k = 0; k < idx.length; k++) o.num[k] = full.num[idx[k]]; } else { o.cat = new Array(idx.length); for (let k = 0; k < idx.length; k++) o.cat[k] = full.cat[idx[k]]; } return o; });
  return { cols, real: build(real, ri), synth: build(synth, si), nReal: ri.length, nSynth: si.length, realIdx: ri, synthIdx: si, sampled: ri.length < real.nrows || si.length < synth.nrows };
}

/* ───────────────────────── fidelity ───────────────────────── */
function validNums(a) { const o = []; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v === v) o.push(v); } return Float64Array.from(o); }
function ksComplement(a, b) {
  if (!a.length || !b.length) return null;
  a = Float64Array.from(a).sort(); b = Float64Array.from(b).sort();
  let i = 0, j = 0, d = 0; const na = a.length, nb = b.length;
  while (i < na || j < nb) {
    const x = Math.min(i < na ? a[i] : Infinity, j < nb ? b[j] : Infinity);
    while (i < na && a[i] <= x) i++; while (j < nb && b[j] <= x) j++;
    d = Math.max(d, Math.abs(i / na - j / nb));
  }
  return 1 - d;
}
function freq(arr, missLabel) { const m = new Map(); for (let i = 0; i < arr.length; i++) { const k = arr[i] === null ? missLabel : arr[i]; m.set(k, (m.get(k) || 0) + 1); } return m; }
function tvComplement(a, b) {
  if (!a.length || !b.length) return null;
  const fa = freq(a, '‹missing›'), fb = freq(b, '‹missing›'); const keys = new Set([...fa.keys(), ...fb.keys()]); let s = 0;
  keys.forEach(k => { s += Math.abs((fa.get(k) || 0) / a.length - (fb.get(k) || 0) / b.length); });
  return 1 - s / 2;
}
function pearson(x, y) {
  let n = 0, sx = 0, sy = 0; for (let i = 0; i < x.length; i++) { const a = x[i], b = y[i]; if (a !== a || b !== b) continue; n++; sx += a; sy += b; }
  if (n < 3) return NaN; const mx = sx / n, my = sy / n; let cxy = 0, cxx = 0, cyy = 0;
  for (let i = 0; i < x.length; i++) { const a = x[i], b = y[i]; if (a !== a || b !== b) continue; const da = a - mx, db = b - my; cxy += da * db; cxx += da * da; cyy += db * db; }
  if (cxx === 0 || cyy === 0) return NaN; return cxy / Math.sqrt(cxx * cyy);
}
function discretize(col, lo, hi, bins) {
  const n = col.num.length, out = new Array(n); const w = (hi - lo) || 1;
  for (let i = 0; i < n; i++) { const v = col.num[i]; if (v !== v) { out[i] = null; continue; } let b = Math.floor((v - lo) / w * bins); out[i] = String(clamp(b, 0, bins - 1)); }
  return out;
}
function contingency(ca, cb) {
  // ca/cb: arrays of keys (null = row skipped)
  const m = new Map(); let n = 0;
  for (let i = 0; i < ca.length; i++) { if (ca[i] === undefined) continue; const a = ca[i], b = cb[i]; if (a === null && b === null && false) continue; const k = a + '\u0002' + b; m.set(k, (m.get(k) || 0) + 1); n++; }
  return { m, n };
}
function contingencySim(ra, rb, sa, sb) {
  const R = contingency(ra, rb), S = contingency(sa, sb); if (!R.n || !S.n) return null;
  const keys = new Set([...R.m.keys(), ...S.m.keys()]); let s = 0;
  keys.forEach(k => { s += Math.abs((R.m.get(k) || 0) / R.n - (S.m.get(k) || 0) / S.n); });
  return 1 - s / 2;
}
function fidBand(s) { return s === null ? 'Unavailable' : s >= 0.9 ? 'Close' : s >= 0.8 ? 'Moderate gap' : 'Large gap'; }
SDA.fidBand = fidBand;

async function runFidelity(real, synth, plan, opt) {
  const y = yielder(); const maxRows = opt.maxRows || 5000;
  const F = evalFrame(real, synth, plan, opt.seed, maxRows);
  const cols = F.cols; const out = { status: 'Completed', settings: { seed: opt.seed, maxRows, sampledReal: F.nReal, sampledSynth: F.nSynth, rowsReal: real.nrows, rowsSynth: synth.nrows, sampled: F.sampled, bins: 20, pairColumnCap: 40, metricNote: 'SDMetrics-style KS Complement / TV Complement / Correlation & Contingency similarity, reimplemented in JavaScript (not the SDMetrics package).' } };
  if (cols.length < 1) { return { status: 'Failed', error: 'No evaluable columns remain after exclusions.' }; }
  // column shapes + distributions + summaries
  const per = [], dists = {}, summary = [];
  for (let c = 0; c < cols.length; c++) {
    const rc = F.real[c], sc = F.synth[c], meta = cols[c]; await y();
    if (meta.kind === 'numeric') {
      const rn = validNums(rc.num), sn = validNums(sc.num); const score = ksComplement(rn, sn);
      const rs = Float64Array.from(rn).sort(), ss = Float64Array.from(sn).sort();
      const rm = mean(rn), sm = mean(sn), rsd = std(rn, rm), ssd = std(sn, sm);
      const stats = (s, m, sd) => ({ n: s.length, mean: m, std: sd, min: s[0], q25: quantile(s, .25), median: quantile(s, .5), q75: quantile(s, .75), max: s[s.length - 1] });
      summary.push({ name: meta.name, kind: 'numeric', real: rs.length ? stats(rs, rm, rsd) : null, synth: ss.length ? stats(ss, sm, ssd) : null });
      // histogram
      let lo = Infinity, hi = -Infinity; if (rs.length) { lo = Math.min(lo, rs[0]); hi = Math.max(hi, rs[rs.length - 1]); } if (ss.length) { lo = Math.min(lo, ss[0]); hi = Math.max(hi, ss[ss.length - 1]); }
      const B = 20; const rb = new Array(B).fill(0), sb = new Array(B).fill(0); const w = (hi - lo) || 1;
      rn.forEach(v => { rb[clamp(Math.floor((v - lo) / w * B), 0, B - 1)]++; }); sn.forEach(v => { sb[clamp(Math.floor((v - lo) / w * B), 0, B - 1)]++; });
      const edges = []; for (let i = 0; i <= B; i++) edges.push(lo + w * i / B);
      dists[meta.name] = { kind: 'numeric', edges, real: rb.map(x => rn.length ? x / rn.length : 0), synth: sb.map(x => sn.length ? x / sn.length : 0), nReal: rn.length, nSynth: sn.length };
      per.push({ name: meta.name, kind: 'numeric', metric: 'KS Complement', score, realMean: rm, synthMean: sm, stdDiff: rsd > 0 ? (sm - rm) / rsd : null, missReal: round((1 - rn.length / F.nReal) * 100, 2), missSynth: round((1 - sn.length / F.nSynth) * 100, 2) });
    } else {
      const score = tvComplement(rc.cat, sc.cat); const fa = freq(rc.cat, '‹missing›'), fb = freq(sc.cat, '‹missing›');
      const keys = Array.from(new Set([...fa.keys(), ...fb.keys()])).sort((a, b) => (fa.get(b) || 0) + (fb.get(b) || 0) - (fa.get(a) || 0) - (fb.get(a) || 0));
      const top = keys.slice(0, 12), rest = keys.slice(12);
      const cats = top.map(k => ({ label: k, real: (fa.get(k) || 0) / F.nReal, synth: (fb.get(k) || 0) / F.nSynth }));
      if (rest.length) cats.push({ label: 'Other (' + rest.length + ')', real: rest.reduce((s, k) => s + (fa.get(k) || 0), 0) / F.nReal, synth: rest.reduce((s, k) => s + (fb.get(k) || 0), 0) / F.nSynth });
      cats.forEach(c2 => c2.diff = Math.abs(c2.real - c2.synth));
      dists[meta.name] = { kind: 'categorical', cats, nCats: keys.length };
      const mode = ds => { let b = null, bc = -1; ds.forEach((v, k) => { if (v > bc) { bc = v; b = k; } }); return b; };
      summary.push({ name: meta.name, kind: 'categorical', real: { n: F.nReal, unique: fa.size, mode: mode(fa) }, synth: { n: F.nSynth, unique: fb.size, mode: mode(fb) } });
      per.push({ name: meta.name, kind: 'categorical', metric: 'TV Complement', score, maxCatDiff: Math.max.apply(null, cats.map(c2 => c2.diff)), missReal: round((fa.get('‹missing›') || 0) / F.nReal * 100, 2), missSynth: round((fb.get('‹missing›') || 0) / F.nSynth * 100, 2) });
    }
  }
  per.forEach(p => p.band = fidBand(p.score));
  const shapesVals = per.map(p => p.score).filter(v => v !== null);
  const columnShapes = shapesVals.length ? mean(shapesVals) : null;

  // correlation (numeric columns only)
  const numIdx = []; cols.forEach((c, i) => { if (c.kind === 'numeric' && colInfo(real, c.name).type === 'numerical') numIdx.push(i); });
  const k = numIdx.length; const names = numIdx.map(i => cols[i].name);
  const RC = [], SC = [], DC = [];
  for (let a = 0; a < k; a++) { RC.push(new Array(k).fill(null)); SC.push(new Array(k).fill(null)); DC.push(new Array(k).fill(null)); }
  const top = []; let dsum = 0, dcnt = 0;
  for (let a = 0; a < k; a++) {
    RC[a][a] = 1; SC[a][a] = 1; DC[a][a] = 0;
    for (let b = a + 1; b < k; b++) {
      await y();
      const r = pearson(F.real[numIdx[a]].num, F.real[numIdx[b]].num), s = pearson(F.synth[numIdx[a]].num, F.synth[numIdx[b]].num);
      const rv = r === r ? r : null, sv = s === s ? s : null; RC[a][b] = RC[b][a] = rv; SC[a][b] = SC[b][a] = sv;
      if (rv !== null && sv !== null) { const d = Math.abs(rv - sv); DC[a][b] = DC[b][a] = d; dsum += d; dcnt++; top.push({ a: names[a], b: names[b], real: rv, synth: sv, diff: d }); }
    }
  }
  top.sort((p, q) => q.diff - p.diff);
  const avgCorrDiff = dcnt ? dsum / dcnt : null;
  // choose up to 14 columns for the heatmap: highest mean diff first (keeps readable)
  let heatIdx = range(k);
  if (k > 14) { const sc = heatIdx.map(a => { let s = 0, n = 0; for (let b = 0; b < k; b++) if (DC[a][b] !== null && a !== b) { s += DC[a][b]; n++; } return n ? s / n : 0; }); heatIdx = heatIdx.sort((p, q) => sc[q] - sc[p]).slice(0, 14).sort((p, q) => p - q); }
  const pick = M => heatIdx.map(a => heatIdx.map(b => M[a][b]));
  out.corr = { cols: heatIdx.map(i => names[i]), real: pick(RC), synth: pick(SC), diff: pick(DC), topDiffs: top.slice(0, 15), totalColumns: k, pairsCompared: dcnt, truncated: k > 14 };

  // pair trends (cap 40 columns)
  const pc = cols.slice(0, 40).map((c, i) => i); const pairs = []; let psum = 0, pcnt = 0;
  const disc = {}; // per column discretised arrays
  function keyArr(side, i) {
    const c = cols[i], key = side + i; if (disc[key]) return disc[key];
    let arr;
    if (c.kind === 'categorical') { const src = (side === 'r' ? F.real : F.synth)[i].cat; arr = src.map(v => v === null ? '‹missing›' : v); }
    else { const rn = validNums(F.real[i].num); let lo = Infinity, hi = -Infinity; for (let q = 0; q < rn.length; q++) { if (rn[q] < lo) lo = rn[q]; if (rn[q] > hi) hi = rn[q]; } arr = discretize((side === 'r' ? F.real : F.synth)[i], lo, hi, 10); }
    disc[key] = arr; return arr;
  }
  for (let a = 0; a < pc.length; a++) for (let b = a + 1; b < pc.length; b++) {
    await y(); const ia = pc[a], ib = pc[b]; let score, type;
    if (cols[ia].kind === 'numeric' && cols[ib].kind === 'numeric' && colInfo(real, cols[ia].name).type === 'numerical' && colInfo(real, cols[ib].name).type === 'numerical') {
      const r = pearson(F.real[ia].num, F.real[ib].num), s = pearson(F.synth[ia].num, F.synth[ib].num); type = 'Correlation similarity';
      score = (r === r && s === s) ? 1 - Math.abs(r - s) / 2 : null;
    } else { type = 'Contingency similarity'; score = contingencySim(keyArr('r', ia), keyArr('r', ib), keyArr('s', ia), keyArr('s', ib)); }
    pairs.push({ a: cols[ia].name, b: cols[ib].name, type, score });
    if (score !== null) { psum += score; pcnt++; }
  }
  const pairTrends = pcnt ? psum / pcnt : null;
  const overall = columnShapes !== null && pairTrends !== null ? (columnShapes + pairTrends) / 2 : null;
  pairs.sort((p, q) => (p.score === null ? 2 : p.score) - (q.score === null ? 2 : q.score));
  out.columnShapes = columnShapes; out.pairTrends = pairTrends; out.overall = overall; out.avgCorrDiff = avgCorrDiff;
  out.pairTrendsNote = pairTrends === null ? 'Needs at least two evaluable columns.' : (cols.length > 40 ? 'Computed on the first 40 evaluable columns.' : '');
  out.corrNote = k < 2 ? 'Fewer than two numerical (non-categorical) columns — correlation analysis is unavailable.' : '';
  out.perColumn = per; out.pairs = pairs; out.dists = dists; out.summary = summary;
  out.health = { missingRealPct: round(per.reduce((s, p) => s + p.missReal, 0) / per.length, 2), missingSynthPct: round(per.reduce((s, p) => s + p.missSynth, 0) / per.length, 2) };
  out.columnsEvaluated = cols.map(c => c.name); out.categoricalAsNumeric = [];
  return out;
}
SDA.fidelity = { run: runFidelity, ksComplement, tvComplement, pearson };

/* ───────────────────────── ML primitives ───────────────────────── */
function buildEncoder(cols, rows) {
  const parts = [];
  for (const c of cols) {
    if (c.kind === 'numeric') {
      const v = []; for (const r of rows) { const x = c.num[r]; if (x === x) v.push(x); }
      v.sort((a, b) => a - b); const med = v.length ? quantile(v, .5) : 0; const m = v.length ? mean(v) : 0; const sd = std(v, m) || 1;
      parts.push({ name: c.name, kind: 'numeric', med, m, sd });
    } else {
      const f = new Map(); for (const r of rows) { const k = c.cat[r] === null ? '‹missing›' : c.cat[r]; f.set(k, (f.get(k) || 0) + 1); }
      const cats = Array.from(f.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15).map(e => e[0]);
      parts.push({ name: c.name, kind: 'categorical', cats, map: new Map(cats.map((k, i) => [k, i])) });
    }
  }
  let d = 0; parts.forEach(p => { p.off = d; d += p.kind === 'numeric' ? 1 : p.cats.length; });
  return { parts, d };
}
function encode(enc, cols, rows) {
  const n = rows.length, d = enc.d; const X = new Float64Array(n * d);
  enc.parts.forEach((p, ci) => {
    const c = cols[ci];
    for (let r = 0; r < n; r++) {
      const row = rows[r];
      if (p.kind === 'numeric') { let x = c.num[row]; if (x !== x) x = p.med; X[r * d + p.off] = (x - p.m) / p.sd; }
      else { const k = c.cat[row] === null ? '‹missing›' : c.cat[row]; const j = p.map.get(k); if (j !== undefined) X[r * d + p.off + j] = 1; }
    }
  });
  return X;
}
function trainLogReg(X, n, d, y, k, opt) {
  const W = new Float64Array(d * k), b = new Float64Array(k); const mW = new Float64Array(d * k), vW = new Float64Array(d * k), mb = new Float64Array(k), vb = new Float64Array(k);
  const gW = new Float64Array(d * k), gb = new Float64Array(k), z = new Float64Array(k); const lr = opt.lr || 0.05, l2 = opt.l2 || 1e-3, E = opt.epochs || 200;
  for (let ep = 1; ep <= E; ep++) {
    gW.fill(0); gb.fill(0);
    for (let i = 0; i < n; i++) {
      const o = i * d; let mx = -Infinity;
      for (let c = 0; c < k; c++) { let s = b[c]; for (let j = 0; j < d; j++) s += X[o + j] * W[j * k + c]; z[c] = s; if (s > mx) mx = s; }
      let sum = 0; for (let c = 0; c < k; c++) { z[c] = Math.exp(z[c] - mx); sum += z[c]; }
      for (let c = 0; c < k; c++) { const e = z[c] / sum - (y[i] === c ? 1 : 0); gb[c] += e; for (let j = 0; j < d; j++) gW[j * k + c] += X[o + j] * e; }
    }
    const b1 = 0.9, b2 = 0.999, t1 = 1 - Math.pow(b1, ep), t2 = 1 - Math.pow(b2, ep);
    for (let q = 0; q < d * k; q++) { const g = gW[q] / n + l2 * W[q]; mW[q] = b1 * mW[q] + (1 - b1) * g; vW[q] = b2 * vW[q] + (1 - b2) * g * g; W[q] -= lr * (mW[q] / t1) / (Math.sqrt(vW[q] / t2) + 1e-8); }
    for (let c = 0; c < k; c++) { const g = gb[c] / n; mb[c] = b1 * mb[c] + (1 - b1) * g; vb[c] = b2 * vb[c] + (1 - b2) * g * g; b[c] -= lr * (mb[c] / t1) / (Math.sqrt(vb[c] / t2) + 1e-8); }
  }
  return { W, b, d, k, predict(Xt, nt) {
    const P = new Float64Array(nt * k), zz = new Float64Array(k);
    for (let i = 0; i < nt; i++) { const o = i * d; let mx = -Infinity; for (let c = 0; c < k; c++) { let s = b[c]; for (let j = 0; j < d; j++) s += Xt[o + j] * W[j * k + c]; zz[c] = s; if (s > mx) mx = s; } let sum = 0; for (let c = 0; c < k; c++) { zz[c] = Math.exp(zz[c] - mx); sum += zz[c]; } for (let c = 0; c < k; c++) P[i * k + c] = zz[c] / sum; }
    return P; } };
}
function solveSPD(A, b, n) { // Cholesky, A is n×n row-major
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = A[i * n + j]; for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k]; if (i === j) L[i * n + i] = Math.sqrt(Math.max(s, 1e-12)); else L[i * n + j] = s / L[j * n + j]; }
  const z = new Float64Array(n); for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * z[k]; z[i] = s / L[i * n + i]; }
  const x = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let s = z[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
}
function trainRidge(X, n, d, y, lam) {
  const D = d + 1; const A = new Float64Array(D * D), bv = new Float64Array(D);
  for (let i = 0; i < n; i++) { const o = i * d; for (let p = 0; p < D; p++) { const xp = p < d ? X[o + p] : 1; bv[p] += xp * y[i]; for (let q = 0; q <= p; q++) A[p * D + q] += xp * (q < d ? X[o + q] : 1); } }
  for (let p = 0; p < D; p++) { for (let q = p + 1; q < D; q++) A[p * D + q] = A[q * D + p]; if (p < d) A[p * D + p] += lam; }
  const w = solveSPD(A, bv, D);
  return { predict(Xt, nt) { const o = new Float64Array(nt); for (let i = 0; i < nt; i++) { let s = w[d]; for (let j = 0; j < d; j++) s += Xt[i * d + j] * w[j]; o[i] = s; } return o; } };
}
/* histogram-based random forest (classification: gini, regression: variance) */
function binMatrix(X, n, d, NB) {
  const edges = [], B = new Uint8Array(n * d);
  for (let j = 0; j < d; j++) {
    const col = new Float64Array(n); for (let i = 0; i < n; i++) col[i] = X[i * d + j]; col.sort();
    const e = []; for (let q = 1; q < NB; q++) { const v = col[Math.min(n - 1, Math.floor(q * n / NB))]; if (!e.length || v > e[e.length - 1]) e.push(v); }
    // drop an edge equal to the max (would create an empty bin)
    while (e.length && e[e.length - 1] >= col[n - 1]) e.pop();
    edges.push(e);
    for (let i = 0; i < n; i++) B[i * d + j] = binOf(e, X[i * d + j]);
  }
  return { edges, B };
}
function binOf(e, x) { let lo = 0, hi = e.length; while (lo < hi) { const m = (lo + hi) >> 1; if (x > e[m]) lo = m + 1; else hi = m; } return lo; }
function applyBins(edges, X, n, d) { const B = new Uint8Array(n * d); for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) B[i * d + j] = binOf(edges[j], X[i * d + j]); return B; }
function trainForest(X, n, d, y, k, opt) {
  const NB = 32; const rng = mulberry32(opt.seed || 1); const { edges, B } = binMatrix(X, n, d, NB);
  const reg = opt.regression; const nTrees = opt.nTrees || 30, maxDepth = opt.maxDepth || 10, minLeaf = opt.minLeaf || 5; const mtry = Math.max(1, Math.round(opt.mtry || Math.sqrt(d)));
  const trees = [];
  const hist = new Float64Array(NB * (reg ? 3 : k)); const feats = range(d);
  for (let t = 0; t < nTrees; t++) {
    const boot = new Int32Array(n); for (let i = 0; i < n; i++) boot[i] = Math.floor(rng() * n);
    const T = { f: [], thr: [], l: [], r: [], v: [] };
    const stack = [{ idx: boot, depth: 0, node: 0 }]; T.f.push(-1); T.thr.push(0); T.l.push(-1); T.r.push(-1); T.v.push(null);
    while (stack.length) {
      const { idx, depth, node } = stack.pop(); const m = idx.length;
      // node value
      let val;
      if (reg) { let s = 0; for (let i = 0; i < m; i++) s += y[idx[i]]; val = s / m; } else { val = new Float64Array(k); for (let i = 0; i < m; i++) val[y[idx[i]]]++; for (let c = 0; c < k; c++) val[c] /= m; }
      T.v[node] = val;
      let pure = false; if (!reg) { for (let c = 0; c < k; c++) if (val[c] === 1) pure = true; }
      if (depth >= maxDepth || m < 2 * minLeaf || pure) continue;
      shuffle(feats, rng); let bestGain = 0, bestF = -1, bestT = -1;
      // parent impurity
      let parent;
      if (reg) { let s = 0, ss = 0; for (let i = 0; i < m; i++) { s += y[idx[i]]; ss += y[idx[i]] * y[idx[i]]; } parent = s * s / m; }
      else { parent = 0; for (let c = 0; c < k; c++) parent += val[c] * val[c]; }
      for (let q = 0; q < mtry; q++) {
        const f = feats[q]; const ne = edges[f].length; if (!ne) continue; hist.fill(0);
        if (reg) { for (let i = 0; i < m; i++) { const r = idx[i], b = B[r * d + f]; hist[b * 3] += 1; hist[b * 3 + 1] += y[r]; } let tn = 0, ts = 0; for (let b = 0; b <= ne; b++) { tn += hist[b * 3]; ts += hist[b * 3 + 1]; } let ln = 0, ls = 0; for (let b = 0; b < ne; b++) { ln += hist[b * 3]; ls += hist[b * 3 + 1]; const rn = tn - ln; if (ln < minLeaf || rn < minLeaf) continue; const gain = (ls * ls / ln + (ts - ls) * (ts - ls) / rn) - ts * ts / tn; if (gain > bestGain) { bestGain = gain; bestF = f; bestT = b; } } }
        else { for (let i = 0; i < m; i++) { const r = idx[i]; hist[B[r * d + f] * k + y[r]]++; } const lc = new Float64Array(k), tc = new Float64Array(k); for (let b = 0; b <= ne; b++) for (let c = 0; c < k; c++) tc[c] += hist[b * k + c]; let ln = 0; for (let b = 0; b < ne; b++) { let ls2 = 0, rs2 = 0; ln = 0; for (let c = 0; c < k; c++) { lc[c] += hist[b * k + c]; ln += lc[c]; } const rn = m - ln; if (ln < minLeaf || rn < minLeaf) continue; for (let c = 0; c < k; c++) { ls2 += lc[c] * lc[c]; const rc = tc[c] - lc[c]; rs2 += rc * rc; } const gain = (ls2 / ln + rs2 / rn) - parent * m; if (gain > bestGain) { bestGain = gain; bestF = f; bestT = b; } } }
      }
      if (bestF < 0 || bestGain <= 1e-12) continue;
      const li = [], ri = []; for (let i = 0; i < m; i++) { const r = idx[i]; if (B[r * d + bestF] <= bestT) li.push(r); else ri.push(r); }
      if (!li.length || !ri.length) continue;
      T.f[node] = bestF; T.thr[node] = bestT;
      const L = T.f.length; T.f.push(-1); T.thr.push(0); T.l.push(-1); T.r.push(-1); T.v.push(null);
      const R = T.f.length; T.f.push(-1); T.thr.push(0); T.l.push(-1); T.r.push(-1); T.v.push(null);
      T.l[node] = L; T.r[node] = R;
      stack.push({ idx: Int32Array.from(li), depth: depth + 1, node: L }, { idx: Int32Array.from(ri), depth: depth + 1, node: R });
    }
    trees.push(T);
  }
  return { predict(Xt, nt) {
    const Bt = applyBins(edges, Xt, nt, d);
    if (reg) { const o = new Float64Array(nt); for (let i = 0; i < nt; i++) { let s = 0; for (const T of trees) { let nd = 0; while (T.l[nd] >= 0) nd = Bt[i * d + T.f[nd]] <= T.thr[nd] ? T.l[nd] : T.r[nd]; s += T.v[nd]; } o[i] = s / trees.length; } return o; }
    const P = new Float64Array(nt * k); for (let i = 0; i < nt; i++) { for (const T of trees) { let nd = 0; while (T.l[nd] >= 0) nd = Bt[i * d + T.f[nd]] <= T.thr[nd] ? T.l[nd] : T.r[nd]; const v = T.v[nd]; for (let c = 0; c < k; c++) P[i * k + c] += v[c] / trees.length; } }
    return P; } };
}
function aucBinary(scores, pos) { // pos: 1 = positive
  const n = scores.length; const idx = range(n).sort((a, b) => scores[a] - scores[b]); let rankSum = 0, nPos = 0; let i = 0;
  while (i < n) { let j = i; while (j + 1 < n && scores[idx[j + 1]] === scores[idx[i]]) j++; const avg = (i + j) / 2 + 1; for (let q = i; q <= j; q++) if (pos[idx[q]]) { rankSum += avg; nPos++; } i = j + 1; }
  const nNeg = n - nPos; if (!nPos || !nNeg) return null; return (rankSum - nPos * (nPos + 1) / 2) / (nPos * nNeg);
}
SDA.ml = { aucBinary };

function classMetrics(yTrue, P, k, labels) {
  const n = yTrue.length; const pred = new Int32Array(n);
  for (let i = 0; i < n; i++) { let b = 0, bv = -1; for (let c = 0; c < k; c++) { const v = P[i * k + c]; if (v > bv) { bv = v; b = c; } } pred[i] = b; }
  const cm = Array.from({ length: k }, () => new Array(k).fill(0)); let ok = 0;
  for (let i = 0; i < n; i++) { cm[yTrue[i]][pred[i]]++; if (yTrue[i] === pred[i]) ok++; }
  const per = labels.map((lab, c) => { let tp = cm[c][c], fp = 0, fn = 0; for (let q = 0; q < k; q++) { if (q !== c) { fp += cm[q][c]; fn += cm[c][q]; } } const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0; return { label: lab, precision: p, recall: r, f1: p + r ? 2 * p * r / (p + r) : 0, support: tp + fn }; });
  const present = per.filter(p => p.support > 0); const macro = key => present.length ? mean(present.map(p => p[key])) : null;
  const totalSupport = present.reduce((s, p) => s + p.support, 0);
  const wf1 = totalSupport ? present.reduce((s, p) => s + p.f1 * p.support, 0) / totalSupport : null;
  // ROC-AUC
  let auc = null;
  if (present.length >= 2) {
    if (k === 2 || present.length === 2) {
      const c = present.length === 2 && k > 2 ? labels.indexOf(present[1].label) : 1; const sc = new Float64Array(n), pos = new Uint8Array(n); for (let i = 0; i < n; i++) { sc[i] = P[i * k + c]; pos[i] = yTrue[i] === c ? 1 : 0; } auc = aucBinary(sc, pos);
    } else { const as = []; for (const p of present) { const c = labels.indexOf(p.label); const sc = new Float64Array(n), pos = new Uint8Array(n); for (let i = 0; i < n; i++) { sc[i] = P[i * k + c]; pos[i] = yTrue[i] === c ? 1 : 0; } const a = aucBinary(sc, pos); if (a !== null) as.push(a); } auc = as.length ? mean(as) : null; }
  }
  return { metrics: { accuracy: ok / n, precision: macro('precision'), recall: macro('recall'), f1: macro('f1'), weightedF1: wf1, rocAuc: auc }, confusion: cm, perClass: per };
}
function regMetrics(yTrue, pred) {
  const n = yTrue.length; let se = 0, ae = 0, my = mean(yTrue), tot = 0;
  for (let i = 0; i < n; i++) { const e = yTrue[i] - pred[i]; se += e * e; ae += Math.abs(e); tot += (yTrue[i] - my) * (yTrue[i] - my); }
  return { rmse: Math.sqrt(se / n), mae: ae / n, r2: tot > 0 ? 1 - se / tot : null };
}
const METRIC_META = {
  accuracy: { label: 'Accuracy', dir: 'higher', unit: '', task: 'classification' }, precision: { label: 'Precision (macro)', dir: 'higher', task: 'classification' },
  recall: { label: 'Recall (macro)', dir: 'higher', task: 'classification' }, f1: { label: 'F1 (macro)', dir: 'higher', task: 'classification' },
  weightedF1: { label: 'F1 (weighted)', dir: 'higher', task: 'classification' }, rocAuc: { label: 'ROC-AUC', dir: 'higher', task: 'classification' },
  rmse: { label: 'RMSE', dir: 'lower', task: 'regression' }, mae: { label: 'MAE', dir: 'lower', task: 'regression' }, r2: { label: 'R²', dir: 'higher', task: 'regression' }
};
SDA.metricMeta = METRIC_META;
function retention(metric, tr, ts) {
  const m = METRIC_META[metric]; if (tr === null || ts === null || tr === undefined || ts === undefined) return { value: null, formula: '', note: 'Metric unavailable for one protocol.' };
  if (m.dir === 'higher') { if (tr <= 0) return { value: null, formula: 'TSTR ÷ TRTR × 100', note: 'TRTR ≤ 0 — ratio is not meaningful.' }; return { value: ts / tr * 100, formula: 'TSTR ÷ TRTR × 100', note: '' }; }
  if (ts <= 0) return { value: null, formula: 'TRTR ÷ TSTR × 100', note: 'TSTR is 0 — ratio undefined.' };
  return { value: tr / ts * 100, formula: 'TRTR ÷ TSTR × 100', note: '' };
}

async function runUtility(real, synth, plan, opt) {
  const y = yielder(); const seed = opt.seed || 42; const rng = mulberry32(seed); const reg = plan.task === 'regression';
  const quick = opt.mode !== 'full'; const capN = opt.maxRows || (quick ? 4000 : 20000);
  const feats = plan.evalCols.filter(c => c.name !== plan.target && c.name !== plan.membershipCol);
  if (!plan.target) return { status: 'Not Run', reason: 'No target column declared.' };
  if (!feats.length) return { status: 'Failed', error: 'No feature columns remain after excluding the target and identifiers.' };
  const tKind = reg ? 'numeric' : 'categorical';
  const rt = colOf(real, plan.target, tKind), st = colOf(synth, plan.target, tKind);
  const rcols = feats.map(c => colOf(real, c.name, c.kind)), scols = feats.map(c => colOf(synth, c.name, c.kind));
  // rows with a usable target (recorded, not silently dropped)
  const validR = [], validS = [];
  for (let i = 0; i < real.nrows; i++) if (reg ? rt.num[i] === rt.num[i] : rt.cat[i] !== null) validR.push(i);
  for (let i = 0; i < synth.nrows; i++) if (reg ? st.num[i] === st.num[i] : st.cat[i] !== null) validS.push(i);
  const missingTargetReal = real.nrows - validR.length, missingTargetSynth = synth.nrows - validS.length;
  if (validR.length < 40 || validS.length < 20) return { status: 'Failed', error: 'Too few rows with a usable target (' + validR.length + ' real, ' + validS.length + ' synthetic).' };
  // sample, split
  shuffle(validR, rng); const R = validR.slice(0, capN);
  let tr = [], te = [];
  const testFrac = opt.testSize || 0.3;
  if (!reg) {
    const groups = new Map(); R.forEach(i => { const k = rt.cat[i]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    groups.forEach(arr => { shuffle(arr, rng); const nt = Math.max(arr.length > 1 ? 1 : 0, Math.round(arr.length * testFrac)); te.push(...arr.slice(0, nt)); tr.push(...arr.slice(nt)); });
  } else { const nt = Math.round(R.length * testFrac); te = R.slice(0, nt); tr = R.slice(nt); }
  shuffle(validS, rng); const S = validS.slice(0, Math.max(tr.length, 100)).slice(0, capN);
  let labels = null, yR = null, yS = null, k = 0;
  if (!reg) {
    labels = plan.classes ? plan.classes.slice() : Array.from(new Set([...R.map(i => rt.cat[i]), ...S.map(i => st.cat[i])])).sort(); k = labels.length;
    const li = new Map(labels.map((l, i) => [l, i])); yR = i => li.get(rt.cat[i]); yS = i => li.get(st.cat[i]);
  }
  const target = (idx, which) => { const a = reg ? new Float64Array(idx.length) : new Int32Array(idx.length); idx.forEach((i, q) => { a[q] = reg ? (which === 'r' ? rt.num[i] : st.num[i]) : (which === 'r' ? yR(i) : yS(i)); }); return a; };
  const yTr = target(tr, 'r'), yTe = target(te, 'r'), yStr = target(S, 's');
  const modelKind = opt.model || 'linear';
  const encR = buildEncoder(rcols, tr), encS = buildEncoder(scols, S);
  const XtrR = encode(encR, rcols, tr), XteR = encode(encR, rcols, te);
  const XtrS = encode(encS, scols, S), XteS = encode(encS, rcols, te); // synthetic-fit encoder applied to the same real test rows
  const epochs = quick ? 120 : 300; const trees = quick ? 25 : 60;
  async function fit(Xtr, ytr, nTr, enc, Xte, tag) {
    await y(); await tick();
    let model;
    if (modelKind === 'forest') model = trainForest(Xtr, nTr, enc.d, ytr, k, { regression: reg, nTrees: trees, maxDepth: 10, minLeaf: 5, seed: seed + (tag === 'r' ? 1 : 2) });
    else model = reg ? trainRidge(Xtr, nTr, enc.d, ytr, 1.0) : trainLogReg(Xtr, nTr, enc.d, ytr, k, { epochs, lr: 0.05, l2: 1e-3 });
    return model.predict(Xte, te.length);
  }
  const predR = await fit(XtrR, yTr, tr.length, encR, XteR, 'r');
  const predS = await fit(XtrS, yStr, S.length, encS, XteS, 's');
  const res = { status: 'Completed', task: plan.task, target: plan.target, model: modelKind === 'forest' ? 'Random forest (histogram-based, ' + trees + ' trees, depth ≤ 10)' : reg ? 'Ridge regression (λ = 1)' : 'Multinomial logistic regression (L2, Adam, ' + epochs + ' epochs)', modelKey: modelKind,
    split: { testFraction: testFrac, realTrain: tr.length, realTest: te.length, synthTrain: S.length, stratified: !reg }, seed, preprocessing: 'Preprocessing is fit on each training set only: numerical → median-impute + z-score; categorical → one-hot (top 15 categories + missing). Same held-out real test rows for TRTR and TSTR.',
    features: feats.map(f => f.name), featureCount: feats.length, encodedFeatures: encR.d, excludedFromFeatures: plan.excluded, rowsMissingTarget: { real: missingTargetReal, synth: missingTargetSynth }, sampled: R.length < validR.length || S.length < validS.length };
  if (!reg) {
    const a = classMetrics(yTe, predR, k, labels), b = classMetrics(yTe, predS, k, labels);
    res.labels = labels; res.trtr = a.metrics; res.tstr = b.metrics; res.confusion = { trtr: a.confusion, tstr: b.confusion }; res.perClass = { trtr: a.perClass, tstr: b.perClass };
    const cnt = new Array(k).fill(0); yTe.forEach(v => cnt[v]++); res.majorityBaseline = Math.max.apply(null, cnt) / yTe.length; res.testClassCounts = labels.map((l, i) => ({ label: l, n: cnt[i] }));
    res.primary = opt.primary && METRIC_META[opt.primary] && METRIC_META[opt.primary].task === 'classification' ? opt.primary : 'accuracy';
    res.metricKeys = ['accuracy', 'precision', 'recall', 'f1', 'weightedF1', 'rocAuc'];
  } else {
    res.trtr = regMetrics(yTe, predR); res.tstr = regMetrics(yTe, predS);
    const cap = Math.min(300, te.length); const step = Math.max(1, Math.floor(te.length / cap)); const sc = [];
    for (let i = 0; i < te.length; i += step) sc.push([yTe[i], predR[i], predS[i]]);
    res.scatter = sc; res.testStd = std(yTe);
    res.primary = opt.primary && METRIC_META[opt.primary] && METRIC_META[opt.primary].task === 'regression' ? opt.primary : 'rmse';
    res.metricKeys = ['rmse', 'mae', 'r2'];
  }
  res.retention = {}; res.metricKeys.forEach(m => { res.retention[m] = retention(m, res.trtr[m], res.tstr[m]); });
  res.warnings = utilityDiagnostics(res, { real, rt, rcols, feats, tr, te, S, reg, labels, yTe, plan });
  res.splitStrategy = reg ? 'Random hold-out of real rows with a usable target (' + Math.round(testFrac * 100) + '% test), seed ' + seed : 'Stratified hold-out of real rows by class (' + Math.round(testFrac * 100) + '% test), seed ' + seed;
  res.retentionFormula = METRIC_META[res.primary].dir === 'higher' ? 'TSTR ÷ TRTR × 100 (higher-is-better metric)' : 'TRTR ÷ TSTR × 100 (error metric, lower is better)';
  res.headline = { metric: res.primary, trtr: res.trtr[res.primary], tstr: res.tstr[res.primary], retention: res.retention[res.primary].value, direction: METRIC_META[res.primary].dir };
  return res;
}
function utilityDiagnostics(res, c) {
  const W = []; const push = (id, level, text) => W.push({ id, level, text });
  if (!c.reg) {
    const cnt = new Map(); c.tr.forEach(i => { const k = c.rt.cat[i]; cnt.set(k, (cnt.get(k) || 0) + 1); });
    let minK = null, minN = Infinity; cnt.forEach((n, k) => { if (n < minN) { minN = n; minK = k; } });
    const share = minN / c.tr.length * 100;
    if (share < 10) push('imbalance', 'warn', 'Class imbalance: the smallest class “' + minK + '” is ' + share.toFixed(1) + '% of real training rows. Accuracy can look good while that class is missed; F1 (macro) or ROC-AUC is the safer headline.');
    if (c.labels.length > 20) push('cardinality', 'warn', 'High-cardinality target: ' + c.labels.length + ' classes. Per-class estimates are thin; check that this column is the intended target.');
    const se = Math.sqrt(Math.max(1e-9, res.trtr.accuracy * (1 - res.trtr.accuracy)) / c.te.length);
    push('uncertainty', 1.96 * se > 0.03 ? 'warn' : 'info', 'Test-set uncertainty: accuracy is measured on ' + c.te.length + ' real rows, so it carries roughly ±' + (1.96 * se).toFixed(3) + ' (95%) sampling noise. Retention differences smaller than this are not meaningful.');
    if (res.trtr.accuracy !== null && res.majorityBaseline !== undefined && res.trtr.accuracy <= res.majorityBaseline + 0.01) push('weak', 'warn', 'The real-trained model barely beats always predicting the majority class (' + (res.majorityBaseline * 100).toFixed(1) + '%). Retention against a weak baseline says little about utility.');
  } else if (c.te.length < 100) push('uncertainty', 'warn', 'Only ' + c.te.length + ' real test rows: regression errors are unstable at this size.');
  if (c.tr.length < 300) push('small', 'warn', 'Small training set: ' + c.tr.length + ' real rows. Model scores and the retention ratio can swing with the seed.');
  // leakage: a single feature that almost determines the target on the real rows
  const n = c.tr.length;
  c.feats.forEach((f, j) => {
    const col = c.rcols[j]; let flag = false, how = '';
    if (!c.reg) {
      const key = i => f.kind === 'categorical' ? col.cat[i] : col.num[i] === col.num[i] ? col.num[i] : null;
      const groups = new Map(); c.tr.forEach(i => { const v = key(i); if (v === null) return; let g = groups.get(v); if (!g) { g = new Map(); groups.set(v, g); } const t = c.rt.cat[i]; g.set(t, (g.get(t) || 0) + 1); });
      if (groups.size > 1 && groups.size < n / 2) { let hit = 0, tot = 0; groups.forEach(g => { let mx = 0, s = 0; g.forEach(v => { s += v; if (v > mx) mx = v; }); hit += mx; tot += s; }); if (tot && hit / tot >= 0.98) { flag = true; how = 'alone predicts the target for ' + (hit / tot * 100).toFixed(1) + '% of real training rows'; } }
    } else if (f.kind === 'numeric' && c.reg) {
      const xs = [], ys = []; c.tr.forEach(i => { const a = col.num[i], b = c.rt.num[i]; if (a === a && b === b) { xs.push(a); ys.push(b); } });
      const r = xs.length > 10 ? pearson(xs, ys) : null; if (r !== null && Math.abs(r) >= 0.98) { flag = true; how = 'has a correlation of ' + r.toFixed(3) + ' with the target'; }
    }
    if (!flag && f.name.toLowerCase() !== c.plan.target.toLowerCase() && f.name.toLowerCase().indexOf(c.plan.target.toLowerCase()) >= 0 && c.plan.target.length >= 3) { flag = true; how = 'has a name derived from the target'; }
    if (flag) push('leakage:' + f.name, 'warn', 'Possible target leakage: “' + f.name + '” ' + how + '. If it is computed from, or recorded after, the target, exclude it in the Profile step and re-run.');
  });
  return W;
}
function suggestTarget(ds, exclude) {
  if (!ds || !ds.headers.length) return null; const ex = new Set(exclude || []);
  const STRONG = /^(target|label|class|y|outcome|churn|churned|default|defaulted|fraud|is_fraud|survived|diagnosis|converted|attrition|readmitted|approved|result|response)$/i, WEAK = /^(income|price|quality|salary|score|rating)$/i;
  const cands = ds.headers.filter(h => !ex.has(h) && !ID_NAME_RE.test(h)).map(h => ({ h, c: colInfo(ds, h) })).filter(x => x.c.type !== 'empty' && !(x.c.unique && x.c.type === 'categorical'));
  const describe = x => { const cls = x.c.type === 'categorical' || x.c.type === 'boolean' || (x.c.type === 'numerical' && x.c.isInt && x.c.distinct <= 20); return { col: x.h, task: cls ? 'classification' : 'regression', detail: cls ? x.c.distinct + ' distinct values' : 'numerical, ' + x.c.distinct + ' distinct values' }; };
  const byName = cands.slice().reverse().find(x => STRONG.test(x.h.trim())) || cands.slice().reverse().find(x => WEAK.test(x.h.trim()));
  if (byName) return Object.assign(describe(byName), { reason: 'column name' });
  const last = cands[cands.length - 1];
  if (last && (last.c.type === 'categorical' || last.c.type === 'boolean' || (last.c.isInt && last.c.distinct <= 20)) && last.c.distinct >= 2 && last.c.distinct <= 20) return Object.assign(describe(last), { reason: 'last column, few distinct values' });
  return null;
}
function suggestTask(ds, col) {
  if (!ds || !col || ds.idx[col] === undefined) return null; const c = colInfo(ds, col);
  if (c.type === 'empty') return null;
  if (c.type === 'categorical' || c.type === 'boolean') return { task: 'classification', why: c.type + ' column with ' + c.distinct + ' distinct value' + (c.distinct === 1 ? '' : 's') };
  if (c.type === 'datetime') return { task: 'regression', why: 'date column; check that predicting it makes sense' };
  if (c.isInt && c.distinct <= 15) return { task: 'classification', why: 'whole numbers with only ' + c.distinct + ' distinct values' };
  return { task: 'regression', why: 'numerical with ' + (c.distinctCapped ? 'more than 5,000' : c.distinct) + ' distinct values' };
}
SDA.utility = { run: runUtility, retention, suggestTarget, suggestTask };

/* ───────────────────────── privacy attacks ───────────────────────── */
SDA.attackCatalogue = [
  { id: 'mia', name: 'Membership Inference Attack (closest-record distance)', short: 'MIA', implemented: true, description: 'Scores each real record by how close its nearest synthetic neighbour is. If members of the generator’s training set sit systematically closer than non-members, an attacker could infer membership.' },
  { id: 'exact', name: 'Exact-match / record-copying test', short: 'Exact match', implemented: true, description: 'Counts synthetic rows that reproduce a real row on every evaluated column, and compares that rate with a natural-collision baseline from the real data itself.' },
  { id: 'shadow', name: 'Shadow-model membership inference', short: 'Shadow MIA', implemented: false, description: 'Trains surrogate generators to learn a membership classifier. Not available in this version.' },
  { id: 'attr', name: 'Attribute inference attack', short: 'Attribute inference', implemented: false, description: 'Infers a sensitive attribute of a known record from its nearest synthetic neighbours. Not available in this version.' },
  { id: 'single', name: 'Singling-out test', short: 'Singling-out', implemented: false, description: 'Tests whether rare attribute combinations isolate a single real individual. Not available in this version.' },
  { id: 'link', name: 'Linkability test', short: 'Linkability', implemented: false, description: 'Tests whether two attribute subsets of a record can be linked through the synthetic data. Not available in this version.' }
];

function distanceSpace(real, synth, plan) {
  const cols = plan.evalCols.filter(c => c.name !== plan.membershipCol);
  const num = cols.filter(c => c.kind === 'numeric'), cat = cols.filter(c => c.kind === 'categorical');
  const scale = num.map(c => { const a = colOf(real, c.name, 'numeric').num; let lo = Infinity, hi = -Infinity; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } } return (hi - lo) || 1; });
  const dict = cat.map(() => new Map());
  function mat(ds, idx) {
    const n = idx.length, dn = num.length, dc = cat.length; const N = new Float64Array(n * dn), C = new Int32Array(n * dc);
    num.forEach((c, j) => { const a = colOf(ds, c.name, 'numeric').num; for (let r = 0; r < n; r++) { const v = a[idx[r]]; N[r * dn + j] = v === v ? v / scale[j] : NaN; } });
    cat.forEach((c, j) => { const a = colOf(ds, c.name, 'categorical').cat; const dm = dict[j]; for (let r = 0; r < n; r++) { const v = a[idx[r]]; if (v === null) { C[r * dc + j] = -1; continue; } let code = dm.get(v); if (code === undefined) { code = dm.size; dm.set(v, code); } C[r * dc + j] = code; } });
    return { N, C, n, dn, dc };
  }
  return { mat, dn: num.length, dc: cat.length, cols: cols.map(c => c.name) };
}
async function nearest(Q, Sm, y) {
  const { dn, dc } = Q; const d = dn + dc; const out = new Float64Array(Q.n); const lim = d;
  for (let i = 0; i < Q.n; i++) {
    if ((i & 15) === 0) await y();
    let best = Infinity; const qo = i * dn, qc = i * dc;
    for (let s = 0; s < Sm.n; s++) {
      let sum = 0; const so = s * dn, sc = s * dc;
      for (let j = 0; j < dn; j++) { const a = Q.N[qo + j], b = Sm.N[so + j]; if (a !== a || b !== b) { if (a === a || b === b) sum += 1; } else { const df = a - b; sum += df < 0 ? (df < -1 ? 1 : -df) : (df > 1 ? 1 : df); } if (sum >= best) break; }
      if (sum < best) for (let j = 0; j < dc; j++) { if (Q.C[qc + j] !== Sm.C[sc + j]) sum += 1; if (sum >= best) break; }
      if (sum < best) { best = sum; if (best === 0) break; }
    }
    out[i] = best / lim;
  }
  return out;
}
function rocCurve(scores, pos) { // higher score → predicted positive
  const n = scores.length; const idx = range(n).sort((a, b) => scores[b] - scores[a]); let nPos = 0; for (let i = 0; i < n; i++) if (pos[i]) nPos++; const nNeg = n - nPos;
  const pts = [[0, 0]]; let tp = 0, fp = 0; let i = 0;
  while (i < n) { let j = i; while (j + 1 < n && scores[idx[j + 1]] === scores[idx[i]]) j++; for (let q = i; q <= j; q++) { if (pos[idx[q]]) tp++; else fp++; } pts.push([fp / nNeg, tp / nPos]); i = j + 1; }
  let tpr10 = 0; for (const p of pts) if (p[0] <= 0.1 + 1e-12 && p[1] > tpr10) tpr10 = p[1];
  // thin for storage
  const thin = pts.length > 200 ? pts.filter((p, q) => q % Math.ceil(pts.length / 200) === 0 || q === pts.length - 1) : pts;
  return { points: thin, tpr10 };
}
function bootstrapAuc(scores, pos, rng, B) {
  const n = scores.length, vals = [];
  for (let b = 0; b < B; b++) { const s = new Float64Array(n), p = new Uint8Array(n); for (let i = 0; i < n; i++) { const j = Math.floor(rng() * n); s[i] = scores[j]; p[i] = pos[j]; } const a = aucBinary(s, p); if (a !== null) vals.push(a); }
  vals.sort((a, b) => a - b); return vals.length ? [quantile(vals, .025), quantile(vals, .975)] : null;
}

async function runMIA(real, synth, plan, opt) {
  const y = yielder(); const rng = mulberry32((opt.seed || 42) + 101); const quick = opt.mode !== 'full';
  const maxQ = opt.miaQueries || (quick ? 600 : 2500), maxS = opt.miaSynth || (quick ? 3000 : 10000);
  const att = { id: 'mia', name: SDA.attackCatalogue[0].name, short: 'MIA', description: SDA.attackCatalogue[0].description, status: 'Completed', seed: opt.seed };
  const proto = opt.protocol || 'random'; const frac = opt.memberFrac || 0.8;
  let members = [], non = [], validity, setup;
  if (proto === 'column') {
    const mc = plan.membershipCol; if (!mc || real.idx[mc] === undefined) return Object.assign(att, { status: 'Failed', error: 'Membership column “' + (mc || '') + '” was not found in the real file.' });
    const raw = real.cols[real.idx[mc]]; const T = new Set(['1', 'true', 'yes', 'y', 't', 'member']), F = new Set(['0', 'false', 'no', 'n', 'f', 'non-member', 'nonmember']); let bad = 0;
    for (let i = 0; i < raw.length; i++) { const v = String(raw[i]).trim().toLowerCase(); if (T.has(v)) members.push(i); else if (F.has(v)) non.push(i); else bad++; }
    if (bad) att.warnings = [bad + ' real rows had an unrecognised membership flag and were left out of this attack only.'];
    validity = 'labelled'; setup = 'Membership labels supplied in column “' + mc + '” of the real file (1 = in the generator’s training set).';
  } else if (proto === 'ordered') {
    const cut = Math.round(real.nrows * frac); members = range(cut); non = range(real.nrows - cut).map(i => i + cut);
    validity = opt.attested ? 'attested' : 'proxy';
    setup = 'Ordered split: first ' + Math.round(frac * 100) + '% of real rows = members, remaining = non-members. ' + (opt.attested ? 'User attests the generator was trained only on the member rows.' : 'Training set not attested — treated as a proxy.');
  } else {
    const idx = shuffle(range(real.nrows), rng), cut = Math.round(real.nrows * frac); members = idx.slice(0, cut); non = idx.slice(cut);
    validity = 'proxy'; setup = 'Random ' + Math.round(frac * 100) + '/' + Math.round((1 - frac) * 100) + ' partition of the real file (project baseline protocol). The partition is not known to the generator, so labels are a proxy.';
  }
  if (members.length < 30 || non.length < 30) return Object.assign(att, { status: 'Failed', error: 'Not enough members (' + members.length + ') or non-members (' + non.length + ') for a stable attack — need at least 30 of each.' });
  shuffle(members, rng); shuffle(non, rng);
  const qm = members.slice(0, Math.min(members.length, Math.ceil(maxQ * (proto === 'column' ? 0.5 : frac)))), qn = non.slice(0, Math.min(non.length, Math.ceil(maxQ * (proto === 'column' ? 0.5 : 1 - frac)) || non.length));
  const sIdx = sampleIdx(synth.nrows, maxS, rng);
  const space = distanceSpace(real, synth, plan); if (!(space.dn + space.dc)) return Object.assign(att, { status: 'Failed', error: 'No usable columns for a distance computation.' });
  const q = qm.concat(qn); const Q = space.mat(real, q), Sm = space.mat(synth, sIdx);
  const dist = await nearest(Q, Sm, y); const scores = new Float64Array(dist.length), pos = new Uint8Array(dist.length);
  for (let i = 0; i < dist.length; i++) { scores[i] = -dist[i]; pos[i] = i < qm.length ? 1 : 0; }
  const auc = aucBinary(scores, pos); const roc = rocCurve(scores, pos); const ci = bootstrapAuc(scores, pos, rng, 200);
  const medM = quantile(Float64Array.from(dist.slice(0, qm.length)).sort(), .5), medN = quantile(Float64Array.from(dist.slice(qm.length)).sort(), .5);
  const B = 20, hm = new Array(B).fill(0), hn = new Array(B).fill(0); let mx = 0; dist.forEach(v => { if (v > mx) mx = v; }); mx = mx || 1;
  dist.forEach((v, i) => { const b = clamp(Math.floor(v / mx * B), 0, B - 1); if (i < qm.length) hm[b]++; else hn[b]++; });
  let zeroM = 0, zeroN = 0; dist.forEach((v, i) => { if (v === 0) { if (i < qm.length) zeroM++; else zeroN++; } });
  const caveats = [];
  if (validity === 'proxy') caveats.push('Membership labels are a proxy: the generator’s true training set is not known. A low AUC under a proxy cannot show that members are safe; only a labelled or attested setup supports that statement.');
  if (qn.length < 100) caveats.push('Only ' + qn.length + ' non-members were scored; TPR at 10% FPR rests on ' + Math.round(qn.length * 0.1) + ' false positives and is noisy.');
  caveats.push('AUC near 0.5 means near-random discrimination for this attack and setup. It does not prove that no privacy risk exists.');
  Object.assign(att, { metrics: { auc, aucCI: ci, tpr10: roc.tpr10, medianDcrMembers: medM, medianDcrNonMembers: medN, zeroDistanceMembers: zeroM, zeroDistanceNonMembers: zeroN }, roc: roc.points, validity, protocol: proto, setup,
    params: { scoring: 'Score = −(Gower-style distance to the closest synthetic record): numerical |Δ| ÷ real range (capped at 1), categorical mismatch = 1, averaged over ' + (space.dn + space.dc) + ' columns', members: qm.length, nonMembers: qn.length, syntheticRecords: sIdx.length, memberFraction: frac, columns: space.cols, ciMethod: 'Bootstrap, 200 resamples', mode: quick ? 'Quick' : 'Full' },
    hist: { max: mx, members: hm.map(v => v / qm.length), nonMembers: hn.map(v => v / qn.length) }, caveats, sampleSizes: { members: qm.length, nonMembers: qn.length }, sampled: qm.length + qn.length < real.nrows || sIdx.length < synth.nrows,
    threatModel: { access: 'The attacker holds the released synthetic dataset and a set of candidate real records. No access to the generator, its parameters or training code.', construction: setup, distance: 'Gower-style: numerical |Δ| ÷ real range (capped at 1), categorical mismatch = 1, missing vs present = 1; mean over ' + (space.dn + space.dc) + ' columns.', preprocessing: 'Numerical columns scaled by the real column range; categories compared as exact labels; identifier and excluded columns left out.', separation: 'Members and non-members are disjoint sets of real rows. The attack is unsupervised (a distance score, no trained attack model), so no labels enter the scores; labels are used only to evaluate them.', samples: qm.length + ' members, ' + qn.length + ' non-members, ' + sIdx.length + ' synthetic records', seed: (opt.seed || 42) + 101 } });
  return att;
}

async function runExact(real, synth, plan, opt) {
  const y = yielder(); const rng = mulberry32((opt.seed || 42) + 202);
  const att = { id: 'exact', name: SDA.attackCatalogue[1].name, short: 'Exact match', description: SDA.attackCatalogue[1].description, status: 'Completed', seed: opt.seed };
  const cols = plan.evalCols.filter(c => c.name !== plan.membershipCol); if (!cols.length) return Object.assign(att, { status: 'Failed', error: 'No usable columns.' });
  const keyer = ds => { const arrs = cols.map(c => { const o = colOf(ds, c.name, c.kind); return c.kind === 'numeric' ? o.num : o.cat; }); const kinds = cols.map(c => c.kind === 'numeric'); return i => { let k = ''; for (let j = 0; j < arrs.length; j++) { const v = arrs[j][i]; k += (kinds[j] ? (v !== v ? '∅' : v) : (v === null ? '∅' : v)) + '\u0001'; } return k; }; };
  const kr = keyer(real), ks = keyer(synth);
  const nReal = real.nrows; const m = Math.min(synth.nrows, Math.round(nReal * 0.2)); if (m < 20) return Object.assign(att, { status: 'Failed', error: 'Real file too small for a baseline comparison (need ≥ 100 rows).' });
  const perm = shuffle(range(nReal), rng); const B = perm.slice(0, m), A = perm.slice(m);
  const aSet = new Set(); for (let i = 0; i < A.length; i++) { if ((i & 4095) === 0) await y(); aSet.add(kr(A[i])); }
  let baseHit = 0; for (const i of B) if (aSet.has(kr(i))) baseHit++;
  const sIdx = sampleIdx(synth.nrows, m, rng); let synHit = 0; for (const i of sIdx) if (aSet.has(ks(i))) synHit++;
  const rs = synHit / sIdx.length * 100, rb = baseHit / B.length * 100; const excess = rs - rb;
  Object.assign(att, { metrics: { synthMatchRate: rs, baselineMatchRate: rb, excessPp: excess, synthMatches: synHit, baselineMatches: baseHit }, validity: 'valid',
    setup: 'Reference set A = ' + A.length.toLocaleString('en-US') + ' real rows (80%). Compared: ' + sIdx.length.toLocaleString('en-US') + ' random synthetic rows vs ' + B.length.toLocaleString('en-US') + ' held-out real rows, each checked for an exact copy in A.',
    params: { columns: cols.map(c => c.name), comparison: 'synthetic → A vs held-out real → A', syntheticRows: sIdx.length, baselineRows: B.length, referenceRows: A.length, matching: 'All ' + cols.length + ' evaluated columns equal (numbers by value, missing = missing)' },
    caveats: ['Low-cardinality tables produce natural exact matches, which is why the real-vs-real baseline is subtracted.', 'A near-zero excess shows no verbatim copying; it says nothing about near-copies (see the distance-based attack).'], sampleSizes: { synthetic: sIdx.length, baseline: B.length },
    threatModel: { access: 'The attacker holds the released synthetic dataset and looks for verbatim copies of real records.', construction: 'Random 80/20 split of the real rows: A = reference, B = held-out real rows used as the natural-collision baseline.', distance: 'Exact equality on every evaluated column (numbers by value, missing = missing).', preprocessing: 'None beyond the column typing shared with the other engines.', separation: 'A and B are disjoint; synthetic rows and B are both compared against A only.', samples: sIdx.length + ' synthetic rows, ' + B.length + ' baseline rows, ' + A.length + ' reference rows', seed: (opt.seed || 42) + 202 } });
  return att;
}
async function runPrivacy(real, synth, plan, opt, progress) {
  const out = { status: 'Completed', attacks: [], pending: SDA.attackCatalogue.filter(a => !a.implemented).map(a => ({ id: a.id, name: a.name, short: a.short, description: a.description, status: 'Not applicable', reason: 'Not available in this version' })) };
  const sel = opt.attacks || { mia: true, exact: true }; let ok = 0, failed = 0;
  for (const [id, fn] of [['mia', runMIA], ['exact', runExact]]) {
    const cat = SDA.attackCatalogue.find(a => a.id === id);
    if (!sel[id]) { out.attacks.push({ id, name: cat.name, short: cat.short, description: cat.description, status: 'Not Run', reason: 'Not selected for this audit.' }); continue; }
    if (progress) progress(cat.short);
    try { const r = await fn(real, synth, plan, opt); out.attacks.push(r); if (r.status === 'Completed') ok++; else failed++; }
    catch (e) { if (e && e.cancelled) throw e; out.attacks.push({ id, name: cat.name, short: cat.short, description: cat.description, status: 'Failed', error: 'Unexpected error: ' + (e && e.message ? e.message : e) }); failed++; }
  }
  out.completed = ok; out.failed = failed; out.status = ok === 0 ? (failed ? 'Failed' : 'Not Run') : failed ? 'Partial' : 'Completed';
  return out;
}
SDA.privacy = { run: runPrivacy, runMIA, runExact };

/* ───────────────────────── ensemble ───────────────────────── */
SDA.ensembleRules = {
  version: 'EPE-0.1 (provisional)',
  signals: [
    { id: 'mia.auc', attack: 'mia', label: 'MIA ROC-AUC', chance: 0.5, strong: 0.8, moderate: 0.55, high: 0.65, unit: '', fmt: 3, note: 'Chance level 0.5. Moderate ≥ 0.55, High ≥ 0.65.' },
    { id: 'mia.tpr10', attack: 'mia', label: 'MIA TPR @ 10% FPR', chance: 0.10, strong: 0.50, moderate: 0.15, high: 0.30, unit: '', fmt: 3, note: 'Chance level 0.10. Moderate ≥ 0.15, High ≥ 0.30.' },
    { id: 'exact.excess', attack: 'exact', label: 'Exact-match excess over baseline', chance: 0, strong: 10, moderate: 1, high: 5, unit: ' pp', fmt: 2, note: 'Chance level 0 pp. Moderate ≥ 1 pp, High ≥ 5 pp.' }
  ],
  planned: 6, minCompleted: 2,
  principles: [
    'Thresholds are fixed before evaluation and are provisional project choices, not calibrated constants.',
    'Raw metric values are always kept; the normalised score = (value − chance) ÷ (strong − chance), clipped to 0–1, is for display only.',
    'No weights are used. The category follows the most concerning signal (a conservative max rule) so one strong signal cannot be averaged away.',
    'A Low category needs at least 2 completed tests and a membership setup that is labelled or attested; a proxy-only MIA cannot support “low”.',
    'Fidelity and utility never enter this calculation.'
  ]
};
const LVL = ['Low', 'Moderate', 'High'];
function levelOf(sig, v) { return v >= sig.high ? 2 : v >= sig.moderate ? 1 : 0; }
function computeEnsemble(priv) {
  const R = SDA.ensembleRules;
  if (!priv || priv.status === 'Not Run' || !priv.attacks) return { status: 'Not Run', category: null, reason: 'Privacy tests have not been run.' };
  const att = {}; priv.attacks.forEach(a => att[a.id] = a);
  const comps = []; let proxy = false;
  R.signals.forEach(sg => {
    const a = att[sg.attack]; if (!a || a.status !== 'Completed') return;
    let v; if (sg.id === 'mia.auc') v = a.metrics.auc; else if (sg.id === 'mia.tpr10') v = a.metrics.tpr10; else v = a.metrics.excessPp;
    if (v === null || v === undefined) return;
    const lvl = levelOf(sg, v); const score = clamp((v - sg.chance) / (sg.strong - sg.chance), 0, 1);
    comps.push({ id: sg.id, attack: sg.attack, label: sg.label, value: v, unit: sg.unit, fmt: sg.fmt, level: LVL[lvl], levelIdx: lvl, score, validity: a.validity, thresholds: sg.note, ci: sg.id === 'mia.auc' ? a.metrics.aucCI : null });
    if (sg.attack === 'mia' && a.validity === 'proxy') proxy = true;
  });
  const completed = priv.attacks.filter(a => a.status === 'Completed'), failed = priv.attacks.filter(a => a.status === 'Failed'), notRun = priv.attacks.filter(a => a.status === 'Not Run');
  const coverage = { completed: completed.length, failed: failed.length, notRun: notRun.length, pending: priv.pending.length, planned: R.planned, implemented: priv.attacks.length };
  const out = { status: 'Completed', rulesVersion: R.version, components: comps, coverage, category: null, label: '', tone: 'grey', rationale: [], conflicts: [], uncertainty: [], followUps: [], insufficient: false };
  const miaOk = att.mia && att.mia.status === 'Completed';
  const maxIdx = comps.length ? Math.max.apply(null, comps.map(c => c.levelIdx)) : -1, minIdx = comps.length ? Math.min.apply(null, comps.map(c => c.levelIdx)) : -1;
  const labelledMia = miaOk && att.mia.validity !== 'proxy';
  if (maxIdx === 2) { out.category = 'High'; out.label = 'High observed concern'; out.tone = 'red'; out.rationale.push('At least one implemented test crossed its documented High threshold: ' + comps.filter(c => c.levelIdx === 2).map(c => c.label + ' = ' + fmtN(c.value, c.fmt) + c.unit).join('; ') + '.'); }
  else if (maxIdx === 1) { out.category = 'Moderate'; out.label = 'Moderate observed concern'; out.tone = 'amber'; out.rationale.push('At least one signal crossed its Moderate threshold: ' + comps.filter(c => c.levelIdx === 1).map(c => c.label + ' = ' + fmtN(c.value, c.fmt) + c.unit).join('; ') + '. No signal reached High.'); }
  else if (maxIdx === 0 && comps.length && completed.length >= R.minCompleted && labelledMia) { out.category = 'Low'; out.label = 'Low observed concern'; out.tone = 'green'; out.rationale.push('All completed signals stayed below their Moderate thresholds under the tested setups. This is not proof of safety.'); }
  else {
    out.category = 'Inconclusive'; out.label = 'Insufficient Evidence for a Reliable Risk Category'; out.tone = 'grey'; out.insufficient = true;
    if (!comps.length) out.rationale.push('No privacy test produced a usable signal.');
    else {
      if (completed.length < R.minCompleted) out.rationale.push('Only ' + completed.length + ' test completed; at least ' + R.minCompleted + ' are needed for a Low category.');
      if (!miaOk) out.rationale.push('The membership inference attack did not complete' + (att.mia && att.mia.error ? ' (' + att.mia.error + ')' : '') + '.');
      else if (!labelledMia) out.rationale.push('The membership setup is a proxy (generator training set unknown), so low scores cannot support a Low category.');
    }
  }
  if (maxIdx >= 0 && maxIdx - minIdx >= 2) out.conflicts.push('Signals disagree: ' + comps.filter(c => c.levelIdx === minIdx).map(c => c.label).join(', ') + ' are Low while ' + comps.filter(c => c.levelIdx === maxIdx).map(c => c.label).join(', ') + ' are High. The High signal governs; the disagreement is shown, not averaged away.');
  else if (maxIdx >= 0 && maxIdx !== minIdx) out.conflicts.push('Signals differ by one level (' + comps.map(c => c.label + ' ' + c.level).join(' · ') + '). The most concerning level governs.');
  if (att.mia && att.mia.status === 'Completed') {
    const ci = att.mia.metrics.aucCI; if (ci) out.uncertainty.push('MIA AUC 95% bootstrap interval: ' + ci[0].toFixed(3) + ' – ' + ci[1].toFixed(3) + (ci[0] < 0.5 && ci[1] > 0.5 ? ' (includes 0.5)' : '') + '.');
    out.uncertainty.push('MIA used ' + att.mia.sampleSizes.members + ' members and ' + att.mia.sampleSizes.nonMembers + ' non-members.');
  }
  out.uncertainty.push('Coverage is limited to ' + completed.length + ' of ' + R.planned + ' attack types; attack types not available in this version may reveal risks these tests cannot see.');
  if (failed.length) out.uncertainty.push('Failed tests: ' + failed.map(a => a.short + (a.error ? ' — ' + a.error : '')).join('; '));
  if (!labelledMia) out.followUps.push('Re-run the membership attack with a membership column or an attested ordered split so that members are known training rows.');
  if (att.mia && att.mia.status === 'Completed' && att.mia.sampleSizes.nonMembers < 200) out.followUps.push('Increase the number of non-members scored (≥ 200) to stabilise TPR at 10% FPR.');
  out.followUps.push('Implement and run attribute-inference and singling-out tests; they probe risks that distance-based attacks do not.');
  if (out.category === 'High' || out.category === 'Moderate') out.followUps.push('Review the generation process (regularisation, differential-privacy options, training-set size) and re-run the audit after any change.');
  if (notRun.length) out.followUps.push('Run the unselected implemented test(s): ' + notRun.map(a => a.short).join(', ') + '.');
  return out;
}
function fmtN(v, d) { return typeof v === 'number' && isFinite(v) ? v.toFixed(d === undefined ? 3 : d) : '—'; }
SDA.ensemble = { compute: computeEnsemble };

/* ───────────────────────── demo data (clearly simulated) ───────────────────────── */
function demoPair(opt) {
  opt = opt || {}; const n = opt.n || 2200; const leaky = !!opt.leaky; const rng = mulberry32(opt.seed || 11);
  const Z = () => normal(rng); const pickW = (items, w) => { let u = rng() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < items.length; i++) { u -= w[i]; if (u <= 0) return items[i]; } return items[items.length - 1]; };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const age = clamp(Math.round(45 + 14 * Z()), 18, 85); const tenure = clamp(Math.round(36 + 22 * Z() + 0.3 * (age - 45)), 0, 120);
    const income = Math.round(Math.exp(10.4 + 0.012 * (age - 45) + 0.5 * Z()) / 10) * 10; const balance = rng() < 0.2 ? 0 : Math.round(income * 0.15 * Math.exp(0.8 * Z()));
    const prod = pickW([1, 2, 3, 4], [0.45, 0.35, 0.15, 0.05]); const region = pickW(['North', 'South', 'East', 'West'], [0.3, 0.25, 0.25, 0.2]);
    const segment = income > 52000 ? pickW(['Premium', 'Retail', 'Business'], [0.6, 0.25, 0.15]) : pickW(['Retail', 'Business', 'Premium'], [0.8, 0.15, 0.05]);
    const card = rng() < 0.45 + 0.1 * prod ? 'Yes' : 'No';
    const lp = -0.3 - 0.045 * (tenure - 36) + (prod === 1 ? 1.2 : -0.6) - 0.00006 * (balance - 5000) + 0.02 * (age - 45) + 0.25 * Z(); const churn = rng() < 1 / (1 + Math.exp(-lp)) ? 'Yes' : 'No';
    const member = rng() < 0.8 ? 1 : 0;
    rows.push({ id: 'C' + String(i + 1).padStart(5, '0'), age, income: rng() < 0.03 ? '' : income, tenure_months: tenure, balance, num_products: prod, segment, region, has_card: card, churned: churn, train_member: member });
  }
  const head = ['customer_id', 'age', 'income', 'tenure_months', 'balance', 'num_products', 'segment', 'region', 'has_card', 'churned', 'train_member'];
  const toCSV = (r, withMember) => { const h = withMember ? head : head.slice(0, -1); return h.join(',') + '\n' + r.map(o => [o.id, o.age, o.income, o.tenure_months, o.balance, o.num_products, o.segment, o.region, o.has_card, o.churned].concat(withMember ? [o.train_member] : []).join(',')).join('\n') + '\n'; };
  const members = rows.filter(r => r.train_member === 1); const syn = [];
  const numK = ['age', 'income', 'tenure_months', 'balance'];
  if (leaky) {
    for (let i = 0; i < n; i++) {
      const s = members[Math.floor(rng() * members.length)]; const sd = { age: 14, income: 20000, tenure_months: 22, balance: 6000 }; const o = Object.assign({}, s);
      numK.forEach(k => { if (o[k] !== '') o[k] = Math.max(0, Math.round(o[k] + 0.015 * sd[k] * Z())); });
      if (rng() < 0.03) o.region = pickW(['North', 'South', 'East', 'West'], [1, 1, 1, 1]);
      o.id = 'S' + String(i + 1).padStart(5, '0'); syn.push(o);
    }
  } else {
    // class-conditional Gaussian on (age, log income, tenure, balance^0.5) with categorical marginals per class
    const byClass = { Yes: members.filter(r => r.churned === 'Yes'), No: members.filter(r => r.churned === 'No') };
    const tf = r => [r.age, Math.log(r.income === '' ? 40000 : Math.max(1, r.income)), r.tenure_months, Math.sqrt(r.balance)]; const fitG = arr => { const X = arr.map(tf); const m = [0, 1, 2, 3].map(j => mean(X.map(x => x[j]))); const C = [0, 1, 2, 3].map(a => [0, 1, 2, 3].map(b => X.reduce((s, x) => s + (x[a] - m[a]) * (x[b] - m[b]), 0) / (X.length - 1))); return { m, L: chol(C) }; };
    const G = { Yes: fitG(byClass.Yes), No: fitG(byClass.No) };
    const cdist = (arr, key) => { const f = {}; arr.forEach(r => { f[r[key]] = (f[r[key]] || 0) + 1; }); return { items: Object.keys(f), w: Object.keys(f).map(k => f[k]) }; };
    const C = {}; ['Yes', 'No'].forEach(cl => { C[cl] = {}; ['segment', 'region', 'has_card', 'num_products'].forEach(k => C[cl][k] = cdist(byClass[cl], k)); });
    const pchurnRate = byClass.Yes.length / members.length;
    for (let i = 0; i < n; i++) {
      const cl = rng() < pchurnRate ? 'Yes' : 'No'; const g = G[cl]; const z = [Z(), Z(), Z(), Z()]; const x = g.m.map((mu, a) => mu + g.L[a].reduce((s, l, b) => s + l * z[b], 0));
      const o = { id: 'S' + String(i + 1).padStart(5, '0'), age: clamp(Math.round(x[0]), 18, 85), income: rng() < 0.03 ? '' : Math.round(Math.exp(x[1]) / 10) * 10, tenure_months: clamp(Math.round(x[2]), 0, 120), balance: rng() < 0.2 ? 0 : Math.round(Math.max(0, x[3]) ** 2), churned: cl };
      ['segment', 'region', 'has_card'].forEach(k => o[k] = pickW(C[cl][k].items, C[cl][k].w)); o.num_products = +pickW(C[cl].num_products.items, C[cl].num_products.w); syn.push(o);
    }
  }
  return { realCsv: toCSV(rows, true), synthCsv: toCSV(syn, false), leaky, rows: n,
    info: { name: leaky ? 'Demo · churn (noisy-copy generator)' : 'Demo · churn (class-conditional Gaussian)', domain: 'Banking (simulated)', description: 'Simulated customer-churn table generated by this app for demonstration only. It is not a real dataset.', generator: leaky ? 'Noisy copy of member rows (deliberately leaky demo)' : 'Class-conditional Gaussian + categorical marginals (demo)', target: 'churned', task: 'classification', categorical: 'num_products', idCols: 'customer_id', membershipCol: 'train_member' } };
}
function chol(C) { const n = C.length, L = C.map(() => new Array(n).fill(0)); for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = C[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-9)) : s / L[j][j]; } return L; }
SDA.demo = { make: demoPair };

/* ───────────────────────── orchestrator ───────────────────────── */
SDA.defaults = {
  info: { name: '', domain: '', description: '', generator: '', target: '', task: 'classification', categorical: '', idCols: '' },
  settings: { mode: 'quick', seed: 42, sampleMax: 5000, doFidelity: true, doUtility: true, doPrivacy: true, attackMia: true, attackExact: true, model: 'linear', primary: '', testSize: 0.3, protocol: 'random', memberFrac: 0.8, membershipCol: '', attested: false, matchedOnly: false }
};
function planCfg(info, st) { return { target: info.target, task: info.target ? info.task : '', categorical: info.categorical, excluded: info.idCols, matchedOnly: st.matchedOnly, membershipCol: st.protocol === 'column' ? st.membershipCol : '' }; }
SDA.planCfg = planCfg;

async function runEvaluations(real, synth, validation, info, st, hooks) {
  const H = hooks || {}; const prog = H.progress || (() => {}); const out = {};
  const plan = validation.plan; const seed = +st.seed || 42; const t0 = Date.now();
  const maxRows = st.mode === 'full' ? Math.max(st.sampleMax || 5000, 20000) : Math.min(st.sampleMax || 5000, 5000);
  const mods = [];
  if (st.doFidelity) mods.push('fidelity'); if (st.doUtility) mods.push('utility'); if (st.doPrivacy) mods.push('privacy');
  let done = 0; const step = (label) => { prog(Math.round(done / (mods.length + 1) * 100), label); };
  const wrap = async (key, fn) => { if (cancel.flag) throw cancelledError(); step('Running ' + key + '…'); await tick(); try { out[key] = await fn(); } catch (e) { if (e && e.cancelled) throw e; out[key] = { status: 'Failed', error: 'Unexpected error: ' + (e && e.message ? e.message : e) }; } done++; };
  if (st.doFidelity) { if (!plan.evalCols.length) out.fidelity = { status: 'Blocked', reason: 'No column can be compared in both files, so fidelity cannot be measured.' }; else await wrap('fidelity', () => runFidelity(real, synth, plan, { seed, maxRows })); } else out.fidelity = { status: 'Not Run', reason: 'Disabled in evaluation settings.' };
  if (st.doUtility) { if (!plan.target) out.utility = { status: 'Not Run', reason: 'No target column selected, so predictive utility was skipped. No score is produced.' }; else if (plan.utilityBlocked) out.utility = { status: 'Blocked', reason: plan.utilityBlocked + ' No score is produced.' }; else await wrap('utility', () => runUtility(real, synth, plan, { seed, mode: st.mode, model: st.model, primary: st.primary, testSize: +st.testSize || 0.3, maxRows: st.mode === 'full' ? 20000 : 4000 })); } else out.utility = { status: 'Not Run', reason: 'Disabled in evaluation settings.' };
  if (st.doPrivacy) await wrap('privacy', () => runPrivacy(real, synth, plan, { seed, mode: st.mode, protocol: st.protocol, memberFrac: +st.memberFrac || 0.8, attested: st.attested, attacks: { mia: st.attackMia, exact: st.attackExact } }, l => prog(Math.round(done / (mods.length + 1) * 100), 'Privacy test: ' + l + '…'))); else out.privacy = { status: 'Not Run', reason: 'Disabled in evaluation settings.', attacks: [], pending: SDA.attackCatalogue.filter(a => !a.implemented).map(a => ({ id: a.id, name: a.name, short: a.short, status: 'Not applicable', reason: 'Not available in this version' })) };
  out.ensemble = computeEnsemble(out.privacy);
  out.durationMs = Date.now() - t0; prog(100, 'Done');
  return out;
}
function auditStatus(res, st) {
  const parts = []; if (st.doFidelity) parts.push(res.fidelity.status); if (st.doUtility) parts.push(res.utility.status); if (st.doPrivacy) parts.push(res.privacy.status);
  if (!parts.length) return 'Ready';
  if (parts.every(p => p === 'Completed')) return 'Completed';
  if (parts.every(p => p === 'Failed')) return 'Failed';
  if (parts.every(p => p === 'Blocked' || p === 'Failed')) return 'Blocked';
  if (parts.some(p => p === 'Completed' || p === 'Partial')) return 'Partial';
  if (parts.every(p => p === 'Not Run')) return 'Ready';
  return 'Failed';
}
SDA.run = runEvaluations; SDA.auditStatus = auditStatus;

/* ───────────────────────── historical baseline (project notes) ───────────────────────── */
SDA.baseline = {
  note: 'Historical reference results from earlier research runs on five public datasets. They were not computed by this app for your upload and are always labelled as historical.',
  rows: [
    { name: 'Adult', domain: 'Census income', shapes: 0.890, trends: 0.682, overall: 0.786, corrDiff: 0.020, retention: 90.6, mia: 0.502 },
    { name: 'Wine Quality', domain: 'Food chemistry', shapes: 0.919, trends: 0.985, overall: 0.952, corrDiff: 0.047, retention: 76.3, mia: 0.509 },
    { name: 'Bank Marketing', domain: 'Banking', shapes: 0.918, trends: 0.786, overall: 0.852, corrDiff: 0.032, retention: 97.3, mia: 0.503 },
    { name: 'Amazon / Google', domain: 'E-commerce product matching', shapes: 0.939, trends: null, overall: 0.939, corrDiff: 0.244, retention: 58.3, mia: 0.498, flag: 'Pair Trends was not reported; shown as N/A, not zero.' },
    { name: 'Breast Cancer', domain: 'Healthcare', shapes: 0.926, trends: 0.929, overall: 0.928, corrDiff: 0.065, retention: 90.1, mia: null, flag: 'MIA result pending verification.' }
  ]
};

/* ───────────────────────── Part II: upload-to-report workflow ───────────────────────── */
SDA.engineVersions = { validation: '1.2.0', preparation: '2.0.0', fidelity: '1.0.0', utility: '1.1.0', privacy: '1.1.0', ensemble: 'EPE-0.1', registry: '1.1.0', report: '1.2.0' };
SDA.limits = { maxBytes: 120 * 1048576, maxCells: 25e6, largeRows: 200000 };

/* file checks: actionable messages before anything else runs (guide §62) */
function inspectFile(name, size, text, ds) {
  const errors = [], warnings = []; const ext = (/\.([a-z0-9]+)$/i.exec(name || '') || [, ''])[1].toLowerCase();
  if (ext && ['csv', 'tsv', 'txt'].indexOf(ext) < 0) {
    const how = { xlsx: 'Excel workbook', xls: 'Excel workbook', json: 'JSON file', parquet: 'Parquet file', ipynb: 'Jupyter notebook', zip: 'ZIP archive', pdf: 'PDF' }[ext];
    errors.push((how ? 'This is a' + (/^[aeiou]/i.test(how) ? 'n ' : ' ') + how + ', not a CSV. ' : 'Unsupported file type “.' + ext + '”. ') + (ext === 'ipynb' ? 'Notebooks are not needed: upload the two data files and the audit code runs here.' : 'Export or save the table as CSV (UTF-8) and upload that file.'));
    return { errors, warnings };
  }
  if (!size) { errors.push('The file is empty (0 bytes). Check that the export finished and upload it again.'); return { errors, warnings }; }
  if (size > SDA.limits.maxBytes) { errors.push('The file is ' + (size / 1048576).toFixed(0) + ' MB, above the ' + SDA.limits.maxBytes / 1048576 + ' MB limit for in-browser processing. Upload a seeded random sample instead and note it in the description.'); return { errors, warnings }; }
  const head = text.slice(0, 65536);
  if (head.indexOf('\u0000') >= 0) { errors.push('The file contains binary data (null bytes), so it is not a plain-text CSV. If it came from Excel or a database tool, export it as “CSV UTF-8”.'); return { errors, warnings }; }
  let bad = 0; for (let i = 0; i < text.length && bad < 100000; i++) if (text.charCodeAt(i) === 0xFFFD) bad++;
  if (bad) { const msg = bad + ' character' + (bad === 1 ? '' : 's') + ' could not be decoded as UTF-8 (they appear as replacement marks). Re-save the file with UTF-8 encoding'; if (bad > text.length * 0.01) errors.push(msg + '. Too much of the text is unreadable to audit reliably.'); else warnings.push(msg + ' so labels compare correctly.'); }
  if (ds) {
    if (!ds.headers.length || !ds.nrows) errors.push('No data rows were found. The first line must be a header row, followed by at least one data row.');
    if (ds.dupHeaders.length) errors.push('Duplicate column names: ' + ds.dupHeaders.slice(0, 6).join(', ') + '. Rename them so every column is unique, then upload again.');
    if (ds.blankHeaders) warnings.push(ds.blankHeaders + ' column' + (ds.blankHeaders === 1 ? ' has' : 's have') + ' no name in the header row. Validation will block until every column is named.');
    if (ds.unclosedAt >= 0) warnings.push('A quoted field opened near data row ' + ds.unclosedAt + ' is never closed, so the rest of the file was read as one value. Check the quoting around that row.');
    if (ds.ragged) warnings.push(ds.ragged + ' row' + (ds.ragged === 1 ? '' : 's') + ' have a different number of fields than the header. They are read as-is (missing fields empty); the file itself is not changed.');
    const cells = ds.nrows * ds.headers.length;
    if (cells > SDA.limits.maxCells) errors.push('The table has ' + (cells / 1e6).toFixed(1) + ' million cells, above the ' + SDA.limits.maxCells / 1e6 + ' million cell limit for this browser engine. Upload a seeded sample.');
    else if (ds.nrows > SDA.limits.largeRows) warnings.push('Large file (' + ds.nrows.toLocaleString('en-US') + ' rows). Engines work on seeded samples within the sampling cap; every result records the sample size and seed.');
  }
  return { errors, warnings };
}
/* dataset fingerprint: SHA-256 of the file text where Web Crypto exists, FNV-1a otherwise (labelled) */
async function fingerprint(text) {
  try {
    const sub = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
    if (sub) { const buf = await sub.digest('SHA-256', new TextEncoder().encode(text)); return { algo: 'SHA-256', hex: Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('') }; }
  } catch (e) { /* fall through */ }
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0; }
  return { algo: 'FNV-1a (non-cryptographic)', hex: h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') };
}
SDA.csv.inspect = inspectFile; SDA.fingerprint = fingerprint;

/* data cleaning workspace: reviewable steps on a working copy, replayable from the untouched upload */
const NUMTXT = /^[+-]?\d{1,3}([,\s  ]\d{3})+(\.\d+)?$/;
const PLAINNUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function derive(ds, headers, cols, rid, note) {
  const out = { name: ds.name, size: ds.size, delimiter: ds.delimiter, headers: headers.slice(), cols, nrows: rid.length, ragged: 0, dupHeaders: [], blankHeaders: ds.blankHeaders || 0, unclosedAt: -1, _c: {}, _t: {}, prepared: true, preparedNote: note, rid };
  out.idx = {}; out.headers.forEach((h, j) => { if (out.idx[h] === undefined) out.idx[h] = j; }); return out;
}
const ridOf = ds => ds.rid || range(ds.nrows);
function numStr(x) { return Number.isInteger(x) ? String(x) : String(Math.round(x * 1e10) / 1e10); }
function iqrFences(a) { const s = Array.from(a).filter(v => v === v).sort((p, q) => p - q); if (s.length < 20) return null; const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), r = q3 - q1; if (!(r > 0)) return null; return { lo: q1 - 3 * r, hi: q3 + 3 * r }; }
function labelMap(ds, h) {
  const j = ds.idx[h]; if (j === undefined) return {}; const groups = new Map();
  ds.cols[j].forEach(v => { const t = v.trim(); if (isMissing(t)) return; const key = t.toLowerCase().replace(/\s+/g, ' '); let g = groups.get(key); if (!g) { g = { spell: new Map(), raws: new Set() }; groups.set(key, g); } g.spell.set(t, (g.spell.get(t) || 0) + 1); g.raws.add(v); });
  const m = {}; groups.forEach(g => { if (g.raws.size < 2) return; let best = null, bn = -1; g.spell.forEach((n, t) => { if (n > bn) { bn = n; best = t; } }); g.raws.forEach(v => { if (v !== best) m[v] = best; }); });
  return m;
}
const DATE_FMT = { 'YYYY-MM-DD': /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/, 'DD/MM/YYYY': /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/, 'MM/DD/YYYY': /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/ };
function parseDate(v, fmt) {
  const t = String(v).trim(); const m = DATE_FMT[fmt].exec(t); if (!m) return null;
  const [y, mo, d] = fmt === 'YYYY-MM-DD' ? [+m[1], +m[2], +m[3]] : fmt === 'DD/MM/YYYY' ? [+m[3], +m[2], +m[1]] : [+m[3], +m[1], +m[2]];
  const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const rest = t.slice(m[0].length); if (rest && !/^[T ]\d{1,2}:\d{2}(:\d{2})?$/.test(rest)) return null;
  const tm = /^[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(rest);
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0') + (tm ? ' ' + tm[1].padStart(2, '0') + ':' + tm[2] + (tm[3] ? ':' + tm[3] : '') : '');
}

/* profile + detected issues; every issue carries a suggested step the user can review before applying */
function cleanProfile(ds) {
  const rows = ds.nrows, cols = ds.headers.length; let missingCells = 0, emptyRows = 0, trimCells = 0; const columns = []; const issues = [];
  for (let i = 0; i < rows; i++) { let all = true; for (let j = 0; j < cols; j++) if (!isMissing(ds.cols[j][i])) { all = false; break; } if (all) emptyRows++; }
  ds.headers.forEach((h, j) => {
    const c = colInfo(ds, h); const a = ds.cols[j]; missingCells += c.missing;
    let trim = 0, numFmt = 0, numOk = 0, nonNum = 0, nm = 0; const bad = [];
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (v !== v.trim() && v.trim() !== '') trim++; const t = v.trim(); if (isMissing(t)) continue; nm++; if (PLAINNUM.test(t)) numOk++; else if (NUMTXT.test(t)) { numOk++; numFmt++; } else { nonNum++; if (bad.length < 3 && bad.indexOf(t) < 0) bad.push(t); } }
    trimCells += trim;
    const lm = c.type === 'categorical' || c.type === 'boolean' ? labelMap(ds, h) : {}; const variants = Object.keys(lm);
    let variantCells = 0; if (variants.length) a.forEach(v => { if (lm[v] !== undefined) variantCells++; });
    let unusual = 0, fences = null; if (c.type === 'numerical') { fences = iqrFences(colOf(ds, h, 'numeric').num); if (fences) colOf(ds, h, 'numeric').num.forEach(v => { if (v === v && (v < fences.lo || v > fences.hi)) unusual++; }); }
    const mixed = c.type === 'categorical' && nm > 0 && numOk / nm >= 0.8 && nonNum > 0;
    const numText = c.type === 'categorical' && numFmt > 0 && numOk / nm >= 0.95 && !mixed;
    const constant = c.type !== 'empty' && c.distinct === 1 && !c.distinctCapped;
    columns.push({ name: h, type: c.type, missing: c.missing, missingPct: c.missingPct, distinct: c.distinct, distinctCapped: c.distinctCapped, constant, trim, numText: numText ? numFmt : 0, mixed: mixed ? nonNum : 0, mixedExamples: mixed ? bad : [], variants: variants.length, variantCells, variantExamples: variants.slice(0, 3).map(v => '“' + v + '” → “' + lm[v] + '”'), unusual, fences });
  });
  const dupRows = rowHashCount(ds);
  const miss = columns.filter(c => c.missing > 0);
  if (miss.length) issues.push({ id: 'missing', kind: 'Missing values', count: missingCells, cols: miss.map(c => c.name), text: missingCells.toLocaleString('en-US') + ' missing cell' + (missingCells === 1 ? '' : 's') + ' in ' + miss.length + ' column' + (miss.length === 1 ? '' : 's') + ': ' + miss.slice(0, 4).map(c => c.name + ' ' + c.missingPct.toFixed(1) + '%').join(', ') + (miss.length > 4 ? '…' : ''), fix: { op: 'missing', cols: miss.map(c => c.name), method: 'drop' } });
  if (dupRows) issues.push({ id: 'dups', kind: 'Exact duplicate rows', count: dupRows, cols: [], text: dupRows.toLocaleString('en-US') + ' row' + (dupRows === 1 ? ' repeats' : 's repeat') + ' an earlier row exactly. Duplicates can be legitimate, so they are only removed if you choose to.', fix: { op: 'dedupe' } });
  if (emptyRows) issues.push({ id: 'empty', kind: 'Blank rows', count: emptyRows, cols: [], text: emptyRows + ' row' + (emptyRows === 1 ? ' has' : 's have') + ' no values at all.', fix: { op: 'emptyrows' } });
  if (trimCells) issues.push({ id: 'trim', kind: 'Surrounding spaces', count: trimCells, cols: columns.filter(c => c.trim).map(c => c.name), text: trimCells.toLocaleString('en-US') + ' value' + (trimCells === 1 ? ' has' : 's have') + ' leading or trailing spaces, which can split one category into two.', fix: { op: 'trim' } });
  columns.filter(c => c.numText).forEach(c => issues.push({ id: 'numtext:' + c.name, kind: 'Numbers stored as text', count: c.numText, cols: [c.name], text: '“' + c.name + '” holds numbers written with thousands separators, so it is read as text.', fix: { op: 'convert', col: c.name, to: 'number' } }));
  columns.filter(c => c.mixed).forEach(c => issues.push({ id: 'mixed:' + c.name, kind: 'Mixed types', count: c.mixed, cols: [c.name], text: '“' + c.name + '” is mostly numbers but has ' + c.mixed + ' non-numeric value' + (c.mixed === 1 ? '' : 's') + ' (' + c.mixedExamples.map(x => '“' + x + '”').join(', ') + '). Converting turns those into missing values.', fix: { op: 'convert', col: c.name, to: 'number' } }));
  columns.filter(c => c.variants).forEach(c => issues.push({ id: 'labels:' + c.name, kind: 'Label variants', count: c.variantCells, cols: [c.name], text: '“' + c.name + '” has labels that differ only by case or spacing: ' + c.variantExamples.join(', ') + '.', fix: { op: 'labels', col: c.name } }));
  columns.filter(c => c.constant).forEach(c => issues.push({ id: 'const:' + c.name, kind: 'Constant column', count: rows, cols: [c.name], text: '“' + c.name + '” has a single value in every non-missing row, so it carries no information for metrics or models.', fix: { op: 'dropcols', cols: [c.name] } }));
  columns.filter(c => c.unusual).forEach(c => issues.push({ id: 'unusual:' + c.name, kind: 'Unusual values', count: c.unusual, cols: [c.name], text: c.unusual + ' value' + (c.unusual === 1 ? '' : 's') + ' in “' + c.name + '” ' + (c.unusual === 1 ? 'lies' : 'lie') + ' beyond 3 × IQR from the quartiles. They may be genuine, so review before treating them.', fix: { op: 'range', col: c.name, min: numStr(+c.fences.lo.toPrecision(6)), max: numStr(+c.fences.hi.toPrecision(6)), action: 'missing' } }));
  return { rows, cols, missingCells, dupRows, emptyRows, trimCells, columns, issues };
}

const OP_LABEL = { missing: 'Handle missing values', dedupe: 'Remove exact duplicate rows', emptyrows: 'Remove blank rows', trim: 'Trim surrounding spaces', convert: 'Convert data type', labels: 'Normalise category labels', range: 'Apply a value range rule', dropcols: 'Remove columns' };
const OP_WHY = {
  missing: 'Missing values are handled by an explicit rule instead of being left to each metric.',
  dedupe: 'Exact repeats weight some records more than others in every metric.',
  emptyrows: 'Blank rows add nothing and inflate missing-value rates.',
  trim: 'Surrounding spaces make “Yes” and “Yes ” different categories and stop numbers being recognised.',
  convert: 'A column is read with the type its values actually represent.',
  labels: 'Labels that differ only by case or spacing split one category into several.',
  range: 'Values outside a range you approved are treated by your chosen rule.',
  dropcols: 'Columns you chose to leave out of the prepared copy.'
};
function describeSpec(s) {
  const cl = l => l.length > 3 ? l.slice(0, 3).join(', ') + ' +' + (l.length - 3) : l.join(', ');
  if (s.op === 'missing') return ({ drop: 'Remove rows with a missing value', median: 'Fill missing values with the column median', mode: 'Fill missing values with the most frequent value', constant: 'Fill missing values with “' + s.value + '”' })[s.method] + ' · ' + cl(s.cols || []);
  if (s.op === 'convert') return s.to === 'number' ? 'Convert “' + s.col + '” to numbers' : 'Convert “' + s.col + '” to ISO dates (from ' + s.format + ')';
  if (s.op === 'labels') return 'Normalise labels in “' + s.col + '”';
  if (s.op === 'range') return ({ drop: 'Remove rows where', missing: 'Set to missing where', clip: 'Clip to the range where' })[s.action] + ' “' + s.col + '” is outside ' + (s.min === '' || s.min === undefined ? '−∞' : s.min) + ' to ' + (s.max === '' || s.max === undefined ? '+∞' : s.max);
  if (s.op === 'dropcols') return 'Remove column' + ((s.cols || []).length === 1 ? '' : 's') + ' ' + cl(s.cols || []);
  return OP_LABEL[s.op] || s.op;
}

/* apply one step to a dataset; never mutates the input. Returns { ds, entry } or { error } */
function cleanApply(ds, spec, fileLabel) {
  const s = spec || {}; const rid = ridOf(ds); const n = ds.nrows; const H = ds.headers; const examples = []; let cellsChanged = 0, toMissing = 0, rowsRemoved = 0; const touched = new Set();
  const colsOf = names => { const bad = (names || []).filter(c => ds.idx[c] === undefined); if (bad.length) throw new Error('Column not found: ' + bad.join(', ') + '.'); return names; };
  const ex = (h, a, b) => { if (examples.length < 6) { const e = (h ? h + ': ' : '') + '“' + a + '” → “' + b + '”'; if (examples.indexOf(e) < 0) examples.push(e); } };
  let headers = H, cols = ds.cols, keep = null;
  const mapCells = (names, fn) => { const set = new Set(names); cols = ds.cols.map((a, j) => { const h = H[j]; if (!set.has(h)) return a; let ch = false; const b = new Array(a.length); for (let i = 0; i < a.length; i++) { const w = fn(a[i], h, i); b[i] = w; if (w !== a[i]) { ch = true; cellsChanged++; if (isMissing(w) && !isMissing(a[i])) toMissing++; ex(h, a[i], w === '' ? '(missing)' : w); } } if (ch) touched.add(h); return ch ? b : a; }); };
  try {
    if (s.op === 'trim') mapCells(H, v => { const t = v.trim(); return t !== v ? t : v; });
    else if (s.op === 'emptyrows') { keep = []; for (let i = 0; i < n; i++) { let all = true; for (let j = 0; j < H.length; j++) if (!isMissing(ds.cols[j][i])) { all = false; break; } if (!all) keep.push(i); } }
    else if (s.op === 'dedupe') { keep = []; const seen = new Set(); for (let i = 0; i < n; i++) { let k = ''; for (let j = 0; j < H.length; j++) k += ds.cols[j][i] + '\u0001'; if (!seen.has(k)) { seen.add(k); keep.push(i); } } }
    else if (s.op === 'missing') {
      const names = colsOf(s.cols && s.cols.length ? s.cols : H); if (!names.length) throw new Error('Choose at least one column.');
      if (s.method === 'drop') { keep = []; const js = names.map(h => ds.idx[h]); for (let i = 0; i < n; i++) if (js.every(j => !isMissing(ds.cols[j][i]))) keep.push(i); names.forEach(h => touched.add(h)); }
      else {
        const fill = {};
        names.forEach(h => { const c = colInfo(ds, h);
          if (s.method === 'median') { if (c.type !== 'numerical') throw new Error('The median needs numerical columns; “' + h + '” is ' + c.type + '. Use the most frequent value or a constant instead.'); const a = Array.from(colOf(ds, h, 'numeric').num).filter(v => v === v).sort((p, q) => p - q); if (!a.length) throw new Error('“' + h + '” has no values to take a median from.'); fill[h] = numStr(quantile(a, 0.5)); }
          else if (s.method === 'mode') { const t = new Map(); ds.cols[ds.idx[h]].forEach(v => { if (!isMissing(v)) t.set(v, (t.get(v) || 0) + 1); }); let best = null, bn = 0; t.forEach((k, v) => { if (k > bn) { bn = k; best = v; } }); if (best === null) throw new Error('“' + h + '” has no values to take the most frequent from.'); fill[h] = best; }
          else if (s.method === 'constant') { if (s.value === undefined || String(s.value).trim() === '') throw new Error('Enter the value to fill with.'); fill[h] = String(s.value); }
          else throw new Error('Choose how to handle the missing values.'); });
        mapCells(names, (v, h) => isMissing(v) ? fill[h] : v);
      }
    }
    else if (s.op === 'convert') {
      colsOf([s.col]);
      if (s.to === 'number') mapCells([s.col], v => { if (isMissing(v)) return v; const t = v.trim(); if (PLAINNUM.test(t)) return t; if (NUMTXT.test(t)) return t.replace(/[,\s  ]/g, ''); return ''; });
      else if (s.to === 'date') { if (!DATE_FMT[s.format]) throw new Error('Choose the date format the column uses.'); mapCells([s.col], v => { if (isMissing(v)) return v; const d = parseDate(v, s.format); return d === null ? '' : d; }); }
      else throw new Error('Choose the type to convert to.');
    }
    else if (s.op === 'labels') { colsOf([s.col]); const m = labelMap(ds, s.col); mapCells([s.col], v => m[v] !== undefined ? m[v] : v); }
    else if (s.op === 'range') {
      colsOf([s.col]); const lo = s.min === '' || s.min === undefined || s.min === null ? -Infinity : +s.min, hi = s.max === '' || s.max === undefined || s.max === null ? Infinity : +s.max;
      if (lo === -Infinity && hi === Infinity) throw new Error('Enter a minimum, a maximum or both.'); if (!(lo === lo) || !(hi === hi)) throw new Error('The range limits must be numbers.'); if (lo > hi) throw new Error('The minimum is larger than the maximum.');
      if (colInfo(ds, s.col).type !== 'numerical') throw new Error('Range rules need a numerical column; “' + s.col + '” is ' + colInfo(ds, s.col).type + '. Convert it to numbers first.');
      const a = colOf(ds, s.col, 'numeric').num; const out = i => a[i] === a[i] && (a[i] < lo || a[i] > hi);
      if (s.action === 'drop') { keep = []; for (let i = 0; i < n; i++) if (!out(i)) keep.push(i); touched.add(s.col); }
      else if (s.action === 'missing') mapCells([s.col], (v, h, i) => out(i) ? '' : v);
      else if (s.action === 'clip') mapCells([s.col], (v, h, i) => out(i) ? numStr(a[i] < lo ? lo : hi) : v);
      else throw new Error('Choose what happens to values outside the range.');
    }
    else if (s.op === 'dropcols') {
      const names = colsOf(s.cols || []); if (!names.length) throw new Error('Choose at least one column to remove.'); if (names.length >= H.length) throw new Error('At least one column must remain.');
      const set = new Set(names); const js = []; H.forEach((h, j) => { if (!set.has(h)) js.push(j); }); headers = js.map(j => H[j]); cols = js.map(j => ds.cols[j]); names.forEach(h => touched.add(h));
    }
    else throw new Error('Unknown cleaning step.');
  } catch (e) { return { error: e.message || String(e) }; }
  let newRid = rid;
  if (keep) { rowsRemoved = n - keep.length; if (keep.length === 0) return { error: 'This step would remove every row. Nothing was applied.' }; cols = cols.map(a => keep.map(i => a[i])); newRid = keep.map(i => rid[i]); if (rowsRemoved && examples.length < 1) examples.push(rowsRemoved.toLocaleString('en-US') + ' of ' + n.toLocaleString('en-US') + ' rows removed'); }
  const out = derive(ds, headers, cols, newRid, describeSpec(s));
  const removedShare = n ? rowsRemoved / n : 0; const imputes = s.op === 'missing' && s.method !== 'drop' && cellsChanged > 0;
  const material = removedShare > 0.05 || imputes || (s.op === 'range' && s.action !== 'drop' && cellsChanged > 0) || s.op === 'dropcols' || (s.op === 'convert' && toMissing > 0);
  const why = []; if (removedShare > 0.05) why.push('removes ' + (removedShare * 100).toFixed(1) + '% of rows'); if (imputes) why.push('fills ' + cellsChanged.toLocaleString('en-US') + ' missing value' + (cellsChanged === 1 ? '' : 's') + ', which changes distributions and correlations'); if (s.op === 'range' && s.action === 'clip' && cellsChanged) why.push('clips ' + cellsChanged + ' value' + (cellsChanged === 1 ? '' : 's') + ' to the range'); if (s.op === 'range' && s.action === 'missing' && cellsChanged) why.push('turns ' + cellsChanged + ' value' + (cellsChanged === 1 ? '' : 's') + ' into missing values'); if (s.op === 'convert' && toMissing) why.push('turns ' + toMissing + ' unreadable value' + (toMissing === 1 ? '' : 's') + ' into missing values'); if (s.op === 'dropcols') why.push('removes ' + touched.size + ' column' + (touched.size === 1 ? '' : 's') + ' that the other file may still have');
  const entry = { op: s.op, label: describeSpec(s), file: fileLabel || '', params: JSON.parse(JSON.stringify(s)), columns: Array.from(touched), rowsBefore: n, rowsAfter: out.nrows, colsBefore: H.length, colsAfter: headers.length, cellsChanged, cellsToMissing: toMissing, rowsRemoved, rationale: OP_WHY[s.op] || '', material, materialWhy: why.join('; '), examples, noop: !rowsRemoved && !cellsChanged && headers.length === H.length, at: new Date().toISOString() };
  return { ds: out, entry };
}
/* rebuild the working copy from the untouched upload; this is what makes every export reproducible */
function cleanReplay(raw, specs, fileLabel) {
  let ds = raw; const log = [];
  for (const sp of specs || []) { const r = cleanApply(ds, sp, fileLabel); if (r.error) return { ds, log, error: 'Step ' + (log.length + 1) + ' could not be replayed: ' + r.error }; ds = r.ds; r.entry.step = log.length + 1; log.push(r.entry); }
  return { ds, log };
}
function csvField(v) { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function datasetCsv(ds) {
  const lines = [ds.headers.map(csvField).join(',')]; const m = ds.headers.length;
  for (let i = 0; i < ds.nrows; i++) { const r = new Array(m); for (let j = 0; j < m; j++) r[j] = csvField(ds.cols[j][i]); lines.push(r.join(',')); }
  return lines.join('\n') + '\n';
}
function cleanLogCsv(log, meta) {
  const m = meta || {};
  const head = ['step', 'file', 'source_file', 'source_fingerprint', 'operation', 'description', 'parameters', 'columns', 'rows_before', 'rows_after', 'columns_before', 'columns_after', 'cells_changed', 'values_set_missing', 'rows_removed', 'applied_at', 'rationale'];
  const rows = log.map(l => [l.step, l.file, m.source || '', m.fingerprint || '', l.op, l.label, JSON.stringify(l.params), l.columns.join('; '), l.rowsBefore, l.rowsAfter, l.colsBefore, l.colsAfter, l.cellsChanged, l.cellsToMissing, l.rowsRemoved, l.at, l.rationale]);
  return [head.join(',')].concat(rows.map(r => r.map(csvField).join(','))).join('\n') + '\n';
}
function cleanedName(name) { const m = /^(.*?)(\.[^.]+)?$/.exec(name || 'dataset.csv'); return (m[1] || 'dataset') + '_cleaned.csv'; }
SDA.clean = { profile: cleanProfile, apply: cleanApply, replay: cleanReplay, describe: describeSpec, toCsv: datasetCsv, logCsv: cleanLogCsv, fileName: cleanedName, label: OP_LABEL, ridOf };

/* canonical engine statuses: missing, failed or unsupported results are never a numeric zero */
SDA.CANON = { done: 'Completed', partial: 'Partial', blocked: 'Blocked', skip: 'Skipped', fail: 'Failed', na: 'Not applicable' };
function versionText(a, k) { const v = a && a.prep && a.prep.versions; if (!v) return a && a.prep && a.prep.log && a.prep.log.length ? 'prepared copy' : 'raw upload'; const n = (a.prep.log || []).filter(l => l.fileKey === k).length; return v[k] === 'cleaned' ? 'cleaned copy (' + n + ' step' + (n === 1 ? '' : 's') + ')' : 'raw upload'; }
function sampledOf(x, id) { if (!x) return false; if (id === 'fidelity') return !!(x.settings && x.settings.sampled); if (id === 'utility') return !!x.sampled; if (id === 'privacy') return (x.attacks || []).some(t => t.status === 'Completed' && t.sampled); return false; }
function engineStatuses(a, gov) {
  const r = (a && a.results) || {}; const C = SDA.CANON; const out = [];
  const add = (id, label, status, reason, extra) => out.push(Object.assign({ id, label, status, reason: reason || '', sampled: false }, extra || {}));
  const v = r.validation;
  add('validation', 'Validation', v ? C.done : C.skip, v ? (v.warnings.length ? v.warnings.length + ' warning' + (v.warnings.length === 1 ? '' : 's') + ', ' + v.blockers.length + ' blocker' + (v.blockers.length === 1 ? '' : 's') : 'No warnings') : 'Not recorded');
  const P = a && a.prep; const cleaned = P && ((P.versions && (P.versions.real === 'cleaned' || P.versions.synth === 'cleaned')) || (!P.versions && P.log && P.log.length));
  add('preparation', 'Cleaning', cleaned ? C.done : C.skip, P ? 'Real: ' + versionText(a, 'real') + ' · Synthetic: ' + versionText(a, 'synth') : 'Not recorded');
  const map = (x, skipWhy) => !x ? [C.skip, 'Not recorded'] : x.status === 'Completed' ? [C.done, ''] : x.status === 'Partial' ? [C.partial, 'Some attacks failed; see each attack'] : x.status === 'Failed' ? [C.fail, x.error || 'Engine failed'] : x.status === 'Blocked' ? [C.blocked, x.reason || 'Blocked by a data issue'] : [C.skip, x.reason || skipWhy];
  const samp = (id, x, m) => { const sm = sampledOf(x, id); if (sm && (m[0] === C.done || m[0] === C.partial)) m[1] = (m[1] ? m[1] + ' · ' : '') + 'sample-based'; return { sampled: sm && (m[0] === C.done || m[0] === C.partial) }; };
  let m = map(r.fidelity, 'Disabled'); if (m[0] === C.done && r.fidelity.pairTrends === null) m[1] = 'Column-pair trends not applicable: ' + (r.fidelity.pairTrendsNote || 'fewer than two evaluable columns');
  let ex = samp('fidelity', r.fidelity, m); add('fidelity', 'Fidelity', m[0], m[1], ex);
  m = map(r.utility, 'Disabled'); ex = samp('utility', r.utility, m); add('utility', 'Utility', m[0], m[1], ex);
  m = map(r.privacy, 'Disabled'); ex = samp('privacy', r.privacy, m);
  const attacks = (r.privacy && r.privacy.attacks || []).map(x => ({ id: x.id, label: x.short || x.name, status: x.status === 'Completed' ? C.done : x.status === 'Failed' ? C.fail : C.skip, reason: x.error || x.reason || '', sampled: !!x.sampled })).concat((r.privacy && r.privacy.pending || []).map(x => ({ id: x.id, label: x.short || x.name, status: C.na, reason: 'Not available in this version' })));
  add('privacy', 'Privacy', m[0], m[1], Object.assign(ex, { attacks }));
  const E = r.ensemble; add('ensemble', 'Ensemble', !E || E.status === 'Not Run' ? C.skip : E.insufficient || !E.category ? C.partial : C.done, !E || E.status === 'Not Run' ? (E && E.reason) || 'Privacy tests did not run' : E.insufficient || !E.category ? 'Evidence insufficient for a reliable category' : E.label);
  if (gov) { const fw = (a.context && a.context.frameworks) || []; const und = gov.applicability ? gov.applicability.filter(x => /undetermined/i.test(x.status || '')).length : 0;
    add('governance', 'Governance', !fw.length ? C.skip : gov.applicability && gov.applicability.length && und === gov.applicability.length ? C.partial : C.done, !fw.length ? 'No frameworks selected for review' : und ? und + ' framework' + (und === 1 ? '' : 's') + ' with undetermined applicability' : gov.mappings.length + ' review prompt' + (gov.mappings.length === 1 ? '' : 's')); }
  return out;
}
SDA.engineStatuses = engineStatuses;

/* results registry: one normalised record per measured value (guide §52) */
const METRIC_DEF = {
  rows_real: 'Rows in the real dataset version used for the audit.', rows_synthetic: 'Rows in the synthetic dataset version used for the audit.',
  duplicate_rate_real: 'Share of rows in the real data that exactly repeat an earlier row.', duplicate_rate_synthetic: 'Share of rows in the synthetic data that exactly repeat an earlier row.',
  transformations_applied: 'Number of logged cleaning steps applied to the dataset versions used.',
  column_shapes: 'Mean per-column distribution similarity: KS complement (numerical) and TV complement (categorical). 1 = identical.',
  column_pair_trends: 'Mean similarity of pairwise relationships: correlation similarity and contingency similarity. 1 = identical.',
  overall_quality: 'Mean of Column Shapes and Column Pair Trends. Higher is better.',
  avg_correlation_difference: 'Mean absolute difference between real and synthetic Pearson correlations. Lower is better.',
  retention: 'TSTR score ÷ TRTR score × 100 on the same held-out real test rows (error metrics inverted).',
  mia_roc_auc: 'ROC-AUC of the closest-record membership attack. 0.5 = no better than chance.',
  mia_tpr_at_10pct_fpr: 'Share of members correctly flagged when 10% of non-members are wrongly flagged.',
  exact_match_excess: 'Synthetic rows copying a real row, minus the natural collision rate between real rows.',
  risk_category: 'Technical risk category from the documented ensemble rules. Not a legal verdict.',
  review_prompts: 'Evidence-to-provision mappings produced for human review.', pending_reviews: 'Mappings still awaiting a review decision.'
};
function metricDef(name) { if (METRIC_DEF[name]) return METRIC_DEF[name]; const m = /^(trtr|tstr|retention)_(.+)$/.exec(name); if (m) { const meta = METRIC_META[m[2]]; const what = meta ? meta.label : m[2]; return m[1] === 'trtr' ? what + ' of a model trained on real data, tested on held-out real data.' : m[1] === 'tstr' ? what + ' of a model trained on synthetic data, tested on the same held-out real data.' : 'TSTR ÷ TRTR × 100 for ' + what + '.'; } return ''; }
function registryFor(a, gov) {
  const recs = []; if (!a) return recs; const r = a.results || {}; const pv = a.provenance || {};
  const fp = f => f && f.fingerprint ? f.fingerprint.hex : null;
  const pair = fp(a.files.real) && fp(a.files.synth) ? 'PAIR-' + fp(a.files.real).slice(0, 8) + '-' + fp(a.files.synth).slice(0, 8) : 'not recorded';
  const prov = { source: a.source === 'demo' ? 'live (simulated demo data)' : 'live', run_id: a.id, computed_on: a.prep && a.prep.log && a.prep.log.length ? 'cleaned data' : 'raw uploads', data_version_real: versionText(a, 'real'), data_version_synthetic: versionText(a, 'synth'), real_fingerprint: fp(a.files.real), synth_fingerprint: fp(a.files.synth), fingerprint_algo: a.files.real && a.files.real.fingerprint ? a.files.real.fingerprint.algo : null, recorded: !!pv.engineVersions };
  const ver = k => (pv.engineVersions || {})[k] || (k === 'governance' ? a.kbVersion : 'not recorded (audit predates the registry)');
  const statuses = engineStatuses(a, gov); const stOf = id => (statuses.find(x => x.id === id) || {}).status || 'Skipped'; const smOf = id => !!(statuses.find(x => x.id === id) || {}).sampled;
  const add = (engine, metric, value, unit, cfg, extra) => recs.push(Object.assign({ audit_id: a.id, dataset_pair_id: pair, engine_name: engine, engine_version: ver(engine), metric_name: metric, metric_value: value === undefined || value === null || (typeof value === 'number' && !isFinite(value)) ? null : value, metric_unit: unit, metric_definition: metricDef(metric), status: stOf(engine), sample_based: smOf(engine), configuration: cfg || {}, timestamp: a.createdAt, warnings: [], limitations: [], evidence_summary: '', provenance: prov }, extra || {}));
  const v = r.validation;
  if (v) { const cfg = { matched_only: !!(a.settings && a.settings.matchedOnly), excluded: v.plan ? v.plan.excluded : [] };
    add('validation', 'rows_real', v.rows ? v.rows.real : null, 'rows', cfg, { evidence_summary: 'Overall validation ' + v.status }); add('validation', 'rows_synthetic', v.rows ? v.rows.synth : null, 'rows', cfg);
    add('validation', 'duplicate_rate_real', v.duplicates.real ? v.duplicates.real.rate : null, '%', cfg); add('validation', 'duplicate_rate_synthetic', v.duplicates.synth ? v.duplicates.synth.rate : null, '%', cfg, { warnings: v.warnings.map(w => w.text) }); }
  const P = a.prep; if (P) { add('preparation', 'transformations_applied', P.log ? P.log.length : 0, 'steps', { versions: P.versions || null }, { evidence_summary: (P.log || []).map(l => l.file + ': ' + l.label + (l.rowsRemoved ? ' (−' + l.rowsRemoved + ' rows)' : ' (' + l.cellsChanged + ' cells)')).join('; ') || 'None', limitations: ['Cleaning can change fidelity, utility and privacy results. Findings on the raw uploads are kept alongside.'] }); }
  const F = r.fidelity; const fcfg = F && F.settings ? { seed: F.settings.seed, max_rows: F.settings.maxRows, sampled: F.settings.sampled, rows_used_real: F.settings.sampledReal, rows_used_synthetic: F.settings.sampledSynth } : {};
  if (F) { const lim = F.settings && F.settings.sampled ? ['Computed on a seeded sample, not the full files.'] : [];
    add('fidelity', 'column_shapes', F.columnShapes, 'score 0–1', fcfg, { limitations: lim }); add('fidelity', 'column_pair_trends', F.pairTrends, 'score 0–1', fcfg, { limitations: F.status === 'Completed' && (F.pairTrends === null || F.pairTrends === undefined) ? ['Not evaluated: ' + (F.pairTrendsNote || 'no evaluable column pairs')] : lim });
    add('fidelity', 'overall_quality', F.overall, 'score 0–1', fcfg, { limitations: lim, evidence_summary: F.status === 'Failed' ? F.error : 'Mean of the available properties' }); add('fidelity', 'avg_correlation_difference', F.avgCorrDiff, 'abs. Pearson r', fcfg); }
  const U = r.utility; if (U) { const ucfg = U.status === 'Completed' ? { target: U.target, task: U.task, model: U.model, split: U.splitStrategy || '', seed: U.seed, primary_metric: U.primary, retention_formula: U.retentionFormula || '' } : {};
    if (U.status === 'Completed') { U.metricKeys.forEach(k => { add('utility', 'trtr_' + k, U.trtr[k], METRIC_META[k].label, ucfg); add('utility', 'tstr_' + k, U.tstr[k], METRIC_META[k].label, ucfg); });
      add('utility', 'retention_' + U.primary, U.headline.retention, '%', ucfg, { warnings: (U.warnings || []).filter(w => w.level === 'warn').map(w => w.text), evidence_summary: (U.retentionFormula || '') }); }
    else add('utility', 'retention', null, '%', ucfg, { evidence_summary: U.reason || U.error || '' }); }
  const PR = r.privacy; if (PR && PR.attacks) PR.attacks.forEach(x => { const pcfg = { protocol: x.protocol || '', seed: x.seed, validity: x.validity || '' };
    if (x.id === 'mia') { add('privacy', 'mia_roc_auc', x.metrics ? x.metrics.auc : null, 'AUC', pcfg, { limitations: x.caveats || [], evidence_summary: x.status === 'Completed' ? (x.metrics.aucCI ? '95% CI ' + x.metrics.aucCI.map(q => q.toFixed(3)).join('–') : '') : (x.error || x.reason || '') }); add('privacy', 'mia_tpr_at_10pct_fpr', x.metrics ? x.metrics.tpr10 : null, 'rate', pcfg); }
    if (x.id === 'exact') add('privacy', 'exact_match_excess', x.metrics ? x.metrics.excessPp : null, 'percentage points', pcfg, { limitations: x.caveats || [], evidence_summary: x.status === 'Completed' ? '' : (x.error || x.reason || '') }); });
  const E = r.ensemble; if (E) add('ensemble', 'risk_category', null, 'category', { rules: E.rulesVersion || 'EPE-0.1' }, { evidence_summary: E.label || E.reason || '', limitations: ['A technical interpretation under the tested attacks. Not a privacy guarantee or legal verdict.'] });
  if (gov && !((a.context && a.context.frameworks) || []).length) { add('governance', 'review_prompts', null, 'mappings', {}, { evidence_summary: 'Not computed: no frameworks were selected for review.' }); }
  else if (gov) { add('governance', 'review_prompts', gov.mappings.length, 'mappings', { frameworks: (a.context && a.context.frameworks) || [] }, { evidence_summary: gov.gaps.length + ' evidence gaps', limitations: ['Not a legal opinion or certification of compliance.'] }); add('governance', 'pending_reviews', gov.mappings.filter(m => m.reviewStatus === 'Pending' || m.reviewStatus === 'Needs More Information').length, 'mappings', {}); }
  return recs;
}
function registryBaseline() {
  return SDA.baseline.rows.flatMap(b => [['overall_quality', b.overall, 'score 0–1', 'fidelity'], ['column_pair_trends', b.trends, 'score 0–1', 'fidelity'], ['retention', b.retention, '%', 'utility'], ['mia_roc_auc', b.mia, 'AUC', 'privacy']].map(([m, v, u, e]) => ({ audit_id: 'HIST-' + b.name.replace(/\W+/g, '').toUpperCase(), dataset_pair_id: b.name, engine_name: e, engine_version: 'notebook (historical)', metric_name: m, metric_value: v === null || v === undefined ? null : v, metric_unit: u, metric_definition: metricDef(m), sample_based: false, status: v === null || v === undefined ? 'Not applicable' : 'Completed', configuration: {}, timestamp: null, warnings: b.flag ? [b.flag] : [], limitations: ['Historical notebook result transcribed from the project notes; not recomputed by this app.'], evidence_summary: '', provenance: { source: 'historical', run_id: null, source_ref: 'Project notes, section 21 (notebook runs)' } })));
}
function registryCsv(recs) {
  const cols = ['audit_id', 'dataset_pair_id', 'engine_name', 'engine_version', 'metric_name', 'metric_value', 'metric_unit', 'metric_definition', 'status', 'sample_based', 'timestamp', 'source', 'data_version_real', 'data_version_synthetic', 'real_fingerprint', 'synth_fingerprint', 'configuration', 'warnings', 'limitations', 'evidence_summary'];
  const q = x => { const s = x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return cols.join(',') + '\n' + recs.map(r => [r.audit_id, r.dataset_pair_id, r.engine_name, r.engine_version, r.metric_name, r.metric_value, r.metric_unit, r.metric_definition, r.status, r.sample_based ? 'yes' : 'no', r.timestamp, r.provenance.source, r.provenance.data_version_real || '', r.provenance.data_version_synthetic || '', r.provenance.real_fingerprint, r.provenance.synth_fingerprint, r.configuration, r.warnings.join(' | '), r.limitations.join(' | '), r.evidence_summary].map(q).join(',')).join('\n') + '\n';
}
SDA.registry = { forAudit: registryFor, baseline: registryBaseline, csv: registryCsv };
/* one place that turns a finished run into a stored audit record (used by the app and the tests) */
function buildAudit(o) {
  const fileMeta = (ds, raw, fp, pfp) => ({ name: raw ? raw.name : ds.name, size: raw ? raw.size : ds.size, rows: ds.nrows, cols: ds.headers.length, rawRows: raw ? raw.nrows : ds.nrows, rawCols: raw ? raw.headers.length : ds.headers.length, fingerprint: fp || null, preparedFingerprint: pfp || null });
  const res = o.results; res.validation = o.validation; const cl = o.clean || {}; const vers = o.versions || { real: 'raw', synth: 'raw' };
  const logs = [];
  [['real', 'Real'], ['synth', 'Synthetic']].forEach(([k, lab]) => { if (vers[k] === 'cleaned' && cl[k] && cl[k].log) cl[k].log.forEach(l => logs.push(Object.assign({}, l, { file: lab, fileKey: k }))); });
  const cleaned = vers.real === 'cleaned' || vers.synth === 'cleaned';
  const audit = { id: o.id, name: (o.info.name || '').trim() || 'Untitled audit', source: o.source || 'upload', createdAt: new Date().toISOString(), durationMs: res.durationMs, status: auditStatus(res, o.settings),
    files: { real: fileMeta(o.real, o.rawReal, o.fp && o.fp.real, cl.real && vers.real === 'cleaned' ? cl.real.fingerprint : null), synth: fileMeta(o.synth, o.rawSynth, o.fp && o.fp.synth, cl.synth && vers.synth === 'cleaned' ? cl.synth.fingerprint : null) },
    info: JSON.parse(JSON.stringify(o.info)), settings: JSON.parse(JSON.stringify(o.settings)), context: JSON.parse(JSON.stringify(o.gov)), results: res, reviews: {}, kbVersion: SDA.kb ? SDA.kb.version : null,
    prep: { versions: { real: vers.real, synth: vers.synth }, log: logs, rawValidation: cleaned ? o.rawValidation || null : null },
    provenance: { kind: 'live', engine: SDA.engineName + ' ' + SDA.version, engineVersions: Object.assign({}, SDA.engineVersions, { governance: SDA.kb ? SDA.kb.version : null }), seed: o.settings.seed, computedOn: cleaned ? 'prepared' : 'raw' } };
  audit.provenance.dataVersions = { real: versionText(audit, 'real'), synth: versionText(audit, 'synth') };
  return audit;
}
SDA.buildAudit = buildAudit;
})(typeof window !== 'undefined' ? window : globalThis);
