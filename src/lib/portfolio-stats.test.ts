import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DailyPoint } from "./portfolio-math-utils";
import {
  computeMonthlyReturns,
  computeAnnualReturns,
  computeRollingMetric,
  computeVaR,
  computeExpectedShortfall,
  computeReturnDistribution,
  computeWinRate,
  computeBestWorstPeriods,
  computeAlphaBeta,
  computeTrackingError,
  computeRiskDecomposition,
  computeHerfindahlIndex,
  detectRegimeChanges,
  computeWeightDrift,
  computeRebalanceSuggestions,
  __resetNonFiniteWarningsForTest,
} from "./portfolio-stats";

// ── Deterministic test data ─────────────────────────────────────────
const DAILY_RETURNS: DailyPoint[] = Array.from({ length: 252 }, (_, i) => ({
  date: new Date(2025, 0, 2 + i).toISOString().slice(0, 10),
  value: (Math.sin(i / 20) * 0.02 + 0.0003) * (1 + Math.cos(i / 50) * 0.5),
}));

/** All-positive constant returns for simpler math checks. */
const CONSTANT_RETURNS: DailyPoint[] = Array.from({ length: 100 }, (_, i) => ({
  date: new Date(2025, 0, 2 + i).toISOString().slice(0, 10),
  value: 0.001,
}));

/** A benchmark series that loosely tracks DAILY_RETURNS but with noise. */
const BENCHMARK: DailyPoint[] = Array.from({ length: 252 }, (_, i) => ({
  date: new Date(2025, 0, 2 + i).toISOString().slice(0, 10),
  value:
    (Math.sin(i / 20) * 0.02 + 0.0003) * (1 + Math.cos(i / 50) * 0.5) +
    Math.sin(i / 7) * 0.003,
}));

