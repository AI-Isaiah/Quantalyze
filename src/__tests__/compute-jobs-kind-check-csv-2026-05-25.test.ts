import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Regression guard for 2026-05-25 prod incident: every CSV-uploaded
// strategy landed in admin Strategy Review with "Analytics: failed" and
// computation_error = `compute job enqueue failed: new row for relation
// "compute_jobs" violates check constraint "compute_jobs_kind_check"`.
//
// Root cause: migration 20260522111858_compute_analytics_from_csv_kind.sql
// (Phase 19.1 / Plan 02) added 'compute_analytics_from_csv' to the
// `compute_jobs_kind_target_coherence` CHECK constraint but FORGOT the
// sibling list-form `compute_jobs_kind_check` CHECK on the same table.
// Migration 108 (process_key_long, 20260510173005) set the precedent at
// lines 108-109 + 122-123: BOTH constraints must be updated in lockstep.
//
// This test:
//   1. Asserts the 2026-05-25 fix migration file exists.
//   2. Asserts it DROPs + ADDs compute_jobs_kind_check with
//      'compute_analytics_from_csv' in the kind ANY-array.
//   3. Asserts every kind currently admitted by the live constraint
//      (per the prod state queried during the investigation) is still
//      present, i.e. the new ADD is a strict superset of the prior list.
//      Prevents a careless rewrite from dropping process_key_long etc.
//   4. Asserts a self-verifying DO block fails loud if a later migration
//      silently regresses the change.
//
// Pure text-based — no live DB required. Mirrors the pattern in
// trades-side-check-constraint-2026-05-07-g12a.test.ts so future audits
// can be regenerated mechanically.

const REPO_ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const FIX_FILENAME =
  "20260525074649_compute_jobs_kind_check_extend_csv.sql";
const FIX_PATH = join(MIGRATIONS_DIR, FIX_FILENAME);

// Kinds admitted by compute_jobs_kind_check in prod BEFORE this fix,
// as captured via pg_get_constraintdef during the 2026-05-25
// investigation. The new ADD must remain a strict superset.
const PRIOR_KINDS = [
  "sync_trades",
  "compute_analytics",
  "compute_portfolio",
  "poll_positions",
  "sync_funding",
  "reconcile_strategy",
  "compute_intro_snapshot",
  "rescore_allocator",
  "poll_allocator_positions",
  "reconstruct_allocator_history",
  "refresh_allocator_equity_daily",
  "process_key_long",
];

describe("compute_jobs_kind_check extends 'compute_analytics_from_csv' (2026-05-25 prod incident regression guard)", () => {
  it("fix migration file exists", () => {
    const sql = readFileSync(FIX_PATH, "utf8");
    expect(sql.length).toBeGreaterThan(0);
  });

  it("DROPs the prior compute_jobs_kind_check (IF EXISTS for idempotency)", () => {
    const sql = readFileSync(FIX_PATH, "utf8");
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+compute_jobs\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+compute_jobs_kind_check/i,
    );
  });

  it("ADDs compute_jobs_kind_check with 'compute_analytics_from_csv' in the kind list", () => {
    const sql = readFileSync(FIX_PATH, "utf8");
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+compute_jobs\s+ADD\s+CONSTRAINT\s+compute_jobs_kind_check/i,
    );
    expect(sql).toMatch(/'compute_analytics_from_csv'/);
  });

  it("preserves every kind from the prior live constraint (strict superset)", () => {
    const sql = readFileSync(FIX_PATH, "utf8");
    // Locate the ADD CONSTRAINT body so the assertion can't accidentally
    // match a commented-out kind elsewhere in the file.
    const addMatch = sql.match(
      /ADD\s+CONSTRAINT\s+compute_jobs_kind_check\s+CHECK[\s\S]*?;/i,
    );
    expect(
      addMatch,
      "ADD CONSTRAINT compute_jobs_kind_check ... body not found",
    ).not.toBeNull();
    const body = addMatch![0];
    for (const kind of PRIOR_KINDS) {
      expect(body, `prior kind '${kind}' must remain in the new ADD`).toMatch(
        new RegExp(`'${kind}'`),
      );
    }
  });

  it("includes a self-verifying DO block that fails loud on future regression", () => {
    const sql = readFileSync(FIX_PATH, "utf8");
    expect(sql).toMatch(/DO\s+\$\$/);
    expect(sql).toMatch(/pg_constraint|information_schema\.check_constraints/);
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i);
    expect(sql).toMatch(/compute_analytics_from_csv/);
  });

  it("no later migration silently drops compute_jobs_kind_check without re-adding it", () => {
    // If a future migration drops the constraint, it MUST re-add an
    // equivalent or stronger CHECK that includes both 'compute_analytics_from_csv'
    // and every PRIOR_KINDS entry. Mirrors the trades-side-check pattern.
    const FIX_TS = "20260525074649";
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f))
      .filter((f) => f.split("_")[0] > FIX_TS)
      .sort();
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      const drops = /DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?compute_jobs_kind_check/i.test(sql);
      if (!drops) continue;
      const addMatch = sql.match(
        /ADD\s+CONSTRAINT\s+compute_jobs_kind_check\s+CHECK[\s\S]*?;/i,
      );
      expect(
        addMatch,
        `later migration ${f} DROPs compute_jobs_kind_check without re-adding it`,
      ).not.toBeNull();
      const body = addMatch![0];
      expect(
        body,
        `later migration ${f} re-adds compute_jobs_kind_check but omits 'compute_analytics_from_csv'`,
      ).toMatch(/'compute_analytics_from_csv'/);
      for (const kind of PRIOR_KINDS) {
        expect(
          body,
          `later migration ${f} re-adds compute_jobs_kind_check but omits prior kind '${kind}'`,
        ).toMatch(new RegExp(`'${kind}'`));
      }
    }
  });
});
