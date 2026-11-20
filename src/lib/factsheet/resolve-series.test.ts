import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sharpe as returnStatsSharpe } from "@/lib/return-stats";

import { convertNativeReturnsToUsd } from "./native-to-usd";
import {
  curveMethodFromFlags,
  curveRecordStart,
  equityCurveToDailyReturns,
  resolveDailyReturnSeries,
  STORED_CURVE_MAX_POINTS,
} from "./resolve-series";

/**
 * Phase 164.6.6.2.2 (D-01, D-02, D-05): a stored `strategy_analytics` row read
 * as DAILY RETURNS, on the TypeScript side.
 *
 * WHY these tests exist: `returns_series` is the cumulative CURVE (wealth
 * levels), not returns. A curve read as returns weights a level of 1.30 as a
 * +130% day, and a curve whose method is `simple` (1 + cumsum) read by ratio
 * is a different series again. Python (`services/wealth_returns.py`) and this
 * resolver must read ONE series from ONE row, so both read the same fixture,
 * and every expected value in it is a hand-computed literal: neither runtime
 * can pass by agreeing with its own arithmetic.
 */

interface OracleCase {
  name: string;
  data_quality_flags: Record<string, unknown> | null;
  daily_returns: unknown;
  curve: Array<{ date?: string; value: number | null }>;
  expected: Array<{ date: string; value: number }>;
  arithmetic: string;
  native_unit?: string;
  closes?: Record<string, number>;
}

interface Oracle {
  tolerance: number;
  stored_curve_max_points: number;
  cases: OracleCase[];
}

// Same precedent as native-to-usd.test.ts: the file lives under
// analytics-service/tests/fixtures so both runtimes read the one copy.
const ORACLE: Oracle = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "analytics-service/tests/fixtures/wealth_to_returns_oracle.json"),
    "utf8",
  ),
);

/** JSON has no NaN: a null level in the fixture stands for a non-finite number. */
function toCurve(raw: OracleCase["curve"]): Array<{ date: string; value: number }> {
  // A fixture head with no `date` (WR-01) is passed through undated, as the DB would hold it.
  return raw.map((p) => ({ date: p.date as string, value: p.value === null ? Number.NaN : p.value }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveDailyReturnSeries: the shared hand-computed oracle (D-01, D-02)", () => {
  it("the fixture is a real oracle: tight tolerance, every case states its arithmetic", () => {
    expect(ORACLE.tolerance).toBeLessThanOrEqual(1e-12);
    expect(ORACLE.cases.length).toBeGreaterThan(0);
    for (const c of ORACLE.cases) expect(c.arithmetic.length).toBeGreaterThan(10);
  });

  it("the fixture carries the honesty and order cases this suite relies on", () => {
    const names = ORACLE.cases.map((c) => c.name);
    for (const required of [
      "geometric_ratio",
      "simple_difference",
      "nonpositive_level_mid_series",
      "nonpositive_level_is_legal_on_simple",
      "non_finite_level_drops_dependent_days",
      "non_finite_level_drops_dependent_days_simple",
      "daily_returns_first_wins",
      "daily_returns_empty_list_falls_to_curve",
      "unknown_method_string_reads_geometric",
      "native_leg_loses_only_day_zero",
      "native_absent_day_is_priced_over_its_own_day",
      "four_day_stored_curve_reads_n_returns_geometric",
      "four_day_stored_curve_reads_n_returns_simple",
      "geometric_nonpositive_first_level_day_zero_is_absent",
      "simple_negative_first_level_is_a_legal_day_zero",
      "one_point_series_is_its_day_zero",
      "dropped_head_reads_with_the_old_pairing",
    ]) {
      expect(names, `fixture lacks ${required}`).toContain(required);
    }
  });

  it.each(ORACLE.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    // An unknown method string logs one warning by design; keep the run quiet.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const method = curveMethodFromFlags(c.data_quality_flags);
    // WR-02: a native leg is read with keepAbsent, exactly as every caller that
    // hands the series to the converter next does, so an absent day stays a
    // placeholder and the next day is priced over its own interval.
    let out = resolveDailyReturnSeries(
      c.daily_returns,
      toCurve(c.curve),
      method,
      c.native_unit !== undefined,
    );
    if (c.native_unit !== undefined && c.closes !== undefined) {
      const prices = Object.entries(c.closes)
        .map(([date, close]) => ({ date, close }))
        .sort((a, b) => a.date.localeCompare(b.date));
      out = convertNativeReturnsToUsd(out, c.native_unit, { prices, dropped: [] });
    }
    expect(out.map((p) => p.date)).toEqual(c.expected.map((p) => p.date));
    c.expected.forEach((e, i) => {
      expect(Math.abs(out[i].value - e.value)).toBeLessThanOrEqual(ORACLE.tolerance);
    });
  });
});

