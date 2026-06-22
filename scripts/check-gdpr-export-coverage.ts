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
 * Audit C-0291 (2026-05-07) hardening
 * ------------------------------------
 *   - Allowlist drift: `addedIn` was a free-form string ("Sprint 4",
 *     "migration 006") that could not be verified against migration
 *     filenames (which are timestamp-prefixed). Removed entirely — only
 *     `reason` (human-readable rationale) survives. Stale-key detection
 *     in `runCoverageCheck()` catches "this entry references a no-longer-
 *     existing table" for both allowlists.
 *   - CREATE TABLE parsing: explicitly documented as BEST-EFFORT
 *     regex (no SQL parser available in repo deps). Edge cases
 *     covered by `check-gdpr-export-coverage.test.ts` fixtures.
 *   - Silent gate: every failure path exits non-zero with a specific
 *     remediation message naming the offending table.
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
import {
  USER_EXPORT_TABLES,
  type UserExportTable,
} from "@/lib/gdpr-export-manifest";

// Resolve repo root from this file's location (scripts/ sibling to supabase/).
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

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
 * Audit C-0291 (2026-05-07): previously each entry carried an `addedIn`
 * field ("Sprint 4", "migration 006") that could not be verified
 * against migration filenames (which are timestamp-prefixed). The
 * field has been removed — it was unverifiable noise that pretended
 * to be a provenance audit. Only `reason` survives; stale-key
 * detection in `runCoverageCheck()` catches entries that reference a
 * no-longer-existing table.
 */

/**
 * B10 — typed exclusion classes. Every EXCLUDED_TABLES entry must declare WHY
 * it is excluded as one of these enumerated classes, not free text, so an
 * exclusion is an opt-in decision with a CHECKED rationale (plan test #8):
 * `runCoverageCheck()` fails loudly on any entry whose class is missing or
 * unrecognised, and the `ExclusionClass` type makes a typo a tsc error too.
 *
 *   - `scoped`      — indirect-owned via a user-FK parent; appears in
 *                     USER_EXPORT_TABLES as an IndirectUserTable (the direct
 *                     `user_id` regex sweep skips it because its FK is e.g.
 *                     `strategy_id`). The data IS exported, just not directly.
 *   - `ephemeral`   — short-lived server-side cache / idempotency / dedup
 *                     ledger, CASCADE-erased on profile deletion. Server
 *                     state, not user-owned content.
 *   - `system`      — system / observability / infrastructure / reference
 *                     data with no per-user, row-level ownership.
 *   - `cross-party` — multi-owner surface where the subject is one party;
 *                     sanitize-time PURGE/anonymize handles the one-sided PII.
 *   - `pre-auth`    — pre-authentication landing intake keyed by email/hash
 *                     with no user FK; PII handled by sanitize email-match.
 */
export const EXCLUSION_CLASSES = [
  "scoped",
  "ephemeral",
  "system",
  "cross-party",
  "pre-auth",
] as const;
export type ExclusionClass = (typeof EXCLUSION_CLASSES)[number];

export const EXCLUDED_TABLES: Record<
  string,
  { class: ExclusionClass; reason: string }