// ── 1. computeMonthlyReturns ────────────────────────────────────────
describe("computeMonthlyReturns", () => {
  it("groups daily returns into monthly compounded values", () => {
    const monthly = computeMonthlyReturns(DAILY_RETURNS);
    // 252 days starting Jan 2 spans ~9 months
    expect(monthly.length).toBeGreaterThanOrEqual(8);
    expect(monthly.length).toBeLessThanOrEqual(10);
    // Each date should be YYYY-MM format
    for (const pt of monthly) {
      expect(pt.date).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it("compounding a constant daily return matches (1+r)^n - 1", () => {
    const monthly = computeMonthlyReturns(CONSTANT_RETURNS);
    // First month has ~21-23 trading days; verify compounding
    const jan = monthly.find((m) => m.date === "2025-01");
    expect(jan).toBeDefined();
    // Count Jan days in the input
    const janDays = CONSTANT_RETURNS.filter((d) =>
      d.date.startsWith("2025-01"),
    ).length;
    const expected = Math.pow(1.001, janDays) - 1;
    expect(jan!.value).toBeCloseTo(expected, 8);
  });

  it("returns empty array for empty input", () => {
    expect(computeMonthlyReturns([])).toEqual([]);
  });
});

// ── 2. computeAnnualReturns ─────────────────────────────────────────
describe("computeAnnualReturns", () => {
  it("groups daily returns into annual compounded values", () => {
    const annual = computeAnnualReturns(DAILY_RETURNS);
    // All dates are in 2025, so we should get exactly 1 year
    expect(annual.length).toBe(1);
    expect(annual[0].date).toBe("2025");
  });

  it("compounding equals the product of monthly compounding", () => {
    const annual = computeAnnualReturns(DAILY_RETURNS);
    const monthly = computeMonthlyReturns(DAILY_RETURNS);
    // Compound all monthly returns should match the annual return
    let product = 1;
    for (const m of monthly) product *= 1 + m.value;
    expect(annual[0].value).toBeCloseTo(product - 1, 8);
  });

  it("returns empty array for empty input", () => {
    expect(computeAnnualReturns([])).toEqual([]);
  });
});

// ── 3. computeRollingMetric ─────────────────────────────────────────
describe("computeRollingMetric", () => {
  it("returns rolling Sharpe with correct length (n - window + 1)", () => {
    const window = 60;
    const rolling = computeRollingMetric(DAILY_RETURNS, window, "sharpe");
    expect(rolling.length).toBe(252 - window + 1);
    // Each point has a date from the original series
    expect(rolling[0].date).toBe(DAILY_RETURNS[window - 1].date);
  });

  it("returns rolling volatility annualized (std * sqrt(252))", () => {
    const window = 60;
    const rolling = computeRollingMetric(DAILY_RETURNS, window, "volatility");
    expect(rolling.length).toBe(252 - window + 1);
    // Volatility should be positive
    for (const pt of rolling) {
      expect(pt.value).toBeGreaterThanOrEqual(0);
    }
  });

  it("constant returns produce near-zero rolling volatility", () => {
    const rolling = computeRollingMetric(CONSTANT_RETURNS, 20, "volatility");
    for (const pt of rolling) {
      expect(pt.value).toBeCloseTo(0, 6);
    }
  });

  it("returns empty when input is shorter than window", () => {
    const short = DAILY_RETURNS.slice(0, 5);
    expect(computeRollingMetric(short, 60, "sharpe")).toEqual([]);
  });

  // #597 — asset-class annualization: crypto passes periodsPerYear=365.
  it("default periodsPerYear is byte-identical to explicit 252", () => {
    const window = 60;
    expect(computeRollingMetric(DAILY_RETURNS, window, "sharpe")).toEqual(
      computeRollingMetric(DAILY_RETURNS, window, "sharpe", 252),
    );
    expect(computeRollingMetric(DAILY_RETURNS, window, "volatility")).toEqual(
      computeRollingMetric(DAILY_RETURNS, window, "volatility", 252),
    );
  });

  it("crypto √365 Sharpe = √252 Sharpe × √(365/252) point-for-point", () => {
    const window = 60;
    const s252 = computeRollingMetric(DAILY_RETURNS, window, "sharpe", 252);
    const s365 = computeRollingMetric(DAILY_RETURNS, window, "sharpe", 365);
    const scale = Math.sqrt(365 / 252);
    expect(s365.length).toBe(s252.length);
    for (let i = 0; i < s365.length; i++) {
      expect(s365[i].value).toBeCloseTo(s252[i].value * scale, 10);
    }
  });

  it("crypto √365 volatility = √252 volatility × √(365/252) point-for-point", () => {
    const window = 60;
    const v252 = computeRollingMetric(DAILY_RETURNS, window, "volatility", 252);
    const v365 = computeRollingMetric(DAILY_RETURNS, window, "volatility", 365);
    const scale = Math.sqrt(365 / 252);
    for (let i = 0; i < v365.length; i++) {
      expect(v365[i].value).toBeCloseTo(v252[i].value * scale, 10);
    }
  });
});

// ── 4. computeVaR ───────────────────────────────────────────────────
describe("computeVaR", () => {
  it("95% VaR is a value at or below which ~5% of returns fall", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const var95 = computeVaR(values, 0.95);
    // Count how many returns are <= VaR
    const countBelow = values.filter((v) => v <= var95).length;
    // Should be approximately 5% of 252 = ~12-13, allow +-3
    expect(countBelow).toBeGreaterThanOrEqual(9);
    expect(countBelow).toBeLessThanOrEqual(18);
  });

  it("99% VaR is more extreme than 95% VaR", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const var95 = computeVaR(values, 0.95);
    const var99 = computeVaR(values, 0.99);
    // 99% VaR should be more negative (further in the tail)
    expect(var99).toBeLessThanOrEqual(var95);
  });

  it("VaR of all-positive constant returns is positive", () => {
    const values = CONSTANT_RETURNS.map((d) => d.value);
    const var95 = computeVaR(values, 0.95);
    expect(var95).toBe(0.001);
  });
});

// ── 5. computeExpectedShortfall ─────────────────────────────────────
describe("computeExpectedShortfall", () => {
  it("ES is at least as extreme as VaR", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const var95 = computeVaR(values, 0.95);
    const es95 = computeExpectedShortfall(values, 0.95);
    expect(es95).toBeLessThanOrEqual(var95);
  });

  it("ES is the mean of the tail (returns <= VaR)", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const var95 = computeVaR(values, 0.95);
    const tail = values.filter((v) => v <= var95);
    const expectedES = tail.reduce((s, v) => s + v, 0) / tail.length;
    const es95 = computeExpectedShortfall(values, 0.95);
    expect(es95).toBeCloseTo(expectedES, 10);
  });

  it("M-0541: confidence=0 clamps to the last index (no undefined / NaN poisoning)", () => {
    const values = [-0.05, -0.02, 0.01, 0.03, 0.08];
    // idx = floor((1-0)*5) = 5 → was sorted[5] === undefined (out of bounds).
    // Now clamped to the last (worst-upper) element; must be a real finite number.
    const var0 = computeVaR(values, 0);
    expect(Number.isFinite(var0)).toBe(true);
    expect(var0).toBe(0.08); // sorted ascending, last element
    // And the undefined must not propagate NaN into Expected Shortfall.
    const es0 = computeExpectedShortfall(values, 0);
    expect(Number.isFinite(es0)).toBe(true);
  });
});

