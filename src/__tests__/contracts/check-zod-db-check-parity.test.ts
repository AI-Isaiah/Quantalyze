/**
 * B9 — CHECK ↔ Zod parity matrix (the non-bypassable half of B9).
 *
 * The `no-passthrough-on-ipc` lint rule (Part A) is a backstop an `eslint-disable`
 * could bypass. THIS test is the real teeth: it freezes the parity between each
 * closed-set the TS layer writes and the latest SQL CHECK constraint on the same
 * column, so a future drift fails CI *before* it can become a runtime 23514 at
 * insert (the NEW-C40-01 / #399 boundary class). It is the generalization of the
 * proven `strategy-sources-migration-parity.test.ts` / `percent-allocated-parity.test.ts`.
 *
 * Method (pure file-read; vitest has no DB):
 *   - SQL side: scan every supabase/migrations/*.sql, comment-stripped, ordered by
 *     leading numeric prefix (Postgres last-wins). EVERY CHECK column resolves via
 *     resolveColumnCheck with this precedence (so a future re-add/narrow is caught
 *     even on columns whose baseline is an inline check):
 *       1. a named `ADD CONSTRAINT <table>_<col>_check CHECK (...)` (newest file, last match), else
 *       2. the inline `CHECK (<col> [IS NULL OR <col>] IN (...))` in the table's CREATE migration.
 *     Enum-typed columns resolve via latestEnumTypeValues (schema-qualified
 *     `CREATE TYPE` + cumulative `ALTER TYPE ... ADD VALUE`).
 *   - TS side: import the runtime single-source-of-truth where one exists (so TS
 *     drift is caught too); pin the documented write-path set inline (with a cite)
 *     for the columns whose TS authority is a route-local const / split write paths.
 *   - Assertion: TS value-set == latest SQL value-set (set equality). A value
 *     'onlyInTs' is the dangerous direction (TS admits what the DB rejects → 23514).
 *
 * Honesty caveat (same as the sibling parity tests): the Zod/TS side is pinned
 * here; the DB side is pinned by each migration's own verification DO-block plus a
 * post-apply MCP probe. vitest cannot reach Postgres, so a constraint hand-edited
 * directly in prod (not via a migration file) would not be caught here — that is
 * what the migration DO-blocks guard. For Python-written columns (computation_status,
 * portfolio_alerts.severity) only the TS-union↔CHECK relation is pinned, NOT the
 * Python-producer↔CHECK relation.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

// Some imported modules transitively pull `server-only`; neutralize it so the
// schemas load in the node test env (mirrors percent-allocated-parity.test.ts).
vi.mock("server-only", () => ({}));

import {
  STRATEGY_ANALYTICS_COMPUTATION_STATUSES,
  SUPPORTED_EXCHANGES,
  FUNDING_EXCHANGES,
  SIGNUP_ROLES,
  LIQUIDITY_PREFERENCES,
} from "@/lib/closed-sets";
import { APP_ROLES } from "@/lib/auth-types";
import { REJECTION_REASONS } from "@/lib/bridge-outcome-schema";
import { GetUserComputeJobsRowSchema } from "@/lib/analytics-schemas";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

function migrationNumber(name: string): number {
  const m = name.match(/^(\d+)/);
  return m ? Number.parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** Strip `-- line` and block comments so a CHECK quoted in a comment can't
 *  masquerade as the live constraint (same conservative strip as the sibling tests). */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/** Strip dollar-quoted string/DO-block bodies (`$tag$ … $tag$`, incl. `$$ … $$`).
 *  Used only for the ALTER TYPE ADD VALUE scan: real ADD VALUE is top-level DDL
 *  (it cannot run inside a tx/DO block), so removing dollar-quoted bodies drops
 *  RAISE-message text that merely QUOTES an `ALTER TYPE … ADD VALUE '…'` example
 *  (e.g. the remediation string in 20260516160300) without dropping real DDL. */
function stripDollarQuotes(sql: string): string {
  return sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "");
}

function migrationsSortedAsc(): { name: string; num: number; path: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ name: f, num: migrationNumber(f), path: join(MIGRATIONS_DIR, f) }))
    .sort((a, b) => a.num - b.num);
}

