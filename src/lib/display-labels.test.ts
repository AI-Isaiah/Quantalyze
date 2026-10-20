/**
 * Phase 170.1.2 LABELS (D-01) — the label vocabularies agree with the database.
 *
 * WHY THIS EXISTS. A label map is hand-typed in TypeScript while the values it
 * labels are a SQL CHECK set. When the database admits a new value (a new
 * compute-job kind, say) and the map lacks it, the page falls through to the
 * fallback label and an operator reads "Other job" for a real job. This census
 * parses `supabase/schema/baseline.sql` and fails when a vocabulary's key set
 * differs from its CHECK set, in either direction, naming the constraint.
 *
 * The census resolves each CHECK newest-wins: the committed baseline dump,
 * overridden by the newest `ADD CONSTRAINT <name> CHECK (...)` in a migration
 * the dump does not carry (the same precedence
 * `src/__tests__/contracts/check-zod-db-check-parity.test.ts` uses). A new
 * migration is judged on the values it admits, never on its existence: it goes
 * red only when it widens a CHECK and the label map was not extended.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXCHANGE_DISPLAY } from "@/lib/closed-sets";
import { statusLabelMap } from "@/components/ui/Badge";
import { ROLE_META } from "@/lib/auth-types";
import { ROLES } from "@/lib/types";
import {
  ALLOCATION_EVENT_TYPE_LABELS,
  ANALYTICS_STATUS_LABELS,
  BREACH_REASON_EMPTY_LABEL,
  BREACH_REASON_LABELS,
  COMPUTE_JOB_ERROR_KIND_LABELS,
  COMPUTE_JOB_KIND_LABELS,
  COMPUTE_JOB_STATUS_LABELS,
  DISCLOSURE_TIER_LABELS,
  INTRO_SNAPSHOT_STATUS_LABELS,
  INTRO_SOURCE_LABELS,
  MATCH_DECISION_LABELS,
  MATCH_MISS_REASON_LABELS,
  ORG_MEMBER_ROLE_LABELS,
  PROFILE_STATUS_LABELS,
  RELATIONSHIP_STATUS_LABELS,
  STRATEGY_SOURCE_LABELS,
  VERIFICATION_STATUS_LABELS,
  allocationEventTypeLabel,
  analyticsStatusLabel,
  appRoleLabel,
  breachReasonLabel,
  computeJobErrorKindLabel,
  computeJobKindLabel,
  computeJobStatusLabel,
  disclosureTierLabel,
  introSnapshotStatusLabel,
  introSourceLabel,
  labelOf,
  matchDecisionLabel,
  matchMissReasonLabel,
  orgMemberRoleLabel,
  profileRoleLabel,
  profileStatusLabel,
  relationshipStatusLabel,
  strategySourceLabel,
  supportedExchangeLabel,
  venueLabel,
  verificationStatusLabel,
} from "./display-labels";

const REPO_ROOT = join(__dirname, "..", "..");

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

const BASELINE = stripSqlComments(
  readFileSync(join(REPO_ROOT, "supabase", "schema", "baseline.sql"), "utf8"),
);

/**
 * Migrations the dump does not carry (filename order, oldest first). The dump
 * is taken from PROD after the apply, so a migration newer than
 * `baseline-carried-migrations.txt` is the normal case, not a red.
 */
const UNCARRIED_MIGRATIONS: Array<{ name: string; sql: string }> = (() => {
  const carried = readFileSync(
    join(REPO_ROOT, "supabase", "schema", "baseline-carried-migrations.txt"),
    "utf8",
  )
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d{14}_.*\.sql$/.test(l))
    .sort();
  const lastCarried = carried[carried.length - 1];
  if (!lastCarried) throw new Error("baseline-carried-migrations.txt lists no migration");
  const migrationsDir = join(REPO_ROOT, "supabase", "migrations");
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f))
    .filter((f) => f > lastCarried)
    .sort()
    .map((name) => ({
      name,
      sql: stripSqlComments(readFileSync(join(migrationsDir, name), "utf8")),
    }));
})();

/**
 * The newest `ADD CONSTRAINT <name> CHECK (...)` value list in a migration the
 * dump does not carry, or null when none re-declares it.
 */