// ── 6. computeReturnDistribution ────────────────────────────────────
describe("computeReturnDistribution", () => {
  it("produces the requested number of bins", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const dist = computeReturnDistribution(values, 10);
    expect(dist.length).toBe(10);
  });

  it("total count across bins equals the number of returns", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const dist = computeReturnDistribution(values, 20);
    const totalCount = dist.reduce((s, b) => s + b.count, 0);
    expect(totalCount).toBe(values.length);
  });

  it("bins cover the full range from min to max", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const dist = computeReturnDistribution(values, 10);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    expect(dist[0].min).toBeCloseTo(minVal, 10);
    expect(dist[dist.length - 1].max).toBeCloseTo(maxVal, 10);
  });

  it("bins are contiguous (each bin.max === next bin.min)", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const dist = computeReturnDistribution(values, 10);
    for (let i = 0; i < dist.length - 1; i++) {
      expect(dist[i].max).toBeCloseTo(dist[i + 1].min, 10);
    }
  });
});

// ── 7. computeWinRate ───────────────────────────────────────────────
describe("computeWinRate", () => {
  it("winRate is the fraction of positive returns", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const { winRate } = computeWinRate(values);
    const positiveCount = values.filter((v) => v > 0).length;
    expect(winRate).toBeCloseTo(positiveCount / values.length, 10);
  });

  it("profitFactor = sum(wins) / abs(sum(losses))", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const { profitFactor } = computeWinRate(values);
    const wins = values.filter((v) => v > 0).reduce((s, v) => s + v, 0);
    const losses = values.filter((v) => v < 0).reduce((s, v) => s + v, 0);
    if (losses === 0) {
      // M-0543: wins-but-no-losses → profitFactor is `null` (undefined ratio),
      // NOT Infinity. A non-finite number would JSON-serialize to null silently;
      // returning null makes the "no downside" case explicit + round-trippable.
      expect(profitFactor).toBeNull();
    } else {
      expect(profitFactor).toBeCloseTo(wins / Math.abs(losses), 10);
    }
  });

  it("all-positive series has winRate 1 and profitFactor null (no losses → undefined ratio, M-0543)", () => {
    const values = CONSTANT_RETURNS.map((d) => d.value);
    const { winRate, profitFactor } = computeWinRate(values);
    expect(winRate).toBe(1);
    expect(profitFactor).toBeNull();
    // The whole result must JSON-round-trip losslessly — the bug was that a
    // number-typed Infinity became null over the wire, lying about the type.
    expect(JSON.parse(JSON.stringify({ winRate, profitFactor }))).toEqual({
      winRate: 1,
      profitFactor: null,
    });
  });
});

// ── 8. computeBestWorstPeriods ──────────────────────────────────────
describe("computeBestWorstPeriods", () => {
  it("returns best and worst for day, week, month, quarter granularities", () => {
    const result = computeBestWorstPeriods(DAILY_RETURNS);
    expect(result.day).toBeDefined();
    expect(result.week).toBeDefined();
    expect(result.month).toBeDefined();
    expect(result.quarter).toBeDefined();
  });

  it("best.value >= worst.value for every granularity", () => {
    const result = computeBestWorstPeriods(DAILY_RETURNS);
    for (const granularity of ["day", "week", "month", "quarter"] as const) {
      expect(result[granularity].best.value).toBeGreaterThanOrEqual(
        result[granularity].worst.value,
      );
    }
  });

  it("day best/worst are actual values from the input", () => {
    const result = computeBestWorstPeriods(DAILY_RETURNS);
    const values = DAILY_RETURNS.map((d) => d.value);
    expect(result.day.best.value).toBe(Math.max(...values));
    expect(result.day.worst.value).toBe(Math.min(...values));
  });
});