> = {
  // Cross-party / internal-only tables that don't need direct user scoping.
  organization_invites: {
    class: "cross-party",
    reason:
      "Cross-party invite state (sent BY a user TO an email). Sanitize-time PURGE by invited_by covers the one-sided PII. Inviter's email deleted by profiles anonymize.",
  },
  organizations: {
    class: "cross-party",
    reason:
      "Cross-party org entity. Anonymize sets created_by=NULL; other members retain access. The org itself is not user-owned data to export.",
  },
  relationship_documents: {
    class: "cross-party",
    reason:
      "Cross-party uploads (allocator-manager). Reachable indirectly via contact_requests in the export; not directly user-scoped.",
  },
  for_quants_leads: {
    class: "pre-auth",
    reason:
      "Public-landing-page lead capture; keyed by email_hash with no user FK. Pre-authenticated data, out of scope for user exports.",
  },
  key_permission_audit: {
    class: "system",
    reason:
      "Internal audit trail of key-permission probes (staff-authored). Not user-owned data.",
  },
  trades: {
    class: "scoped",
    reason:
      "Indirect-owned via strategies — appears in the manifest as an IndirectUserTable. Excluded from direct-column regex sweep because its FK is strategy_id, not user_id.",
  },
  // Legacy landing-page intake — keyed by email, not user_id.
  verification_requests: {
    class: "pre-auth",
    reason:
      "Legacy pre-auth landing-page intake. Keyed by `email` TEXT, no user FK. Sanitize-time PURGE by email-match handles PII; not exportable.",
  },
  // System / observability tables with no per-user data to export.
  cron_runs: {
    class: "system",
    reason: "System observability (cron heartbeat). No user data.",
  },
  notification_dispatches: {
    class: "system",
    reason:
      "Outbound email ledger with recipient_email PII, but it's a system-authored audit trail — not user-owned. Retention policy (ADR-0024) purges at 180d.",
  },
  scenario_commit_idempotency: {
    class: "ephemeral",
    reason:
      "Short-lived server-side dedup cache for the Idempotency-Key contract on POST /api/allocator/scenario/commit. Rows carry a body-hash + cached response payload pointing to match_decisions / bridge_outcomes that ARE exported via those tables. ON DELETE CASCADE to profiles(id) handles right-to-erasure; the cache itself is server state, not user-owned content. Equivalent treatment to notification_dispatches.",
  },
  compute_jobs: {
    class: "system",
    reason: "System job queue. No user-owned row-level data.",
  },
  compute_job_kinds: {
    class: "system",
    reason: "Queue metadata lookup. System-level; no user data.",
  },
  reconciliation_reports: {
    class: "scoped",
    reason:
      "Indirect-owned via strategies. Present in the manifest as an IndirectUserTable; direct regex excludes because FK is strategy_id.",
  },
  system_flags: {
    class: "system",
    reason: "Feature-flag / ops switches. No user data.",
  },
  // Audit C-0291: `sync_checkpoints` was previously listed here but
  // no migration declares a CREATE TABLE for it (only a stale matrix
  // comment in 20260417110538_sanitize_user.sql:134 mentions it).
  // The new stale-EXCLUDED_TABLES check would fail on it. Removed
  // to restore CI green; if a future migration creates the table,
  // re-add this entry.
  // NEW-C16-04 (audit 2026-05-26): positions + position_snapshots were
  // EXCLUDED with a FACTUALLY WRONG rationale ("Portfolio-scoped...
  // indirect via portfolios"). Both FK `strategy_id NOT NULL REFERENCES
  // strategies` — the identical indirect shape as trades / funding_fees
  // / strategy_analytics — so a user's live positions + historical
  // snapshots (Art. 15 personal trading data) were entirely absent from
  // the export. They are now IndirectUserTable entries in
  // USER_EXPORT_TABLES (strategy_id -> strategies.user_id) and covered
  // by the existing `positions`/`position_snapshots | PRESERVE` rows in
  // the sanitize_user matrix. Do NOT re-add them here.
  used_ack_tokens: {
    class: "ephemeral",
    reason:
      "Idempotency guard for alert-ack tokens. System bookkeeping; no user PII.",
  },
  funding_fees: {
    class: "scoped",
    reason:
      "Strategy-scoped historical. Present in manifest as IndirectUserTable; direct regex excludes because FK is strategy_id.",
  },
  benchmark_prices: {
    class: "system",
    reason: "Reference-data time-series. System-owned; no user data.",
  },
  discovery_categories: {
    class: "system",
    reason: "Admin-curated discovery taxonomy. No user-owned data.",
  },
  decks: {
    class: "system",
    reason:
      "System-curated admin content. Migration 005 declares no user_id/created_by column. If a future migration adds a user FK, REMOVE this entry and add the table to USER_EXPORT_TABLES.",
  },
  deck_strategies: {
    class: "system",
    reason:
      "Link table between system-curated decks and strategies. Inherits decks' no-user-FK posture.",
  },
};

/**
 * Covered-table names from the manifest: each entry's `table` plus the
 * `source_table` of `projected` entries (e.g. audit_log ->
 * audit_log_for_user); from the migration-coverage perspective the raw
 * source is what's covered.
 *
 * B13: reads the imported typed `USER_EXPORT_TABLES` array directly
 * instead of regex-scraping the source text — drift between this gate
 * and the real manifest is now impossible by construction.
 */
function readManifestTables(): Set<string> {
  return extractManifestTables();
}

/**
 * Pure helper used by `readManifestTables` and tests. Returns the
 * `table` + `source_table` names from USER_EXPORT_TABLES. Accepts the
 * array so tests can drive it with a synthetic manifest; defaults to
 * the real imported manifest.
 */