describe("equityCurveToDailyReturns: stored adjacency, never bridged", () => {
  it("a non-positive level between two good ones leaves BOTH dependent days absent, not a bridged ratio", () => {
    // 1.0 -> 1.1 (+0.1), then 0 (ratio undefined), then 1.3 (pairs with 0).
    // The old filter-then-pair code dropped the 0 level and emitted
    // 1.3 / 1.1 - 1 = 0.1818..., a return no stored day produced.
    const out = equityCurveToDailyReturns(
      [
        { date: "2026-03-02", value: 1.0 },
        { date: "2026-03-03", value: 1.1 },
        { date: "2026-03-04", value: 0 },
        { date: "2026-03-05", value: 1.3 },
      ],
      "geometric",
    );
    expect(out.map((p) => p.date)).toEqual(["2026-03-03"]);
    expect(out[0].value).toBeCloseTo(0.1, 12);
  });

  it("the default method is geometric, so a caller that omits it is unchanged", () => {
    const out = equityCurveToDailyReturns([
      { date: "2026-03-02", value: 1.0 },
      { date: "2026-03-03", value: 1.1 },
    ]);
    expect(out[0].value).toBeCloseTo(0.1, 12);
  });

  it("simple emits the difference of two finite levels, including a non-positive one", () => {
    const out = equityCurveToDailyReturns(
      [
        { date: "2026-03-02", value: 0.1 },
        { date: "2026-03-03", value: -0.05 },
      ],
      "simple",
    );
    expect(out).toHaveLength(1);
    expect(out[0].value).toBeCloseTo(-0.15, 12);
  });

  it("an input that is not an array, or has fewer than two points, is empty", () => {
    expect(equityCurveToDailyReturns([], "geometric")).toEqual([]);
    expect(equityCurveToDailyReturns([{ date: "2026-03-02", value: 1 }], "simple")).toEqual([]);
  });
});