// ── 9. computeAlphaBeta ─────────────────────────────────────────────
describe("computeAlphaBeta", () => {
  it("beta of a series against itself is 1.0", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const { beta } = computeAlphaBeta(values, values);
    expect(beta).toBeCloseTo(1, 6);
  });

  it("alpha of a series against itself is ~0", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const { alpha } = computeAlphaBeta(values, values);
    expect(alpha).toBeCloseTo(0, 6);
  });

  it("beta is cov(r,b)/var(b) mathematically", () => {
    const r = DAILY_RETURNS.map((d) => d.value);
    const b = BENCHMARK.map((d) => d.value);
    const { beta } = computeAlphaBeta(r, b);
    // Manual calculation
    const n = r.length;
    const meanR = r.reduce((s, v) => s + v, 0) / n;
    const meanB = b.reduce((s, v) => s + v, 0) / n;
    let cov = 0;
    let varB = 0;
    for (let i = 0; i < n; i++) {
      cov += (r[i] - meanR) * (b[i] - meanB);
      varB += (b[i] - meanB) * (b[i] - meanB);
    }
    const expectedBeta = cov / varB;
    expect(beta).toBeCloseTo(expectedBeta, 10);
  });
});

// ── 10. computeTrackingError ────────────────────────────────────────
describe("computeTrackingError", () => {
  it("tracking error against self is 0", () => {
    const values = DAILY_RETURNS.map((d) => d.value);
    const te = computeTrackingError(values, values);
    expect(te).toBeCloseTo(0, 10);
  });

  it("tracking error is std(r-b) * sqrt(252)", () => {
    const r = DAILY_RETURNS.map((d) => d.value);
    const b = BENCHMARK.map((d) => d.value);
    const te = computeTrackingError(r, b);
    // Manual calculation
    const diff = r.map((v, i) => v - b[i]);
    const meanDiff = diff.reduce((s, v) => s + v, 0) / diff.length;
    const variance =
      diff.reduce((s, v) => s + (v - meanDiff) * (v - meanDiff), 0) /
      (diff.length - 1);
    const expectedTE = Math.sqrt(variance) * Math.sqrt(252);
    expect(te).toBeCloseTo(expectedTE, 10);
  });

  it("is always non-negative", () => {
    const r = DAILY_RETURNS.map((d) => d.value);
    const b = BENCHMARK.map((d) => d.value);
    expect(computeTrackingError(r, b)).toBeGreaterThanOrEqual(0);
  });

  // #597 — crypto passes periodsPerYear=365; TE scales by √(365/252).
  it("default periodsPerYear is byte-identical to explicit 252", () => {
    const r = DAILY_RETURNS.map((d) => d.value);
    const b = BENCHMARK.map((d) => d.value);
    expect(computeTrackingError(r, b)).toBe(computeTrackingError(r, b, 252));
  });

  it("crypto √365 TE = √252 TE × √(365/252)", () => {
    const r = DAILY_RETURNS.map((d) => d.value);
    const b = BENCHMARK.map((d) => d.value);
    const te365 = computeTrackingError(r, b, 365);
    const te252 = computeTrackingError(r, b, 252);
    expect(te365).toBeCloseTo(te252 * Math.sqrt(365 / 252), 12);
  });
});

