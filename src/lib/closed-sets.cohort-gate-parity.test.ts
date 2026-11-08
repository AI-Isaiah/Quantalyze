import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isComputedAnalytics } from "./closed-sets";
import { MIN_ANNUALIZATION_DAYS, MIN_ANNUALIZATION_OBS } from "./figure-gate";
import { ANNUALIZED_PERCENTILE_METRICS } from "./percentile-core";

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

  // Phase 194 / D-11 as superseded by D-15: the cohort also drops a strategy whose TOTAL record
  // fails the minimum. The two SQL bounds are named constants in the function; the TS twins are
  // MIN_ANNUALIZATION_DAYS and MIN_ANNUALIZATION_OBS. Without this pin the cohort could keep a
  // strategy the figure gate withholds (or the reverse) after one side's bound moves alone.
  describe("D-15 record bounds, SQL constants == figure-gate.ts", () => {
    const spanDays = [
      ...sql.matchAll(/v_min_span_days\s+CONSTANT\s+INT\s*:=\s*(\d+)/g),
    ].map((m) => Number(m[1]));
    const obs = [
      ...sql.matchAll(/v_min_obs\s+CONSTANT\s+INT\s*:=\s*(\d+)/g),
    ].map((m) => Number(m[1]));

    it("v_min_span_days is declared once and equals MIN_ANNUALIZATION_DAYS", () => {
      expect(spanDays).toEqual([MIN_ANNUALIZATION_DAYS]);
    });

    it("v_min_obs is declared once and equals MIN_ANNUALIZATION_OBS", () => {
      expect(obs).toEqual([MIN_ANNUALIZATION_OBS]);
    });

    it("the record predicate sits in BOTH cohort queries (count and rank)", () => {
      // Both arms, twice each: a gate on only one query makes the min-N denominator
      // diverge from the rank population (the RANK-01 defect class).
      const occurrences = (needle: string) => sql.split(needle).length - 1;
      expect(occurrences("::int < v_min_obs WHEN")).toBe(2);
      expect(occurrences("END) + 1 < v_min_span_days END, false)")).toBe(2);
    });
  });

  // D-18 (founder, 2026-11-07, review WR-02): a record under the D-15 minimum leaves the
  // ANNUALISED peer sets (Sharpe, Sortino) and stays in the Max drawdown set, in SQL and TS alike.
  // The TS side is withholdShortRecordRanks, which nulls only ANNUALIZED_PERCENTILE_METRICS. The SQL
  // side must apply the record flag to the Sharpe and Sortino numerators and denominator only.
  describe("D-18 peer sets, SQL == percentile-core.ts", () => {
    it("the TS side nulls Sharpe and Sortino and leaves max_drawdown", () => {
      expect(ANNUALIZED_PERCENTILE_METRICS).toContain("sharpe");
      expect(ANNUALIZED_PERCENTILE_METRICS).toContain("sortino");
      expect(ANNUALIZED_PERCENTILE_METRICS).not.toContain("max_drawdown");
    });

    it("the SQL ranks Sharpe and Sortino over the record-qualified rows and Max DD over the whole cohort", () => {
      expect(sql).toContain(
        "count(*) FILTER (WHERE r.rec_ok AND a.sharpe  <= p_sharpe)  / v_n)",
      );
      expect(sql).toContain(
        "count(*) FILTER (WHERE r.rec_ok AND a.sortino <= p_sortino) / v_n)",
      );
      // The Max DD numerator carries no record flag and its denominator is the whole cohort.
      expect(sql).toContain(
        "count(*) FILTER (WHERE abs(a.max_drawdown) <= p_max_dd) / v_n_all)",
      );
      expect(sql).not.toMatch(/FILTER \(WHERE r\.rec_ok AND abs\(a\.max_drawdown\)/);
    });

    it("the count query reports both populations", () => {
      expect(sql).toContain(
        "count(*) FILTER (WHERE r.rec_ok), count(*) INTO v_n, v_n_all",
      );
    });
  });
});
