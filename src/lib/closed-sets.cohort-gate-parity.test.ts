import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isComputedAnalytics } from "./closed-sets";
import { figureRecord, MIN_ANNUALIZATION_DAYS, MIN_ANNUALIZATION_OBS, recordClears } from "./figure-gate";
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

  // Phase 194.2 / D-01 (194-MALFORMED-DATES-ABSENT, the SQL half): a record date that is PRESENT but
  // not a real calendar day is UNREADABLE and withholds the figure in TS (`figureRecord`), so the
  // cohort must leave that strategy out of the annualised peer sets too. Before 20261110120000 a
  // malformed date fell through to NULL, COALESCE read it as "fine", and the row stayed ranked while
  // the factsheet withheld it. An ABSENT date is not unreadable and keeps the null rule.
  describe("D-01 unreadable record dates, SQL == figureRecord", () => {
    const predicateLines = sql
      .split("\n")
      .filter((l) => l.includes("CROSS JOIN LATERAL (SELECT NOT COALESCE("));
    const DATES = [
      "a.returns_series->0->>'date'",
      "a.returns_series->-1->>'date'",
      "a.data_quality_flags->>'headline_since'",
    ];
    // The unreadable term for one date expression, exactly as the migration writes it: shaped like a
    // day -> the parser must read it (NULL = an impossible day); any other non-empty text -> unreadable.
    const term = (x: string) =>
      String.raw`(CASE WHEN (${x}) ~ '^\d{4}-\d{2}-\d{2}$' THEN public.ledger_refresh_parse_series_date(${x}) IS NULL ELSE (${x}) <> '' END)`;

    it("both cohort queries carry the unreadable term for all three record dates", () => {
      expect(predicateLines).toHaveLength(2);
      for (const line of predicateLines) {
        for (const x of DATES) expect(line, x).toContain(term(x));
      }
    });

    it("the unreadable arm leads the CASE, ahead of the record_observations arm", () => {
      // TS withholds an unreadable record even when a stored count clears, so a non-crypto row with
      // enough observations and a garbage date must be out. Ordering is the whole rule: with the
      // observation arm first, that row would be decided by its count and stay in.
      for (const line of predicateLines) {
        const lead = line.indexOf("NOT COALESCE(CASE WHEN ((CASE WHEN");
        const observationArm = line.indexOf("record_observations");
        const handoff = line.indexOf("THEN true WHEN s.asset_class IS DISTINCT FROM 'crypto'");
        expect(lead, "the CASE opens with the unreadable arm").toBeGreaterThan(-1);
        expect(handoff, "the unreadable arm hands over to the observation arm").toBeGreaterThan(lead);
        expect(handoff).toBeLessThan(observationArm);
        for (const x of DATES) expect(line.indexOf(term(x)), x).toBeLessThan(handoff);
      }
    });

    it("TS agrees on the verdict: a present malformed date withholds, an absent one does not", () => {
      const base = { seriesEnd: "2026-06-01", observations: 200, periodsPerYear: 252 };
      // a non-crypto record whose stored count clears is still withheld when a date is unreadable
      expect(recordClears(figureRecord({ ...base, seriesStart: "garbage" }))).toBe(false);
      expect(recordClears(figureRecord({ ...base, seriesStart: "2026-01-01", headlineSince: "garbage" }))).toBe(false);
      // absent (null or empty) is unknown, never unreadable: the count decides
      expect(recordClears(figureRecord({ ...base, seriesStart: null }))).toBe(true);
      expect(recordClears(figureRecord({ ...base, seriesStart: "" }))).toBe(true);
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