// ── 11. computeRiskDecomposition ────────────────────────────────────
describe("computeRiskDecomposition", () => {
  it("marginal contributions sum to total portfolio variance", () => {
    // 3-asset portfolio
    const weights = [0.5, 0.3, 0.2];
    const covMatrix = [
      [0.04, 0.01, 0.005],
      [0.01, 0.09, 0.02],
      [0.005, 0.02, 0.16],
    ];
    const result = computeRiskDecomposition(weights, covMatrix);
    const totalFromContribs = result.reduce((s, c) => s + c.contribution, 0);
    // Portfolio variance = w^T * C * w
    let portVar = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        portVar += weights[i] * weights[j] * covMatrix[i][j];
      }
    }
    expect(totalFromContribs).toBeCloseTo(portVar, 10);
  });

  it("returns one entry per asset", () => {
    const weights = [0.6, 0.4];
    const covMatrix = [
      [0.04, 0.01],
      [0.01, 0.09],
    ];
    const result = computeRiskDecomposition(weights, covMatrix);
    expect(result.length).toBe(2);
  });

  it("percentage contributions sum to ~100%", () => {
    const weights = [0.5, 0.3, 0.2];
    const covMatrix = [
      [0.04, 0.01, 0.005],
      [0.01, 0.09, 0.02],
      [0.005, 0.02, 0.16],
    ];
    const result = computeRiskDecomposition(weights, covMatrix);
    const totalPct = result.reduce((s, c) => s + c.percentage, 0);
    expect(totalPct).toBeCloseTo(100, 6);
  });
});

// ── 12. computeHerfindahlIndex ──────────────────────────────────────
describe("computeHerfindahlIndex", () => {
  it("equal weights produce HHI = 1/n", () => {
    const weights = [0.25, 0.25, 0.25, 0.25];
    expect(computeHerfindahlIndex(weights)).toBeCloseTo(0.25, 10);
  });

  it("single asset produces HHI = 1", () => {
    expect(computeHerfindahlIndex([1.0])).toBeCloseTo(1, 10);
  });

  it("concentrated portfolio has higher HHI than diversified", () => {
    const concentrated = [0.8, 0.1, 0.1];
    const diversified = [0.34, 0.33, 0.33];
    expect(computeHerfindahlIndex(concentrated)).toBeGreaterThan(
      computeHerfindahlIndex(diversified),
    );
  });

  it("HHI = sum of squared weights", () => {
    const weights = [0.5, 0.3, 0.2];
    const expected = 0.25 + 0.09 + 0.04;
    expect(computeHerfindahlIndex(weights)).toBeCloseTo(expected, 10);
  });

  it("M-0544: long-short book with negative weights stays in [1/n, 1]", () => {
    // [1.5, -0.5] (150% long / 50% short) — the raw Σwᵢ² returned 2.5, out of
    // the documented [1/n, 1] range → "Concentration: 2.5" gibberish. With
    // gross-exposure normalization Σ|wᵢ|=2: w'=[0.75, 0.25] → 0.625, in range.
    const hhi = computeHerfindahlIndex([1.5, -0.5]);
    expect(hhi).toBeCloseTo(0.625, 10);
    expect(hhi).toBeGreaterThanOrEqual(0.5); // 1/n for n=2
    expect(hhi).toBeLessThanOrEqual(1);
  });

  it("M-0544: empty or all-zero book returns the inert 0 (no exposure)", () => {
    expect(computeHerfindahlIndex([])).toBe(0);
    expect(computeHerfindahlIndex([0, 0, 0])).toBe(0);
  });
});

// ── 13. detectRegimeChanges ─────────────────────────────────────────
describe("detectRegimeChanges", () => {
  it("returns crossover points where 50d MA crosses 200d MA", () => {
    const result = detectRegimeChanges(DAILY_RETURNS);
    // With 252 points, we need at least 200 for the slow MA
    // so there should be some crossover points
    expect(result).toBeInstanceOf(Array);
  });

  it("each crossover has a date, direction, and index", () => {
    const result = detectRegimeChanges(DAILY_RETURNS);
    for (const pt of result) {
      expect(pt.date).toBeTruthy();
      expect(["bullish", "bearish"]).toContain(pt.direction);
      expect(typeof pt.index).toBe("number");
    }
  });

  it("returns empty for data shorter than the slow MA window", () => {
    const short = DAILY_RETURNS.slice(0, 50);
    expect(detectRegimeChanges(short)).toEqual([]);
  });

  it("detects a bullish crossover in a rising trend", () => {
    // Build a series that starts negative and trends positive
    const rising: DailyPoint[] = Array.from({ length: 300 }, (_, i) => ({
      date: new Date(2025, 0, 2 + i).toISOString().slice(0, 10),
      value: (i - 150) * 0.0001, // negative first half, positive second
    }));
    const result = detectRegimeChanges(rising);
    const bullish = result.filter((r) => r.direction === "bullish");
    expect(bullish.length).toBeGreaterThanOrEqual(1);
  });
});

