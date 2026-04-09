import { describe, it, expect } from "vitest";
import {
  buildDateMapCache,
  computeScenario,
  computeStrategyCurve,
  computeCompositeCurve,
  computeFavoritesOverlayCurve,
  type StrategyForBuilder,
  type DailyPoint,
  type ScenarioState,
} from "./scenario";

/**
 * Regression-critical tests for @/lib/scenario.
 *
 * This module powers the YTD chart on /allocations (My Allocation), the
 * /scenarios sandbox, and the Favorites panel overlay. It was lifted out
 * of ScenarioBuilder.tsx in PR 3 of the My Allocation restructure. Four
 * behaviors were specifically flagged by the eng review as "regression
 * candidates" because they were previously patched in ScenarioBuilder
 * and a future refactor could silently drift them. Each has a test
 * below named with "[REGRESSION PIN: ...]" so the intent stays legible
 * when the suite grows.
 *
 *   1. Weight renormalization on staggered start dates
 *   2. Avg pairwise correlation uses ABSOLUTE values
 *   3. Sortino divides the downside RMS by TOTAL observations, not by
 *      the count of negative days
 *   4. Include-from date honored per-strategy (not reduced to a global
 *      max — earlier includes actually take effect)
 */

// =========================================================================
// Test helpers
// =========================================================================

/** Generate N sequential business-day ISO dates starting at startDate. */
function buildDates(startDate: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(startDate + "T00:00:00Z");
  let i = 0;
  while (out.length < n) {
    // Skip weekends (getUTCDay: 0=Sun, 6=Sat).
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      out.push(d.toISOString().slice(0, 10));
    }
    d.setUTCDate(d.getUTCDate() + 1);
    i++;
    if (i > n * 3) break; // safety
  }
  return out;
}

/** A fixed-return strategy: every day returns exactly `value`. */
function constantReturnStrategy(
  id: string,
  dates: string[],
  value: number,
  overrides: Partial<StrategyForBuilder> = {},
): StrategyForBuilder {
  return {
    id,
    name: `Strategy ${id}`,
    codename: null,
    disclosure_tier: "institutional",
    strategy_types: ["arbitrage"],
    markets: ["BTC"],
    start_date: dates[0] ?? null,
    daily_returns: dates.map((date) => ({ date, value })),
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
    ...overrides,
  };
}

/** A strategy with an alternating positive/negative pattern. */
function alternatingStrategy(
  id: string,
  dates: string[],
  up: number,
  down: number,
): StrategyForBuilder {
  return constantReturnStrategy(id, dates, 0, {
    daily_returns: dates.map((date, i) => ({
      date,
      value: i % 2 === 0 ? up : down,
    })),
  });
}

function defaultState(strategies: StrategyForBuilder[]): ScenarioState {
  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  const startDates: Record<string, string> = {};
  for (const s of strategies) {
    selected[s.id] = true;
    weights[s.id] = 1;
    startDates[s.id] = s.start_date ?? "2022-01-01";
  }
  return { selected, weights, startDates };
}

// =========================================================================
// Basic edge cases
// =========================================================================

