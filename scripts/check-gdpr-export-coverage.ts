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
 * per-table matrix comment block of migration 20260417110538_sanitize_user.sql.
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
 *
 * Forward-compatibility note
 * --------------------------
 * Some entries (e.g. `trades`, `funding_fees`, `reconciliation_reports`)
 * are listed defensively. They have no direct `user_id` column today —
 * they're indirect-scoped via `strategy_id` — so the regex scan in
 * `scanMigrationsForUserTables` below wouldn't match them anyway, and
 * including them here does NOT cause false negatives today. The
 * defensiveness is for the future: if a migration adds a `user_id`
 * column to `trades` (or similar), REMOVE it from this list so the hook
 * can flag the manifest gap. Silence-via-defensive-exclusion is the
 * exact failure mode we want to avoid for a GDPR coverage invariant.
 */
/**
 * Each entry names the reason inline (per M5 of the Sprint 6 code-review
 * fixes). `reason` is a free-form string for humans; `addedIn` points at
 * the migration or sprint that introduced the exclusion so the diff
 * reviewer can trace the decision back to its context.
 */
const EXCLUDED_TABLES: Record<string, { reason: string; addedIn: string }> = {
  // Cross-party / internal-only tables that don't need direct user scoping.
  organization_invites: {
    reason:
      "Cross-party invite state (sent BY a user TO an email). Sanitize-time PURGE by invited_by covers the one-sided PII. Inviter's email deleted by profiles anonymize.",
    addedIn: "migration 006",
  },
  organizations: {
    reason:
      "Cross-party org entity. Anonymize sets created_by=NULL; other members retain access. The org itself is not user-owned data to export.",
    addedIn: "migration 006",
  },
  relationship_documents: {
    reason:
      "Cross-party uploads (allocator-manager). Reachable indirectly via contact_requests in the export; not directly user-scoped.",
    addedIn: "Sprint 4",
  },
  for_quants_leads: {
    reason:
      "Public-landing-page lead capture; keyed by email_hash with no user FK. Pre-authenticated data, out of scope for user exports.",
    addedIn: "Sprint 2",
  },
  key_permission_audit: {
    reason:
      "Internal audit trail of key-permission probes (staff-authored). Not user-owned data.",
    addedIn: "migration 052",
  },
  trades: {
    reason:
      "Indirect-owned via strategies — appears in the manifest as an IndirectUserTable. Excluded from direct-column regex sweep because its FK is strategy_id, not user_id.",
    addedIn: "migration 003",
  },
  // Legacy landing-page intake — keyed by email, not user_id.
  verification_requests: {
    reason:
      "Legacy pre-auth landing-page intake. Keyed by `email` TEXT, no user FK. Sanitize-time PURGE by email-match handles PII; not exportable.",
    addedIn: "migration 009",
  },
  // System / observability tables with no per-user data to export.
  cron_runs: {
    reason: "System observability (cron heartbeat). No user data.",
    addedIn: "migration 013",
  },
  notification_dispatches: {
    reason:
      "Outbound email ledger with recipient_email PII, but it's a system-authored audit trail — not user-owned. Retention policy (ADR-0024) purges at 180d.",
    addedIn: "migration 020",
  },
  scenario_commit_idempotency: {
    reason:
      "Short-lived server-side dedup cache for the Idempotency-Key contract on POST /api/allocator/scenario/commit. Rows carry a body-hash + cached response payload pointing to match_decisions / bridge_outcomes that ARE exported via those tables. ON DELETE CASCADE to profiles(id) handles right-to-erasure; the cache itself is server state, not user-owned content. Equivalent treatment to notification_dispatches.",
    addedIn: "migration 130",
  },
  compute_jobs: {
    reason: "System job queue. No user-owned row-level data.",
    addedIn: "migration 032",
  },
  compute_job_kinds: {
    reason: "Queue metadata lookup. System-level; no user data.",
    addedIn: "migration 032",
  },
  reconciliation_reports: {
    reason:
      "Indirect-owned via strategies. Present in the manifest as an IndirectUserTable; direct regex excludes because FK is strategy_id.",
    addedIn: "Sprint 5",
  },
  system_flags: {
    reason: "Feature-flag / ops switches. No user data.",
    addedIn: "Sprint 5",
  },
  sync_checkpoints: {
    reason: "Ingestion bookkeeping per strategy. System-owned.",
    addedIn: "migration 045",
  },
  position_snapshots: {
    reason:
      "Portfolio-scoped historical snapshots. Indirect via portfolios; not a direct user table.",
    addedIn: "Sprint 3",
  },
  positions: {
    reason:
      "Portfolio-scoped holdings. Indirect via portfolios; not a direct user table.",
    addedIn: "Sprint 3",
  },
  used_ack_tokens: {
    reason:
      "Idempotency guard for alert-ack tokens. System bookkeeping; no user PII.",
    addedIn: "migration 047b",
  },
  funding_fees: {
    reason:
      "Strategy-scoped historical. Present in manifest as IndirectUserTable; direct regex excludes because FK is strategy_id.",
    addedIn: "migration 044",
  },
  benchmark_prices: {
    reason: "Reference-data time-series. System-owned; no user data.",
    addedIn: "Sprint 3",
  },
  discovery_categories: {
    reason: "Admin-curated discovery taxonomy. No user-owned data.",
    addedIn: "Sprint 2",
  },
  decks: {
    reason:
      "System-curated admin content. Migration 005 declares no user_id/created_by column. If a future migration adds a user FK, REMOVE this entry and add the table to USER_EXPORT_TABLES.",
    addedIn: "migration 005",
  },
  deck_strategies: {
    reason:
      "Link table between system-curated decks and strategies. Inherits decks' no-user-FK posture.",
    addedIn: "migration 005",
  },
};