// ── 14. computeWeightDrift ──────────────────────────────────────────
describe("computeWeightDrift", () => {
  it("drift is zero when current equals target", () => {
    const current = [0.5, 0.3, 0.2];
    const target = [0.5, 0.3, 0.2];
    const drift = computeWeightDrift(current, target);
    for (const d of drift) {
      expect(d).toBeCloseTo(0, 10);
    }
  });

  it("drift is the pairwise difference (current - target)", () => {
    const current = [0.6, 0.25, 0.15];
    const target = [0.5, 0.3, 0.2];
    const drift = computeWeightDrift(current, target);
    expect(drift[0]).toBeCloseTo(0.1, 10);
    expect(drift[1]).toBeCloseTo(-0.05, 10);
    expect(drift[2]).toBeCloseTo(-0.05, 10);
  });

  it("drift values sum to ~0 when both weight sets sum to 1", () => {
    const current = [0.4, 0.35, 0.25];
    const target = [0.5, 0.3, 0.2];
    const drift = computeWeightDrift(current, target);
    const sum = drift.reduce((s, d) => s + d, 0);
    expect(sum).toBeCloseTo(0, 10);
  });
});

// ── 15. computeRebalanceSuggestions ─────────────────────────────────
describe("computeRebalanceSuggestions", () => {
  it("returns one suggestion per asset with name, drift, and direction", () => {
    const current = [0.6, 0.25, 0.15];
    const target = [0.5, 0.3, 0.2];
    const names = ["BTC", "ETH", "SOL"];
    const suggestions = computeRebalanceSuggestions(current, target, names);
    expect(suggestions.length).toBe(3);
    for (const s of suggestions) {
      expect(names).toContain(s.name);
      expect(typeof s.drift).toBe("number");
      expect(["buy", "sell", "hold"]).toContain(s.direction);
    }
  });

  it("overweight assets get 'sell', underweight get 'buy'", () => {
    const current = [0.6, 0.25, 0.15];
    const target = [0.5, 0.3, 0.2];
    const names = ["BTC", "ETH", "SOL"];
    const suggestions = computeRebalanceSuggestions(current, target, names);
    const btc = suggestions.find((s) => s.name === "BTC")!;
    const eth = suggestions.find((s) => s.name === "ETH")!;
    expect(btc.direction).toBe("sell");
    expect(eth.direction).toBe("buy");
  });

  it("zero drift produces 'hold' direction", () => {
    const current = [0.5, 0.3, 0.2];
    const target = [0.5, 0.3, 0.2];
    const names = ["BTC", "ETH", "SOL"];
    const suggestions = computeRebalanceSuggestions(current, target, names);
    for (const s of suggestions) {
      expect(s.direction).toBe("hold");
    }
  });
});