describe("computeScenario — edge cases", () => {
  it("returns null metrics when no strategies are selected", () => {
    const dates = buildDates("2024-01-02", 50);
    const strategies = [constantReturnStrategy("a", dates, 0.001)];
    const state = defaultState(strategies);
    state.selected["a"] = false; // deselect all

    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, state, cache);

    expect(metrics.n).toBe(0);
    expect(metrics.twr).toBeNull();
    expect(metrics.cagr).toBeNull();
    expect(metrics.sharpe).toBeNull();
    expect(metrics.equity_curve).toEqual([]);
    expect(metrics.effective_start).toBeNull();
    expect(metrics.effective_end).toBeNull();
  });

  it("returns null metrics when fewer than 10 common days exist", () => {
    const dates = buildDates("2024-01-02", 5);
    const strategies = [constantReturnStrategy("a", dates, 0.001)];
    const state = defaultState(strategies);

    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, state, cache);

    expect(metrics.n).toBe(5);
    expect(metrics.twr).toBeNull();
    expect(metrics.cagr).toBeNull();
    expect(metrics.sharpe).toBeNull();
    expect(metrics.equity_curve).toEqual([]);
    // effective_start/end still populated from the commonDates that
    // exist, even though metrics are null (useful for UX messaging).
    expect(metrics.effective_start).toBe(dates[0]);
    expect(metrics.effective_end).toBe(dates[4]);
  });

  it("single-strategy identity: composite TWR matches (1+r)^n for a constant-return strategy", () => {
    // 252 business days of a constant +0.1% daily return.
    const dates = buildDates("2024-01-02", 252);
    const r = 0.001;
    const strategies = [constantReturnStrategy("a", dates, r)];
    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    expect(metrics.n).toBe(252);
    // TWR = (1 + r)^252 - 1
    const expectedTwr = Math.pow(1 + r, 252) - 1;
    expect(metrics.twr).toBeCloseTo(expectedTwr, 4);
    // Max drawdown on a monotonically-up series is ~0 (floating-point
    // precision; allow a tiny epsilon).
    expect(metrics.max_drawdown).toBeCloseTo(0, 4);
    // Vol is effectively 0 for a constant series, so Sharpe is either
    // null (if vol rounds to exactly 0) or enormous (if float error
    // produces a tiny non-zero vol). We don't assert on Sharpe here —
    // the point of this test is the TWR identity.
  });
});

// =========================================================================
// Weighted composite math
// =========================================================================

describe("computeScenario — weighted composites", () => {
  it("equal-weighted two strategies average their daily returns", () => {
    const dates = buildDates("2024-01-02", 60);
    // Strategy a: +0.2% every day. Strategy b: -0.1% every day. Equal
    // weights → portfolio daily = (+0.002 + -0.001) / 2 = +0.0005.
    const strategies = [
      constantReturnStrategy("a", dates, 0.002),
      constantReturnStrategy("b", dates, -0.001),
    ];
    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    const expectedDaily = 0.0005;
    const expectedTwr = Math.pow(1 + expectedDaily, 60) - 1;
    expect(metrics.twr).toBeCloseTo(expectedTwr, 4);
  });

  it("weights normalize: 2:1 weighting blends returns proportionally", () => {
    const dates = buildDates("2024-01-02", 60);
    const strategies = [
      constantReturnStrategy("a", dates, 0.003),
      constantReturnStrategy("b", dates, 0.001),
    ];
    const state = defaultState(strategies);
    state.weights = { a: 2, b: 1 }; // 2/3 a, 1/3 b

    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, state, cache);

    // (2/3)*0.003 + (1/3)*0.001 = 0.00233...
    const expectedDaily = (2 / 3) * 0.003 + (1 / 3) * 0.001;
    const expectedTwr = Math.pow(1 + expectedDaily, 60) - 1;
    expect(metrics.twr).toBeCloseTo(expectedTwr, 4);
  });
});

// =========================================================================
// Regression pins
// =========================================================================

describe("computeScenario — [REGRESSION PIN] staggered start weight renormalization", () => {
  it("earlier strategy contributes alone before the later strategy's include-from date", () => {
    // Strategy a covers the full window; strategy b only starts 20 days in.
    // On days 0-19, the composite should equal a's returns (not (a+b)/2
    // with b zero-filled, which would halve the return).
    const dates = buildDates("2024-01-02", 60);
    const stratA = constantReturnStrategy("a", dates, 0.002);
    const stratB = constantReturnStrategy("b", dates, 0.004);
    const strategies = [stratA, stratB];

    const state = defaultState(strategies);
    // Push b's include-from to the 21st business day (index 20).
    state.startDates["b"] = dates[20];

    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, state, cache);

    // During days 0-19, portfolio_daily should renormalize to a's full
    // weight (1.0) so the return is 0.002, not (0.002 + 0) / 2 = 0.001.
    // During days 20-59, equal-weight of a+b → (0.002 + 0.004) / 2 = 0.003.
    //
    // Cumulative ≈ (1.002^20) * (1.003^40) - 1
    const firstHalf = Math.pow(1 + 0.002, 20);
    const secondHalf = Math.pow(1 + 0.003, 40);
    const expectedTwr = firstHalf * secondHalf - 1;

    expect(metrics.twr).toBeCloseTo(expectedTwr, 3);
  });

  it("never 'shrinks' the scenario window to the overlap when a late-inception strategy joins", () => {
    // Strategy a has 60 days of history. Strategy b joins on day 40.
    // Before the regression fix, the scenario window was clamped to the
    // OVERLAP (20 days). After the fix, the window is the UNION (60
    // days), with b zero-filled (and weights renormalized) on days 0-39.
    const dates = buildDates("2024-01-02", 60);
    const stratA = constantReturnStrategy("a", dates, 0.001);
    const stratB = constantReturnStrategy("b", dates.slice(40), 0.002);
    const strategies = [stratA, stratB];

    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    // If the window were clamped to the overlap (20 days), n would be
    // 20. The regression-fixed behavior returns n = 60.
    expect(metrics.n).toBe(60);
    expect(metrics.effective_start).toBe(dates[0]);
    expect(metrics.effective_end).toBe(dates[59]);
  });
});