/**
 * Read the manifest file as text, then extract the list of `table: "..."`
 * AND `source_table: "..."` literals from the `USER_EXPORT_TABLES`
 * array. `source_table` is the underlying table for the `projected`
 * entries (e.g. audit_log -> audit_log_for_user); from the migration
 * coverage perspective the raw source is what's covered.
 * A regex is sufficient because we control the file's shape - see
 * gdpr-export.ts.
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
  const tableLiteralRe = /\b(?:table|source_table):\s*"([a-z0-9_]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = tableLiteralRe.exec(body)) !== null) {
    names.add(m[1]);
  }
  return names;
}

/**
 * Audit 2026-05-07 H-0455/H-0457 - tables in USER_EXPORT_TABLES that
 * intentionally do NOT appear in the sanitize_user matrix. Each entry
 * documents the rationale inline.
 *
 * Convention: a manifest entry that doesn't fall through a sanitize
 * DELETE/UPDATE OR an `-- <table> | <STRATEGY> | ...` matrix row MUST
 * appear here with a `reason` and an `addedIn` pointer to the
 * migration / sprint that introduced the policy. New manifest entries
 * default to "must appear in matrix" - landing here is the explicit
 * override.
 */
const SANITIZE_PARITY_ALLOWLIST: Record<
  string,
  { reason: string; addedIn: string }