function quotedLiterals(s: string): string[] {
  return [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Latest named `ADD CONSTRAINT <name> CHECK (...)` value-set, or null if none. */
function latestNamedCheckSet(constraintName: string): string[] | null {
  const files = migrationsSortedAsc();
  const re = new RegExp(
    `ADD\\s+CONSTRAINT\\s+${constraintName}\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*;`,
    "gi",
  );
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = stripSqlComments(readFileSync(files[i].path, "utf8"));
    const matches = [...sql.matchAll(re)];
    if (matches.length > 0) return quotedLiterals(matches[matches.length - 1][1]);
  }
  return null;
}

/** Inline `CHECK (<col> [IS NULL OR <col>] IN (...))` in a specific CREATE migration.
 *  The IN-list capture is `[^()]*` (no parens) so a compound/nested future CHECK
 *  fails loud (empty/partial capture → assertion mismatch) rather than silently
 *  mis-binding to the wrong paren group. The exactly-1-match guard catches a
 *  column-name collision or a migrated-to-named constraint. */
function inlineCheckSet(fileName: string, column: string): string[] {
  const f = migrationsSortedAsc().find((x) => x.name === fileName);
  if (!f) throw new Error(`migration file not found: ${fileName}`);
  const sql = stripSqlComments(readFileSync(f.path, "utf8"));
  const re = new RegExp(`CHECK\\s*\\([^)]*?\\b${column}\\s+IN\\s*\\(([^()]*)\\)`, "gi");
  const matches = [...sql.matchAll(re)];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly 1 inline CHECK for column '${column}' in ${fileName}, found ${matches.length} — ` +
        `the column may have gained a named ADD CONSTRAINT (resolveColumnCheck should pick it up) ` +
        `or another column collides; resolve explicitly rather than guessing.`,
    );
  }
  return quotedLiterals(matches[0][1]);
}

/**
 * Resolve a column's LATEST value-set CHECK with named-constraint precedence:
 * a `<table>_<column>_check` named ADD CONSTRAINT (newest wins) if one exists
 * anywhere, else the inline CHECK in the table's CREATE migration. This makes
 * the precedence the docstring promises real for EVERY column — a future
 * migration that re-adds/narrows an inline-checked column via a named
 * ADD CONSTRAINT (the DROP-then-ADD idiom B9 itself uses for strategy_analytics)
 * is then detected, not silently compared against the stale CREATE-time set.
 *
 * Assumption: a value-set CHECK on a pinned column follows the canonical
 * `<table>_<column>_check` name. A future narrowing under a NON-canonical
 * constraint name would fall back to the inline CREATE set (no current instance —
 * the only non-canonically-named CHECKs in the corpus are XOR/coherence
 * constraints, not value-set CHECKs on a pinned column).
 */
function resolveColumnCheck(table: string, column: string, createFile: string): string[] {
  return latestNamedCheckSet(`${table}_${column}_check`) ?? inlineCheckSet(createFile, column);
}

/**
 * Latest cumulative value-set for a column governed by a Postgres ENUM type.
 * Reads `CREATE TYPE [schema.]<name> AS ENUM (...)` (newest wins; schema prefix
 * tolerated) and UNIONs in every `ALTER TYPE [schema.]<name> ADD VALUE
 * [IF NOT EXISTS] '<v>'` across all migrations — the idiomatic way a PG enum
 * grows — so the resolved set reflects the cumulative live enum, not just the
 * original CREATE.
 */
function latestEnumTypeValues(typeName: string): string[] {
  const files = migrationsSortedAsc();
  const createRe = new RegExp(
    `CREATE\\s+TYPE\\s+(?:public\\.)?${typeName}\\s+AS\\s+ENUM\\s*\\(([\\s\\S]*?)\\)`,
    "gi",
  );
  const addValueRe = new RegExp(
    `ALTER\\s+TYPE\\s+(?:public\\.)?${typeName}\\s+ADD\\s+VALUE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'([^']+)'`,
    "gi",
  );
  let base: string[] | null = null;
  const added = new Set<string>();
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = stripSqlComments(readFileSync(files[i].path, "utf8"));
    if (base === null) {
      const creates = [...sql.matchAll(createRe)];
      if (creates.length > 0) base = quotedLiterals(creates[creates.length - 1][1]);
    }
    for (const m of stripDollarQuotes(sql).matchAll(addValueRe)) added.add(m[1]);
  }
  if (base === null) throw new Error(`CREATE TYPE ${typeName} AS ENUM (...) not found`);
  return [...new Set([...base, ...added])];
}

// --- compute_jobs Zod enums, read from the canonical read-side row schema -----
// GetUserComputeJobsRowSchema pins status (z.enum) + error_kind (z.enum().nullable()).
const computeJobsStatus = [...GetUserComputeJobsRowSchema.shape.status.options];
const computeJobsErrorKind = [
  ...GetUserComputeJobsRowSchema.shape.error_kind.unwrap().options,
];

