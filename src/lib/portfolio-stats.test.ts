import { describe, it, expect } from "vitest";
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
      expect(profitFactor).toBe(Infinity);
    } else {
      expect(profitFactor).toBeCloseTo(wins / Math.abs(losses), 10);
    }
  });

  it("all-positive series has winRate 1 and profitFactor Infinity", () => {
    const values = CONSTANT_RETURNS.map((d) => d.value);
    const { winRate, profitFactor } = computeWinRate(values);
    expect(winRate).toBe(1);
    expect(profitFactor).toBe(Infinity);
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