> = {
  // audit_log_for_user is the projected NAME for audit_log (which IS
  // in the sanitize matrix as PRESERVE per migration
  // 20260417110538_sanitize_user.sql:103). The projection's role is
  // export-side cross-party PII redaction; the underlying source
  // table's sanitize policy is unchanged.
  audit_log_for_user: {
    reason:
      "Projection of audit_log (PRESERVE per sanitize matrix). The projected name appears in the manifest for bundle clarity; the sanitize policy is for the source table.",
    addedIn: "Lane E audit P460/P697/P707",
  },
  // allocator_equity_snapshots: user-owned via allocator_id (=
  // api_keys.user_id), the f5 owner-coherence trigger keeps the
  // relationship inviolate. The sanitize_user PURGE on api_keys
  // does NOT cascade to allocator_equity_snapshots (no FK ON DELETE
  // CASCADE today); the table is intentionally PRESERVE so the
  // anonymized profile's historical equity curve survives for any
  // future audit. If a future PR adds a CASCADE FK or chooses
  // PURGE, REMOVE this allowlist entry and add a matching row to
  // the sanitize matrix.
  allocator_equity_snapshots: {
    reason:
      "PRESERVE-historical: equity curve tied to the anonymized profile; no PII left after profiles anonymize. Matches the portfolio_analytics/weight_snapshots PRESERVE policy in the existing matrix.",
    addedIn: "Phase 07 migration 070",
  },
  allocator_holdings: {
    reason:
      "PRESERVE-historical: exchange position/balance snapshots tied to the anonymized profile; no standalone PII. Matches the position_snapshots PRESERVE policy in the existing matrix.",
    addedIn: "Phase 06 migration 066",
  },
  // bridge_outcomes / bridge_outcome_dismissals: cross-party bridge
  // surfaces. Matching the contact_requests PRESERVE pattern - the
  // anonymized profile's identity is non-resolvable once
  // profiles.display_name is set to '[deleted]'.
  bridge_outcomes: {
    reason:
      "PRESERVE-cross-party: bridge audit trail mirrors contact_requests PRESERVE pattern; anonymized profile makes allocator_id non-resolvable.",
    addedIn: "Sprint 6 bridge surfaces",
  },
  bridge_outcome_dismissals: {
    reason:
      "PRESERVE-cross-party: dismissals are the allocator's own state on cross-party bridge surfaces. Mirrors bridge_outcomes policy.",
    addedIn: "Sprint 6 bridge surfaces",
  },
  // strategy_analytics: indirect child of strategies; sanitize
  // ANONYMIZE on strategies preserves the strategy id but blanks
  // identifying columns, so the child analytics survives keyed to
  // an anonymized parent.
  strategy_analytics: {
    reason:
      "Strategy-scoped historical analytics. Strategies are ANONYMIZE per matrix; the child rows survive keyed to the anonymized strategy id. Mirrors the trades ANONYMIZE policy.",
    addedIn: "Sprint 5",
  },
};

/**
 * Audit 2026-05-07 H-0455/H-0457 - sanitize_user/USER_EXPORT_TABLES
 * parity check.
 *
 * The GDPR export manifest (this file) and the sanitize_user PL/pgSQL
 * function (migrations 20260417110538_sanitize_user.sql and
 * 20260513073518_sanitize_user_hardening.sql) MUST cover the same
 * set of user-owned tables. Otherwise:
 *   - A manifest-only table means an Art. 17 deletion request leaves
 *     data the Art. 15 export keeps surfacing.
 *   - A sanitize-only table means the user cannot see (via export)
 *     what was deleted - opaque erasure violates Art. 15/12.
 *
 * The sanitize_user matrix is documented as a `-- table_name |
 * Strategy | Rationale` block in the original migration. We extract
 * those rows AND every DELETE/UPDATE statement body, treating either
 * as proof the table is in the sanitize policy.
 */
function scanSanitizeUserCoverage(): Set<string> {
  const files = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.endsWith(".sql") && /sanitize_user/i.test(f),
  );
  const covered = new Set<string>();
  for (const filename of files) {
    const content = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    // Matrix comment-block lines: `-- <table> | <STRATEGY> | ...`
    const matrixLineRe =
      /^--\s+([a-z_]+)\s+\|\s+(ANONYMIZE|PURGE|PRESERVE|CASCADE|SKIPPED)\b/gim;
    let m: RegExpExecArray | null;
    while ((m = matrixLineRe.exec(content)) !== null) {
      covered.add(m[1]);
    }
    // SQL body: any DELETE FROM <table> or UPDATE <table>.
    const stmtRe =
      /\b(?:DELETE\s+FROM|UPDATE)\s+(?:public\.)?([a-z_]+)\b/gi;
    while ((m = stmtRe.exec(content)) !== null) {
      const table = m[1];
      // Drop auth.* (not in the public-schema manifest scope).
      if (table === "users" || table === "sessions" || table === "refresh_tokens") {
        continue;
      }
      covered.add(table);
    }
  }
  return covered;
}

