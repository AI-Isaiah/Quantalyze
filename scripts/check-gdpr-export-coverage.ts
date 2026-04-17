#!/usr/bin/env -S npx tsx
/**
 * CI hook — fail if `src/lib/gdpr-export.ts::USER_EXPORT_TABLES` lacks a case
 * for any migration-declared user-owned table.
 *
 * Sprint 6 closeout Task 7.3. The GDPR export route assembles a bundle of
 * every user-referencing table (see `src/lib/gdpr-export.ts`). When a new
 * migration adds a table with `user_id UUID REFERENCES auth.users(...)` or
 * `user_id UUID ... REFERENCES profiles(...)` (the codebase's convention
 * for user-owned data), the export manifest MUST be extended in the same
 * PR. Otherwise the bundle silently omits rows and the user's GDPR
 * Art. 15 request produces an incomplete file.
 *
 * This script:
 *   1. Reads every migration under `supabase/migrations/`.
 *   2. Extracts table names from `CREATE TABLE ... IF NOT EXISTS? ... (<cols>)`
 *      where one of the columns matches the user-id-FK patterns.
 *   3. Diffs against `USER_EXPORT_TABLES`. If a migration-declared table
 *      is missing from the manifest, exit 1 with a specific error message
 *      naming the missing table.
 *
 * False-positive tolerance
 * ------------------------
 * The parser tolerates a small allowlist of tables that genuinely don't
 * belong in the export:
 *   - `auth.*` / `storage.*` — not in the public schema; out of scope.
 *   - `verification_requests` — legacy landing-page intake table; the
 *      user doesn't "own" these rows by user_id (it uses `email` text).
 *   - `for_quants_leads`, `relationship_documents`, etc. — they're
 *      cross-party and appear via their parent tables.
 *
 * If the CI fails with a table you believe should be allowlisted, add
 * it to EXCLUDED_TABLES below AND document the rationale in the
 * per-table matrix comment block of migration 055_sanitize_user.sql.
 *
 * Invocation
 * ----------
 *   npx tsx scripts/check-gdpr-export-coverage.ts
 *
 * Exit codes:
 *   0 — coverage is complete
 *   1 — at least one user-owned table is missing from the manifest
 *   2 — parser error (file read failed, regex mismatch, etc.)
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve repo root from this file's location (scripts/ sibling to supabase/).
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const MANIFEST_FILE = join(REPO_ROOT, "src", "lib", "gdpr-export.ts");

/**
 * Tables whose rows are NOT user-owned in a way the GDPR export should
 * surface — keeping these out of USER_EXPORT_TABLES is intentional.
 */
const EXCLUDED_TABLES = new Set<string>([
  // Cross-party / internal-only tables that don't need direct user scoping.
  "organization_invites",
  "organizations",
  "relationship_documents",
  "for_quants_leads",
  "key_permission_audit",
  "trades",
  // Legacy landing-page intake — keyed by email, not user_id.
  "verification_requests",
  // System / observability tables with no per-user data to export.
  "cron_runs",
  "notification_dispatches",
  "compute_jobs",
  "compute_job_kinds",
  "reconciliation_reports",
  "system_flags",
  "sync_checkpoints",
  "position_snapshots",
  "positions",
  "used_ack_tokens",
  "funding_fees",
  "benchmark_prices",
  "discovery_categories",
  "decks",
  "deck_strategies",
]);

/**
 * Read the manifest file as text, then extract the list of `table: "..."`
 * literals from the `USER_EXPORT_TABLES` array. A regex is sufficient
 * because we control the file's shape — see gdpr-export.ts.
 */
function readManifestTables(): Set<string> {
  const src = readFileSync(MANIFEST_FILE, "utf8");
  // Grab the USER_EXPORT_TABLES array body.
  const arrMatch = src.match(
    /USER_EXPORT_TABLES:\s*readonly\s+UserExportTable\[\]\s*=\s*\[([\s\S]*?)\]\s*as\s*const\s*;/,
  );
  if (!arrMatch) {
    console.error(
      "[check-gdpr-export-coverage] Could not find USER_EXPORT_TABLES in manifest",
    );
    process.exit(2);
  }
  const body = arrMatch[1];
  const names = new Set<string>();
  const tableLiteralRe = /\btable:\s*"([a-z0-9_]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = tableLiteralRe.exec(body)) !== null) {
    names.add(m[1]);
  }
  return names;
}

/**
 * Scan every migration file for CREATE TABLE blocks where a column
 * references profiles or auth.users via user_id / allocator_id / etc.
 *
 * Return a map of table_name -> first migration filename that declared it.
 * We track the first declaration so the error message can point the
 * operator at the offending migration.
 */
function scanMigrationsForUserTables(): Map<string, string> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const declarations = new Map<string, string>();

  // Pattern: CREATE TABLE [IF NOT EXISTS] [schema.]table ( <body> );
  // Match the body between the first `(` and the matching final `)`.
  // We scan the body for a user-id-FK column.
  const createTableRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;

  // A column declaration that references profiles(id) or auth.users(id).
  // Covers: user_id, allocator_id, uploaded_by, created_by, invited_by.
  // We match on the USER-ID intent columns only — FKs like "strategy_id"
  // to profiles don't exist in this codebase.
  const userColumnRe =
    /\b(user_id|allocator_id|invited_by|created_by|uploaded_by|decided_by|edited_by_user_id|processed_by|updated_by|granted_by)\s+UUID[^,]*REFERENCES\s+(?:auth\.users|profiles)\b/i;

  for (const filename of files) {
    const content = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    createTableRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = createTableRe.exec(content)) !== null) {
      const tableName = match[1];
      const body = match[2];

      if (EXCLUDED_TABLES.has(tableName)) continue;
      if (declarations.has(tableName)) continue; // first decl wins

      if (userColumnRe.test(body)) {
        declarations.set(tableName, filename);
      }
    }
  }

  return declarations;
}

function main(): void {
  let manifest: Set<string>;
  try {
    manifest = readManifestTables();
  } catch (err) {
    console.error(
      "[check-gdpr-export-coverage] Failed to read manifest:",
      err instanceof Error ? err.message : err,
    );
    process.exit(2);
  }

  let declared: Map<string, string>;
  try {
    declared = scanMigrationsForUserTables();
  } catch (err) {
    console.error(
      "[check-gdpr-export-coverage] Failed to scan migrations:",
      err instanceof Error ? err.message : err,
    );
    process.exit(2);
  }

  const missing: Array<{ table: string; migration: string }> = [];
  for (const [table, migration] of declared) {
    if (!manifest.has(table)) {
      missing.push({ table, migration });
    }
  }

  if (missing.length > 0) {
    console.error(
      "[check-gdpr-export-coverage] FAIL - GDPR export manifest is missing " +
        missing.length +
        " user-owned table(s):",
    );
    for (const { table, migration } of missing) {
      console.error(
        `  - ${table} (declared in ${migration}) -> add to USER_EXPORT_TABLES in src/lib/gdpr-export.ts`,
      );
    }
    console.error(
      "\nIf the table genuinely should NOT appear in the export (e.g., cross-party " +
        "audit-only), add it to EXCLUDED_TABLES in scripts/check-gdpr-export-coverage.ts " +
        "and document the rationale in migration 055's per-table matrix.",
    );
    process.exit(1);
  }

  const count = manifest.size;
  const declaredCount = declared.size;
  console.log(
    `[check-gdpr-export-coverage] OK - manifest covers all ${declaredCount} declared user-owned tables (manifest size ${count}).`,
  );
  process.exit(0);
}

main();