describe("computeScenario — [REGRESSION PIN] avg pairwise correlation uses absolute values", () => {
  it("two strongly anti-correlated strategies report high |avg corr|, not zero", () => {
    // Strategy a: +0.01 on even days, -0.01 on odd days.
    // Strategy b: -0.01 on even days, +0.01 on odd days.
    // They're perfectly anti-correlated (corr = -1).
    //
    // A SIGNED average of pair correlations would be -1. An ABSOLUTE
    // average is 1 (high concentration). The chart KPI is labelled
    // "Avg |corr|" — the math must match.
    const dates = buildDates("2024-01-02", 50);
    const stratA = alternatingStrategy("a", dates, 0.01, -0.01);
    const stratB = alternatingStrategy("b", dates, -0.01, 0.01);
    const strategies = [stratA, stratB];

    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    expect(metrics.correlation_matrix).not.toBeNull();
    // Direct pair correlation should be close to -1.
    expect(metrics.correlation_matrix!["a"]["b"]).toBeCloseTo(-1, 2);
    // |corr| aggregate should be close to 1 (absolute value), NOT -1.
    expect(metrics.avg_pairwise_correlation).toBeCloseTo(1, 2);
    expect(metrics.avg_pairwise_correlation).toBeGreaterThan(0);
  });
});