function newestUncarriedCheckSet(constraintName: string): string[] | null {
  const re = new RegExp(
    `ADD\\s+CONSTRAINT\\s+"?${constraintName}"?\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*;`,
    "gi",
  );
  for (let i = UNCARRIED_MIGRATIONS.length - 1; i >= 0; i--) {
    const hits = [...UNCARRIED_MIGRATIONS[i].sql.matchAll(re)];
    if (hits.length > 0) {
      return [...hits[hits.length - 1][1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    }
  }
  return null;
}

/**
 * The value list of `CONSTRAINT "<name>" CHECK (("<col>" = ANY (ARRAY[...])))`
 * in the baseline dump, with the `::"text"` casts dropped, unless a newer
 * migration re-declares the constraint (newest wins). Throws unless the
 * constraint appears exactly once in the dump, so a rename or a second
 * declaration fails loud instead of comparing against nothing.
 */
function checkSet(constraintName: string): string[] {
  const re = new RegExp(
    `CONSTRAINT "${constraintName}" CHECK \\(\\("[a-z_]+" = ANY \\(ARRAY\\[([^\\]]*)\\]`,
    "g",
  );
  const matches = [...BASELINE.matchAll(re)];
  if (matches.length !== 1) {
    throw new Error(
      `${constraintName}: expected exactly 1 ARRAY check in baseline.sql, found ${matches.length}`,
    );
  }
  const newer = newestUncarriedCheckSet(constraintName);
  const values = newer ?? [...matches[0][1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  expect(values.length, `${constraintName} captured no values`).toBeGreaterThan(0);
  return values;
}

function expectSameSet(constraint: string, keys: string[]) {
  const sql = checkSet(constraint);
  const onlyInSql = sql.filter((v) => !keys.includes(v));
  const onlyInTs = keys.filter((k) => !sql.includes(k));
  expect(
    { onlyInSql, onlyInTs },
    `${constraint}: the label map and the database CHECK set differ. onlyInSql = values the database admits with no label; onlyInTs = labels for values the database no longer admits.`,
  ).toEqual({ onlyInSql: [], onlyInTs: [] });
}

/**
 * Every vocabulary keyed by its database constraint. `profiles_*_status_check`
 * share one map (the allocator and manager statuses are the same three
 * values). The role vocabularies reuse `ROLES` / `ROLE_META`, so their key sets
 * come from those sources.
 */
const CENSUS: Array<[constraint: string, keys: string[]]> = [
  ["compute_jobs_kind_check", Object.keys(COMPUTE_JOB_KIND_LABELS)],
  ["compute_jobs_status_check", Object.keys(COMPUTE_JOB_STATUS_LABELS)],
  ["compute_jobs_error_kind_check", Object.keys(COMPUTE_JOB_ERROR_KIND_LABELS)],
  ["allocation_events_event_type_check", Object.keys(ALLOCATION_EVENT_TYPE_LABELS)],
  ["match_decisions_decision_check", Object.keys(MATCH_DECISION_LABELS)],
  ["organization_members_role_check", Object.keys(ORG_MEMBER_ROLE_LABELS)],
  ["user_app_roles_role_check", Object.keys(ROLE_META)],
  ["profiles_role_check", ROLES.map((r) => r.value)],
  ["profiles_allocator_status_check", Object.keys(PROFILE_STATUS_LABELS)],
  ["profiles_manager_status_check", Object.keys(PROFILE_STATUS_LABELS)],
  ["strategy_verifications_status_check", Object.keys(VERIFICATION_STATUS_LABELS)],
  ["contact_requests_snapshot_status_check", Object.keys(INTRO_SNAPSHOT_STATUS_LABELS)],
  ["contact_requests_source_check", Object.keys(INTRO_SOURCE_LABELS)],
  ["portfolio_strategies_relationship_status_check", Object.keys(RELATIONSHIP_STATUS_LABELS)],
  ["strategy_analytics_computation_status_check", Object.keys(ANALYTICS_STATUS_LABELS)],
  ["strategies_disclosure_tier_check", Object.keys(DISCLOSURE_TIER_LABELS)],
  ["strategies_source_check", Object.keys(STRATEGY_SOURCE_LABELS)],
];

describe("labelOf", () => {
  const map = { a: "Alpha" };

  it("returns the label for an own key", () => {
    expect(labelOf(map, "a", "Fallback")).toBe("Alpha");
  });

  it("returns the fallback for a value outside the map, never the raw value", () => {
    expect(labelOf(map, "nope", "Fallback")).toBe("Fallback");
  });

  it("returns the fallback for prototype keys and non-strings", () => {
    expect(labelOf(map, "constructor", "Fallback")).toBe("Fallback");
    expect(labelOf(map, "__proto__", "Fallback")).toBe("Fallback");
    expect(labelOf(map, "toString", "Fallback")).toBe("Fallback");
    expect(labelOf(map, null, "Fallback")).toBe("Fallback");
    expect(labelOf(map, undefined, "Fallback")).toBe("Fallback");
  });
});

describe("label vocabularies cover exactly their database CHECK sets", () => {
  it.each(CENSUS)("%s", (constraint, keys) => {
    expectSameSet(constraint, keys);
  });
});

describe("wrappers: a real value reads its label", () => {
  it("compute jobs", () => {
    expect(computeJobKindLabel("sync_trades")).toBe("Trade sync");
    expect(computeJobKindLabel("derive_allocator_equity")).toBe("Allocator equity derivation");
    expect(computeJobStatusLabel("failed_retry")).toBe("Retrying");
    expect(computeJobStatusLabel("done_pending_children")).toBe("Done, follow-up jobs pending");
    expect(computeJobErrorKindLabel("orphaned")).toBe("Worker stopped");
    expect(computeJobErrorKindLabel("transient")).toBe("Temporary error");
  });

  it("allocations and matching", () => {
    expect(allocationEventTypeLabel("withdrawal")).toBe("Withdrawal");
    expect(matchDecisionLabel("sent_as_intro")).toBe("Intro sent");
    expect(matchDecisionLabel("thumbs_up")).toBe("Kept");
    expect(matchDecisionLabel("thumbs_down")).toBe("Skipped");
    expect(breachReasonLabel("max_weight")).toBe("Above max weight");
    expect(breachReasonLabel("correlation_ceiling")).toBe("Above correlation ceiling");
    expect(BREACH_REASON_EMPTY_LABEL).toBe("Composite score above threshold");
    expect(matchMissReasonLabel("not_in_top_3")).toBe("Ranked below top 3");
    expect(matchMissReasonLabel("no_prior_batch")).toBe("No earlier match batch");
    // match_eval.py emits exactly these two reasons for a missed intro.
    expect(Object.keys(MATCH_MISS_REASON_LABELS).sort()).toEqual(["no_prior_batch", "not_in_top_3"]);
    expect(Object.keys(BREACH_REASON_LABELS).sort()).toEqual(["correlation_ceiling", "max_weight"]);
  });

  it("roles come from their existing sources, not a copy", () => {
    expect(profileRoleLabel("manager")).toBe("Asset Manager");
    expect(profileRoleLabel("both")).toBe("Both");
    expect(appRoleLabel("quant_manager")).toBe("Quant manager");
    expect(appRoleLabel("analyst")).toBe("Analyst");
    expect(orgMemberRoleLabel("owner")).toBe("Owner");
    for (const r of ROLES) expect(profileRoleLabel(r.value)).toBe(r.label);
    for (const [k, meta] of Object.entries(ROLE_META)) expect(appRoleLabel(k)).toBe(meta.label);
  });

  it("statuses", () => {
    expect(profileStatusLabel("newbie")).toBe("New");
    expect(verificationStatusLabel("metrics_captured")).toBe("Metrics captured");
    expect(introSnapshotStatusLabel("ready")).toBe("Ready");
    expect(introSourceLabel("bridge")).toBe("Bridge");
    expect(relationshipStatusLabel("exited")).toBe("Exited");
    expect(analyticsStatusLabel("complete_with_warnings")).toBe("Analytics complete, with warnings");
    expect(analyticsStatusLabel("complete")).toBe("Analytics complete");
    expect(disclosureTierLabel("exploratory")).toBe("Exploratory");
  });

  it("strategy sources: exchange sources come from EXCHANGE_DISPLAY", () => {
    expect(strategySourceLabel("okx")).toBe("OKX");
    expect(strategySourceLabel("sfox")).toBe("sFOX");
    expect(strategySourceLabel("admin_import")).toBe("Import");
    expect(strategySourceLabel("csv")).toBe("CSV");
    for (const [code, name] of Object.entries(EXCHANGE_DISPLAY)) {
      expect(strategySourceLabel(code)).toBe(name);
    }
  });
});

describe("wrappers: a value outside the closed set reads the fallback, never the raw value", () => {
  // [wrapper, fallback]. Each is probed with a stranger, a prototype key and null.
  const FALLBACKS: Array<[string, (v: unknown) => string, string]> = [
    ["computeJobKindLabel", computeJobKindLabel, "Other job"],
    ["computeJobStatusLabel", computeJobStatusLabel, "Unknown status"],
    ["computeJobErrorKindLabel", computeJobErrorKindLabel, "Error"],
    ["allocationEventTypeLabel", allocationEventTypeLabel, "Other event"],
    ["matchDecisionLabel", matchDecisionLabel, "Other decision"],
    ["breachReasonLabel", breachReasonLabel, "Other mandate breach"],
    ["matchMissReasonLabel", matchMissReasonLabel, "Other reason"],
    ["orgMemberRoleLabel", orgMemberRoleLabel, "Unknown role"],
    ["profileRoleLabel", profileRoleLabel, "Unknown role"],
    ["appRoleLabel", appRoleLabel, "Unknown role"],
    ["profileStatusLabel", profileStatusLabel, "Unknown status"],
    ["verificationStatusLabel", verificationStatusLabel, "Unknown status"],
    ["introSnapshotStatusLabel", introSnapshotStatusLabel, "Unknown status"],
    ["introSourceLabel", introSourceLabel, "Other source"],
    ["relationshipStatusLabel", relationshipStatusLabel, "Unknown status"],
    ["analyticsStatusLabel", analyticsStatusLabel, "Analytics status unknown"],
    ["disclosureTierLabel", disclosureTierLabel, "Unknown tier"],
    ["strategySourceLabel", strategySourceLabel, "Other source"],
    ["venueLabel", venueLabel, "Other venue"],
  ];

  it.each(FALLBACKS)("%s", (_name, fn, fallback) => {
    expect(fn("not_a_real_value")).toBe(fallback);
    expect(fn("constructor")).toBe(fallback);
    expect(fn("__proto__")).toBe(fallback);
    expect(fn(null)).toBe(fallback);
    expect(fn(undefined)).toBe(fallback);
  });
});

describe("venueLabel", () => {
  it("maps every EXCHANGE_DISPLAY key case-insensitively", () => {
    for (const [code, name] of Object.entries(EXCHANGE_DISPLAY)) {
      expect(venueLabel(code)).toBe(name);
      expect(venueLabel(code.toUpperCase())).toBe(name);
    }
    expect(venueLabel("okx")).toBe("OKX");
    expect(venueLabel("OKX")).toBe("OKX");
    expect(venueLabel("sfox")).toBe("sFOX");
    expect(venueLabel("mt5")).toBe("MT5");
  });

  it("reads 'Other venue' for a venue outside the closed set", () => {
    expect(venueLabel("kraken")).toBe("Other venue");
  });
});

describe("supportedExchangeLabel (free-text exchange lists)", () => {
  it("maps a known code through EXCHANGE_DISPLAY, case-insensitively", () => {
    expect(supportedExchangeLabel("okx")).toBe("OKX");
    expect(supportedExchangeLabel("OKX")).toBe("OKX");
    expect(supportedExchangeLabel("Binance")).toBe("Binance");
  });

  it("returns any other value verbatim, trimmed, never 'Other venue'", () => {
    expect(supportedExchangeLabel("Kraken")).toBe("Kraken");
    expect(supportedExchangeLabel(" Kraken ")).toBe("Kraken");
  });

  it("never resolves a prototype member", () => {
    expect(supportedExchangeLabel("constructor")).toBe("constructor");
    expect(supportedExchangeLabel("__proto__")).toBe("__proto__");
  });
});

describe("Badge statusLabelMap", () => {
  it("covers exactly strategies_status_check union contact_requests_status_check", () => {
    const union = [
      ...new Set([
        ...checkSet("strategies_status_check"),
        ...checkSet("contact_requests_status_check"),
      ]),
    ];
    const keys = Object.keys(statusLabelMap);
    expect(
      {
        onlyInSql: union.filter((v) => !keys.includes(v)),
        onlyInTs: keys.filter((k) => !union.includes(k)),
      },
      "Badge statusLabelMap and the strategy/contact-request status CHECK sets differ",
    ).toEqual({ onlyInSql: [], onlyInTs: [] });
  });
});