// ── Audit batch-1 regressions (HIGH findings) ───────────────────────
describe("non-finite input robustness (audit batch1)", () => {
  // H-0470: a single +Infinity drives binWidth to Infinity and
  // idx = floor(x / Infinity) = NaN, so result[NaN].count++ threw a
  // TypeError. NaN entries corrupted every bin boundary to NaN.
  it("computeReturnDistribution does not crash and excludes non-finite returns", () => {
    expect(() =>
      computeReturnDistribution([0.01, Infinity, 0.02, NaN, -Infinity], 10),
    ).not.toThrow();
    const dist = computeReturnDistribution([0.01, Infinity, 0.02, NaN, -Infinity], 10);
    expect(dist.length).toBe(10);
    // Only the two finite returns are counted.
    const total = dist.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(2);
    // Bin boundaries stay finite (derived from finite min/max only).
    for (const bin of dist) {
      expect(Number.isFinite(bin.min)).toBe(true);
      expect(Number.isFinite(bin.max)).toBe(true);
    }
    expect(dist[0].min).toBeCloseTo(0.01, 12);
    expect(dist[dist.length - 1].max).toBeCloseTo(0.02, 12);
  });

  it("computeReturnDistribution returns [] when no finite returns remain", () => {
    expect(computeReturnDistribution([NaN, Infinity, -Infinity], 10)).toEqual([]);
  });

  it("M-0542: all-identical returns collapse to a single bin, not N noise bins", () => {
    // range === 0: the generic path emitted 10 bins all with min===max===0.02,
    // bin 0 holding all 4 counts and bins 1..9 being zero-count noise. Now a
    // single meaningful bin.
    const dist = computeReturnDistribution([0.02, 0.02, 0.02, 0.02], 10);
    expect(dist).toEqual([{ min: 0.02, max: 0.02, count: 4 }]);
  });

  // H-0472: findMinMax left the -Infinity/+Infinity sentinels in place when
  // every period was non-finite, so best/worst serialized to null. Partial
  // non-finite periods must be skipped, not corrupt the finite extremes.
  it("computeBestWorstPeriods returns neutral 0 (not ±Infinity) when all periods are non-finite", () => {
    const allNaN: DailyPoint[] = [
      { date: "2025-01-01", value: NaN },
      { date: "2025-01-02", value: NaN },
    ];
    const result = computeBestWorstPeriods(allNaN);
    expect(result.day.best.value).toBe(0);
    expect(result.day.worst.value).toBe(0);
    expect(result.day.best.date).toBe("");
    expect(result.day.worst.date).toBe("");
  });

  it("computeBestWorstPeriods skips non-finite periods but keeps finite extremes", () => {
    const partial: DailyPoint[] = [
      { date: "2025-01-01", value: 0.05 },
      { date: "2025-01-02", value: NaN },
      { date: "2025-01-03", value: -0.03 },
    ];
    const day = computeBestWorstPeriods(partial).day;
    expect(day.best.value).toBeCloseTo(0.05, 12);
    expect(day.best.date).toBe("2025-01-01");
    expect(day.worst.value).toBeCloseTo(-0.03, 12);
    expect(day.worst.date).toBe("2025-01-03");
  });

  // H-0473: once the cumulative product overflowed to Infinity, every later
  // point was Infinity, the moving averages were Infinity, and the
  // Infinity > Infinity comparison fabricated/suppressed crossovers. Here the
  // overflow tail produced a spurious extra crossover (index 296). The guard
  // detects only over the finite prefix.
  it("detectRegimeChanges ignores the overflowed tail and reports only finite-prefix crossovers", () => {
    const series: DailyPoint[] = Array.from({ length: 305 }, (_, i) => ({
      date: new Date(2025, 0, 2 + i).toISOString().slice(0, 10),
      value: i < 295 ? (i - 150) * 0.0001 : 1e308, // overflows cumulative near the end
    }));
    const crossovers = detectRegimeChanges(series);
    // Exactly the one legitimate bullish crossover from the rising prefix;
    // no phantom crossover manufactured by the Infinity tail.
    expect(crossovers.length).toBe(1);
    expect(crossovers[0].direction).toBe("bullish");
    for (const c of crossovers) {
      expect(c.index).toBeLessThan(295);
    }
  });
});

// ── isoWeekKey ISO 8601 correctness (audit batch1: H-0471) ──────────
// isoWeekKey is module-private; exercise it through computeBestWorstPeriods'
// weekly aggregation. A naive ceil(dayOfYear/7) splits an ISO week that
// straddles the year boundary into two buckets; true ISO 8601 keeps it whole.
describe("ISO 8601 weekly bucketing (audit batch1)", () => {
  it("groups a year-boundary ISO week into a single weekly period", () => {
    // 2024-12-30 (Mon) .. 2025-01-05 (Sun) is one ISO week (2025-W01).
    // Naive week-of-year splits Dec 30-31 (2024) from Jan 1-5 (2025).
    const week: DailyPoint[] = [
      { date: "2024-12-30", value: 0.01 },
      { date: "2024-12-31", value: 0.01 },
      { date: "2025-01-01", value: 0.01 },
      { date: "2025-01-02", value: 0.01 },
      { date: "2025-01-03", value: 0.01 },
    ];
    const { week: weekResult } = computeBestWorstPeriods(week);
    // All five days compound into ONE bucket: best === worst, and the value
    // equals (1.01^5 - 1). Under the naive split there were two buckets
    // (1.01^2-1 and 1.01^3-1), so best !== worst.
    const expected = Math.pow(1.01, 5) - 1;
    expect(weekResult.best.value).toBeCloseTo(expected, 12);
    expect(weekResult.worst.value).toBeCloseTo(expected, 12);
    expect(weekResult.best.value).toBeCloseTo(weekResult.worst.value, 12);
  });
});

