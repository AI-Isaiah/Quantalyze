// PR-Y1 rename planner: produces rename-map.csv, rename.sh, reconcile.sql.
// Run: node .planning/phase-19/audit/build-rename-plan.mjs

import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const gitLog = JSON.parse(fs.readFileSync(path.join(here, 'git-log.json'), 'utf8'));
const prodRows = JSON.parse(fs.readFileSync(path.join(here, 'prod-migrations-after.json'), 'utf8'));

const NNN_PREFIX_RE = /^(\d{3}[a-z]?)_/;
function stripPrefix(name) {
  const m = name.match(NNN_PREFIX_RE);
  return m ? name.slice(m[0].length) : name;
}
function toUtcTimestamp(isoLocal) {
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
  const iso = `${ts14.slice(0,4)}-${ts14.slice(4,6)}-${ts14.slice(6,8)}T${ts14.slice(8,10)}:${ts14.slice(10,12)}:${ts14.slice(12,14)}Z`;
  return Math.floor(new Date(iso).getTime() / 1000);
}
function epochToTs(epoch) {
  return toUtcTimestamp(new Date(epoch * 1000).toISOString());
}
function isTimestampVersion(v) { return /^\d{14}$/.test(v); }
function isSequentialVersion(v) { return /^\d{3}[a-z]?$/.test(v); }

// Index prod by full-name and by canonical-name (NNN stripped).
const prodByFullName = new Map();
const prodByCanonical = new Map();
for (const r of prodRows) {
  if (!prodByFullName.has(r.name)) prodByFullName.set(r.name, []);
  prodByFullName.get(r.name).push(r);
  const canon = stripPrefix(r.name);
  if (!prodByCanonical.has(canon)) prodByCanonical.set(canon, []);
  prodByCanonical.get(canon).push(r);
}

// For each local file, decide its final version:
//   1. If prod has a TS row whose name == local file's full name → use that TS
//   2. Else if prod has a TS row whose canonical name matches → use that TS
//   3. Else synthesize from git first-commit (UTC), with collision bumping
const local = gitLog.map(e => ({
  file: e.file,
  canonical: stripPrefix(e.file),
  git_first_commit: e.first_commit,
  candidate_ts: toUtcTimestamp(e.first_commit),
}));
local.sort((a, b) => a.file.localeCompare(b.file)); // by NNN

// Pass 1: lookups
for (const l of local) {
  // Match by full name first
  const byFull = prodByFullName.get(l.file) || [];
  const byFullTs = byFull.filter(r => isTimestampVersion(r.version));
  if (byFullTs.length === 1) {
    l.final_version = byFullTs[0].version;
    l.source = 'prod_ts_full_name';
    continue;
  }
  // Match by canonical
  const byCanon = prodByCanonical.get(l.canonical) || [];
  const byCanonTs = byCanon.filter(r => isTimestampVersion(r.version));
  if (byCanonTs.length === 1) {
    l.final_version = byCanonTs[0].version;
    l.source = 'prod_ts_canonical';
    continue;
  }
  if (byCanonTs.length > 1) {
    // Multiple TS rows — pick the one whose name matches by NNN prefix if any, else first
    const preferred = byCanonTs.find(r => r.name === l.file) || byCanonTs[0];
    l.final_version = preferred.version;
    l.source = 'prod_ts_canonical_multi';
    continue;
  }
  // No TS row exists. Use git-derived.
  l.final_version = l.candidate_ts;
  l.source = 'git_synthesized';
}

// Pass 2: resolve collisions by bumping seconds (file order is NNN-sorted).
const seen = new Map();
for (const l of local) {
  let epoch = tsToEpoch(l.final_version);
  while (seen.has(epoch)) epoch++;
  seen.set(epoch, l.file);
  l.final_version = epochToTs(epoch);
  l.new_filename = `${l.final_version}_${l.canonical}.sql`;
}

// Emit rename-map.csv
const csvHeaders = ['old_filename','new_filename','final_version','source','canonical_name'];
const csvLines = [csvHeaders.join(',')];
for (const l of local) {
  csvLines.push([`${l.file}.sql`, l.new_filename, l.final_version, l.source, l.canonical].join(','));
}
fs.writeFileSync(path.join(here, 'pr-y1-rename-map.csv'), csvLines.join('\n') + '\n');

