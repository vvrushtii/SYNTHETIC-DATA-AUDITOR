/* Synthetic Data Auditor — Compliance Knowledge Base, applicability screening and Compliance Mapper.
   All rule records ship as UNVERIFIED DRAFTS: a reviewer must check them against the official source and mark them
   project-reviewed before the app treats a mapping as anything more than a review prompt. Governance support only — not legal advice. */
(function (g) {
'use strict';
const SDA = g.SDA = g.SDA || {};
const KB_VERSION = 'KB-0.1-draft';

const OPT = {
  regions: ['EU/EEA', 'UK', 'India', 'United States', 'California (US)', 'Brazil', 'Canada', 'Australia', 'Singapore', 'China', 'Other', 'Unknown', 'Not provided'],
  industries: ['Healthcare', 'Financial services', 'Technology', 'Education / research', 'Public sector', 'Retail / consumer', 'Other', 'Unknown', 'Not provided'],
  orgTypes: ['Healthcare provider, health plan or clearinghouse', 'Business associate / service provider to a healthcare entity', 'Company acting as controller / data fiduciary', 'Processor / service provider', 'Academic or research institution', 'Public authority', 'Unknown', 'Not provided'],
  categories: ['Personal data about identifiable people', 'Health data', 'Financial data', 'Children’s data', 'Biometric or genetic data', 'Other sensitive categories', 'No personal data (stated)', 'Unknown', 'Not provided'],
  purposes: ['Software testing / development', 'ML model training', 'Analytics / research', 'Sharing with third parties', 'Public release', 'Unknown', 'Not provided'],
  recipients: ['Internal team only', 'Named third parties', 'Public release', 'Unknown', 'Not provided'],
  safeguards: ['Access controls', 'Encryption (at rest / in transit)', 'Retention & deletion policy', 'DPIA / risk assessment on file', 'Generator & settings documented', 'Human review process', 'None in place', 'Unknown', 'Not provided']
};
const NONE_VALUES = ['Unknown', 'Not provided'];

/* ───────── framework catalogue ───────── */
const FW = [
  { id: 'gdpr', name: 'GDPR', long: 'General Data Protection Regulation (EU) 2016/679', jurisdiction: 'EU / EEA (can apply extra-territorially)', instrument: 'Binding law', status: 'Draft Rules', version: 'Consolidated text to be confirmed at review', effective: 'In force since 25 May 2018', body: 'EUR-Lex (Publications Office of the EU)', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj', url2: 'https://commission.europa.eu/law/law-topic/data-protection_en', regions: ['EU/EEA'] },
  { id: 'dpdp', name: 'India DPDP Act & Rules', long: 'Digital Personal Data Protection Act, 2023 and applicable rules', jurisdiction: 'India', instrument: 'Binding law', status: 'Needs Update', version: 'Act of 2023; Rules and phased commencement to be re-verified', effective: 'Commencement is notified in phases — verification required', body: 'India Code / MeitY', url: 'https://www.indiacode.nic.in/', url2: 'https://www.meity.gov.in/', regions: ['India'], note: 'Marked Needs Update because commencement dates and rules change by notification; check the current position before relying on any mapping.' },
  { id: 'hipaa', name: 'HIPAA', long: 'Health Insurance Portability and Accountability Act — Privacy, Security & Breach Notification Rules (45 CFR Parts 160 and 164)', jurisdiction: 'United States (health-sector entities only)', instrument: 'Binding law', status: 'Draft Rules', version: 'Current eCFR text to be confirmed at review', effective: 'In force', body: 'U.S. HHS Office for Civil Rights', url: 'https://www.hhs.gov/hipaa/for-professionals/privacy/index.html', url2: 'https://www.hhs.gov/hipaa/for-professionals/security/index.html', regions: ['United States'], note: 'Applies to covered entities and business associates, not to every health dataset or company.' },
  { id: 'ukgdpr', name: 'UK GDPR & DPA 2018', long: 'UK GDPR and Data Protection Act 2018', jurisdiction: 'United Kingdom', instrument: 'Binding law', status: 'Catalogue Only', version: 'Not collected', effective: 'In force — check recent amendments', body: 'legislation.gov.uk / ICO', url: 'https://www.legislation.gov.uk/', url2: 'https://ico.org.uk/', regions: ['UK'] },
  { id: 'ccpa', name: 'California CCPA / CPRA', long: 'California Consumer Privacy Act as amended by the CPRA', jurisdiction: 'California, United States', instrument: 'Binding law', status: 'Catalogue Only', version: 'Not collected', effective: 'In force — thresholds and exemptions apply', body: 'California Legislative Information / CPPA', url: 'https://leginfo.legislature.ca.gov/', url2: 'https://cppa.ca.gov/', regions: ['California (US)'] },
  { id: 'lgpd', name: 'Brazil LGPD', long: 'Lei Geral de Proteção de Dados (Law 13.709/2018)', jurisdiction: 'Brazil', instrument: 'Binding law', status: 'Catalogue Only', version: 'Not collected', effective: 'In force', body: 'Planalto / ANPD', url: 'https://www.planalto.gov.br/', url2: 'https://www.gov.br/anpd/', regions: ['Brazil'] },
  { id: 'pipeda', name: 'Canada PIPEDA', long: 'Personal Information Protection and Electronic Documents Act', jurisdiction: 'Canada (federal; provincial laws may also apply)', instrument: 'Binding law', status: 'Catalogue Only', version: 'Not collected', effective: 'In force', body: 'Office of the Privacy Commissioner / Justice Laws', url: 'https://www.priv.gc.ca/', url2: 'https://laws-lois.justice.gc.ca/', regions: ['Canada'] },
  { id: 'auspa', name: 'Australia Privacy Act', long: 'Privacy Act 1988 (Cth) and Australian Privacy Principles', jurisdiction: 'Australia', instrument: 'Binding law', status: 'Catalogue Only', version: 'Not collected', effective: 'In force — amendments pending/recent', body: 'Federal Register of Legislation / OAIC', url: 'https://www.legislation.gov.au/', url2: 'https://www.oaic.gov.au/', regions: ['Australia'] },
  { id: 'pdpa', name: 'Singapore PDPA', long: 'Personal Data Protection Act 2012', jurisdiction: 'Singapore', instrument: 'Binding law', status: 'Catalogue Only', version: 'Not collected', effective: 'In force', body: 'Singapore Statutes Online / PDPC', url: 'https://sso.agc.gov.sg/', url2: 'https://www.pdpc.gov.sg/', regions: ['Singapore'] },
  { id: 'pipl', name: 'China PIPL', long: 'Personal Information Protection Law of the PRC', jurisdiction: 'China', instrument: 'Binding law', status: 'Not Supported', version: 'Not collected', effective: 'In force', body: 'NPC / Cyberspace Administration of China', url: 'https://www.npc.gov.cn/', url2: 'https://www.cac.gov.cn/', regions: ['China'], note: 'Not supported: authoritative translation and interpretation need qualified review.' },
  { id: 'aiact', name: 'EU AI Act', long: 'Regulation (EU) 2024/1689 laying down harmonised rules on artificial intelligence', jurisdiction: 'EU / EEA', instrument: 'Binding law', status: 'Catalogue Only', version: 'Not collected', effective: 'Phased application — verify dates', body: 'EUR-Lex / European Commission', url: 'https://eur-lex.europa.eu/', url2: 'https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai', regions: ['EU/EEA'], note: 'Scope depends on the AI system and its risk class; synthetic-data use is not automatically in scope.' },
  { id: 'nistpf', name: 'NIST Privacy Framework', long: 'NIST Privacy Framework: A Tool for Improving Privacy through Enterprise Risk Management', jurisdiction: 'International (U.S. NIST)', instrument: 'Voluntary framework', status: 'Draft Rules', version: 'Version 1.0 (2020); a revised version may exist — verify', effective: 'Voluntary — no legal force', body: 'NIST', url: 'https://www.nist.gov/privacy-framework', url2: '', regions: [] },
  { id: 'nistai', name: 'NIST AI RMF', long: 'NIST Artificial Intelligence Risk Management Framework (AI RMF 1.0)', jurisdiction: 'International (U.S. NIST)', instrument: 'Voluntary framework', status: 'Draft Rules', version: 'AI RMF 1.0 (2023)', effective: 'Voluntary — no legal force', body: 'NIST', url: 'https://www.nist.gov/itl/ai-risk-management-framework', url2: '', regions: [] },
  { id: 'iso27001', name: 'ISO/IEC 27001', long: 'ISO/IEC 27001 Information security management systems', jurisdiction: 'International', instrument: 'Technical standard', status: 'Catalogue Only', version: 'Edition to be confirmed (2022 edition current at drafting)', effective: 'Certifiable standard — voluntary', body: 'ISO / IEC', url: 'https://www.iso.org/', url2: '', regions: [], note: 'Licensed text is not reproduced; only permitted identifiers and summaries can be stored.' },
  { id: 'iso27701', name: 'ISO/IEC 27701', long: 'ISO/IEC 27701 Privacy information management', jurisdiction: 'International', instrument: 'Technical standard', status: 'Not Supported', version: 'Edition to be confirmed — a revised edition may supersede 2019', effective: 'Certifiable standard — voluntary', body: 'ISO / IEC', url: 'https://www.iso.org/', url2: '', regions: [], note: 'Not supported until licensing and the current edition are confirmed.' }
];

/* ───────── knowledge-base rule records (draft) ───────── */
const R = (fw, id, prov, title, summary, conds, extra) => Object.assign({ id, fw, provision: prov, title, summary, conditions: conds, reviewDate: null, verification: 'Unverified draft' }, extra || {});
const RULES = [
  R('gdpr', 'GDPR-REC26', 'Recital 26', 'Anonymous information', 'The principles of data protection do not apply to anonymous information. To decide whether a person is identifiable, account should be taken of all the means reasonably likely to be used to identify them, directly or indirectly.', 'GDPR in scope (EU/EEA connection) and a claim that a dataset is anonymous or non-personal.', { sourceType: 'Primary legal text (recital — interpretive)' }),
  R('gdpr', 'GDPR-A4-1', 'Article 4(1)', 'Definition of personal data', 'Personal data means any information relating to an identified or identifiable natural person.', 'GDPR in scope; source data relates to people.', { sourceType: 'Primary legal text' }),
  R('gdpr', 'GDPR-A5-1a', 'Article 5(1)(a)', 'Lawfulness, fairness and transparency', 'Personal data must be processed lawfully, fairly and in a transparent manner.', 'GDPR in scope; source data is personal data.', { sourceType: 'Primary legal text' }),
  R('gdpr', 'GDPR-A5-1b', 'Article 5(1)(b)', 'Purpose limitation', 'Personal data must be collected for specified, explicit and legitimate purposes and not further processed in an incompatible manner.', 'GDPR in scope; source data is personal data.', { sourceType: 'Primary legal text' }),
  R('gdpr', 'GDPR-A5-1c', 'Article 5(1)(c)', 'Data minimisation', 'Personal data must be adequate, relevant and limited to what is necessary for the purposes.', 'GDPR in scope; source data is personal data.', { sourceType: 'Primary legal text' }),
  R('gdpr', 'GDPR-A5-1e', 'Article 5(1)(e)', 'Storage limitation', 'Personal data must be kept in identifiable form no longer than necessary for the purposes.', 'GDPR in scope; source data is personal data.', { sourceType: 'Primary legal text' }),
  R('gdpr', 'GDPR-A25', 'Article 25', 'Data protection by design and by default', 'The controller must implement appropriate technical and organisational measures designed to implement data-protection principles and to process only data necessary for each purpose.', 'GDPR in scope; controller role.', { sourceType: 'Primary legal text' }),
  R('gdpr', 'GDPR-A32', 'Article 32', 'Security of processing', 'Controllers and processors must implement measures appropriate to the risk, which may include pseudonymisation, encryption and regular testing of effectiveness.', 'GDPR in scope; controller or processor role.', { sourceType: 'Primary legal text' }),
  R('gdpr', 'GDPR-A35', 'Article 35', 'Data protection impact assessment', 'Where processing is likely to result in a high risk to individuals, an assessment of the impact of the envisaged processing must be carried out beforehand.', 'GDPR in scope; processing likely to be high risk (e.g. sensitive categories, new technologies).', { sourceType: 'Primary legal text' }),
  R('dpdp', 'DPDP-S2T', 'Section 2(t)', 'Definition of personal data', 'Personal data means any data about an individual who is identifiable by or in relation to such data.', 'DPDP Act in scope; digital personal data.', { sourceType: 'Primary legal text' }),
  R('dpdp', 'DPDP-S4', 'Section 4', 'Grounds for processing', 'Personal data may be processed only in accordance with the Act and for a lawful purpose for which the Data Principal has given consent or for certain legitimate uses.', 'DPDP Act in scope.', { sourceType: 'Primary legal text' }),
  R('dpdp', 'DPDP-S8-5', 'Section 8(5)', 'Reasonable security safeguards', 'A Data Fiduciary must protect personal data in its possession or under its control by taking reasonable security safeguards to prevent a personal data breach.', 'DPDP Act in scope; Data Fiduciary role.', { sourceType: 'Primary legal text' }),
  R('dpdp', 'DPDP-S8-7', 'Section 8(7)', 'Erasure when purpose is served', 'A Data Fiduciary must erase personal data when the Data Principal withdraws consent or the specified purpose is no longer being served, unless retention is required by law.', 'DPDP Act in scope; Data Fiduciary role.', { sourceType: 'Primary legal text' }),
  R('hipaa', 'HIPAA-164.514b', '45 CFR § 164.514(b)', 'De-identification standard', 'Health information is not individually identifiable if de-identified either by a qualified expert determination or by removing specified identifiers (Safe Harbor) with no actual knowledge that the remainder could identify an individual.', 'Covered entity or business associate holding protected health information.', { sourceType: 'Primary legal text (eCFR) + HHS guidance', url: 'https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-E/section-164.514' }),
  R('hipaa', 'HIPAA-164.306a', '45 CFR § 164.306(a)', 'Security Rule — general requirements', 'Covered entities and business associates must ensure the confidentiality, integrity and availability of electronic protected health information and protect against reasonably anticipated threats.', 'Covered entity or business associate holding ePHI.', { sourceType: 'Primary legal text (eCFR)', url: 'https://www.hhs.gov/hipaa/for-professionals/security/index.html' }),
  R('nistpf', 'NISTPF-IDRAP', 'ID.RA-P', 'Risk Assessment', 'The organisation understands the privacy risks to individuals and how such risks may create follow-on impacts on organisational operations.', 'Organisation voluntarily adopts the NIST Privacy Framework.', { sourceType: 'Official voluntary framework' }),
  R('nistpf', 'NISTPF-CTDPP', 'CT.DP-P', 'Disassociated Processing', 'Data processing solutions increase disassociability consistent with the organisation’s risk strategy to protect individuals’ privacy.', 'Organisation voluntarily adopts the NIST Privacy Framework.', { sourceType: 'Official voluntary framework' }),
  R('nistpf', 'NISTPF-PRDSP', 'PR.DS-P', 'Data Security', 'Data are managed consistent with the organisation’s risk strategy to protect individuals’ privacy and maintain data confidentiality, integrity and availability.', 'Organisation voluntarily adopts the NIST Privacy Framework.', { sourceType: 'Official voluntary framework' }),
  R('nistpf', 'NISTPF-GVPOP', 'GV.PO-P', 'Governance Policies, Processes and Procedures', 'Policies, processes and procedures for managing privacy risk are established, communicated and enforced.', 'Organisation voluntarily adopts the NIST Privacy Framework.', { sourceType: 'Official voluntary framework' }),
  R('nistai', 'NISTAI-M210', 'MEASURE 2.10', 'Privacy risk of the AI system', 'Privacy risk of the AI system — as identified in the MAP function — is examined and documented.', 'Organisation voluntarily adopts the NIST AI RMF.', { sourceType: 'Official voluntary framework' }),
  R('nistai', 'NISTAI-M21', 'MEASURE 2.1', 'Test sets, metrics and TEVV details documented', 'Test sets, metrics, and details about the tools used during test, evaluation, validation and verification (TEVV) are documented.', 'Organisation voluntarily adopts the NIST AI RMF.', { sourceType: 'Official voluntary framework' })
];
RULES.forEach(r => {
  const f = FW.find(x => x.id === r.fw);
  r.frameworkName = f.name; r.instrument = f.instrument; r.url = r.url || f.url;
  r.version = f.version; r.effectiveStatus = f.effective; r.effectiveVerified = false;
  r.urlNote = 'Link goes to the issuing body; add a provision-level deep link at review.';
});

/* ───────── helpers ───────── */
const hasReal = arr => Array.isArray(arr) && arr.some(x => NONE_VALUES.indexOf(x) < 0);
const isUnknown = arr => !Array.isArray(arr) || arr.length === 0 || (arr.every(x => NONE_VALUES.indexOf(x) >= 0));
const has = (arr, v) => Array.isArray(arr) && arr.indexOf(v) >= 0;
const txt = s => typeof s === 'string' && s.trim().length > 0 && !/^(unknown|not provided)$/i.test(s.trim());
function realRegions(ctx) { return (ctx.regions || []).concat(ctx.subjectRegions || []).filter(x => NONE_VALUES.indexOf(x) < 0); }

/* effective rule view with the reviewer overlay */
function ruleView(rule, kbState) {
  const o = (kbState || {})[rule.id]; const out = Object.assign({}, rule);
  if (o && o.verification === 'Project-reviewed') {
    out.verification = 'Project-reviewed'; out.reviewer = o.reviewer; out.reviewDate = o.date; out.reviewNote = o.note;
    const age = (Date.now() - Date.parse(o.date)) / 864e5;
    if (age > 365) { out.verification = 'Needs re-review'; out.stale = true; }
  }
  out.effectiveVerified = out.verification === 'Project-reviewed';
  return out;
}
function frameworkView(f, kbState) {
  const rs = RULES.filter(r => r.fw === f.id).map(r => ruleView(r, kbState));
  const reviewed = rs.filter(r => r.verification === 'Project-reviewed').length, stale = rs.filter(r => r.stale).length;
  let status = f.status;
  if (rs.length) {
    if (stale) status = 'Needs Update';
    else if (reviewed && (f.status === 'Draft Rules' || f.status === 'Verified Subset')) status = 'Verified Subset';
    else if (reviewed === rs.length && f.status === 'Needs Update') status = 'Verified Subset';
  }
  const last = rs.map(r => r.reviewDate).filter(Boolean).sort().pop() || null;
  return Object.assign({}, f, { status, ruleCount: rs.length, reviewedCount: reviewed, lastChecked: last, freshness: last ? 'Last reviewed ' + last : 'No source check recorded' });
}

/* ───────── applicability screening ───────── */
const ST_REL = 'Potentially Relevant', ST_NOT = 'Not Indicated by Known Context', ST_UND = 'Undetermined', ST_REV = 'Needs Human Review';
function screen(ctx, fw) {
  const regs = realRegions(ctx); const reasons = []; const missing = []; let status = ST_UND;
  const locUnknown = regs.length === 0; if (locUnknown) missing.push('Country / region of the organisation, processing or data subjects');
  const cats = ctx.dataCategories || []; const catsUnknown = isUnknown(cats); if (catsUnknown) missing.push('Data categories');
  const noPersonal = has(cats, 'No personal data (stated)');
  const health = has(cats, 'Health data'); const hasRegion = r => regs.indexOf(r) >= 0;
  const purposes = ctx.purposes || []; const aiUse = has(purposes, 'ML model training');
  const selected = (ctx.frameworks || []).indexOf(fw.id) >= 0;
  const legal = fw.instrument === 'Binding law';
  if (fw.id === 'hipaa') {
    if (locUnknown) { status = ST_UND; reasons.push('No region supplied, so HIPAA’s US-health-sector scope cannot be judged.'); }
    else if (!hasRegion('United States')) { status = ST_NOT; reasons.push('No United States connection was stated.'); }
    else if (catsUnknown) { status = ST_UND; reasons.push('A US connection was stated but data categories are unknown.'); }
    else if (!health) { status = ST_NOT; reasons.push('HIPAA concerns protected health information; no health data was declared.'); }
    else if (ctx.orgType === 'Healthcare provider, health plan or clearinghouse' || ctx.orgType === 'Business associate / service provider to a healthcare entity') { status = ST_REL; reasons.push('US connection, health data and a covered-entity / business-associate role were stated. Confirm the role and that the data is protected health information.'); }
    else if (!txt(ctx.orgType) || NONE_VALUES.indexOf(ctx.orgType) >= 0) { status = ST_REV; reasons.push('US + health data were stated, but covered-entity / business-associate status is unknown. Health data alone does not establish that HIPAA applies.'); missing.push('Organisation role (covered entity / business associate?)'); }
    else { status = ST_REV; reasons.push('US + health data stated, but the organisation type given is not a typical covered entity. It might still be a business associate — needs human review.'); }
  } else if (fw.id === 'ccpa') {
    if (locUnknown) { status = ST_UND; reasons.push('No region supplied.'); }
    else if (hasRegion('California (US)')) { status = ST_REV; reasons.push('A California connection was stated. Applicability also depends on business thresholds, exemptions and the data involved — needs human review.'); }
    else if (hasRegion('United States')) { status = ST_UND; reasons.push('Only “United States” was stated; whether California residents are involved is unknown.'); missing.push('Whether California residents are data subjects'); }
    else { status = ST_NOT; reasons.push('No California / US connection was stated.'); }
  } else if (fw.id === 'aiact') {
    if (locUnknown) { status = ST_UND; reasons.push('No region supplied.'); }
    else if (!hasRegion('EU/EEA')) { status = ST_NOT; reasons.push('No EU/EEA connection was stated.'); }
    else if (aiUse) { status = ST_REV; reasons.push('EU connection plus ML model training was stated. Whether an in-scope AI system exists, and its risk class, needs human review.'); }
    else if (isUnknown(purposes)) { status = ST_UND; reasons.push('EU connection stated; intended use unknown, so AI-system scope cannot be judged.'); missing.push('Intended purpose / use'); }
    else { status = ST_NOT; reasons.push('The declared purposes do not include developing or deploying an AI system.'); }
  } else if (legal) {
    if (locUnknown) { status = ST_UND; reasons.push('No region supplied; legal scope is territorial, so applicability stays undetermined.'); }
    else if (fw.regions.some(hasRegion)) {
      if (noPersonal) { status = ST_NOT; reasons.push('Region match (' + fw.regions.filter(hasRegion).join(', ') + '), but you stated that no personal data is involved.'); }
      else { status = ST_REL; reasons.push('A connection to ' + fw.regions.filter(hasRegion).join(', ') + ' was stated.' + (catsUnknown ? ' Personal-data status is unknown, so this remains a prompt to review, not a conclusion.' : ' Role (controller / processor) and exact scope still need review.')); }
    } else { status = ST_NOT; reasons.push('None of the stated regions (' + regs.join(', ') + ') matches ' + fw.jurisdiction + '.'); }
  } else if (fw.id === 'nistai') {
    status = selected ? (aiUse || isUnknown(purposes) ? ST_REL : ST_UND) : ST_UND; reasons.push('Voluntary framework — no legal obligation. Relevant if the organisation uses it to manage AI risk' + (aiUse ? ' (ML model training was stated).' : '.'));
  } else if (fw.instrument === 'Voluntary framework') {
    status = ST_REL; reasons.push('Voluntary framework — no legal obligation. Relevant if the organisation has adopted or benchmarks against it.');
  } else {
    status = ST_UND; reasons.push('Technical standard — relevant only if the organisation operates or seeks certification for a management system within this scope.'); missing.push('Whether an ISO management system is in scope');
  }
  return { id: fw.id, name: fw.name, instrument: fw.instrument, status, reasons, missing, selected };
}
function suggest(ctx) { const regs = realRegions(ctx); const out = []; FW.forEach(f => { if (f.regions.some(r => regs.indexOf(r) >= 0)) out.push(f.id); }); if (has(ctx.dataCategories, 'Health data') && regs.indexOf('United States') >= 0 && out.indexOf('hipaa') < 0) out.push('hipaa'); return out; }

/* ───────── evidence collection ───────── */
const fmt = (v, d) => typeof v === 'number' && isFinite(v) ? v.toFixed(d === undefined ? 3 : d) : '—';
function collectEvidence(audit) {
  const res = audit.results || {}, ctx = audit.context || {}, info = audit.info || {};
  const priv = res.privacy || {}, ens = res.ensemble || {}; const att = {}; (priv.attacks || []).forEach(a => att[a.id] = a);
  const E = { ctx, info, res, cat: ens.category || null, ens, att, mia: att.mia && att.mia.status === 'Completed' ? att.mia : null, exact: att.exact && att.exact.status === 'Completed' ? att.exact : null };
  E.privRun = priv.status === 'Completed' || priv.status === 'Partial';
  E.privIncomplete = !E.privRun || (priv.attacks || []).some(a => a.status !== 'Completed') || ens.category === 'Inconclusive';
  E.miaTxt = E.mia ? 'MIA ROC-AUC ' + fmt(E.mia.metrics.auc) + (E.mia.metrics.aucCI ? ' (95% CI ' + fmt(E.mia.metrics.aucCI[0]) + '–' + fmt(E.mia.metrics.aucCI[1]) + ')' : '') + ', TPR@10%FPR ' + fmt(E.mia.metrics.tpr10) + '; ' + E.mia.sampleSizes.members + ' members / ' + E.mia.sampleSizes.nonMembers + ' non-members; membership setup: ' + E.mia.validity : '';
  E.exactTxt = E.exact ? 'Exact-match rate ' + fmt(E.exact.metrics.synthMatchRate, 2) + '% vs baseline ' + fmt(E.exact.metrics.baselineMatchRate, 2) + '% (excess ' + fmt(E.exact.metrics.excessPp, 2) + ' pp; ' + E.exact.metrics.synthMatches + ' synthetic rows copied)' : '';
  E.ensTxt = ens.category ? 'Ensemble interpretation: ' + ens.label + ' (' + (ens.coverage ? ens.coverage.completed + ' of ' + ens.coverage.planned + ' attack types tested' : '') + ')' : '';
  E.idDeclared = (info.idCols || '').split(/[,\n;]+/).map(s => s.trim()).filter(Boolean);
  const v = res.validation || {}; E.suspectedIds = (v.warnings || []).filter(w => /^ident:/.test(w.id)).map(w => w.id.slice(6));
  E.fid = res.fidelity && res.fidelity.status === 'Completed' ? res.fidelity.overall : null;
  E.known = { purpose: hasReal(ctx.purposes) || txt(ctx.purposeText), source: txt(ctx.sourceText), safeguards: hasReal(ctx.safeguards), recipients: hasReal(ctx.recipients) || txt(ctx.recipientsText), generator: txt(info.generator) || has(ctx.safeguards, 'Generator & settings documented'), regions: realRegions(ctx).length > 0, categories: !isUnknown(ctx.dataCategories) };
  E.retention = has(ctx.safeguards, 'Retention & deletion policy'); E.dpia = has(ctx.safeguards, 'DPIA / risk assessment on file'); E.noSafeguards = has(ctx.safeguards, 'None in place'); E.access = has(ctx.safeguards, 'Access controls') || has(ctx.safeguards, 'Encryption (at rest / in transit)');
  return E;
}

/* ───────── mapping rules ───────── */
const SUF = { S: 'Sufficient', P: 'Partial', I: 'Insufficient' };
const MR = [
  { id: 'MR-01', finding: 'Empirical privacy signal at or above Moderate', type: 'technical', priority: 'High',
    when: E => E.res.ensemble && (E.cat === 'High' || E.cat === 'Moderate'),
    evidence: E => [E.ensTxt, E.miaTxt, E.exactTxt].filter(Boolean).join(' · '), sufficiency: E => E.mia && E.mia.validity !== 'proxy' && E.exact ? SUF.S : SUF.P,
    targets: ['GDPR-REC26', 'DPDP-S2T', 'HIPAA-164.514b', 'NISTPF-CTDPP', 'NISTPF-IDRAP', 'NISTAI-M210'],
    why: { 'GDPR-REC26': 'Whether data is anonymous depends on the means reasonably likely to be used to identify a person. A concerning attack result is evidence a reviewer weighs against treating the synthetic set as anonymous.', 'DPDP-S2T': 'Personal data is data about an individual who is identifiable by or in relation to it. Records that remain linkable to real individuals may fall within this definition.', 'HIPAA-164.514b': 'De-identification requires that remaining information cannot identify an individual (expert determination or Safe Harbor). Attack evidence is an input to that determination.', 'NISTPF-CTDPP': 'Disassociability is the privacy outcome this control addresses; an attack signal indicates disassociability may be weaker than intended.', 'NISTPF-IDRAP': 'The privacy risk to individuals from releasing this dataset should be assessed and documented; this result is a risk input.', 'NISTAI-M210': 'Privacy risk of the AI system / data pipeline should be examined and documented; this audit supplies measured evidence.' },
    action: 'Review the generation process and mitigation options (regularisation, smaller training memorisation, differential privacy), re-run the audit, and have a qualified reviewer decide whether the dataset can be treated as non-personal.' },
  { id: 'MR-02', finding: 'Verbatim records reproduced from the real data', type: 'technical', priority: 'High',
    when: E => E.exact && E.exact.metrics.synthMatches > 0 && E.exact.metrics.excessPp > 0,
    evidence: E => E.exactTxt, sufficiency: E => SUF.S, targets: ['GDPR-A4-1', 'DPDP-S2T', 'HIPAA-164.514b'],
    why: { 'GDPR-A4-1': 'Synthetic rows that exactly equal real rows are information that may still relate to an identifiable person.', 'DPDP-S2T': 'Exact copies of real records are data that may remain identifiable by or in relation to individuals.', 'HIPAA-164.514b': 'Exact copies undermine the claim that identifiers have been removed or that the expert determination holds.' },
    action: 'Inspect the copied rows (securely), find out why the generator reproduced them, and remove or regenerate them before any release.' },
  { id: 'MR-03', finding: 'Privacy evidence is incomplete or inconclusive', type: 'technical', priority: 'Medium',
    when: E => E.res.privacy && E.res.privacy.status !== undefined && E.privIncomplete && E.cat !== 'High' && E.cat !== 'Moderate',
    evidence: E => (E.privRun ? 'Privacy tests ran but the interpretation is ' + (E.ens.label || 'incomplete') + '.' : 'Privacy tests were not run for this audit.') + (E.fid !== null ? ' Fidelity overall ' + fmt(E.fid) + ' is available but does not measure privacy.' : ''),
    sufficiency: E => SUF.I, targets: ['GDPR-REC26', 'NISTAI-M210', 'NISTPF-IDRAP'],
    why: { 'GDPR-REC26': 'An anonymity assessment needs evidence about identifiability. Incomplete testing leaves the question open rather than answering it either way.', 'NISTAI-M210': 'Privacy risk must be examined and documented; no (or incomplete) privacy evidence means this documentation is missing.', 'NISTPF-IDRAP': 'A risk assessment needs privacy-risk inputs; attack evidence is currently incomplete.' },
    action: 'Complete the implemented privacy tests with a labelled or attested membership setup, then re-run the interpretation. Do not treat fidelity or utility as privacy evidence.' },
  { id: 'MR-04', finding: 'Low observed concern — keep the evidence on file', type: 'technical', priority: 'Low',
    when: E => E.cat === 'Low', evidence: E => E.ensTxt + ' · ' + E.miaTxt + (E.exactTxt ? ' · ' + E.exactTxt : ''), sufficiency: E => SUF.P, targets: ['NISTAI-M210', 'NISTPF-CTDPP'],
    why: { 'NISTAI-M210': 'Documented test results are the record that privacy risk was examined.', 'NISTPF-CTDPP': 'Low observed attack signal supports (but does not prove) disassociability.' },
    action: 'Store the audit report with the dataset release record. Note that only a subset of attack types was run; this is not proof of safety.' },
  { id: 'MR-05', finding: 'Possible identifier columns not excluded', type: 'technical', priority: 'Medium',
    when: E => E.suspectedIds.length > 0 && E.suspectedIds.some(n => E.idDeclared.indexOf(n) < 0), evidence: E => 'Columns that look like identifiers (name pattern or all-unique values): ' + E.suspectedIds.filter(n => E.idDeclared.indexOf(n) < 0).join(', ') + '. Heuristic only — column names alone do not establish identifiers.',
    sufficiency: E => SUF.P, targets: ['GDPR-A5-1c', 'HIPAA-164.514b'], why: { 'GDPR-A5-1c': 'Retaining identifier-like fields may exceed what is necessary for the stated purpose.', 'HIPAA-164.514b': 'Safe Harbor requires removal of listed identifiers; identifier-like columns are a prompt to check.' },
    action: 'Confirm whether each flagged column is a real identifier. If so, declare it as an excluded identifier and re-run; if the generator saw it, review how it was handled.' },
  { id: 'MR-06', finding: 'Intended purpose not provided', type: 'governance-gap', priority: 'Medium',
    when: E => !E.known.purpose, evidence: E => 'Governance context: purpose and intended use = Not provided / Unknown (user-reported field left open). This is a missing answer, not a failed check.', sufficiency: E => SUF.I,
    targets: ['GDPR-A5-1b', 'DPDP-S4'], why: { 'GDPR-A5-1b': 'Purpose limitation requires specified, explicit purposes; the audit cannot relate its findings to a purpose that was not stated.', 'DPDP-S4': 'Processing must be for a lawful purpose; the purpose has not been supplied to this audit.' },
    action: 'Record the specific purpose(s) the synthetic dataset will serve and who may use it.' },
  { id: 'MR-07', finding: 'Data source / lawful-collection context not provided', type: 'governance-gap', priority: 'Medium',
    when: E => !E.known.source, evidence: E => 'Governance context: data source and processing context = Not provided. Synthetic generation does not remove questions about how the source data was obtained.', sufficiency: E => SUF.I,
    targets: ['GDPR-A5-1a', 'DPDP-S4'], why: { 'GDPR-A5-1a': 'Lawfulness of the source processing is not addressed by the synthetic output; the source context is unknown.', 'DPDP-S4': 'The ground on which the source data was processed is unknown.' },
    action: 'Document where the real data came from, the basis for processing it, and whether using it to generate synthetic data fits that basis.' },
  { id: 'MR-08', finding: 'Security safeguards unknown or stated absent', type: 'governance-gap', priority: 'Medium',
    when: E => !E.access && (E.noSafeguards || !E.known.safeguards), evidence: E => E.noSafeguards ? 'Governance context: user stated no safeguards are in place (user-reported, unverified).' : 'Governance context: safeguards = Not provided / Unknown. Controls are unverified, not failed.', sufficiency: E => E.noSafeguards ? SUF.P : SUF.I,
    targets: ['GDPR-A32', 'DPDP-S8-5', 'HIPAA-164.306a', 'NISTPF-PRDSP'], why: { 'GDPR-A32': 'Security measures appropriate to the risk are required for real and synthetic copies during processing.', 'DPDP-S8-5': 'Reasonable security safeguards are expected for data under the fiduciary’s control.', 'HIPAA-164.306a': 'Safeguards for electronic PHI apply to the real data used to build the generator.', 'NISTPF-PRDSP': 'Data security controls are part of managing privacy risk.' },
    action: 'List the access, encryption and handling controls covering the real file, the generator, and the synthetic outputs, with evidence for each.' },
  { id: 'MR-09', finding: 'Retention / deletion process not documented', type: 'governance-gap', priority: 'Low',
    when: E => !E.retention, evidence: E => 'Governance context does not include a retention & deletion policy (' + (E.known.safeguards ? 'other safeguards were listed' : 'safeguards not provided') + ').', sufficiency: E => SUF.I,
    targets: ['GDPR-A5-1e', 'DPDP-S8-7'], why: { 'GDPR-A5-1e': 'Identifiable source data should not be kept longer than necessary; the retention position is not documented.', 'DPDP-S8-7': 'Erasure once the purpose is served is expected; no deletion process was recorded.' },
    action: 'Document how long the real file, the generator and the synthetic data are kept, and how deletion is carried out.' },
  { id: 'MR-10', finding: 'No impact assessment on file despite a concerning privacy signal', type: 'technical', priority: 'High',
    when: E => (E.cat === 'High' || E.cat === 'Moderate') && !E.dpia, evidence: E => E.ensTxt + '. DPIA / risk assessment is not listed among existing safeguards.', sufficiency: E => SUF.P,
    targets: ['GDPR-A35', 'GDPR-A25'], why: { 'GDPR-A35': 'Processing likely to be high risk needs an impact assessment; a concerning privacy signal is relevant to that judgement.', 'GDPR-A25': 'Data protection by design includes choosing generation settings that limit exposure of individuals.' },
    action: 'Have the privacy lead decide whether an impact assessment is required and attach this audit as input.' },
  { id: 'MR-11', finding: 'Generator and settings documentation incomplete', type: 'governance-gap', priority: 'Low',
    when: E => !E.known.generator, evidence: E => 'No generator / method description was provided and “Generator & settings documented” was not ticked.', sufficiency: E => SUF.I,
    targets: ['NISTAI-M21', 'NISTPF-GVPOP'], why: { 'NISTAI-M21': 'Test sets, metrics and the tools used for evaluation should be documented so results can be reproduced.', 'NISTPF-GVPOP': 'Documented processes support governance of privacy risk.' },
    action: 'Record the generator, its version, training data scope and hyper-parameters alongside this audit.' },
  { id: 'MR-12', finding: 'High fidelity without privacy evidence', type: 'technical', priority: 'Medium',
    when: E => E.fid !== null && E.fid >= 0.85 && E.privIncomplete, evidence: E => 'Fidelity overall ' + fmt(E.fid) + ' (higher is closer to the real data) while privacy evidence is incomplete.', sufficiency: E => SUF.P,
    targets: ['NISTAI-M210'], why: { 'NISTAI-M210': 'A close statistical match can also mean closer reproduction of individuals; it is not privacy evidence and cannot offset a missing or concerning privacy result.' },
    action: 'Do not describe the dataset as “safe” on the basis of fidelity or utility. Complete the privacy evidence first.' }
];
SDA.ruleById = id => RULES.find(r => r.id === id);

function buildGovernance(audit, kbState) {
  const ctx = audit.context || {}; const E = collectEvidence(audit);
  const selected = ctx.frameworks || [];
  const fwViews = FW.map(f => frameworkView(f, kbState));
  const applic = selected.map(id => { const f = FW.find(x => x.id === id); return f ? screen(ctx, f) : null; }).filter(Boolean);
  const appById = {}; applic.forEach(a => appById[a.id] = a);
  const mappings = []; const withheld = [];
  MR.forEach(mr => {
    let fired = false; try { fired = !!mr.when(E); } catch (e) { fired = false; }
    if (!fired) return;
    mr.targets.forEach(rid => {
      const rule = RULES.find(r => r.id === rid); if (!rule) return;
      const app = appById[rule.fw];
      if (!app) return; // framework not selected
      const rv = ruleView(rule, kbState);
      if (app.status === ST_NOT) { withheld.push({ finding: mr.finding, framework: rule.frameworkName, provision: rule.provision, why: 'Withheld: ' + app.reasons[0] }); return; }
      const m = { id: mr.id + '·' + rid, mappingRule: mr.id, ruleId: rid, finding: mr.finding, type: mr.type, evidence: mr.evidence(E), evidenceKind: mr.type === 'technical' ? 'Machine-measured' : 'User-reported / not provided', framework: rule.frameworkName, frameworkId: rule.fw, instrument: rule.instrument, provision: rule.provision, provisionTitle: rule.title, why: mr.why[rid] || '', sufficiency: mr.sufficiency(E), action: mr.action, url: rule.url, ruleVerification: rv.verification, ruleStale: !!rv.stale, applicability: app.status, priority: mr.priority };
      if (rv.verification !== 'Project-reviewed') { m.caveat = 'Draft rule — shown as a review prompt, not a confident mapping.'; if (m.sufficiency === SUF.S) m.sufficiency = SUF.P; }
      if (app.status === ST_UND || app.status === ST_REV) m.caveat = (m.caveat ? m.caveat + ' ' : '') + 'Applicability is ' + app.status.toLowerCase() + '.';
      mappings.push(m);
    });
  });
  const prRank = { High: 0, Medium: 1, Low: 2 }; mappings.sort((a, b) => prRank[a.priority] - prRank[b.priority] || a.framework.localeCompare(b.framework));
  // recommendations: group mappings by mapping rule
  const recs = []; const byMr = {}; mappings.forEach(m => { (byMr[m.mappingRule] = byMr[m.mappingRule] || []).push(m); });
  Object.keys(byMr).forEach(k => {
    const mr = MR.find(x => x.id === k), ms = byMr[k]; const gap = mr.type === 'governance-gap';
    recs.push({ id: 'REC-' + k.slice(3), mappingRule: k, title: mr.finding, kind: gap ? 'Unknown / not provided' : 'Detected', detected: ms[0].evidence, why: ms.map(m => m.framework + ' ' + m.provision + ': ' + m.why).join('\n'), review: mr.action, controls: ms.map(m => m.framework + ' ' + m.provision), urls: ms.map(m => m.url).filter((u, i, a) => a.indexOf(u) === i), human: !gap || ms.some(m => m.applicability !== ST_REL) || ms.some(m => m.ruleVerification !== 'Project-reviewed'), priority: mr.priority, draft: ms.some(m => m.ruleVerification !== 'Project-reviewed') });
  });
  applic.filter(a => a.status === ST_REV).forEach(a => recs.push({ id: 'REC-AP-' + a.id, mappingRule: 'applicability', title: 'Confirm whether ' + a.name + ' applies', kind: 'Unknown / not provided', detected: a.reasons[0], why: 'Applicability depends on facts this tool cannot determine from the data or the context supplied.', review: 'Ask a qualified reviewer to confirm scope and role before relying on any ' + a.name + ' mapping.', controls: [a.name + ' — scope question'], urls: [(FW.find(f => f.id === a.id) || {}).url].filter(Boolean), human: true, priority: 'High', draft: false }));
  recs.sort((a, b) => prRank[a.priority] - prRank[b.priority]);

  // gaps / cross-validation
  const gaps = []; const G = (kind, text, sev, genuine) => gaps.push({ kind, text, sev: sev || 'Info', genuine: !!genuine });
  const ask = (ok, label, why) => { if (!ok) G('Not provided', label + ' — ' + why, 'Info', false); };
  ask(E.known.regions, 'Country / region', 'applicability of territorial laws stays undetermined');
  ask(E.known.categories, 'Data categories', 'cannot tell whether personal or sensitive data is involved');
  ask(E.known.purpose, 'Purpose and intended use', 'purpose-limitation questions cannot be answered');
  ask(E.known.source, 'Data source and processing context', 'lawful-collection context is unknown');
  ask(E.known.recipients, 'Recipients and access', 'sharing and exposure cannot be reviewed');
  ask(E.known.safeguards, 'Existing safeguards', 'controls are unverified (not failed)');
  ask(E.known.generator, 'Generator / method documentation', 'reproducibility documentation incomplete');
  const priv = audit.results.privacy || {};
  (priv.attacks || []).forEach(a => { if (a.status === 'Failed') G('Failed check', a.short + ' failed: ' + (a.error || 'unknown error') + ' — this is a genuine failure, not missing information.', 'High', true); else if (a.status === 'Not Run') G('Test not run', a.short + ' was not run (' + (a.reason || 'not selected') + ').', 'Medium', false); });
  if (!E.privRun && (priv.status === 'Not Run' || !priv.status)) G('Test not run', 'No privacy tests were run for this audit.', 'High', false);
  if ((priv.pending || []).length) G('Incomplete tests', (priv.pending || []).length + ' privacy attack types are not available in this version (' + priv.pending.map(p => p.short).join(', ') + ').', 'Medium', false);
  if (E.mia && E.mia.validity === 'proxy') G('Incomplete tests', 'The membership setup is a proxy; true training-set membership is unknown.', 'Medium', false);
  ['fidelity', 'utility'].forEach(k => { const r = audit.results[k]; if (r && r.status === 'Failed') G('Failed check', k + ' evaluation failed: ' + (r.error || 'unknown error'), 'Medium', true); });
  if (E.fid !== null && E.fid >= 0.9 && (E.cat === 'High' || E.cat === 'Moderate')) G('Contradictory evidence', 'High fidelity (' + fmt(E.fid) + ') coexists with a ' + E.cat.toLowerCase() + ' privacy signal. Both are shown; fidelity does not offset the privacy concern.', 'High', false);
  if (E.mia && E.exact) { const li = E.ens.components || []; const lv = li.map(c => c.levelIdx); if (lv.length && Math.max.apply(null, lv) - Math.min.apply(null, lv) >= 1) G('Contradictory evidence', 'Privacy tests disagree: ' + li.map(c => c.label + ' = ' + c.level).join('; ') + '. The more concerning level governs.', 'Medium', false); }
  selected.forEach(id => { const f = FW.find(x => x.id === id); if (!f) return; const rs = RULES.filter(r => r.fw === id).map(r => ruleView(r, kbState));
    if (!rs.length) G('Unsupported mapping', f.name + ' is selected but has no knowledge-base rules (' + frameworkView(f, kbState).status + '). No mapping can be produced.', 'Medium', false);
    else { const un = rs.filter(r => r.verification !== 'Project-reviewed'); if (un.length) G('Stale / unverified rule', un.length + ' of ' + rs.length + ' ' + f.name + ' rules are unverified or need re-review.', 'Medium', false); }
    if (f.status === 'Needs Update') G('Stale / unverified rule', f.name + ': ' + (f.note || 'source status needs re-checking.'), 'Medium', false); });
  if (!selected.length) G('Not provided', 'No frameworks were selected for review, so no mappings are produced.', 'Info', false);

  const counts = { Pending: 0, Accepted: 0, Rejected: 0, 'Needs More Information': 0, Completed: 0 };
  mappings.forEach(m => { const rv = (audit.reviews || {})[m.id]; m.reviewStatus = rv ? rv.status : 'Pending'; m.history = rv ? rv.history : []; counts[m.reviewStatus] = (counts[m.reviewStatus] || 0) + 1; });
  return { kbVersion: KB_VERSION, frameworks: fwViews, applicability: applic, suggested: suggest(ctx), mappings, withheld, recs, gaps, reviewCounts: counts, evidenceSummary: { technical: [E.ensTxt, E.miaTxt, E.exactTxt].filter(Boolean), known: E.known } };
}

SDA.kb = { version: KB_VERSION, options: OPT, frameworks: FW, rules: RULES, mappingRules: MR, ruleView, frameworkView, screen, suggest, buildGovernance, collectEvidence, noneValues: NONE_VALUES, statuses: { rel: ST_REL, not: ST_NOT, und: ST_UND, rev: ST_REV },
  defaultContext: () => ({ regions: [], subjectRegions: [], industry: '', orgType: '', dataCategories: [], purposes: [], purposeText: '', sourceText: '', recipients: [], recipientsText: '', safeguards: [], docsText: '', frameworks: [] }) };
})(typeof window !== 'undefined' ? window : globalThis);
