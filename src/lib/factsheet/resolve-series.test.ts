import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { convertNativeReturnsToUsd } from "./native-to-usd";
import {
  curveMethodFromFlags,
  equityCurveToDailyReturns,
  resolveDailyReturnSeries,
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
  curve: Array<{ date: string; value: number | null }>;
  expected: Array<{ date: string; value: number }>;
  arithmetic: string;
  native_unit?: string;
  closes?: Record<string, number>;
}

interface Oracle {
  tolerance: number;
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
  return raw.map((p) => ({ date: p.date, value: p.value === null ? Number.NaN : p.value }));
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
      "native_leg_loses_first_two_days",
      "native_absent_day_is_priced_over_its_own_day",
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
    // 1.3 / 1.1 - 1 would be a bridged 0.1818...; it must not appear.
    expect(out.map((p) => p.date)).toEqual(["2026-03-03", "2026-03-06"]);
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
    expect(out).toEqual([]);
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
    expect(out.map((p) => p.date)).toEqual(["2026-03-06"]);
    expect(out[0].value).toBeCloseTo(0.1, 12);
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