interface Spec {
  column: string;
  /** The TS write-side closed set (canonical SoT or documented write-path set). */
  ts: readonly string[];
  /** Latest SQL CHECK / ENUM value-set, resolved from migrations (named-first). */
  sql: () => string[];
  /** Values that MUST NOT appear in the SQL set (e.g. the #399 'stale'). */
  rejects?: readonly string[];
  /** Where the TS set comes from when it's not an imported symbol. */
  tsNote?: string;
}

// Deliberately-deferred columns (a TS closed set AND a column CHECK both exist,
// but parity is pinned elsewhere or there is no TS SoT yet — tracked, not
// silently omitted, so the matrix's coverage is auditable):
//   - strategies.source        → strategy-sources-migration-parity.test.ts (+ strategies-source-csv-constraint.test.ts)
//   - trades/positions.side     → no TS SoT yet (B8b Python-mirror TRADE_SIDES deferred)
//   - doc_type / access_level / disclosure_tier / priority → follow-up coverage (their TS unions
//     are display-only types today; promoting each to a runtime SoT const + a SPEC is tracked B9.1)
const SPECS: Spec[] = [
  {
    // THE #399 / complete_with_warnings exhibit. After the B9 widening migration
    // the named CHECK is the 5-value set; 'stale' must stay rejected.
    column: "strategy_analytics.computation_status",
    ts: STRATEGY_ANALYTICS_COMPUTATION_STATUSES,
    tsNote: "STRATEGY_ANALYTICS_COMPUTATION_STATUSES (closed-sets.ts); 5-value after the B9 widening migration",
    sql: () =>
      resolveColumnCheck("strategy_analytics", "computation_status", "20260405061911_initial_schema.sql"),
    rejects: ["stale", "complete_with_errors"],
  },
  {
    column: "compute_jobs.status",
    ts: computeJobsStatus,
    sql: () => resolveColumnCheck("compute_jobs", "status", "20260411144407_compute_jobs_queue.sql"),
  },
  {
    column: "compute_jobs.error_kind",
    ts: computeJobsErrorKind,
    sql: () => resolveColumnCheck("compute_jobs", "error_kind", "20260411144407_compute_jobs_queue.sql"),
  },
  {
    column: "compute_jobs.exchange",
    ts: SUPPORTED_EXCHANGES,
    sql: () => resolveColumnCheck("compute_jobs", "exchange", "20260411144407_compute_jobs_queue.sql"),
  },
  {
    // B9 H-1122: funding_fees was the lone exchange column with no CHECK. The
    // 20260602180000 migration adds it, mirroring the sibling exchange columns.
    //
    // Phase 68 (DRB-02) DECOUPLE: the funding CHECK deliberately STAYS 3-exchange
    // even though SUPPORTED_EXCHANGES gained 'deribit'. Deribit funding is
    // continuous (arbitrary intra-hour settlement timestamps, BYB-02 red-team
    // 2026-07-04): a floor-bucket entry in _FUNDING_BUCKET_HOURS would silently
    // collapse distinct events. So this spec pins the 3-value FUNDING_EXCHANGES
    // const (NOT SUPPORTED_EXCHANGES) + rejects:['deribit'] — asserting the funding
    // CHECK EXCLUDES deribit (the "both directions" CONTEXT requirement). Phase 70
    // flips this spec TOGETHER with the SQL CHECK (20260602180000) and
    // _FUNDING_BUCKET_HOURS via a native-id/exact-ts dedup axis — the flip must
    // consciously edit THIS pinned spec, it can never drift green.
    column: "funding_fees.exchange",
    ts: FUNDING_EXCHANGES,
    rejects: ["deribit"],
    tsNote:
      "FUNDING_EXCHANGES (closed-sets.ts) — the decoupled 3-value funding surface; NOT SUPPORTED_EXCHANGES. CHECK added by 20260602180000_funding_fees_exchange_check.sql, stays 3-exchange until Phase 70.",
    sql: () =>
      resolveColumnCheck(
        "funding_fees",
        "exchange",
        "20260602180000_funding_fees_exchange_check.sql",
      ),
  },
  {
    // Phase 68 (DRB-02): the key-save last-line-of-defense. Widened to admit
    // 'deribit' by 20260704200446_deribit_exchange_boundary_checks.sql (named
    // ADD CONSTRAINT api_keys_exchange_check, newest-wins). ts: SUPPORTED_EXCHANGES
    // — the 4-value key-save allowlist. This is the CONTAIN direction of SC1.
    column: "api_keys.exchange",
    ts: SUPPORTED_EXCHANGES,
    tsNote:
      "SUPPORTED_EXCHANGES (closed-sets.ts) — the TS key-save allowlist; the api_keys.exchange CHECK is the SQL mirror, widened to deribit by 20260704200446.",
    sql: () => resolveColumnCheck("api_keys", "exchange", "20260405061911_initial_schema.sql"),
  },
  {
    // Phase 68 (DRB-02): the LIVE verify write path. Widened to admit 'deribit'
    // by 20260704200446 (named strategy_verifications_source_check). The write
    // path also stamps source='csv' (Phase 15), so the TS set is SUPPORTED_EXCHANGES
    // + 'csv'. NOTE: the frozen verification_requests_legacy table (Phase 19; the
    // public verification_requests is now a VIEW) is deliberately NOT covered —
    // its CHECK is intentionally frozen and must never be DROPped.
    column: "strategy_verifications.source",
    ts: [...SUPPORTED_EXCHANGES, "csv"],
    tsNote:
      "SUPPORTED_EXCHANGES + 'csv' — the live strategy_verifications write path (source=exchange for key-verified, 'csv' for uploads); widened to deribit by 20260704200446.",
    sql: () =>
      resolveColumnCheck(
        "strategy_verifications",
        "source",
        "20260501055202_strategy_verifications.sql",
      ),
  },
  {
    // Phase 68 (DRB-02) EXCLUSION pin: positions are Phase 71. The
    // position_snapshots.exchange CHECK stays 3-exchange until the f3 Path-B
    // DeribitNotSupportedError lifts (derivative positions). This spec pins an
    // explicit 3-value literal (NOT FUNDING_EXCHANGES — a semantically distinct
    // surface that happens to share the 3 codes) + rejects:['deribit'] so a future
    // SUPPORTED_EXCHANGES edit cannot silently widen positions. Phase 71 flips this
    // spec TOGETHER with the CHECK.
    column: "position_snapshots.exchange",
    ts: ["binance", "okx", "bybit"],
    rejects: ["deribit"],
    tsNote:
      "explicit 3-value literal — positions surface (Phase 71); position_snapshots_exchange_check stays 3-exchange until DeribitNotSupportedError lifts.",
    sql: () =>
      resolveColumnCheck(
        "position_snapshots",
        "exchange",
        "20260412094450_position_snapshots.sql",
      ),
  },
  {
    column: "profiles.role",
    ts: SIGNUP_ROLES,
    sql: () => resolveColumnCheck("profiles", "role", "20260405061911_initial_schema.sql"),
    rejects: ["admin"], // privilege class lives in user_app_roles, never signup
  },
  {
    column: "user_app_roles.role",
    ts: APP_ROLES,
    sql: () => resolveColumnCheck("user_app_roles", "role", "20260417031851_user_app_roles.sql"),
  },
  {
    column: "user_notes.scope_kind",
    // Phase 100 PI-04 added the 5th value 'dashboard' to the SQL CHECK
    // (mig 20260715090000) AND to the runtime TS sets (ownership.ts ScopeKind +
    // route.ts ALLOWED_KINDS). Keep this mirror in lockstep.
    ts: ["portfolio", "holding", "bridge_outcome", "strategy", "dashboard"],
    tsNote: "notes/route.ts:35 ALLOWED_KINDS (route-local) / ownership.ts:30 ScopeKind",
    sql: () => resolveColumnCheck("user_notes", "scope_kind", "20260421060316_user_notes_multiscope.sql"),
  },
  {
    column: "contact_requests.status",
    ts: ["pending", "intro_made", "completed", "declined"],
    tsNote: "intro-request/route.ts:11 VALID_STATUSES (route-local) / types.ts:1017 ContactRequestStatus",
    sql: () => resolveColumnCheck("contact_requests", "status", "20260405061911_initial_schema.sql"),
    rejects: ["accepted"], // migrated away in mig 008
  },
  {
    column: "contact_requests.source",
    ts: ["direct", "bridge"], // intro/route.ts:45 INTRO_SCHEMA.source z.enum
    tsNote: "intro/route.ts:45 INTRO_SCHEMA.source (route-local z.enum)",
    sql: () =>
      resolveColumnCheck("contact_requests", "source", "20260416125430_contact_request_metadata.sql"),
  },
  {
    column: "bridge_outcomes.rejection_reason",
    ts: REJECTION_REASONS,
    sql: () =>
      resolveColumnCheck("bridge_outcomes", "rejection_reason", "20260418060747_bridge_outcomes.sql"),
  },
  {
    column: "allocator_preferences.liquidity_preference",
    ts: LIQUIDITY_PREFERENCES,
    sql: () =>
      resolveColumnCheck(
        "allocator_preferences",
        "liquidity_preference",
        "20260418150632_mandate_columns.sql",
      ),
  },
  {
    column: "match_decisions.kind",
    // database.types Constants.public.Enums.match_decision_kind + scenario-commit
    // discriminated union; SQL side is a PG ENUM TYPE, not a CHECK.
    ts: ["bridge_recommended", "voluntary_remove", "voluntary_add", "voluntary_modify"],
    tsNote: "database.types match_decision_kind + scenario/commit/route.ts discriminated union (SQL = PG ENUM type)",
    sql: () => latestEnumTypeValues("match_decision_kind"),
  },
  {
    column: "match_decisions.decision",
    // Union of the split write paths: admin route emits a 3-value subset,
    // holding route emits the 4th ('sent_as_intro') — no single TS symbol has all four.
    ts: ["thumbs_up", "thumbs_down", "sent_as_intro", "snoozed"],
    tsNote:
      "admin/match/decisions/route.ts:10 VALID (3-value subset) + match/decisions/holding/route.ts:130 'sent_as_intro' literal — union of the split write paths",
    sql: () => resolveColumnCheck("match_decisions", "decision", "20260407164606_perfect_match.sql"),
  },
  {
    column: "portfolio_alerts.severity",
    ts: ["critical", "high", "medium", "low"],
    tsNote:
      "utils.ts:126 AlertSeverity (TS display/email union — the pinned authority). Column is WRITTEN by analytics-service (reconciliation.py emits 'critical'; portfolio.py emits high/medium/low), so Python-producer↔CHECK drift is NOT covered here — only TS-union↔CHECK.",
    sql: () =>
      resolveColumnCheck("portfolio_alerts", "severity", "20260407075303_portfolio_intelligence.sql"),
  },
];