// ── Non-finite drop diagnostic breadcrumb (silent-failure MED) ──────
// computeReturnDistribution / findMinMax / detectRegimeChanges drop
// non-finite (NaN/±Infinity) values to stay crash-safe. Dropping them
// silently would mask upstream data corruption (e.g. a malformed CSV
// daily_return), violating the project's "never silently fail / log
// with context" standard. Each must emit a one-shot console.warn
// naming the dropped count + function context — and must NOT warn for
// all-finite input. The guard is module-scoped and bounded to ONE warn
// per context per process; we reset it between tests via the exported
// __resetNonFiniteWarningsForTest helper.
describe("non-finite drop diagnostic breadcrumb (silent-failure MED)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Clear the once-per-process guard so each assertion starts fresh —
    // the audit-batch1 tests above already trip these contexts otherwise.
    __resetNonFiniteWarningsForTest();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe("computeReturnDistribution", () => {
    it("warns once with context + dropped count when non-finite values are dropped", () => {
      computeReturnDistribution([0.01, Infinity, 0.02, NaN, -Infinity], 10);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0] as string;
      expect(msg).toMatch(/computeReturnDistribution/);
      expect(msg).toMatch(/dropped 3 non-finite/);
    });

    it("does NOT warn for all-finite input", () => {
      computeReturnDistribution([0.01, 0.02, -0.01, 0.03], 10);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns at most once per process even across repeated calls (no spam)", () => {
      // Simulates the per-render call pattern: a corrupt series re-binned
      // many times must surface exactly one breadcrumb, not one per render.
      for (let i = 0; i < 5; i++) {
        computeReturnDistribution([0.01, NaN, 0.02], 10);
      }
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("findMinMax (via computeBestWorstPeriods)", () => {
    it("warns once with the findMinMax context when a period is non-finite", () => {
      // A NaN day-value makes the day period non-finite → dropped in
      // findMinMax. (findMinMax is module-private; reached through the
      // public computeBestWorstPeriods, matching the existing tests.)
      const partial: DailyPoint[] = [
        { date: "2025-01-01", value: 0.05 },
        { date: "2025-01-02", value: NaN },
        { date: "2025-01-03", value: -0.03 },
      ];
      computeBestWorstPeriods(partial);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0] as string;
      expect(msg).toMatch(/findMinMax/);
      expect(msg).toMatch(/dropped \d+ non-finite/);
    });

    it("does NOT warn for an all-finite series", () => {
      const clean: DailyPoint[] = [
        { date: "2025-01-01", value: 0.05 },
        { date: "2025-01-02", value: 0.01 },
        { date: "2025-01-03", value: -0.03 },
      ];
      computeBestWorstPeriods(clean);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("detectRegimeChanges", () => {
    it("warns once when the cumulative product overflows and the tail is dropped", () => {
      // The overflow tail (value 1e308) drives the cumulative product to
      // Infinity, truncating later points — those dropped points are the
      // corruption signal the breadcrumb surfaces.
      const series: DailyPoint[] = Array.from({ length: 305 }, (_, i) => ({
        date: new Date(2025, 0, 2 + i).toISOString().slice(0, 10),
        value: i < 295 ? (i - 150) * 0.0001 : 1e308,
      }));
      detectRegimeChanges(series);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const msg = warnSpy.mock.calls[0][0] as string;
      expect(msg).toMatch(/detectRegimeChanges/);
      expect(msg).toMatch(/dropped \d+ non-finite/);
    });

    it("does NOT warn for a finite series that never overflows", () => {
      const rising: DailyPoint[] = Array.from({ length: 300 }, (_, i) => ({
        date: new Date(2025, 0, 2 + i).toISOString().slice(0, 10),
        value: (i - 150) * 0.0001,
      }));
      detectRegimeChanges(rising);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  it("return values are unchanged whether or not the breadcrumb fires (purely diagnostic)", () => {
    // The breadcrumb must not alter behavior: the dropped-value output
    // here must match the audit-batch1 contract exactly.
    const dist = computeReturnDistribution([0.01, Infinity, 0.02, NaN, -Infinity], 10);
    expect(dist.length).toBe(10);
    expect(dist.reduce((s, b) => s + b.count, 0)).toBe(2);
  });
});