describe("G3-1 (a): a stored curve is anchored at an implicit 1.0, so n stored points read as n returns", () => {
  // The writer stores no base point: levels are (1 + r).cumprod(). Built by hand from
  // daily returns 0.02, -0.01, 0.03, 0.01:
  //   1.02 = 1 * 1.02 ; 1.0098 = 1.02 * 0.99 ; 1.040094 = 1.0098 * 1.03 ; 1.05049494 = 1.040094 * 1.01
  const FOUR_DAY_CURVE = [
    { date: "2026-03-02", value: 1.02 },
    { date: "2026-03-03", value: 1.0098 },
    { date: "2026-03-04", value: 1.040094 },
    { date: "2026-03-05", value: 1.05049494 },
  ];

  it("the row reader returns all four returns, the first being w0 - 1 = 0.02", () => {
    const out = resolveDailyReturnSeries(null, FOUR_DAY_CURVE, "geometric");
    expect(out.map((p) => p.date)).toEqual(["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]);
    const want = [0.02, -0.01, 0.03, 0.01];
    want.forEach((w, i) => expect(Math.abs(out[i].value - w)).toBeLessThanOrEqual(ORACLE.tolerance));
  });

  it("a Sharpe on that series is the n = 4 literal (11.619), not the n - 1 = 3 literal (7.937)", () => {
    // Hand arithmetic, sample sd (ddof 1), a 252 clock, rf = 0 (the composer's convention:
    // `returnStatsSharpe(portDaily, { periodsPerYear, ddof: 1 })` in src/lib/scenario.ts).
    //   n = 4: mean = (0.02 - 0.01 + 0.03 + 0.01) / 4 = 0.0125
    //     deviations 0.0075, -0.0225, 0.0175, -0.0025 ; squares 5.625e-5, 5.0625e-4, 3.0625e-4, 6.25e-6
    //     sum = 8.75e-4 ; sample var = 8.75e-4 / 3 = 2.916667e-4 ; sd = 0.0170783
    //     Sharpe = 0.0125 * 252 / (0.0170783 * sqrt(252)) = 3.15 / 0.271109 = 11.61895
    //   n - 1 = 3 (day 0 dropped): returns -0.01, 0.03, 0.01 ; mean = 0.01
    //     deviations -0.02, 0.02, 0 ; sum of squares 8e-4 ; sample var = 4e-4 ; sd = 0.02
    //     Sharpe = 0.01 * 252 / (0.02 * sqrt(252)) = 2.52 / 0.3174902 = 7.937254
    const read = resolveDailyReturnSeries(null, FOUR_DAY_CURVE, "geometric").map((p) => p.value);
    const withDayZero = returnStatsSharpe(read, { periodsPerYear: 252, ddof: 1 });
    expect(withDayZero).not.toBeNull();
    expect(withDayZero as number).toBeCloseTo(11.61895, 4);
    expect(withDayZero as number).not.toBeCloseTo(7.937254, 1);
    // The old reading, written by literal (day 0 dropped), is the n - 1 number.
    const old = returnStatsSharpe([-0.01, 0.03, 0.01], { periodsPerYear: 252, ddof: 1 });
    expect(old as number).toBeCloseTo(7.937254, 4);
  });

  it("the raw function stays on the old pairing by default; fromBase = true adds day 0", () => {
    const old = equityCurveToDailyReturns(FOUR_DAY_CURVE, "geometric");
    expect(old.map((p) => p.date)).toEqual(["2026-03-03", "2026-03-04", "2026-03-05"]);
    const based = equityCurveToDailyReturns(FOUR_DAY_CURVE, "geometric", false, true);
    expect(based).toHaveLength(4);
    expect(based[0].date).toBe("2026-03-02");
    expect(based[0].value).toBeCloseTo(0.02, 12);
  });

  it("resolveDailyReturnSeries(..., fromBase = false) reads a cut curve with the old pairing", () => {
    const out = resolveDailyReturnSeries(null, FOUR_DAY_CURVE, "geometric", false, false);
    expect(out.map((p) => p.date)).toEqual(["2026-03-03", "2026-03-04", "2026-03-05"]);
  });

  it("a one-point curve is its day 0: 1.07 / 1 - 1 = 0.07 (it yielded none before)", () => {
    const out = resolveDailyReturnSeries(null, [{ date: "2026-03-02", value: 1.07 }], "geometric");
    expect(out).toHaveLength(1);
    expect(out[0].value).toBeCloseTo(0.07, 12);
    expect(equityCurveToDailyReturns([], "geometric", false, true)).toEqual([]);
  });

  it("day 0 is absent for w0 <= 0 or non-finite on the geometric curve, and a NaN placeholder with keepAbsent", () => {
    const curve = [
      { date: "2026-03-02", value: 0 },
      { date: "2026-03-03", value: 1.0 },
      { date: "2026-03-04", value: 1.1 },
    ];
    const dropped = equityCurveToDailyReturns(curve, "geometric", false, true);
    expect(dropped.map((p) => p.date)).toEqual(["2026-03-04"]);
    const kept = equityCurveToDailyReturns(curve, "geometric", true, true);
    expect(kept.map((p) => p.date)).toEqual(["2026-03-02", "2026-03-03", "2026-03-04"]);
    expect(kept.map((p) => Number.isFinite(p.value))).toEqual([false, false, true]);
    // simple: only non-finite is unusable, so a zero w0 is a legal -1.0 day 0
    const simple = equityCurveToDailyReturns(curve, "simple", false, true);
    expect(simple[0].date).toBe("2026-03-02");
    expect(simple[0].value).toBeCloseTo(-1.0, 12);
  });

  it("the cap constant equals the oracle's and the writer's cap_data_points default", () => {
    expect(STORED_CURVE_MAX_POINTS).toBe(ORACLE.stored_curve_max_points);
    expect(ORACLE.stored_curve_max_points).toBe(5000);
  });

  it("a curve below the writer cap emits day 0; one at or above it does not", () => {
    // simple curve, +0.001 a day: level k (0-based) = 1 + 0.001 * (k + 1), so day 0 = 0.001
    const curve = (n: number) =>
      Array.from({ length: n }, (_, k) => ({
        date: new Date(Date.UTC(2000, 0, 1 + k)).toISOString().slice(0, 10),
        value: 1 + 0.001 * (k + 1),
      }));
    const below = resolveDailyReturnSeries(null, curve(STORED_CURVE_MAX_POINTS - 1), "simple");
    expect(below).toHaveLength(STORED_CURVE_MAX_POINTS - 1);
    expect(below[0].date).toBe("2000-01-01");
    expect(below[0].value).toBeCloseTo(0.001, 12);
    for (const n of [STORED_CURVE_MAX_POINTS, STORED_CURVE_MAX_POINTS + 1]) {
      const atCap = resolveDailyReturnSeries(null, curve(n), "simple");
      expect(atCap, `n = ${n}`).toHaveLength(n - 1);
      expect(atCap[0].date, `n = ${n}`).toBe("2000-01-02");
    }
  });
});

describe("resolveDailyReturnSeries: the curve normalizer keeps a bad level's position", () => {
  it("a null level in an array curve is kept as NaN, so its dependent days are absent (never bridged)", () => {
    const out = resolveDailyReturnSeries(
      null,
      [
        { date: "2026-03-02", value: 1.0 },
        { date: "2026-03-03", value: 1.1 },
        { date: "2026-03-04", value: null },
        { date: "2026-03-05", value: 1.3 },
        { date: "2026-03-06", value: 1.43 },
      ],
      "geometric",
    );
    // 1.3 / 1.1 - 1 would be a bridged 0.1818...; it must not appear. Day 0
    // (2026-03-02) is 1.0 / 1 - 1 = 0.0.
    expect(out.map((p) => p.date)).toEqual(["2026-03-02", "2026-03-03", "2026-03-06"]);
  });

  it("a string level is non-numeric, kept as a bad level, never coerced", () => {
    const out = resolveDailyReturnSeries(
      null,
      [
        { date: "2026-03-02", value: 1.0 },
        { date: "2026-03-03", value: "1.1" },
        { date: "2026-03-04", value: 1.21 },
      ],
      "geometric",
    );
    // Day 0 is 1.0 / 1 - 1 = 0.0 and stands; day 1 has the NaN level "1.1" and day 2
    // pairs with it, so both are absent. The string level is never coerced.
    expect(out).toEqual([{ date: "2026-03-02", value: 0 }]);
  });

  it("daily_returns stays first: a non-empty direct series wins over the curve (D-02)", () => {
    const out = resolveDailyReturnSeries(
      [{ date: "2026-03-03", value: 0.03 }],
      [
        { date: "2026-03-02", value: 1.0 },
        { date: "2026-03-03", value: 1.5 },
      ],
      "simple",
    );
    expect(out).toEqual([{ date: "2026-03-03", value: 0.03 }]);
  });
});

describe("curveMethodFromFlags: strict literals (D-05)", () => {
  it("reads the two raw worker strings", () => {
    expect(curveMethodFromFlags({ cumulative_method: "simple" })).toBe("simple");
    expect(curveMethodFromFlags({ cumulative_method: "geometric" })).toBe("geometric");
  });

  it("absent flags, an absent key or a null key read geometric silently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(curveMethodFromFlags(null)).toBe("geometric");
    expect(curveMethodFromFlags(undefined)).toBe("geometric");
    expect(curveMethodFromFlags("simple")).toBe("geometric");
    expect(curveMethodFromFlags({})).toBe("geometric");
    expect(curveMethodFromFlags({ cumulative_method: null })).toBe("geometric");
    expect(warn).not.toHaveBeenCalled();
  });

  it("an unexpected present value reads geometric and warns exactly once, without echoing the value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(curveMethodFromFlags({ cumulative_method: "SIMPLE-secret-token" })).toBe("geometric");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-token");
  });
});

