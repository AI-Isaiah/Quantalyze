// PR-Y1 audit reconciler: joins local migration files, git first-commit times,
// test schema_migrations, and prod schema_migrations into a single CSV + summary.
// Run: node .planning/phase-19/audit/build-audit.mjs

import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const gitLog = JSON.parse(fs.readFileSync(path.join(here, 'git-log.json'), 'utf8'));
const testRows = JSON.parse(fs.readFileSync(path.join(here, 'test-migrations.json'), 'utf8'));
const prodRows = JSON.parse(fs.readFileSync(path.join(here, 'prod-migrations.json'), 'utf8'));

// --- helpers -------------------------------------------------------------

const NNN_PREFIX_RE = /^(\d{3}[a-z]?)_/;

function stripPrefix(name) {
  const m = name.match(NNN_PREFIX_RE);
  return m ? name.slice(m[0].length) : name;
}

function extractNnn(name) {
  const m = name.match(NNN_PREFIX_RE);
  return m ? m[1] : null;
}

function isTimestampVersion(v) {
  return /^\d{14}$/.test(v);
}

function isSequentialVersion(v) {
  return /^\d{3}[a-z]?$/.test(v);
}

function toUtcTimestamp(isoLocal) {
  // ISO 8601 with offset, e.g. "2026-04-05T08:19:11+02:00"
  const d = new Date(isoLocal);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}

function tsToEpoch(ts14) {
  // "YYYYMMDDHHMMSS" -> epoch seconds (treats as UTC)
  const iso = `${ts14.slice(0, 4)}-${ts14.slice(4, 6)}-${ts14.slice(6, 8)}T${ts14.slice(8, 10)}:${ts14.slice(10, 12)}:${ts14.slice(12, 14)}Z`;
  return Math.floor(new Date(iso).getTime() / 1000);
}

function epochToTs(epoch) {
  return toUtcTimestamp(new Date(epoch * 1000).toISOString());
}

// --- step 1: compute candidate new_version per local file ---------------

const local = gitLog.map(e => ({
  file: e.file,
  nnn: extractNnn(e.file),
  canonical: stripPrefix(e.file),
  git_first_commit_local: e.first_commit,
  candidate_ts: toUtcTimestamp(e.first_commit),
}));

// Stable sort by (candidate_ts, nnn) so ties resolve in NNN order.
local.sort((a, b) => {
  if (a.candidate_ts !== b.candidate_ts) return a.candidate_ts < b.candidate_ts ? -1 : 1;
  return a.nnn.localeCompare(b.nnn);
});

// Walk in order and bump duplicate seconds to ensure unique versions.
let prev = 0;
for (const row of local) {
  let epoch = tsToEpoch(row.candidate_ts);
  if (epoch <= prev) epoch = prev + 1;
  row.new_version = epochToTs(epoch);
  row.new_filename = `${row.new_version}_${row.canonical}.sql`;
  prev = epoch;
}

// --- step 2: index test / prod by canonical_name ------------------------

const testByCanonical = new Map();
for (const r of testRows) {
  const canon = stripPrefix(r.name);
  if (!testByCanonical.has(canon)) testByCanonical.set(canon, []);
  testByCanonical.get(canon).push(r);
}

const prodByCanonical = new Map();
for (const r of prodRows) {
  const canon = stripPrefix(r.name);
  if (!prodByCanonical.has(canon)) prodByCanonical.set(canon, []);
  prodByCanonical.get(canon).push(r);
}

// --- step 3: per-local-file join ----------------------------------------

const auditRows = local.map(l => {
  const testMatches = testByCanonical.get(l.canonical) || [];
  const prodMatches = prodByCanonical.get(l.canonical) || [];
  const prodSeq = prodMatches.filter(r => isSequentialVersion(r.version));
  const prodTs = prodMatches.filter(r => isTimestampVersion(r.version));

  const classifications = [];
  if (testMatches.length === 0) classifications.push('missing_in_test');
  if (testMatches.length > 1) classifications.push('test_duplicate');
  if (prodMatches.length === 0) classifications.push('missing_in_prod');
  if (prodSeq.length > 0 && prodTs.length > 0) classifications.push('prod_duplicate_seq_and_ts');
  if (prodTs.length > 1) classifications.push('prod_duplicate_ts');
  if (prodSeq.length > 1) classifications.push('prod_duplicate_seq');
  if (classifications.length === 0) classifications.push('clean');

  return {
    nnn: l.nnn,
    canonical_name: l.canonical,
    local_filename: `${l.file}.sql`,
    new_version: l.new_version,
    new_filename: l.new_filename,
    git_first_commit: l.git_first_commit_local,
    test_version: testMatches.map(r => r.version).join('|'),
    test_name: testMatches.map(r => r.name).join('|'),
    prod_seq_version: prodSeq.map(r => r.version).join('|'),
    prod_seq_name: prodSeq.map(r => r.name).join('|'),
    prod_ts_version: prodTs.map(r => r.version).join('|'),
    prod_ts_name: prodTs.map(r => r.name).join('|'),
    classification: classifications.join('+'),
  };
});

