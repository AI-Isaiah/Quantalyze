import { describe, it, expect, vi } from "vitest";
import {
  buildDateMapCache,
  computeScenario,
  computeStrategyCurve,
  computeCompositeCurve,
  toWealth,
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

  it("[REGRESSION PIN: catastrophic-day guard] returns null metrics when any single day has return ≤ -100% (cumulative wealth flips sign)", () => {
    // Reported as Phase 10 ISSUE-001 — demo allocator with thin OKX
    // history (3 months) + a stablecoin holding showed -79,017% YTD TWR
    // and -10,976% Max DD in the Scenario tab. Root cause: at least one
    // day in `daily_returns` had a value ≤ -1 (impossible for real
    // long-only positions; signals data-quality issue — bad return
    // units, mis-stamped returns_series, or stablecoin price feed
    // glitch). Once cumulative wealth flips sign, twr/cagr/sharpe/maxDD
    // become mathematically meaningless. The guard returns null KPIs so
    // KpiStrip renders honest em-dashes instead of astronomical garbage.
    const dates = buildDates("2024-01-02", 50);
    // Day 5 has a -1.05 return (more than -100%) — clearly bad data.
    const dailyReturns: DailyPoint[] = dates.map((date, i) => ({
      date,
      value: i === 5 ? -1.05 : 0.001,
    }));
    const strategy: StrategyForBuilder = {
      ...constantReturnStrategy("a", dates, 0),
      daily_returns: dailyReturns,
    };
    const cache = buildDateMapCache([strategy]);
    const metrics = computeScenario([strategy], defaultState([strategy]), cache);

    expect(metrics.n).toBe(50);
    // All KPIs nulled out by the guard — KpiStrip will render em-dash.
    expect(metrics.twr).toBeNull();
    expect(metrics.cagr).toBeNull();
    expect(metrics.volatility).toBeNull();
    expect(metrics.sharpe).toBeNull();
    expect(metrics.sortino).toBeNull();
    expect(metrics.max_drawdown).toBeNull();
    expect(metrics.max_dd_days).toBeNull();
    expect(metrics.correlation_matrix).toBeNull();
    expect(metrics.avg_pairwise_correlation).toBeNull();
    // Equity curve also suppressed (plotting bad data misleads more
    // than empty state).
    expect(metrics.equity_curve).toEqual([]);
    // effective_start/end still populated so downstream UX can render
    // a "data quality issue" message keyed to the real date range.
    expect(metrics.effective_start).toBe(dates[0]);
    expect(metrics.effective_end).toBe(dates[49]);
  });

  it("[REGRESSION PIN: catastrophic-day guard] does NOT trigger for normal market crashes (-50% single day)", () => {
    // Sanity check: a -50% single day is bad but plausible (Black
    // Monday, COVID crash, etc.). Cumulative stays positive, metrics
    // should compute normally.
    const dates = buildDates("2024-01-02", 50);
    const dailyReturns: DailyPoint[] = dates.map((date, i) => ({
      date,
      value: i === 5 ? -0.5 : 0.001,
    }));
    const strategy: StrategyForBuilder = {
      ...constantReturnStrategy("a", dates, 0),
      daily_returns: dailyReturns,
    };
    const cache = buildDateMapCache([strategy]);
    const metrics = computeScenario([strategy], defaultState([strategy]), cache);

    expect(metrics.n).toBe(50);
    expect(metrics.twr).not.toBeNull();
    expect(metrics.twr).toBeLessThan(0); // ends negative after the -50% day
    expect(metrics.twr).toBeGreaterThan(-1); // but cumulative wealth stays positive
    expect(metrics.equity_curve.length).toBeGreaterThan(0);
  });

  // M-0481 — Pitfall 1 contract pin (cumulative-RETURN vs wealth form).
  //
  // queries.ts::liveBaselineMetricsFromHoldings feeds per-holding returns into
  // computeScenario and then converts the result to wealth form with
  // `value: p.value + 1` (the "EquityChart expects wealth-form" fix). That +1
  // is correct ONLY because computeScenario emits cumulative RETURN values
  // (0.0-based: `cumulative[i] - 1`). If a future scenario.ts refactor emitted
  // wealth-form directly (1.0-based), the +1 in queries.ts would silently
  // double-count and the live-baseline equity series would start near 2.0
  // instead of 1.0 — visible only in the production drawer. This test pins the
  // contract the caller depends on so that drift fails here, loudly.
  it("[REGRESSION PIN: M-0481] equity_curve emits cumulative-RETURN form (0-based), not wealth (1.0-based)", () => {
    const dates = buildDates("2024-01-02", 30);
    const r = 0.01; // +1% every day
    const strategies = [constantReturnStrategy("a", dates, r)];
    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    expect(metrics.equity_curve.length).toBeGreaterThan(0);

    // First emitted point is at i=0 → cumulative after the first day's return,
    // expressed as a RETURN: (1 + r) - 1 = r ≈ 0.01. In wealth form it would
    // be ≈ 1.01. The distinction is the whole point of the +1 in queries.ts.
    const first = metrics.equity_curve[0];
    expect(first.value).toBeCloseTo(r, 4);
    expect(first.value).toBeLessThan(0.5); // NOT ~1.0 wealth form

    // Last point: cumulative compounded return over the full window, which
    // (in return form) equals the reported TWR. If the curve were wealth-form
    // the final point would be twr + 1, breaking this identity.
    const last = metrics.equity_curve[metrics.equity_curve.length - 1];
    expect(last.value).toBeCloseTo(metrics.twr as number, 4);
    // Compounded return is well above the first day's single-period return.
    expect(last.value).toBeGreaterThan(first.value);

    // Applying the queries.ts wealth-form conversion (p.value + 1) must yield
    // a series that STARTS at ~1.0+, proving the +1 is the correct bridge.
    const wealth = metrics.equity_curve.map((p) => p.value + 1);
    expect(wealth[0]).toBeCloseTo(1 + r, 4);
    expect(wealth[0]).toBeGreaterThan(1.0);
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

// =========================================================================
// audit-2026-05-07 G8.E.6 / G8.E.7 / G8.E.8 — scenario math polish
// =========================================================================

describe("computeScenario — [G8.E.6] Sortino returns null instead of fallback to Sharpe when downsideVol === 0", () => {
  it("strategy with no negative days → sortino: null (NOT silent Sharpe substitution)", () => {
    // All-positive constant-return strategy. downsideSumSq = 0, so
    // downsideVol = 0. Pre-fix this returned `sharpe ?? 0` and the UI
    // displayed Sharpe relabeled as Sortino — misleading the
    // allocator. Post-fix, sortino === null and the UI's
    // formatNumber path renders an em-dash.
    const dates = buildDates("2024-01-02", 60);
    const strategies = [constantReturnStrategy("a", dates, 0.001)];

    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    expect(metrics.sortino).toBeNull();
    // Sharpe is also null in this constant-return case (volatility ===
    // 0 → Sharpe null). The point of this test is purely the Sortino
    // null contract.
  });
});

describe("computeScenario — [G8.E.7] NaN/Infinity guard on cumulative wealth", () => {
  it("daily_returns containing NaN → all KPIs return null (no NaN poison)", () => {
    const dates = buildDates("2024-01-02", 30);
    const dr: DailyPoint[] = dates.map((date, i) => ({
      date,
      value: i === 5 ? NaN : 0.001,
    }));
    const strategies = [
      { ...constantReturnStrategy("a", dates, 0), daily_returns: dr },
    ];

    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    // Pre-fix, NaN poisoned the cumulative product (NaN < Infinity is
    // false, so the catastrophic-day guard never tripped) and TWR
    // came out NaN. Post-fix, the new Number.isFinite scan triggers
    // the null-KPI return.
    expect(metrics.twr).toBeNull();
    expect(metrics.cagr).toBeNull();
    expect(metrics.volatility).toBeNull();
    expect(metrics.sharpe).toBeNull();
    expect(metrics.sortino).toBeNull();
    expect(metrics.max_drawdown).toBeNull();
    expect(metrics.equity_curve).toEqual([]);
  });

  it("daily_returns containing Infinity → all KPIs return null", () => {
    const dates = buildDates("2024-01-02", 30);
    const dr: DailyPoint[] = dates.map((date, i) => ({
      date,
      value: i === 10 ? Infinity : 0.001,
    }));
    const strategies = [
      { ...constantReturnStrategy("a", dates, 0), daily_returns: dr },
    ];

    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    expect(metrics.twr).toBeNull();
    expect(metrics.equity_curve).toEqual([]);
  });

  it("daily_returns containing -Infinity → catastrophic-day guard catches it", () => {
    // -Infinity ≤ -1, so 1 + -Infinity = -Infinity. The cumulative
    // product becomes ±Infinity which is NOT finite. Either the
    // catastrophic-day guard (minCumulative <= 0) or the new
    // anyNonFinite check fires; both return null KPIs.
    const dates = buildDates("2024-01-02", 30);
    const dr: DailyPoint[] = dates.map((date, i) => ({
      date,
      value: i === 5 ? -Infinity : 0.001,
    }));
    const strategies = [
      { ...constantReturnStrategy("a", dates, 0), daily_returns: dr },
    ];

    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    expect(metrics.twr).toBeNull();
    expect(metrics.equity_curve).toEqual([]);
  });
});

// =========================================================================
// R4 — per-strategy leverage (ScenarioState.leverage)
// =========================================================================
describe("computeScenario — R4 leverage multiplier", () => {
  const dates = buildDates("2024-01-02", 30);
  // Two genuinely different series so correlation is well-defined and the
  // blend isn't degenerate.
  const stratA = alternatingStrategy("a", dates, 0.02, -0.01);
  const stratB = alternatingStrategy("b", dates, -0.015, 0.025);
  const strategies = [stratA, stratB];
  const cache = buildDateMapCache(strategies);
  const baseState = defaultState(strategies); // equal weights, NO leverage field

  it("an absent leverage field is byte-identical to an explicit all-1× field (pre-R4 invariance)", () => {
    const withUndef = computeScenario(strategies, baseState, cache);
    const withOnes = computeScenario(
      strategies,
      { ...baseState, leverage: { a: 1, b: 1 } },
      cache,
    );
    expect(withOnes).toEqual(withUndef);
  });

  it("uniform 2× leverage scales volatility ~2× but leaves Sharpe + correlation INVARIANT (the honesty caveat)", () => {
    const base = computeScenario(strategies, baseState, cache);
    const levered = computeScenario(
      strategies,
      { ...baseState, leverage: { a: 2, b: 2 } },
      cache,
    );
    // Uniform leverage scales every daily portfolio return by L, so vol scales by L.
    expect(levered.volatility!).toBeCloseTo(2 * base.volatility!, 4);
    // Sharpe = mean/vol — both scale by L, so it cancels. This is exactly why
    // the UI MUST caveat that risk-adjusted metrics are leverage-invariant.
    expect(levered.sharpe!).toBeCloseTo(base.sharpe!, 3);
    // Correlation is built from the RAW per-strategy series, never the levered
    // portfolio sum → identical matrix + avg |ρ|.
    expect(levered.correlation_matrix).toEqual(base.correlation_matrix);
    expect(levered.avg_pairwise_correlation).toBe(base.avg_pairwise_correlation);
    // Leverage MOVES return (the whole point): cumulative TWR differs.
    expect(levered.twr).not.toBe(base.twr);
  });

  it("per-strategy leverage re-tilts the blend (levering one leg ≠ baseline) without touching correlation", () => {
    const base = computeScenario(strategies, baseState, cache);
    const tilted = computeScenario(
      strategies,
      { ...baseState, leverage: { a: 3, b: 1 } },
      cache,
    );
    expect(tilted.volatility).not.toBe(base.volatility);
    expect(tilted.correlation_matrix).toEqual(base.correlation_matrix);
  });

  it("non-finite or negative leverage defends to 1.0 (a bad caller can't poison the curve)", () => {
    const base = computeScenario(strategies, baseState, cache);
    const poisoned = computeScenario(
      strategies,
      { ...baseState, leverage: { a: NaN, b: -5 } },
      cache,
    );
    // NaN → 1.0 and a negative L → 1.0, so the metrics equal the unlevered baseline.
    expect(poisoned.twr).toBe(base.twr);
    expect(poisoned.volatility).toBe(base.volatility);
    expect(poisoned.sharpe).toBe(base.sharpe);
  });

  it("Infinity leverage defends to 1.0 (the value the UI input can produce — never poisons the curve)", () => {
    // The ScenarioComposer non-finite test feeds an "Infinity" paste; the UI
    // rejects it, but the engine must ALSO defend (Number.isFinite catches it),
    // so a future caller that bypasses the UI clamp can't blow up the curve.
    const base = computeScenario(strategies, baseState, cache);
    const inf = computeScenario(
      strategies,
      { ...baseState, leverage: { a: Infinity, b: 1 } },
      cache,
    );
    expect(inf.twr).toBe(base.twr);
    expect(inf.volatility).toBe(base.volatility);
  });

  it("L=0 is admitted (the >=0 guard): it ZEROES a leg's return but KEEPS its weight mass — dilution, not exclusion", () => {
    // 0× is a legitimate UI value (min=0). Unlike toggling a leg OFF (which
    // removes it from activeStrategies), a 0× leg still occupies the un-levered
    // weight denominator, so it dilutes the rest of the book rather than
    // dropping out. The blend must therefore differ from BOTH the baseline AND
    // a pure single-leg projection.
    const base = computeScenario(strategies, baseState, cache);
    const zeroed = computeScenario(
      strategies,
      { ...baseState, leverage: { a: 0, b: 1 } },
      cache,
    );
    expect(zeroed.twr).not.toBe(base.twr);
    // Correlation is built from the raw series, untouched by leverage → both legs
    // still present in the matrix (0× is NOT exclusion).
    expect(zeroed.correlation_matrix).toEqual(base.correlation_matrix);
  });

  it("leverage that drives a daily portfolio return below -100% trips the catastrophic-loss guard (honest null KPIs, not garbage)", () => {
    // A -50% single day is a plausible market crash that the guard deliberately
    // does NOT trip at 1× (pinned in the [catastrophic-day guard] sanity test).
    // Leverage is a NEW way to push that day's PORTFOLIO return past -100%:
    // -0.5 × 3 = -1.5 → cumulative wealth flips sign → the guard MUST return
    // null KPIs so KpiStrip renders honest em-dashes instead of astronomical
    // garbage TWR. Without leverage feeding the cumulative-wealth chain, this
    // interaction would be untested and a regression could surface false metrics.
    const dates = buildDates("2024-01-02", 50);
    const crashDay: DailyPoint[] = dates.map((date, i) => ({
      date,
      value: i === 5 ? -0.5 : 0.001,
    }));
    const strategy: StrategyForBuilder = {
      ...constantReturnStrategy("a", dates, 0),
      daily_returns: crashDay,
    };
    const cache1 = buildDateMapCache([strategy]);
    // Control: at 1× the -50% day is survivable → metrics compute.
    const unlevered = computeScenario([strategy], defaultState([strategy]), cache1);
    expect(unlevered.twr).not.toBeNull();
    // 3× turns the -50% day into a -150% portfolio day → guard trips.
    const levered = computeScenario(
      [strategy],
      { ...defaultState([strategy]), leverage: { a: 3 } },
      cache1,
    );
    expect(levered.twr).toBeNull();
    expect(levered.volatility).toBeNull();
    expect(levered.sharpe).toBeNull();
    expect(levered.max_drawdown).toBeNull();
    expect(levered.equity_curve).toEqual([]);
  });
});

// =========================================================================
// portfolio_daily_returns — additive OPTIONAL full-resolution daily series
// (Plan 24-01, BENCH-01: the source the benchmark inner-join reads from)
// =========================================================================

describe("computeScenario — portfolio_daily_returns (full daily series)", () => {
  it("[24-01] exposes the FULL daily series: length === n, dates span effective_start..effective_end, UNROUNDED", () => {
    const dates = buildDates("2024-01-02", 30);
    // A constant daily return carried to MORE than 5 decimal places. As a
    // single weight-1, leverage-1 strategy, portDaily[i] === this value
    // exactly. If the field were rounded (.toFixed(5)) the trailing digits
    // would be lost — so equality below proves the series is UNROUNDED.
    const r = 0.0012345678;
    const strategies = [constantReturnStrategy("a", dates, r)];
    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    const series = metrics.portfolio_daily_returns;
    expect(series).toBeDefined();
    // Full resolution: one point per common date, NOT the every-5-day
    // downsample the equity_curve uses.
    expect(series!.length).toBe(metrics.n);
    expect(series!.length).toBe(30);
    expect(series!.length).toBeGreaterThan(metrics.equity_curve.length);

    // Dates run along the engine's internal daily axis.
    expect(series![0].date).toBe(metrics.effective_start);
    expect(series![series!.length - 1].date).toBe(metrics.effective_end);
    expect(series![0].date).toBe(dates[0]);
    expect(series![series!.length - 1].date).toBe(dates[29]);

    // Unrounded: the exact 10-decimal daily return survives. A .toFixed(5)
    // field would have collapsed this to 0.00123.
    expect(series![0].value).toBe(r);
    expect(series![15].value).toBe(r);
    // Sanity: the rounded equity_curve point at the same place would NOT
    // equal the raw daily return (it is cumulative AND 5-decimal rounded).
    expect(series![0].value).not.toBe(
      Number((series![0].value as number).toFixed(5)),
    );
  });

  it("[24-01] equals [] on a degenerate scenario (single strategy, <10 days)", () => {
    const dates = buildDates("2024-01-02", 5); // < 10 → n<10 early return
    const strategies = [constantReturnStrategy("a", dates, 0.001)];
    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    expect(metrics.n).toBe(5);
    expect(metrics.twr).toBeNull(); // confirms we are on the degenerate path
    expect(metrics.portfolio_daily_returns).toEqual([]);
  });

  it("[24-01] equals [] when no strategies are selected", () => {
    const dates = buildDates("2024-01-02", 30);
    const strategies = [constantReturnStrategy("a", dates, 0.001)];
    const cache = buildDateMapCache(strategies);
    const state = defaultState(strategies);
    state.selected["a"] = false;
    const metrics = computeScenario(strategies, state, cache);

    expect(metrics.n).toBe(0);
    expect(metrics.portfolio_daily_returns).toEqual([]);
  });

  it("[24-01] equals [] on the non-finite / catastrophic-loss guard path", () => {
    const dates = buildDates("2024-01-02", 30);
    // A -100% single day trips the catastrophic-loss guard (minCumulative<=0).
    const poisoned = constantReturnStrategy("a", dates, 0.001, {
      daily_returns: dates.map((date, i) => ({
        date,
        value: i === 10 ? -1 : 0.001,
      })),
    });
    const cache = buildDateMapCache([poisoned]);
    const metrics = computeScenario([poisoned], defaultState([poisoned]), cache);

    expect(metrics.twr).toBeNull(); // guard tripped
    expect(metrics.equity_curve).toEqual([]);
    expect(metrics.portfolio_daily_returns).toEqual([]);
  });

  it("[24-01] for a multi-strategy blend the series equals the engine's weighted portDaily (matches equity_curve at shared sample points)", () => {
    const dates = buildDates("2024-01-02", 30);
    // Equal-weight: portDaily = (0.002 + -0.001)/2 = 0.0005 every day.
    const strategies = [
      constantReturnStrategy("a", dates, 0.002),
      constantReturnStrategy("b", dates, -0.001),
    ];
    const cache = buildDateMapCache(strategies);
    const metrics = computeScenario(strategies, defaultState(strategies), cache);

    const series = metrics.portfolio_daily_returns!;
    expect(series.length).toBe(30);
    for (const pt of series) {
      expect(pt.value).toBeCloseTo(0.0005, 12);
    }
    // The first equity_curve point (i=0, return form) is the first daily
    // return; it must match the first portfolio_daily_returns value.
    expect(metrics.equity_curve[0].value).toBeCloseTo(series[0].value, 4);
  });
});

/**
 * toWealth() moved here from the EquityChart "use client" widget so the
 * server-rendered scenario-share page can call it without the RSC client/server
 * boundary 500 (see scenario-share/[token]/page-server-boundary.test.ts).
 * Its behavior was previously exercised only via the EquityChart re-export;
 * these tests pin the constructor at its new home, imported directly from
 * "./scenario".
 */
describe("toWealth (pure constructor, RSC-safe home)", () => {
  it("brands each point and preserves date+value", () => {
    const pts: DailyPoint[] = [
      { date: "2024-01-01", value: 1.0 },
      { date: "2024-01-02", value: 1.1 },
    ];
    const w = toWealth(pts);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ date: "2024-01-01", value: 1.0, __wealthBrand: true });
    expect(w[1]).toMatchObject({ date: "2024-01-02", value: 1.1, __wealthBrand: true });
  });

  it("returns [] for empty input and never warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(toWealth([])).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when the first value is below the 0.05 miscall threshold (likely raw RETURN-form)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    toWealth([
      { date: "2024-01-01", value: 0.04 },
      { date: "2024-01-02", value: 0.05 },
    ]);
    const hits = warn.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("[scenario] toWealth"),
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
    warn.mockRestore();
  });

  it("does NOT warn at the 0.05 boundary (a legitimately deep but valid wealth curve)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    toWealth([
      { date: "2024-01-01", value: 0.05 },
      { date: "2024-01-02", value: 0.06 },
    ]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