describe("computeScenario — [REGRESSION PIN] Sortino denominator is total observations", () => {
  it("Sortino divides downside RMS by total n (not the count of negative days)", () => {
    // Build a series with 60 days total: 30 positive +0.005, 30 negative
    // -0.005. Dividing downside sum-of-squares by 30 (negative count)
    // would inflate Sortino. Dividing by 60 (total n) is the fix.
    //
    // We construct the exact expected Sortino from both formulas and
    // assert that we get the "total n" answer.
    const dates = buildDates("2024-01-02", 60);
    const values: number[] = [];
    for (let i = 0; i < 60; i++) values.push(i % 2 === 0 ? 0.005 : -0.005);
    const dr: DailyPoint[] = dates.map((date, i) => ({ date, value: values[i] }));
    const strategies: StrategyForBuilder[] = [
      { ...constantReturnStrategy("a", dates, 0), daily_returns: dr },
    ];

    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    // Mean of the series = 0 → numerator in Sortino = 0 → Sortino = 0.
    // Even at 0 the denominator math still has to be right, so we also
    // assert that downside vol is consistent with dividing by n, not by
    // the count of negatives.
    //
    // downsideSumSq = 30 * (0.005^2) = 0.00075
    // With the CORRECT denominator (n=60): downsideVar = 0.0000125,
    //   downsideVolDaily = ~0.00354, * sqrt(252) ≈ 0.0561
    // With the BUG denominator (negCount=30): downsideVar = 0.000025,
    //   downsideVolDaily = ~0.005, * sqrt(252) ≈ 0.0794
    //
    // We infer which denominator was used by checking the numeric
    // consistency of the returned Sortino. Since mean = 0, Sortino is
    // 0, but we can compute implied downside vol through Sharpe if vol
    // is non-zero. Safer: compute the expected mean-of-zero edge and
    // verify the computeScenario returns 0 cleanly.
    expect(metrics.sortino).toBeCloseTo(0, 4);

    // Direct verification via an asymmetric series where mean > 0 and
    // the denominator choice makes the Sortino value observably different.
    const values2: number[] = [];
    for (let i = 0; i < 100; i++) {
      // 80 positive small + 20 negative large.
      values2.push(i < 80 ? 0.001 : -0.003);
    }
    const dates2 = buildDates("2024-01-02", 100);
    const dr2: DailyPoint[] = dates2.map((date, i) => ({
      date,
      value: values2[i],
    }));
    const strategies2: StrategyForBuilder[] = [
      { ...constantReturnStrategy("b", dates2, 0), daily_returns: dr2 },
    ];
    const cache2 = buildDateMapCache(strategies2);
    const metrics2 = computeScenario(
      strategies2,
      defaultState(strategies2),
      cache2,
    );

    // Compute expected Sortino with the CORRECT denominator.
    const meanR2 = values2.reduce((s, r) => s + r, 0) / 100;
    const downsideSumSq2 = values2.reduce(
      (s, r) => s + (r < 0 ? r * r : 0),
      0,
    );
    const downsideVarCorrect = downsideSumSq2 / 100;
    const downsideVolCorrect = Math.sqrt(downsideVarCorrect) * Math.sqrt(252);
    const expectedSortino = (meanR2 * 252) / downsideVolCorrect;

    // And the BUG variant (dividing by negative count 20).
    const downsideVarBug = downsideSumSq2 / 20;
    const downsideVolBug = Math.sqrt(downsideVarBug) * Math.sqrt(252);
    const bugSortino = (meanR2 * 252) / downsideVolBug;

    // The returned value must be close to the CORRECT formula, NOT the bug.
    expect(metrics2.sortino).toBeCloseTo(Number(expectedSortino.toFixed(3)), 2);
    expect(
      Math.abs((metrics2.sortino ?? 0) - bugSortino),
    ).toBeGreaterThan(0.1);
  });
});

// =========================================================================
// Strategy curve + composite curve wrappers
// =========================================================================

describe("computeStrategyCurve", () => {
  it("computes cumulative wealth from daily returns (1.0 = flat)", () => {
    const dr: DailyPoint[] = [
      { date: "2024-01-02", value: 0.01 },
      { date: "2024-01-03", value: 0.02 },
      { date: "2024-01-04", value: -0.005 },
    ];
    const curve = computeStrategyCurve(dr);

    expect(curve).toHaveLength(3);
    expect(curve[0].value).toBeCloseTo(1.01, 4);
    expect(curve[1].value).toBeCloseTo(1.01 * 1.02, 4);
    expect(curve[2].value).toBeCloseTo(1.01 * 1.02 * 0.995, 4);
    expect(curve[0].date).toBe("2024-01-02");
    expect(curve[2].date).toBe("2024-01-04");
  });

  it("returns empty array for empty input", () => {
    expect(computeStrategyCurve([])).toEqual([]);
  });
});

describe("computeCompositeCurve", () => {
  it("returns empty array for empty strategies", () => {
    const out = computeCompositeCurve([], {}, "2024-01-02");
    expect(out).toEqual([]);
  });

  it("returns cumulative WEALTH values (1.0-based), not cumulative RETURN", () => {
    // computeScenario internally returns value as (cumulative - 1).
    // computeCompositeCurve wraps that and adds 1 back so the output is
    // ready to feed into PortfolioEquityCurve (which expects wealth).
    const dates = buildDates("2024-01-02", 30);
    const strategies = [constantReturnStrategy("a", dates, 0.001)];
    const curve = computeCompositeCurve(strategies, { a: 1 }, "2024-01-02");

    expect(curve.length).toBeGreaterThan(0);
    // Every point should be >= 1.0 for a positive-return strategy.
    for (const p of curve) {
      expect(p.value).toBeGreaterThanOrEqual(1);
    }
    // Final value ≈ (1.001)^30
    const expectedFinal = Math.pow(1.001, 30);
    const lastPoint = curve[curve.length - 1];
    expect(lastPoint.value).toBeCloseTo(expectedFinal, 3);
  });

  it("clamps a favorite with a later start_date to its own launch date (no time travel)", () => {
    const allDates = buildDates("2024-01-02", 60);
    const lateDates = allDates.slice(30); // later 30 days
    const stratA = constantReturnStrategy("a", allDates, 0.001);
    const lateStrat = constantReturnStrategy("late", lateDates, 0.005);
    // The late strategy's start_date is on day 30 — after the inception
    // date we pass in (day 0). The composite should not time-travel: the
    // late strategy contributes zero on days 0-29 and its actual return
    // on days 30-59.
    const curve = computeCompositeCurve(
      [stratA, lateStrat],
      { a: 1, late: 1 },
      allDates[0],
    );

    expect(curve.length).toBeGreaterThan(0);
    // Effective start should be the earliest inception date (day 0),
    // NOT the late strategy's start_date.
    expect(curve[0].date).toBe(allDates[0]);
  });
});