export function extractManifestTables(
  tables: readonly UserExportTable[] = USER_EXPORT_TABLES,
): Set<string> {
  const names = new Set<string>();
  for (const t of tables) {
    names.add(t.table);
    if (t.kind === "projected") names.add(t.source_table);
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
export const SANITIZE_PARITY_ALLOWLIST: Record<
  string,
  { reason: string }
> = {
  // audit_log_for_user is the projected NAME for audit_log (which IS
  // in the sanitize matrix as PRESERVE per migration
  // 20260417110538_sanitize_user.sql:103). The projection's role is
  // export-side cross-party PII redaction; the underlying source
  // table's sanitize policy is unchanged.
  audit_log_for_user: {
    reason:
      "Projection of audit_log (PRESERVE per sanitize matrix). The projected name appears in the manifest for bundle clarity; the sanitize policy is for the source table.",
  },
  // NEW-C16-03 (audit 2026-05-26): audit_log_cold is the 2yr+ archive
  // the audit_log_hot_to_cold cron MOVEs rows into (migration
  // 20260417110539_retention_crons.sql). It mirrors hot audit_log
  // exactly and is now exported as the `audit_log_cold_for_user`
  // projection. PRESERVE, mirroring hot. The cold table's erasure
  // policy lives in the retention-cron migration (audit_log_cold_purge
  // at 7y) — NOT the sanitize_user matrix the parity scan reads — so
  // BOTH the bundle name and the source_table are allowlisted here
  // (the projection-parity check requires both sides covered when they
  // differ). sanitize_user PRESERVES cold rows for the same reason it
  // PRESERVES hot: append-only forensic record, no PII left once
  // profiles is anonymized.
  audit_log_cold_for_user: {
    reason:
      "Projection of audit_log_cold (PRESERVE — 2yr+ archive mirroring hot audit_log). Erasure handled by the audit_log_cold_purge retention cron (7y), not the sanitize_user matrix.",
  },
  audit_log_cold: {
    reason:
      "Source of the audit_log_cold_for_user projection. PRESERVE (mirrors hot audit_log). Append-only forensic archive; profiles anonymize removes PII. Purged at 7y by the audit_log_cold_purge retention cron.",
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
  },
  allocator_holdings: {
    reason:
      "PRESERVE-historical: exchange position/balance snapshots tied to the anonymized profile; no standalone PII. Matches the position_snapshots PRESERVE policy in the existing matrix.",
  },
  // bridge_outcomes / bridge_outcome_dismissals: cross-party bridge
  // surfaces. Matching the contact_requests PRESERVE pattern - the
  // anonymized profile's identity is non-resolvable once
  // profiles.display_name is set to '[deleted]'.
  bridge_outcomes: {
    reason:
      "PRESERVE-cross-party: bridge audit trail mirrors contact_requests PRESERVE pattern; anonymized profile makes allocator_id non-resolvable.",
  },
  bridge_outcome_dismissals: {
    reason:
      "PRESERVE-cross-party: dismissals are the allocator's own state on cross-party bridge surfaces. Mirrors bridge_outcomes policy.",
  },
  // strategy_analytics: indirect child of strategies; sanitize
  // ANONYMIZE on strategies preserves the strategy id but blanks
  // identifying columns, so the child analytics survives keyed to
  // an anonymized parent.
  strategy_analytics: {
    reason:
      "Strategy-scoped historical analytics. Strategies are ANONYMIZE per matrix; the child rows survive keyed to the anonymized strategy id. Mirrors the trades ANONYMIZE policy.",
  },
  // csv_daily_returns: NEW-C16-09 (audit 2026-05-26) — strategy-scoped
  // daily-return series added by migration 20260522111839. The table
  // declares `strategy_id NOT NULL REFERENCES strategies ON DELETE CASCADE`,
  // so rows are automatically erased when the strategy is deleted / the user
  // is sanitized (strategies ANONYMIZE → cascade removes child rows). The
  // sanitize_user migration pre-dates this table (added 4 days ago) so it
  // has no explicit matrix row; the CASCADE FK is the erasure mechanism.
  // Mirrors the strategy_analytics allowlist pattern.
  csv_daily_returns: {
    reason:
      "Strategy-scoped CSV daily-return series (migration 20260522111839). ON DELETE CASCADE from strategies ensures erasure when the parent strategy is deleted during sanitize. No explicit sanitize_user matrix row needed; mirrors strategy_analytics policy.",
  },
  // scenarios: Phase 23 (migration 20260621120000) — the allocator's own saved
  // ScenarioDraft config, user-owned via `allocator_id NOT NULL REFERENCES
  // profiles ON DELETE CASCADE`. The CASCADE FK erases every scenario row when
  // the profile is deleted during sanitize, so no explicit sanitize_user matrix
  // row is required. The sanitize_user migration pre-dates this table, so it
  // has no matrix entry; the CASCADE is the erasure mechanism. Mirrors the
  // csv_daily_returns allowlist pattern (CASCADE-from-parent erasure).
  scenarios: {
    reason:
      "Allocator's own saved ScenarioDraft config (migration 20260621120000). ON DELETE CASCADE from profiles erases all scenario rows when the profile is sanitized/deleted. No explicit sanitize_user matrix row needed; mirrors csv_daily_returns CASCADE-erasure allowlist.",
  },
  // scenario_shares: Phase 25 (migration 20260622120000) — the allocator's own
  // share-link state, user-owned via `created_by NOT NULL REFERENCES profiles
  // ON DELETE CASCADE` (and `scenario_id ... REFERENCES scenarios ON DELETE
  // CASCADE`). Both CASCADE FKs erase every share row when the profile is
  // deleted during sanitize, so no explicit sanitize_user matrix row is
  // required. The sanitize_user migration pre-dates this table; the CASCADE is
  // the erasure mechanism. Mirrors the scenarios allowlist pattern.
  scenario_shares: {
    reason:
      "Allocator's own scenario share-link state (migration 20260622120000). ON DELETE CASCADE from profiles (and from scenarios) erases all share rows when the profile is sanitized/deleted. No explicit sanitize_user matrix row needed; mirrors the scenarios CASCADE-erasure allowlist.",
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
    extractSanitizeCoverageFromContent(content, covered);
  }
  return covered;
}

/**
 * Pure helper for tests: extract sanitize-coverage names from a
 * sanitize_user migration's SQL.
 */
export function extractSanitizeCoverageFromContent(
  content: string,
  covered: Set<string> = new Set(),
): Set<string> {
  // Matrix comment-block lines: `-- <table> | <STRATEGY> | ...`
  const matrixLineRe =
    /^--\s+([a-z_]+)\s+\|\s+(ANONYMIZE|PURGE|PRESERVE|CASCADE|SKIPPED)\b/gim;
  let m: RegExpExecArray | null;
  while ((m = matrixLineRe.exec(content)) !== null) {
    covered.add(m[1]);
  }
  // SQL body: any DELETE FROM <table> or UPDATE <table>.
  const stmtRe = /\b(?:DELETE\s+FROM|UPDATE)\s+(?:public\.)?([a-z_]+)\b/gi;
  while ((m = stmtRe.exec(content)) !== null) {
    const table = m[1];
    // Drop auth.* (not in the public-schema manifest scope).
    if (table === "users" || table === "sessions" || table === "refresh_tokens") {
      continue;
    }
    covered.add(table);
  }
  return covered;
}

/**
 * Build the set of source-table names from the manifest (treating
 * projected entries by `source_table`). Indirect entries contribute
 * BOTH child and parent_table.
 */
function readManifestTablesForParity(): Set<string> {
  return extractManifestTablesForParity();
}

export function extractManifestTablesForParity(
  tables: readonly UserExportTable[] = USER_EXPORT_TABLES,
): Set<string> {
  const names = new Set<string>();
  for (const t of tables) {
    names.add(t.table);
    if (t.kind === "projected") names.add(t.source_table);
    if (t.kind === "indirect") names.add(t.parent_table);
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
  return extractProjectedEntries();
}

export function extractProjectedEntries(
  tables: readonly UserExportTable[] = USER_EXPORT_TABLES,
): Array<{ bundleName: string; sourceTable: string }> {
  const out: Array<{ bundleName: string; sourceTable: string }> = [];
  for (const t of tables) {
    if (t.kind === "projected") {
      out.push({ bundleName: t.table, sourceTable: t.source_table });
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
  return extractManifestEntries();
}

export function extractManifestEntries(
  tables: readonly UserExportTable[] = USER_EXPORT_TABLES,
): Array<{ table: string; kind: string; hasUserFilter: boolean }> {
  // The TYPED manifest guarantees the filter column exists (direct /
  // projected -> user_column, indirect -> parent_user_column). This
  // runtime re-check is defense-in-depth: it still reports
  // hasUserFilter=false if a future entry is cast past the type system
  // (or drifts) without a non-empty filter column, so the P698 gate
  // below cannot be silently bypassed.
  const isNonEmptyString = (v: unknown): boolean =>
    typeof v === "string" && v.length > 0;
  return tables.map((t) => {
    let hasUserFilter = false;
    if (t.kind === "direct" || t.kind === "projected") {
      hasUserFilter = isNonEmptyString(t.user_column);
    } else if (t.kind === "indirect") {
      hasUserFilter = isNonEmptyString(t.parent_user_column);
    }
    return { table: t.table, kind: t.kind, hasUserFilter };
  });
}

/**
 * Scan every migration file for CREATE TABLE blocks where a column
 * references profiles or auth.users via user_id / allocator_id / etc.
 *
 * Return a map of table_name -> first migration filename that declared it.
 * We track the first declaration so the error message can point the
 * operator at the offending migration.
 *
 * CREATE TABLE parsing — BEST-EFFORT REGEX (audit C-0291)
 * --------------------------------------------------------
 * No SQL parser is available in repo deps (pg-query-parser and
 * node-sql-parser are NOT installed; pulling one in is gated by
 * separate audit work). This implementation is regex-based and
 * intentionally tolerant of the codebase's actual migration style.
 * Known limitations:
 *
 *   - PARTITIONED tables with `... PARTITION OF parent` — not matched
 *     (no parenthesised column body). Migrations in this repo do not
 *     use partitions today.
 *   - CREATE TABLE LIKE clauses — not matched. Not used today.
 *   - Nested parentheses in column defaults (e.g. CHECK expressions
 *     spanning multiple lines) can confuse the body-capture group's
 *     `\n\s*\)` boundary. Mitigation: every known migration in the
 *     repo terminates the CREATE TABLE with `\n);` on its own line,
 *     which the regex anchors on. The colocated test
 *     (check-gdpr-export-coverage.test.ts) drives this helper with
 *     fixtures for IF NOT EXISTS, schema-qualified names, and
 *     multi-line bodies to catch regressions if a migration drifts
 *     from this convention.
 *
 * If a migration adds a partition / LIKE clause / non-standard
 * terminator, the regex will silently miss it. The CHAIN-8 audit
 * (2026-05-07) flagged this as a known limitation; promote to a
 * real SQL parser when one is added to the dependency set.
 */
function scanMigrationsForUserTables(): Map<string, string> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const declarations = new Map<string, string>();

  for (const filename of files) {
    const content = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    extractUserTablesFromMigration(content, filename, declarations);
  }

  return declarations;
}

/**
 * Pure helper for tests. Mutates `declarations` if not provided, and
 * returns it. `filename` is used to attribute the first declaration
 * (so error messages can name the migration that introduced a gap).
 */
export function extractUserTablesFromMigration(
  content: string,
  filename: string,
  declarations: Map<string, string> = new Map(),
): Map<string, string> {
  // H-1019 (audit 2026-05-25): strip SQL comments BEFORE scanning. The
  // user-column regex previously ran against the raw CREATE TABLE body,
  // so a "-- ..." line that merely DOCUMENTED a sibling table's
  // "user_id UUID REFERENCES auth.users(id)" FK made the regex match
  // even though the table has no real user column — a phantom coverage
  // gap. We strip line comments and block comments up-front so only
  // real DDL is scanned.
  const scrubbed = stripSqlComments(content);

  // BEST-EFFORT — see the limitation block on
  // `scanMigrationsForUserTables`.
  //
  // H-1020 (audit 2026-05-25): the table identifier was matched only as
  // a bare `([a-z0-9_]+)`, which does NOT match a DOUBLE-QUOTED
  // identifier (`CREATE TABLE "foo" (...)`). A quoted table therefore
  // escaped detection → omitted from required GDPR-export coverage → a
  // potential user-data leak. We now match an OPTIONAL double-quoted
  // form: group 1 is the quoted name (quotes stripped by the capture),
  // group 2 the bare name; the column body shifts to group 3. The name
  // is taken from whichever alternative matched and keyed unquoted (the
  // capture already excludes the quotes), matching how the rest of the
  // script keys tables.
  //
  // Finding 4 (red-team, 2026-05-25): the prior fix only handled a bare
  // `public.` schema prefix OR a quoted bare name — NOT a quoted and/or
  // schema-qualified name. So `CREATE TABLE "public"."secret_data" (...)`
  // and `CREATE TABLE app."secret5" (...)` still escaped the gate. We
  // replace the `(?:public\.)?` prefix with a generalized OPTIONAL
  // schema-qualifier that matches a quoted OR bare schema name followed
  // by a dot. CRITICAL: the schema-qualifier is fully NON-capturing
  // (`(?:...)`), so the table-name capture groups (1 = quoted name, 2 =
  // bare name) and the body group (3) DO NOT shift — every downstream
  // `match[1] ?? match[2]` / `match[3]` consumer is unaffected. The
  // captured table name remains the unqualified, unquoted name.
  const createTableRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"[a-z0-9_]+"|[a-z0-9_]+)\.)?(?:"([a-z0-9_]+)"|([a-z0-9_]+))\s*\(([\s\S]*?)\n\s*\)\s*;/gi;

  // A column declaration that identifies a user.  Two match shapes:
  //
  //   1. FK-reference form (any intent column + REFERENCES auth.users|profiles):
  //      user_id UUID ... REFERENCES auth.users(id)
  //      allocator_id UUID ... REFERENCES profiles(id)
  //      etc. — covers the wide set of intent columns.
  //
  //   2. Bare-UUID form (user_id / allocator_id + UUID NOT NULL, no inline FK):
  //      NEW-C16-06 (audit 2026-05-26, MED conf-8): `audit_log` and
  //      `audit_log_cold` use `user_id UUID NOT NULL` WITHOUT an inline
  //      REFERENCES clause (the FK is enforced at the DB level, not inline
  //      in the DDL). The FK-only regex was blind to these tables — a
  //      user-owned table with a bare user_id escaped the drift guard and
  //      any future `user_id UUID`-without-inline-FK table would do the
  //      same. We widen to also match the two canonical bare-uuid owner
  //      columns; EXCLUDED_TABLES suppresses false positives for audit
  //      infrastructure tables and other legitimate non-owned bare columns.
  //
  // The alternation uses `(?:...|...)` so the overall re is tested once
  // per body (both shapes are tried before returning false).
  const userColumnRe =
    /(?:\b(user_id|allocator_id|invited_by|created_by|uploaded_by|decided_by|edited_by_user_id|processed_by|updated_by|granted_by)\s+UUID[^,]*REFERENCES\s+(?:auth\.users|profiles)\b|\b(user_id|allocator_id)\s+UUID\s+NOT\s+NULL\b)/i;

  createTableRe.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = createTableRe.exec(scrubbed)) !== null) {
    // H-1020: group 1 = quoted-form name, group 2 = bare name, group 3 =
    // column body. Take the name from whichever alternative matched.
    const tableName = match[1] ?? match[2];
    const body = match[3];

    if (tableName in EXCLUDED_TABLES) continue;
    if (declarations.has(tableName)) continue; // first decl wins

    if (userColumnRe.test(body)) {
      declarations.set(tableName, filename);
    }
  }

  // H-1019 (audit 2026-05-25): a table can become user-owned LATER via
  // "ALTER TABLE <t> ADD COLUMN user_id UUID ... REFERENCES auth.users".
  // The CREATE TABLE sweep above misses that — so a late-added user
  // column escaped the coverage gate and the Art. 15 export silently
  // omitted the table's rows. Scan ALTER TABLE ... ADD COLUMN for the
  // same user-id-FK columns. We match the column spec up to the
  // statement terminator (";") so the userColumnRe match sees the full
  // column definition.
  // H-1020 (audit 2026-05-25): same double-quoted-identifier escape
  // vector as createTableRe above — `ALTER TABLE "foo" ADD COLUMN
  // user_id UUID REFERENCES auth.users(id)` was missed. Match an
  // OPTIONAL double-quoted form: group 1 = quoted name, group 2 = bare
  // name, group 3 = the column spec (shifted from group 2).
  //
  // Finding 4 (red-team, 2026-05-25): same quoted/schema-qualified
  // escape vector as createTableRe — `ALTER TABLE "public"."x" ADD
  // COLUMN ...` and `ALTER TABLE app."x" ADD COLUMN ...` escaped. The
  // `(?:public\.)?` prefix is replaced with the same generalized OPTIONAL
  // schema-qualifier (quoted OR bare schema name + dot). It is fully
  // NON-capturing, so the table-name groups (1 quoted, 2 bare) and the
  // column-spec group (3) DO NOT shift.
  const alterAddColumnRe =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:(?:"[a-z0-9_]+"|[a-z0-9_]+)\.)?(?:"([a-z0-9_]+)"|([a-z0-9_]+))\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]*?);/gi;
  alterAddColumnRe.lastIndex = 0;
  while ((match = alterAddColumnRe.exec(scrubbed)) !== null) {
    // H-1020: take the table name from whichever alternative matched
    // (quoted group 1 or bare group 2); the column spec is now group 3.
    const tableName = match[1] ?? match[2];
    const columnSpec = match[3];

    if (tableName in EXCLUDED_TABLES) continue;
    if (declarations.has(tableName)) continue; // first decl wins

    if (userColumnRe.test(columnSpec)) {
      declarations.set(tableName, filename);
    }
  }

  return declarations;
}

