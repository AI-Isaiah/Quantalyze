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
 *     leading numeric prefix (Postgres last-wins). For each column take the LATEST
 *     value-set, resolved in this precedence:
 *       1. a named `ADD CONSTRAINT <table>_<col>_check CHECK (...)` (newest file, last match), else
 *       2. the inline `CHECK (<col> [IS NULL OR <col>] IN (...))` in the table's CREATE migration, else
 *       3. a `CREATE TYPE <enum> AS ENUM (...)` for enum-typed columns.
 *     The named-search runs FIRST so a future migration that re-adds/narrows a
 *     constraint is detected even on columns whose baseline is an inline check.
 *   - TS side: import the runtime single-source-of-truth where one exists (so TS
 *     drift is caught too); pin the documented write-path set inline (with a cite)
 *     for the columns whose TS authority is a route-local const / split write paths.
 *   - Relation: 'equal' (in-parity) OR 'ts-subset' (TS deliberately stricter — a
 *     per-endpoint business rule; SAFE: every TS value is SQL-accepted).
 *
 * Honesty caveat (same as the sibling parity tests): the Zod/TS side is pinned
 * here; the DB side is pinned by each migration's own verification DO-block plus a
 * post-apply MCP probe. vitest cannot reach Postgres, so a constraint hand-edited
 * directly in prod (not via a migration file) would not be caught here — that is
 * what the migration DO-blocks guard.
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