describe("computeFavoritesOverlayCurve", () => {
  it("returns the baseline curve when no favorites are toggled on", () => {
    const dates = buildDates("2024-01-02", 30);
    const real = [
      constantReturnStrategy("a", dates, 0.001),
      constantReturnStrategy("b", dates, 0.002),
    ];
    const weights = { a: 0.5, b: 0.5 };

    const baseline = computeCompositeCurve(real, weights, dates[0]);
    const overlay = computeFavoritesOverlayCurve(real, weights, [], dates[0]);

    expect(overlay).toHaveLength(baseline.length);
    for (let i = 0; i < baseline.length; i++) {
      expect(overlay[i].date).toBe(baseline[i].date);
      expect(overlay[i].value).toBeCloseTo(baseline[i].value, 6);
    }
  });

  it("shifts the curve when a favorite is toggled on, with a 10% sleeve by default", () => {
    const dates = buildDates("2024-01-02", 60);
    const real = [constantReturnStrategy("a", dates, 0.002)];
    const favorite = constantReturnStrategy("f", dates, 0.010);

    const baseline = computeCompositeCurve(real, { a: 1 }, dates[0]);
    const withFavorite = computeFavoritesOverlayCurve(
      real,
      { a: 1 },
      [favorite],
      dates[0],
    );

    expect(withFavorite.length).toBe(baseline.length);
    // The favorite has a much higher daily return, so the composite
    // should be strictly above the baseline at every point past index 0.
    // Sleeve = 10%, so expected composite daily ≈ 0.9 * 0.002 + 0.1 * 0.010
    // = 0.0018 + 0.0010 = 0.0028, vs baseline's 0.002.
    for (let i = 1; i < withFavorite.length; i++) {
      expect(withFavorite[i].value).toBeGreaterThan(baseline[i].value);
    }
    // The final value should match the analytic expectation, +/- 1%.
    const expectedFinal = Math.pow(1 + 0.9 * 0.002 + 0.1 * 0.010, 60);
    const lastPoint = withFavorite[withFavorite.length - 1];
    expect(lastPoint.value).toBeCloseTo(expectedFinal, 2);
  });

  it("splits the sleeve equally among multiple active favorites", () => {
    const dates = buildDates("2024-01-02", 60);
    const real = [constantReturnStrategy("a", dates, 0.002)];
    const fav1 = constantReturnStrategy("f1", dates, 0.010);
    const fav2 = constantReturnStrategy("f2", dates, 0.004);

    const curve = computeFavoritesOverlayCurve(
      real,
      { a: 1 },
      [fav1, fav2],
      dates[0],
    );

    // Expected daily: 0.9 * 0.002 + 0.05 * 0.010 + 0.05 * 0.004
    //               = 0.0018 + 0.0005 + 0.0002 = 0.0025
    const expectedDaily = 0.9 * 0.002 + 0.05 * 0.010 + 0.05 * 0.004;
    const expectedFinal = Math.pow(1 + expectedDaily, 60);
    const lastPoint = curve[curve.length - 1];
    expect(lastPoint.value).toBeCloseTo(expectedFinal, 2);
  });
});