/**
 * H-1019 (audit 2026-05-25): strip SQL comments so DDL-scanning regexes
 * don't match reference phrases that only appear in documentation
 * comments. Removes line comments (to end of line) and block comments.
 * Block comments are replaced with a newline so line-anchored regexes
 * elsewhere keep their line structure.
 */
function stripSqlComments(content: string): string {
  const BLOCK_COMMENT = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
  const LINE_COMMENT = /--[^\n]*/g;
  return content.replace(BLOCK_COMMENT, "\n").replace(LINE_COMMENT, "");
}

/**
 * Audit C-0291 helper: collect EVERY table name declared by any
 * migration's CREATE TABLE — including ones the user-FK scan filters
 * out (excluded, or no user-FK). Used by the stale-EXCLUDED_TABLES
 * check to detect entries that reference a no-longer-existing table.
 *
 * Uses the same BEST-EFFORT CREATE TABLE regex (see CHAIN-8 limitation
 * block) without the user-FK filter.
 */
export function collectAllDeclaredTables(): Set<string> {
  const out = new Set<string>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  for (const filename of files) {
    const content = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    extractAllDeclaredTablesFromContent(content, out);
  }
  return out;
}

/**
 * Pure helper for tests.
 */
export function extractAllDeclaredTablesFromContent(
  content: string,
  out: Set<string> = new Set(),
): Set<string> {
  const createTableRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = createTableRe.exec(content)) !== null) {
    out.add(m[1]);
  }
  return out;
}