describe("[B9] CHECK ↔ Zod parity matrix", () => {
  it("pins exactly the expected column set (identity, not just count — a drop-one/add-one swap fails)", () => {
    // Identity, not a >=N floor: a count-only guard lets a malicious/accidental
    // drop-one-add-one swap net green. Pin the exact set so dropping any pinned
    // column fails even if another is added. Add coverage by editing this list
    // deliberately.
    const EXPECTED_COLUMNS = [
      "strategy_analytics.computation_status",
      "compute_jobs.status",
      "compute_jobs.error_kind",
      "compute_jobs.exchange",
      "funding_fees.exchange",
      "api_keys.exchange",
      "strategy_verifications.source",
      "position_snapshots.exchange",
      "profiles.role",
      "user_app_roles.role",
      "user_notes.scope_kind",
      "contact_requests.status",
      "contact_requests.source",
      "bridge_outcomes.rejection_reason",
      "allocator_preferences.liquidity_preference",
      "match_decisions.kind",
      "match_decisions.decision",
      "portfolio_alerts.severity",
    ];
    expect(
      SPECS.map((s) => s.column).sort(),
      "B9 parity column set drifted — a pinned pair was dropped/renamed (a drop-one/add-one " +
        "swap would slip past a count-only guard). Update EXPECTED_COLUMNS deliberately if adding coverage.",
    ).toEqual([...EXPECTED_COLUMNS].sort());
  });

  it.each(SPECS)("$column — TS set == latest SQL CHECK", (spec) => {
    const sqlSet = new Set(spec.sql());
    const tsSet = new Set(spec.ts);

    expect(sqlSet.size, `${spec.column}: extracted an empty SQL CHECK set`).toBeGreaterThan(0);

    const onlyInSql = [...sqlSet].filter((v) => !tsSet.has(v));
    const onlyInTs = [...tsSet].filter((v) => !sqlSet.has(v));
    expect(
      { onlyInSql, onlyInTs },
      `${spec.column}: TS closed set drifted from the latest SQL CHECK. ` +
        `A value 'onlyInTs' is the dangerous direction (TS admits what the DB rejects → 23514 at insert). ` +
        `Reconcile: add the value to the other side, or write a migration that aligns the CHECK. ` +
        `(TS source: ${spec.tsNote ?? "imported canonical const"})`,
    ).toEqual({ onlyInSql: [], onlyInTs: [] });

    for (const bad of spec.rejects ?? []) {
      expect(
        sqlSet.has(bad),
        `${spec.column}: SQL CHECK must REJECT '${bad}' but its value set contains it.`,
      ).toBe(false);
    }
  });
});