/**
 * Build the set of source-table names from the manifest (treating
 * projected entries by `source_table`). Indirect entries contribute
 * BOTH child and parent_table.
 */
function readManifestTablesForParity(): Set<string> {
  const src = readFileSync(MANIFEST_FILE, "utf8");
  const arrMatch = src.match(
    /USER_EXPORT_TABLES:\s*readonly\s+UserExportTable\[\]\s*=\s*\[([\s\S]*?)\]\s*as\s*const\s*;/,
  );
  if (!arrMatch) return new Set();
  const body = arrMatch[1];
  const names = new Set<string>();
  const tableLiteralRe =
    /\b(?:source_table|parent_table|table):\s*"([a-z0-9_]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = tableLiteralRe.exec(body)) !== null) {
    names.add(m[1]);
  }
  return names;
}

/**
 * Audit 2026-05-07 red-team #9 (MED conf-8): walk the projected
 * manifest entries and surface (bundle_name, source_table) pairs
 * where the two diverge. Used by `enforceProjectionParity` to assert
 * BOTH names are covered by the sanitize matrix (or both allowlisted
 * with documented reasons), and to detect stale SANITIZE_PARITY_ALLOWLIST
 * entries whose reason references a source_table that no longer exists
 * in the matrix.
 *
 * Returns one entry per `kind: "projected"` literal in the manifest.
 */