describe("WR-02: an absent day must not widen the next day's price interval", () => {
  const GAP_CURVE = [
    { date: "2026-03-02", value: 1.0 },
    { date: "2026-03-03", value: 1.1 },
    { date: "2026-03-04", value: Number.NaN },
    { date: "2026-03-05", value: 1.2 },
    { date: "2026-03-06", value: 1.32 },
  ];
  const GAP_CLOSES = {
    prices: [
      { date: "2026-03-02", close: 100 },
      { date: "2026-03-03", close: 100 },
      { date: "2026-03-04", close: 200 },
      { date: "2026-03-05", close: 400 },
      { date: "2026-03-06", close: 400 },
    ],
    dropped: [],
  };

  it("the review's repro: 03-06 is the one-day native +10% on a flat BTC day, +10% in USD, never +340%", () => {
    // Independent invariant, written by literal: (1 + r_native) * (P_k / P_{k-1}) - 1
    // over the SAME day. 03-06's native return is 1.32 / 1.2 - 1 = 0.1 and BTC
    // closed 400 -> 400 that day, so USD is 1.1 * 1 - 1 = 0.1. Pricing it against
    // 03-03 (close 100) gave 1.1 * (400 / 100) - 1 = 3.4.
    const native = resolveDailyReturnSeries(null, GAP_CURVE, "geometric", true);
    const out = convertNativeReturnsToUsd(native, "BTC", GAP_CLOSES);
    // Day 0 (03-02) is the converter's interval anchor and is not priced. 03-03 is
    // priced over [03-02, 03-03], closes 100 -> 100: 1.1 * 1 - 1 = 0.1.
    expect(out.map((p) => p.date)).toEqual(["2026-03-03", "2026-03-06"]);
    expect(out[0].value).toBeCloseTo(0.1, 12);
    expect(out[1].value).toBeCloseTo(0.1, 12);
    expect(out.every((p) => Number.isFinite(p.value))).toBe(true);
  });

  it("keepAbsent keeps each absent day after day 0 as a NaN placeholder at its own date", () => {
    const out = equityCurveToDailyReturns(GAP_CURVE, "geometric", true);
    expect(out.map((p) => p.date)).toEqual([
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
    ]);
    expect(out.map((p) => Number.isFinite(p.value))).toEqual([true, false, false, true]);
  });

  it("the default read still deletes the absent days, so no caller that omits the flag ever sees NaN", () => {
    const out = equityCurveToDailyReturns(GAP_CURVE, "geometric");
    expect(out.map((p) => p.date)).toEqual(["2026-03-03", "2026-03-06"]);
    expect(out.every((p) => Number.isFinite(p.value))).toBe(true);
  });

  it("keepAbsent is a no-op when a daily_returns column wins", () => {
    const out = resolveDailyReturnSeries(
      [
        { date: "2026-03-03", value: 0.1 },
        { date: "2026-03-06", value: 0.1 },
      ],
      GAP_CURVE,
      "geometric",
      true,
    );
    expect(out.map((p) => p.date)).toEqual(["2026-03-03", "2026-03-06"]);
    expect(out.every((p) => Number.isFinite(p.value))).toBe(true);
  });

  it("a curve with no formable day is [] even when absent days are kept", () => {
    expect(
      equityCurveToDailyReturns(
        [
          { date: "2026-03-02", value: 1.0 },
          { date: "2026-03-03", value: Number.NaN },
        ],
        "geometric",
        true,
      ),
    ).toEqual([]);
  });
});

describe("curveRecordStart (194.2 D-02, WR-02): the stored curve's first date, verbatim", () => {
  const CURVE = (first: unknown) => [{ date: first, value: 1 }, { date: "2026-01-02", value: 1.01 }];

  it("a curve-derived series starts at the curve's FIRST point; a winning daily_returns column is not curve-derived", () => {
    expect(curveRecordStart(null, CURVE("2026-01-01"))).toBe("2026-01-01");
    expect(curveRecordStart([{ date: "2026-01-05", value: 0.01 }], CURVE("2026-01-01"))).toBeNull();
  });

  it("an absent first date (missing, null, empty string) is absent", () => {
    for (const absent of [undefined, null, ""]) expect(curveRecordStart(null, CURVE(absent))).toBeNull();
  });

  it("a PRESENT non-string first date is kept as text, so the record reads it as unreadable (as the SQL ->> text does)", () => {
    expect(curveRecordStart(null, CURVE(20260101))).toBe("20260101");
    expect(curveRecordStart(null, CURVE(false))).toBe("false");
    expect(curveRecordStart(null, CURVE({ y: 2026 }))).toBe("[object Object]");
  });
});