/**
 * Audit C-0291: exported entry point so tests can drive the script's
 * exit behaviour with injected helpers. Defaults wire to the
 * filesystem-backed readers above. Returns the exit code instead of
 * calling `process.exit` so test callers can assert on it without
 * tearing down the test runner.
 *
 * The `log` / `errorLog` hooks let tests capture output and assert on
 * the FAIL messages naming the offending table.
 */
export function runCoverageCheck(opts: {
  readManifest?: () => Set<string>;
  readManifestForParity?: () => Set<string>;
  readManifestEntries?: () => Array<{
    table: string;
    kind: string;
    hasUserFilter: boolean;
  }>;
  readProjectedEntries?: () => Array<{
    bundleName: string;
    sourceTable: string;
  }>;
  scanMigrations?: () => Map<string, string>;
  scanSanitize?: () => Set<string>;
  scanAllDeclaredTables?: () => Set<string>;
  errorLog?: (msg: string) => void;
  log?: (msg: string) => void;
} = {}): number {
  const errorLog = opts.errorLog ?? ((m: string) => console.error(m));
  const log = opts.log ?? ((m: string) => console.log(m));

  let manifest: Set<string>;
  try {
    manifest = (opts.readManifest ?? readManifestTables)();
  } catch (err) {
    errorLog(
      "[check-gdpr-export-coverage] Failed to read manifest: " +
        (err instanceof Error ? err.message : String(err)),
    );
    return 2;
  }

  let declared: Map<string, string>;
  try {
    declared = (opts.scanMigrations ?? scanMigrationsForUserTables)();
  } catch (err) {
    errorLog(
      "[check-gdpr-export-coverage] Failed to scan migrations: " +
        (err instanceof Error ? err.message : String(err)),
    );
    return 2;
  }

  // P698 - per-table user-id filter audit. Run BEFORE the coverage
  // diff so a filter-less entry surfaces even if the manifest otherwise
  // matches the migrations.
  const entries = (opts.readManifestEntries ?? readManifestEntries)();
  const filterless = entries.filter((e) => !e.hasUserFilter);
  if (filterless.length > 0) {
    errorLog(
      "[check-gdpr-export-coverage] FAIL (P698) - " +
        filterless.length +
        " USER_EXPORT_TABLES entry/entries lack an explicit user-id filter:",
    );
    for (const e of filterless) {
      errorLog(
        `  - ${e.table} (kind="${e.kind}") -> add ` +
          (e.kind === "indirect" ? "parent_user_column" : "user_column"),
      );
    }
    errorLog(
      "\nService-role bypasses RLS; the user-id filter is the only contractual " +
        "guarantee that the export cannot leak cross-tenant rows. See P698 in " +
        "the 2026-05-07 audit.",
    );
    return 1;
  }

  const missing: Array<{ table: string; migration: string }> = [];
  for (const [table, migration] of declared) {
    if (!manifest.has(table)) {
      missing.push({ table, migration });
    }
  }

  if (missing.length > 0) {
    errorLog(
      "[check-gdpr-export-coverage] FAIL - GDPR export manifest is missing " +
        missing.length +
        " user-owned table(s):",
    );
    for (const { table, migration } of missing) {
      errorLog(
        `  - ${table} (declared in ${migration}) -> add to USER_EXPORT_TABLES in src/lib/gdpr-export.ts`,
      );
    }
    errorLog(
      "\nFIX: open src/lib/gdpr-export.ts, locate the USER_EXPORT_TABLES " +
        'array, and add a `{ kind: "direct", table: "<name>", user_column: ' +
        '"<col>" }` entry (or `indirect` / `projected` as appropriate).\n' +
        "If the table genuinely should NOT appear in the export (e.g., cross-party " +
        "audit-only), add it to EXCLUDED_TABLES in scripts/check-gdpr-export-coverage.ts " +
        "and document the rationale in migration 055's per-table matrix.",
    );
    return 1;
  }

  // Audit 2026-05-07 H-0455/H-0457 - sanitize_user parity.
  let manifestForParity: Set<string>;
  let sanitizeCoverage: Set<string>;
  try {
    manifestForParity = (opts.readManifestForParity ?? readManifestTablesForParity)();
    sanitizeCoverage = (opts.scanSanitize ?? scanSanitizeUserCoverage)();
  } catch (err) {
    errorLog(
      "[check-gdpr-export-coverage] Failed to scan sanitize_user coverage: " +
        (err instanceof Error ? err.message : String(err)),
    );
    return 2;
  }
  const parityGaps: string[] = [];
  for (const table of manifestForParity) {
    if (sanitizeCoverage.has(table)) continue;
    if (table in SANITIZE_PARITY_ALLOWLIST) continue;
    parityGaps.push(table);
  }
  if (parityGaps.length > 0) {
    errorLog(
      "[check-gdpr-export-coverage] FAIL (H-0455/H-0457) - " +
        parityGaps.length +
        " USER_EXPORT_TABLES entry/entries have no matching row in the " +
        "sanitize_user matrix (migrations 20260417110538_sanitize_user.sql / " +
        "20260513073518_sanitize_user_hardening.sql):",
    );
    for (const t of parityGaps) {
      errorLog(
        `  - ${t} -> add a PURGE/ANONYMIZE/PRESERVE/CASCADE row to the ` +
          `sanitize_user matrix comment block AND (if needed) a DELETE/UPDATE ` +
          `statement to the function body. If the table is genuinely ` +
          `out-of-scope for sanitize (e.g., historical analytics ` +
          `keyed to an anonymized parent), add it to ` +
          `SANITIZE_PARITY_ALLOWLIST in this script with a documented reason.`,
      );
    }
    errorLog(
      "\nGDPR parity: every table exposed in the Art. 15 export bundle must " +
        "have a corresponding Art. 17 erasure policy. Without parity, a " +
        "deletion request can leave data the export keeps surfacing, or " +
        "purge data the user has no way to see was deleted.",
    );
    return 1;
  }

  // Audit 2026-05-07 red-team #9 (MED conf-8): projection parity +
  // stale-allowlist detection. C-0291 expands stale-allowlist
  // detection to ALSO cover EXCLUDED_TABLES, replacing the
  // unverifiable `addedIn` provenance with structural verification.
  let projected: ReturnType<typeof readProjectedManifestEntries>;
  try {
    projected = (opts.readProjectedEntries ?? readProjectedManifestEntries)();
  } catch (err) {
    errorLog(
      "[check-gdpr-export-coverage] Failed to read projected entries: " +
        (err instanceof Error ? err.message : String(err)),
    );
    return 2;
  }
  const projectionParityGaps: string[] = [];
  for (const { bundleName, sourceTable } of projected) {
    if (bundleName === sourceTable) continue;
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
  // Stale SANITIZE_PARITY_ALLOWLIST keys.
  const staleAllowlistKeys: string[] = [];
  for (const key of Object.keys(SANITIZE_PARITY_ALLOWLIST)) {
    if (!manifestForParity.has(key)) {
      staleAllowlistKeys.push(key);
    }
  }
  // C-0291: stale EXCLUDED_TABLES keys — every entry claims to
  // exclude a real table, so a key that no migration declares is
  // either a typo, a renamed-and-forgotten entry, or a dropped
  // table. This is the structural replacement for the deleted
  // `addedIn` field's intent (provenance tracking).
  const allDeclaredTables = (
    opts.scanAllDeclaredTables ?? collectAllDeclaredTables
  )();
  const staleExcludedKeys: string[] = [];
  for (const key of Object.keys(EXCLUDED_TABLES)) {
    if (!allDeclaredTables.has(key)) {
      staleExcludedKeys.push(key);
    }
  }
  // B10 (plan test #8): every EXCLUDED_TABLES entry must carry a recognised
  // exclusion class — excluding a table from the GDPR export is an opt-in
  // decision with a CHECKED rationale, not free text. The `ExclusionClass`
  // type makes a typo a tsc error; this runtime guard catches a class cast
  // away (or a hand-edited entry) and fails CI loudly rather than silently
  // widening the set of tables omitted from a data-subject's Art. 15 export.
  const invalidExclusionClasses: string[] = [];
  for (const [key, meta] of Object.entries(EXCLUDED_TABLES)) {
    if (!(EXCLUSION_CLASSES as readonly string[]).includes(meta.class)) {
      invalidExclusionClasses.push(
        `${key} (class: ${JSON.stringify(meta.class)})`,
      );
    }
  }
  if (
    projectionParityGaps.length > 0 ||
    staleAllowlistKeys.length > 0 ||
    staleExcludedKeys.length > 0 ||
    invalidExclusionClasses.length > 0
  ) {
    errorLog(
      "[check-gdpr-export-coverage] FAIL (audit-2026-05-07 red-team #9 / C-0291) - " +
        "projection parity / allowlist consistency failure(s):",
    );
    for (const g of projectionParityGaps) errorLog(`  - ${g}`);
    for (const k of staleAllowlistKeys) {
      errorLog(
        `  - SANITIZE_PARITY_ALLOWLIST has stale entry "${k}" — no matching ` +
          `table/source_table/parent_table in USER_EXPORT_TABLES. Remove the ` +
          `allowlist entry OR re-add the manifest entry it documents.`,
      );
    }
    for (const k of staleExcludedKeys) {
      errorLog(
        `  - EXCLUDED_TABLES has stale entry "${k}" — no migration declares ` +
          `this table. Either the table was renamed/dropped (remove this entry) ` +
          `or the migration's CREATE TABLE doesn't match the parser's regex ` +
          `(escalate to a SQL parser; see CHAIN-8 audit note).`,
      );
    }
    for (const e of invalidExclusionClasses) {
      errorLog(
        `  - EXCLUDED_TABLES entry "${e}" has an unrecognised exclusion class ` +
          `— must be one of: ${EXCLUSION_CLASSES.join(", ")}. Pick the class ` +
          `that matches WHY the table is excluded (see the ExclusionClass ` +
          `docblock) so the exclusion stays an auditable, opt-in decision.`,
      );
    }
    errorLog(
      "\nProjection parity: when a projected entry's bundle-facing name " +
        "differs from its underlying source_table (e.g. audit_log_for_user " +
        "projects audit_log), the sanitize matrix MUST cover BOTH names. A " +
        "source-table rename without an allowlist update silently leaves " +
        "the projection's provenance dangling.",
    );
    return 1;
  }

  const count = manifest.size;
  const declaredCount = declared.size;
  log(
    `[check-gdpr-export-coverage] OK - manifest covers all ${declaredCount} declared user-owned tables (manifest size ${count}).`,
  );
  return 0;
}

// Entry point — only run when invoked directly, not when imported by
// tests. `process.argv[1]` is the resolved script path; we compare
// against `import.meta.url` so the test runner can `import` this
// module without triggering `process.exit`.
const isDirectInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectInvocation) {
  process.exit(runCoverageCheck());
}