function readProjectedManifestEntries(): Array<{
  bundleName: string;
  sourceTable: string;
}> {
  const src = readFileSync(MANIFEST_FILE, "utf8");
  const arrMatch = src.match(
    /USER_EXPORT_TABLES:\s*readonly\s+UserExportTable\[\]\s*=\s*\[([\s\S]*?)\]\s*as\s*const\s*;/,
  );
  if (!arrMatch) return [];
  const body = arrMatch[1];
  const out: Array<{ bundleName: string; sourceTable: string }> = [];
  // Match `{ kind: "projected", ... }` blocks and extract their `table`
  // + `source_table`. The negative-look-ahead-free strategy: find the
  // `kind: "projected"` literal, then scan within a bounded window for
  // the immediately-following `table:` and `source_table:` literals.
  const projectedRe =
    /\{\s*kind:\s*"projected"\s*,([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = projectedRe.exec(body)) !== null) {
    const entryBody = m[1];
    const tableMatch = entryBody.match(/\btable:\s*"([a-z0-9_]+)"/);
    const sourceMatch = entryBody.match(/\bsource_table:\s*"([a-z0-9_]+)"/);
    if (tableMatch && sourceMatch) {
      out.push({ bundleName: tableMatch[1], sourceTable: sourceMatch[1] });
    }
  }
  return out;
}

/**
 * P698 - per-table user-id filter audit.
 *
 * Walk every entry in USER_EXPORT_TABLES and assert each has an
 * explicit user-scoping column declared:
 *   - direct: user_column set
 *   - projected: user_column set (post-fetch redaction is enforced
 *     separately by the unit tests in gdpr-export-redaction.test.ts)
 *   - indirect: parent_user_column set
 *
 * Service-role bypasses RLS, so this filter is the only contractual
 * guarantee that a manifest entry cannot leak cross-tenant rows. A
 * future refactor that omits the filter on a new entry would silently
 * widen the export beyond the data subject.
 */
function readManifestEntries(): Array<{
  table: string;
  kind: string;
  hasUserFilter: boolean;
}> {
  const src = readFileSync(MANIFEST_FILE, "utf8");
  const arrMatch = src.match(
    /USER_EXPORT_TABLES:\s*readonly\s+UserExportTable\[\]\s*=\s*\[([\s\S]*?)\]\s*as\s*const\s*;/,
  );
  if (!arrMatch) return [];
  const body = arrMatch[1];

  const entries: Array<{ table: string; kind: string; hasUserFilter: boolean }> = [];
  const entryRe = /\{\s*kind:\s*"(direct|indirect|projected)"\s*,([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body)) !== null) {
    const kind = m[1];
    const entryBody = m[2];
    const tableMatch = entryBody.match(/\btable:\s*"([a-z0-9_]+)"/);
    if (!tableMatch) continue;
    const table = tableMatch[1];
    let hasUserFilter = false;
    if (kind === "direct" || kind === "projected") {
      hasUserFilter = /\buser_column:\s*"[a-z0-9_]+"/.test(entryBody);
    } else if (kind === "indirect") {
      hasUserFilter = /\bparent_user_column:\s*"[a-z0-9_]+"/.test(entryBody);
    }
    entries.push({ table, kind, hasUserFilter });
  }
  return entries;
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

      if (tableName in EXCLUDED_TABLES) continue;
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

  // P698 - per-table user-id filter audit. Run BEFORE the coverage
  // diff so a filter-less entry surfaces even if the manifest otherwise
  // matches the migrations.
  const entries = readManifestEntries();
  const filterless = entries.filter((e) => !e.hasUserFilter);
  if (filterless.length > 0) {
    console.error(
      "[check-gdpr-export-coverage] FAIL (P698) - " +
        filterless.length +
        " USER_EXPORT_TABLES entry/entries lack an explicit user-id filter:",
    );
    for (const e of filterless) {
      console.error(
        `  - ${e.table} (kind="${e.kind}") -> add ` +
          (e.kind === "indirect" ? "parent_user_column" : "user_column"),
      );
    }
    console.error(
      "\nService-role bypasses RLS; the user-id filter is the only contractual " +
        "guarantee that the export cannot leak cross-tenant rows. See P698 in " +
        "the 2026-05-07 audit.",
    );
    process.exit(1);
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

  // Audit 2026-05-07 H-0455/H-0457 - sanitize_user parity. Run AFTER
  // the migration->manifest diff so the operator sees the simpler
  // "missing from manifest" message first when both fail.
  let manifestForParity: Set<string>;
  let sanitizeCoverage: Set<string>;
  try {
    manifestForParity = readManifestTablesForParity();
    sanitizeCoverage = scanSanitizeUserCoverage();
  } catch (err) {
    console.error(
      "[check-gdpr-export-coverage] Failed to scan sanitize_user coverage:",
      err instanceof Error ? err.message : err,
    );
    process.exit(2);
  }
  const parityGaps: string[] = [];
  for (const table of manifestForParity) {
    if (sanitizeCoverage.has(table)) continue;
    if (table in SANITIZE_PARITY_ALLOWLIST) continue;
    parityGaps.push(table);
  }
  if (parityGaps.length > 0) {
    console.error(
      "[check-gdpr-export-coverage] FAIL (H-0455/H-0457) - " +
        parityGaps.length +
        " USER_EXPORT_TABLES entry/entries have no matching row in the " +
        "sanitize_user matrix (migrations 20260417110538_sanitize_user.sql / " +
        "20260513073518_sanitize_user_hardening.sql):",
    );
    for (const t of parityGaps) {
      console.error(
        `  - ${t} -> add a PURGE/ANONYMIZE/PRESERVE/CASCADE row to the ` +
          `sanitize_user matrix comment block AND (if needed) a DELETE/UPDATE ` +
          `statement to the function body. If the table is genuinely ` +
          `out-of-scope for sanitize (e.g., historical analytics ` +
          `keyed to an anonymized parent), add it to ` +
          `SANITIZE_PARITY_ALLOWLIST in this script with a documented reason.`,
      );
    }
    console.error(
      "\nGDPR parity: every table exposed in the Art. 15 export bundle must " +
        "have a corresponding Art. 17 erasure policy. Without parity, a " +
        "deletion request can leave data the export keeps surfacing, or " +
        "purge data the user has no way to see was deleted.",
    );
    process.exit(1);
  }

  // Audit 2026-05-07 red-team #9 (MED conf-8): walk every projected
  // entry whose bundle-name differs from its source_table and assert
  // BOTH names are covered (by the matrix OR by the allowlist). The
  // pre-fix parity check only required EITHER name to be covered —
  // which let a future migration rename a source table (audit_log →
  // audit_events) while leaving the allowlist's "projection of
  // audit_log" reason dangling against a no-longer-existing source.
  // The new sub-check ALSO surfaces stale allowlist entries: any
  // allowlist key that isn't in `manifestForParity` is a typo or a
  // renamed-and-forgotten entry; we surface it loud rather than
  // letting it shadow a real coverage gap.
  let projected: ReturnType<typeof readProjectedManifestEntries>;
  try {
    projected = readProjectedManifestEntries();
  } catch (err) {
    console.error(
      "[check-gdpr-export-coverage] Failed to read projected entries:",
      err instanceof Error ? err.message : err,
    );
    process.exit(2);
  }
  const projectionParityGaps: string[] = [];
  for (const { bundleName, sourceTable } of projected) {
    if (bundleName === sourceTable) continue;
    // Both names must be covered. The bundle name's allowlist is in
    // SANITIZE_PARITY_ALLOWLIST; the source_table covers via the
    // sanitize matrix DELETE/UPDATE/comment-line scan.
    const bundleCovered =
      sanitizeCoverage.has(bundleName) ||
      bundleName in SANITIZE_PARITY_ALLOWLIST;
    const sourceCovered =
      sanitizeCoverage.has(sourceTable) ||
      sourceTable in SANITIZE_PARITY_ALLOWLIST;
    if (!bundleCovered) {
      projectionParityGaps.push(
        `${bundleName} (projection of ${sourceTable}) -> bundle name not in sanitize matrix or allowlist`,
      );
    }
    if (!sourceCovered) {
      projectionParityGaps.push(
        `${sourceTable} (source of projection ${bundleName}) -> source_table not in sanitize matrix or allowlist`,
      );
    }
  }
  // Stale allowlist detection: keys that don't appear in the manifest's
  // table+source_table+parent_table union are dangling provenance
  // comments. The previous check happily skipped them; we now surface
  // them so a future operator who renames a source table can't leave
  // a misleading allowlist reason behind.
  const staleAllowlistKeys: string[] = [];
  for (const key of Object.keys(SANITIZE_PARITY_ALLOWLIST)) {
    if (!manifestForParity.has(key)) {
      staleAllowlistKeys.push(key);
    }
  }
  if (projectionParityGaps.length > 0 || staleAllowlistKeys.length > 0) {
    console.error(
      "[check-gdpr-export-coverage] FAIL (audit-2026-05-07 red-team #9) - " +
        "projection parity / allowlist consistency failure(s):",
    );
    for (const g of projectionParityGaps) console.error(`  - ${g}`);
    for (const k of staleAllowlistKeys) {
      console.error(
        `  - SANITIZE_PARITY_ALLOWLIST has stale entry "${k}" — no matching ` +
          `table/source_table/parent_table in USER_EXPORT_TABLES. Remove the ` +
          `allowlist entry OR re-add the manifest entry it documents.`,
      );
    }
    console.error(
      "\nProjection parity: when a projected entry's bundle-facing name " +
        "differs from its underlying source_table (e.g. audit_log_for_user " +
        "projects audit_log), the sanitize matrix MUST cover BOTH names. A " +
        "source-table rename without an allowlist update silently leaves " +
        "the projection's provenance dangling.",
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