// --- step 4: orphans (rows present remotely but not locally) ------------

const localCanonicals = new Set(local.map(l => l.canonical));
const orphanTest = testRows.filter(r => !localCanonicals.has(stripPrefix(r.name)));
const orphanProd = prodRows.filter(r => !localCanonicals.has(stripPrefix(r.name)));

// --- step 5: emit CSV + summary -----------------------------------------

function csvEscape(s) {
  if (s == null) return '';
  const str = String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const csvHeaders = [
  'nnn', 'canonical_name', 'local_filename', 'new_version', 'new_filename',
  'git_first_commit',
  'test_version', 'test_name',
  'prod_seq_version', 'prod_seq_name',
  'prod_ts_version', 'prod_ts_name',
  'classification',
];
const csvLines = [csvHeaders.join(',')];
for (const r of auditRows) {
  csvLines.push(csvHeaders.map(h => csvEscape(r[h])).join(','));
}
fs.writeFileSync(path.join(here, 'pr-y1-audit.csv'), csvLines.join('\n') + '\n');

// Summary
const counts = {};
for (const r of auditRows) {
  counts[r.classification] = (counts[r.classification] || 0) + 1;
}

const summary = [];
summary.push('# PR-Y1 Audit Summary');
summary.push('');
summary.push(`Generated: ${new Date().toISOString()}`);
summary.push('');
summary.push(`Local files: ${local.length}`);
summary.push(`Test rows: ${testRows.length}`);
summary.push(`Prod rows: ${prodRows.length}`);
summary.push('');
summary.push('## Classification counts');
summary.push('');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  summary.push(`- ${k}: ${v}`);
}
summary.push('');
summary.push('## Orphans (rows with no local file)');
summary.push('');
summary.push('### Test orphans');
for (const r of orphanTest) {
  summary.push(`- ${r.version} / ${r.name}`);
}
if (orphanTest.length === 0) summary.push('(none)');
summary.push('');
summary.push('### Prod orphans');
for (const r of orphanProd) {
  summary.push(`- ${r.version} / ${r.name}`);
}
if (orphanProd.length === 0) summary.push('(none)');
summary.push('');
summary.push('## Synthesized new_version range');
summary.push('');
summary.push(`First: ${local[0].new_version} (${local[0].file})`);
summary.push(`Last:  ${local[local.length - 1].new_version} (${local[local.length - 1].file})`);
summary.push('');
summary.push('## Files needing prod-side action');
summary.push('');
const needsAction = auditRows.filter(r => r.classification !== 'clean');
summary.push(`Total: ${needsAction.length}`);
summary.push('');
summary.push('| NNN | Canonical | Classification | prod_seq | prod_ts |');
summary.push('|---|---|---|---|---|');
for (const r of needsAction) {
  summary.push(`| ${r.nnn} | ${r.canonical_name} | ${r.classification} | ${r.prod_seq_version || '-'} | ${r.prod_ts_version || '-'} |`);
}
fs.writeFileSync(path.join(here, 'pr-y1-audit-summary.md'), summary.join('\n') + '\n');

console.log('Wrote pr-y1-audit.csv');
console.log('Wrote pr-y1-audit-summary.md');
console.log('');
console.log('Classification counts:');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}
console.log('');
console.log(`Test orphans: ${orphanTest.length}`);
for (const r of orphanTest) console.log(`  ${r.version} / ${r.name}`);
console.log(`Prod orphans: ${orphanProd.length}`);
for (const r of orphanProd) console.log(`  ${r.version} / ${r.name}`);