// Emit rename.sh
const shLines = ['#!/usr/bin/env bash', 'set -euo pipefail', 'cd "$(git rev-parse --show-toplevel)"', ''];
for (const l of local) {
  shLines.push(`git mv "supabase/migrations/${l.file}.sql" "supabase/migrations/${l.new_filename}"`);
}
shLines.push('');
shLines.push('# Rollback files: rename to keep paired with their migrations.');
// Rollback files: 103-rollback.sql .. 132-rollback.sql exist. Find the matching local file and use its NNN.
const rollbackNnns = ['103','104','105','106','107','108','132'];
for (const nnn of rollbackNnns) {
  const matching = local.find(l => l.file.startsWith(`${nnn}_`));
  if (matching) {
    shLines.push(`git mv "supabase/migrations/down/${nnn}-rollback.sql" "supabase/migrations/down/${matching.final_version}-rollback.sql"`);
  } else {
    shLines.push(`# WARN: no local migration matches rollback NNN ${nnn}`);
  }
}
fs.writeFileSync(path.join(here, 'pr-y1-rename.sh'), shLines.join('\n') + '\n');
fs.chmodSync(path.join(here, 'pr-y1-rename.sh'), 0o755);

// Emit reconcile.sql for prod
// Strategy:
//   For each local file's (final_version, new_filename) target:
//     Find all prod rows with name matching the canonical or NNN-prefixed name.
//     If there's a TS row matching final_version: nothing to do (or UPDATE name to new_filename)
//     Else: UPDATE one of the matching rows (NNN or TS) to (final_version, new_filename_without_ts_prefix_or_with)
//   DELETE leftover NNN duplicates.
const sqlLines = ['BEGIN;', ''];

// Build a map of local files keyed by canonical_name for lookup.
const localByCanonical = new Map();
for (const l of local) localByCanonical.set(l.canonical, l);

// Track which prod rows we've handled (by current version).
const handled = new Set();

for (const l of local) {
  const matches = (prodByCanonical.get(l.canonical) || []).filter(r => !handled.has(r.version));
  if (matches.length === 0) {
    // Need to INSERT a row. Use stable name: just the canonical (no NNN prefix) since
    // local file's new name uses TS prefix.
    sqlLines.push(`INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('${l.final_version}', '${l.canonical}', NULL) ON CONFLICT (version) DO NOTHING;`);
    continue;
  }
  // Pick the "best" row to UPDATE to final_version: prefer existing TS row, else NNN.
  const tsMatch = matches.find(r => isTimestampVersion(r.version));
  const target = tsMatch || matches[0];
  if (target.version === l.final_version && target.name === l.canonical) {
    // Already perfect; nothing to do
    handled.add(target.version);
  } else if (target.version === l.final_version) {
    // Version is right; UPDATE name
    sqlLines.push(`UPDATE supabase_migrations.schema_migrations SET name = '${l.canonical}' WHERE version = '${target.version}';`);
    handled.add(target.version);
  } else {
    // UPDATE version + name. Quote-safe (no apostrophes expected in canonical names).
    sqlLines.push(`UPDATE supabase_migrations.schema_migrations SET version = '${l.final_version}', name = '${l.canonical}' WHERE version = '${target.version}';`);
    handled.add(target.version); // tracking by original version
    // Mark new version handled too for any future collisions
    handled.add(l.final_version);
  }
  // DELETE any other matches (NNN duplicates etc.)
  for (const r of matches) {
    if (r === target) continue;
    sqlLines.push(`DELETE FROM supabase_migrations.schema_migrations WHERE version = '${r.version}' AND name = '${r.name.replace(/'/g, "''")}';`);
    handled.add(r.version);
  }
}

// Note orphans (prod rows that match no local file). These stay.
const orphans = prodRows.filter(r => !handled.has(r.version));
sqlLines.push('');
sqlLines.push('-- Orphans (no matching local file; left as-is):');
for (const r of orphans) {
  sqlLines.push(`--   ${r.version} / ${r.name}`);
}
sqlLines.push('');
sqlLines.push('-- Final verify');
sqlLines.push(`SELECT COUNT(*) AS total_rows FROM supabase_migrations.schema_migrations;`);
sqlLines.push('COMMIT;');

fs.writeFileSync(path.join(here, 'pr-y1-reconcile.sql'), sqlLines.join('\n') + '\n');

// Console summary
console.log(`Wrote: pr-y1-rename-map.csv (${local.length} files)`);
console.log(`Wrote: pr-y1-rename.sh`);
console.log(`Wrote: pr-y1-reconcile.sql`);
const sourceCounts = {};
for (const l of local) sourceCounts[l.source] = (sourceCounts[l.source] || 0) + 1;
console.log('Source distribution:');
for (const [k, v] of Object.entries(sourceCounts)) console.log(`  ${k}: ${v}`);
console.log(`Orphan prod rows (no local match): ${orphans.length}`);
for (const r of orphans) console.log(`  ${r.version} / ${r.name}`);