/** Inline `CHECK (<col> [IS NULL OR <col>] IN (...))` in a specific CREATE migration. */
function inlineCheckSet(fileName: string, column: string): string[] {
  const f = migrationsSortedAsc().find((x) => x.name === fileName);
  if (!f) throw new Error(`migration file not found: ${fileName}`);
  const sql = stripSqlComments(readFileSync(f.path, "utf8"));
  const re = new RegExp(`CHECK\\s*\\([^)]*?\\b${column}\\s+IN\\s*\\(([^)]*)\\)`, "gi");
  const matches = [...sql.matchAll(re)];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly 1 inline CHECK for column '${column}' in ${fileName}, found ${matches.length} — ` +
        `the column may have gained a named ADD CONSTRAINT (update the spec to use latestNamedCheckSet) ` +
        `or another column collides; resolve explicitly rather than guessing.`,
    );
  }
  return quotedLiterals(matches[0][1]);
}

/** Latest `CREATE TYPE <name> AS ENUM (...)` value-set (column governed by a PG enum). */
function latestEnumTypeValues(typeName: string): string[] {
  const files = migrationsSortedAsc();
  const re = new RegExp(`CREATE\\s+TYPE\\s+${typeName}\\s+AS\\s+ENUM\\s*\\(([\\s\\S]*?)\\)`, "gi");
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = stripSqlComments(readFileSync(files[i].path, "utf8"));
    const matches = [...sql.matchAll(re)];
    if (matches.length > 0) return quotedLiterals(matches[matches.length - 1][1]);
  }
  throw new Error(`CREATE TYPE ${typeName} AS ENUM (...) not found`);
}

// --- compute_jobs Zod enums, read from the canonical read-side row schema -----
// GetUserComputeJobsRowSchema pins status (z.enum) + error_kind (z.enum().nullable()).
const computeJobsStatus = [...GetUserComputeJobsRowSchema.shape.status.options];
const computeJobsErrorKind = [
  ...GetUserComputeJobsRowSchema.shape.error_kind.unwrap().options,
];

type Relation = "equal" | "ts-subset";

interface Spec {
  column: string;
  /** The TS write-side closed set (canonical SoT or documented write-path set). */
  ts: readonly string[];
  /** How the SQL CHECK set is resolved from migrations. */
  sql: () => string[];
  relation: Relation;
  /** Values that MUST NOT appear in the SQL set (e.g. the #399 'stale'). */
  rejects?: readonly string[];
  /** Where the TS set comes from when it's not an imported symbol. */
  tsNote?: string;
}

const SPECS: Spec[] = [
  {
    // THE #399 / complete_with_warnings exhibit. After
    // 20260602120000_..._add_complete_with_warnings.sql the named CHECK is the
    // 5-value set; 'stale' must stay rejected.
    column: "strategy_analytics.computation_status",
    ts: STRATEGY_ANALYTICS_COMPUTATION_STATUSES,
    sql: () => {
      const s = latestNamedCheckSet("strategy_analytics_computation_status_check");
      if (!s) throw new Error("no named strategy_analytics_computation_status_check found");
      return s;
    },
    relation: "equal",
    rejects: ["stale", "complete_with_errors"],
  },
  {
    column: "compute_jobs.status",
    ts: computeJobsStatus,
    sql: () => inlineCheckSet("20260411144407_compute_jobs_queue.sql", "status"),
    relation: "equal",
  },
  {
    column: "compute_jobs.error_kind",
    ts: computeJobsErrorKind,
    sql: () => inlineCheckSet("20260411144407_compute_jobs_queue.sql", "error_kind"),
    relation: "equal",
  },
  {
    column: "compute_jobs.exchange",
    ts: SUPPORTED_EXCHANGES,
    sql: () => inlineCheckSet("20260411144407_compute_jobs_queue.sql", "exchange"),
    relation: "equal",
  },
  {
    column: "profiles.role",
    ts: SIGNUP_ROLES,
    sql: () => inlineCheckSet("20260405061911_initial_schema.sql", "role"),
    relation: "equal",
    rejects: ["admin"], // privilege class lives in user_app_roles, never signup
  },
  {
    column: "user_app_roles.role",
    ts: APP_ROLES,
    sql: () => inlineCheckSet("20260417031851_user_app_roles.sql", "role"),
    relation: "equal",
  },
  {
    column: "user_notes.scope_kind",
    // src/app/api/notes/route.ts:35 ALLOWED_KINDS + src/lib/notes/ownership.ts:30 ScopeKind
    ts: ["portfolio", "holding", "bridge_outcome", "strategy"],
    tsNote: "notes/route.ts:35 ALLOWED_KINDS (route-local) / ownership.ts:30 ScopeKind",
    sql: () => {
      const s = latestNamedCheckSet("user_notes_scope_kind_check");
      if (!s) throw new Error("no named user_notes_scope_kind_check found");
      return s;
    },
    relation: "equal",
  },
  {
    column: "contact_requests.status",
    // intro-request/route.ts:11 VALID_STATUSES + types.ts:1017 ContactRequestStatus
    ts: ["pending", "intro_made", "completed", "declined"],
    tsNote: "intro-request/route.ts:11 VALID_STATUSES (route-local) / types.ts:1017",
    sql: () => {
      const s = latestNamedCheckSet("contact_requests_status_check");
      if (!s) throw new Error("no named contact_requests_status_check found");
      return s;
    },
    relation: "equal",
    rejects: ["accepted"], // migrated away in mig 008
  },
  {
    column: "contact_requests.source",
    ts: ["direct", "bridge"], // intro/route.ts:45 INTRO_SCHEMA.source z.enum
    tsNote: "intro/route.ts:45 INTRO_SCHEMA.source (route-local z.enum)",
    sql: () => {
      const s = latestNamedCheckSet("contact_requests_source_check");
      if (!s) throw new Error("no named contact_requests_source_check found");
      return s;
    },
    relation: "equal",
  },
  {
    column: "bridge_outcomes.rejection_reason",
    ts: REJECTION_REASONS,
    sql: () => inlineCheckSet("20260418060747_bridge_outcomes.sql", "rejection_reason"),
    relation: "equal",
  },
  {
    column: "allocator_preferences.liquidity_preference",
    ts: LIQUIDITY_PREFERENCES,
    sql: () => {
      const s = latestNamedCheckSet("allocator_preferences_liquidity_preference_check");
      if (!s) throw new Error("no named allocator_preferences_liquidity_preference_check found");
      return s;
    },
    relation: "equal",
  },
  {
    column: "match_decisions.kind",
    // database.types Constants.public.Enums.match_decision_kind + scenario-commit
    // discriminated union; SQL side is a PG ENUM TYPE, not a CHECK.
    ts: ["bridge_recommended", "voluntary_remove", "voluntary_add", "voluntary_modify"],
    tsNote: "database.types match_decision_kind + scenario/commit/route.ts discriminated union",
    sql: () => latestEnumTypeValues("match_decision_kind"),
    relation: "equal",
  },
  {
    column: "match_decisions.decision",
    // Full intended set; admin route emits a 3-value subset, holding route emits
    // the 4th ('sent_as_intro') — no single TS symbol enumerates all four.
    ts: ["thumbs_up", "thumbs_down", "sent_as_intro", "snoozed"],
    tsNote: "admin/match/decisions/route.ts:10 VALID (subset) + match/decisions/holding/route.ts:130 literal",
    sql: () => inlineCheckSet("20260407164606_perfect_match.sql", "decision"),
    relation: "equal",
  },
  {
    column: "portfolio_alerts.severity",
    ts: ["critical", "high", "medium", "low"], // utils.ts:126 AlertSeverity (Python writes the column)
    tsNote: "utils.ts:126 AlertSeverity (type union; portfolio_alerts is written by analytics-service)",
    sql: () => {
      const s = latestNamedCheckSet("portfolio_alerts_severity_check");
      if (!s) throw new Error("no named portfolio_alerts_severity_check found");
      return s;
    },
    relation: "equal",
  },
];

describe("[B9] CHECK ↔ Zod parity matrix", () => {
  it("pins a non-trivial set of column pairs (fail-loud on accidental truncation)", () => {
    expect(
      SPECS.length,
      "B9 parity SPECS shrank unexpectedly — did a pinned pair get dropped?",
    ).toBeGreaterThanOrEqual(14);
  });

  it.each(SPECS)("$column — TS $relation SQL CHECK", (spec) => {
    const sqlSet = new Set(spec.sql());
    const tsSet = new Set(spec.ts);

    expect(sqlSet.size, `${spec.column}: extracted an empty SQL CHECK set`).toBeGreaterThan(0);

    if (spec.relation === "equal") {
      const onlyInSql = [...sqlSet].filter((v) => !tsSet.has(v));
      const onlyInTs = [...tsSet].filter((v) => !sqlSet.has(v));
      expect(
        { onlyInSql, onlyInTs },
        `${spec.column}: TS closed set drifted from the latest SQL CHECK. ` +
          `A value 'onlyInTs' is the dangerous direction (TS admits what the DB rejects → 23514 at insert). ` +
          `Reconcile: add the value to the other side, or write a migration that aligns the CHECK. ` +
          `(TS source: ${spec.tsNote ?? "imported canonical const"})`,
      ).toEqual({ onlyInSql: [], onlyInTs: [] });
    } else {
      // ts-subset: every TS value must be SQL-accepted (no 23514). SQL may have extras.
      const tsNotInSql = [...tsSet].filter((v) => !sqlSet.has(v));
      expect(
        tsNotInSql,
        `${spec.column}: TS admits value(s) the SQL CHECK rejects → 23514-at-insert risk.`,
      ).toEqual([]);
    }

    for (const bad of spec.rejects ?? []) {
      expect(
        sqlSet.has(bad),
        `${spec.column}: SQL CHECK must REJECT '${bad}' but its value set contains it.`,
      ).toBe(false);
    }
  });
});
