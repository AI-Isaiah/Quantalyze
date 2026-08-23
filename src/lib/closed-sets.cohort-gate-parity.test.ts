import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isComputedAnalytics } from "./closed-sets";

/**
 * RANK-01 cross-language parity gate (Phase 159 /simplify — altitude finding).
 *
 * The cohort-rank RPC (`get_verified_cohort_rank`) and the TS percentile gate
 * (`isComputedAnalytics` via `isRankableAnalyticsRow`) must admit the SAME
 * computation_status set — before this test, that parity was held together only
 * by "change one, change the other" comments on both sides. 159-CENSUS.md
 * measured what a one-sided drift costs: 17/18 published PROD strategies ranked
 * on dead numbers. This test makes the claim executable: it reads the checked-in
 * SQL function snapshot (which the sql-function-snapshot CI gate keeps in sync
 * with migrations), extracts every `computation_status IN (...)` list, and
 * asserts set-equality against the statuses the TS gate accepts.
 *
 * If either side moves alone, this fails. If both should move together, update
 * the migration + snapshot + `isComputedAnalytics` in the SAME commit.
 */
describe("cohort-rank SQL gate ⇄ isComputedAnalytics parity", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/schema/functions/get_verified_cohort_rank.sql",
    ),
    "utf8",
  );

  const inLists = [
    ...sql.matchAll(/computation_status\s+IN\s*\(([^)]*)\)/gi),
  ].map((m) =>
    [...m[1].matchAll(/'([^']*)'/g)].map((lit) => lit[1]).sort(),
  );

  it("scans a non-vacuous SQL surface (both predicates present)", () => {
    // The count predicate AND the rank predicate each carry the gate — the
    // Phase 159 migration's own DO block asserts the same occurrence count.
    expect(inLists).toHaveLength(2);
    for (const list of inLists) expect(list.length).toBeGreaterThan(0);
  });

  it("every SQL-admitted status is accepted by the TS gate", () => {
    for (const list of inLists) {
      for (const status of list) {
        expect(isComputedAnalytics(status), `SQL admits '${status}'`).toBe(
          true,
        );
      }
    }
  });

  it("the TS gate accepts NOTHING beyond the SQL lists", () => {
    // Enumerate the TS side from source: the literals compared inside
    // isComputedAnalytics. A `startsWith`/regex rewrite of the gate breaks the
    // extraction and fails here loudly rather than passing vacuously.
    const tsSource = readFileSync(join(__dirname, "closed-sets.ts"), "utf8");
    const fnStart = tsSource.indexOf("export function isComputedAnalytics");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = tsSource.indexOf("\n}", fnStart);
    const body = tsSource.slice(fnStart, fnEnd);
    const tsStatuses = [...body.matchAll(/===\s*"([^"]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect(tsStatuses.length).toBeGreaterThan(0);
    for (const list of inLists) {
      expect(list).toEqual(tsStatuses);
    }
  });
});
