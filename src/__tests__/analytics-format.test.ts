import { describe, it, expect } from "vitest";
import { extractAnalytics, EMPTY_ANALYTICS } from "@/lib/queries";
import type { StrategyAnalytics } from "@/lib/types";

/**
 * Regression test for Supabase PostgREST returning strategy_analytics
 * as a plain object {} instead of an array [{}] when the FK is unique.
 * Fix: commit 5df5c21
 */

const SAMPLE_ANALYTICS: StrategyAnalytics = {
  id: "a-1",
  strategy_id: "s-1",
  computed_at: "2026-04-01T00:00:00Z",
  computation_status: "complete",
  computation_error: null,
  benchmark: "BTC",
  cumulative_return: 0.42,
  cagr: 0.18,
  volatility: 0.25,
  sharpe: 1.2,
  sortino: 1.8,
  calmar: 0.9,
  max_drawdown: -0.15,
  max_drawdown_duration_days: 30,
  six_month_return: 0.12,
  sparkline_returns: [0.01, 0.02, -0.01],
  sparkline_drawdown: [-0.01, -0.02],
  metrics_json: null,
  returns_series: null,
  drawdown_series: null,
  monthly_returns: null,
  daily_returns: null,
  rolling_metrics: null,
  return_quantiles: null,
  trade_metrics: null,
};

describe("extractAnalytics", () => {
  it("handles a single analytics object (not wrapped in array)", () => {
    const result = extractAnalytics(SAMPLE_ANALYTICS);
    expect(result).toEqual(SAMPLE_ANALYTICS);
  });

  it("handles a normal array response", () => {
    const result = extractAnalytics([SAMPLE_ANALYTICS]);
    expect(result).toEqual(SAMPLE_ANALYTICS);
  });

  it("returns null for null input", () => {
    expect(extractAnalytics(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractAnalytics(undefined)).toBeNull();
  });

  it("handles an empty array", () => {
    expect(extractAnalytics([])).toBeNull();
  });

  it("returns the first element when array has multiple entries", () => {
    const second: StrategyAnalytics = { ...SAMPLE_ANALYTICS, id: "a-2" };
    const result = extractAnalytics([SAMPLE_ANALYTICS, second]);
    expect(result).toEqual(SAMPLE_ANALYTICS);
  });

  it("returns data with the expected analytics shape keys", () => {
    const result = extractAnalytics(SAMPLE_ANALYTICS);
    expect(result).not.toBeNull();

    const expectedKeys: (keyof StrategyAnalytics)[] = [
      "id",
      "strategy_id",
      "computed_at",
      "computation_status",
      "cagr",
      "sharpe",
      "sortino",
      "calmar",
      "volatility",
      "max_drawdown",
      "cumulative_return",
      "six_month_return",
    ];

    for (const key of expectedKeys) {
      expect(result).toHaveProperty(key);
    }
  });

  it("EMPTY_ANALYTICS has all required StrategyAnalytics keys", () => {
    const keys: (keyof StrategyAnalytics)[] = [
      "id",
      "strategy_id",
      "computed_at",
      "computation_status",
      "computation_error",
      "benchmark",
      "cumulative_return",
      "cagr",
      "volatility",
      "sharpe",
      "sortino",
      "calmar",
      "max_drawdown",
      "max_drawdown_duration_days",
      "six_month_return",
      "sparkline_returns",
      "sparkline_drawdown",
      "metrics_json",
      "returns_series",
      "drawdown_series",
      "monthly_returns",
      "daily_returns",
      "rolling_metrics",
      "return_quantiles",
      "trade_metrics",
    ];

    for (const key of keys) {
      expect(EMPTY_ANALYTICS).toHaveProperty(key);
    }
  });
});
