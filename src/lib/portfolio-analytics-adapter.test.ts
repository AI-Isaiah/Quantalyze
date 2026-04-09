import { describe, expect, it } from "vitest";
import { adaptPortfolioAnalytics } from "./portfolio-analytics-adapter";

import complete from "@/__tests__/fixtures/portfolio-analytics/complete.json";
import partialNullBenchmark from "@/__tests__/fixtures/portfolio-analytics/partial-null-benchmark.json";
import emptyRollingCorr from "@/__tests__/fixtures/portfolio-analytics/empty-rolling-corr.json";
import allNull from "@/__tests__/fixtures/portfolio-analytics/all-null.json";
import malformedRollingCorr from "@/__tests__/fixtures/portfolio-analytics/malformed-rolling-corr.json";
import computedStatusFailed from "@/__tests__/fixtures/portfolio-analytics/computed-status-failed.json";
import narrativeOnly from "@/__tests__/fixtures/portfolio-analytics/narrative-only.json";

describe("adaptPortfolioAnalytics", () => {
  it("returns null for non-objects", () => {
    expect(adaptPortfolioAnalytics(null)).toBeNull();
    expect(adaptPortfolioAnalytics(undefined)).toBeNull();
    expect(adaptPortfolioAnalytics("string")).toBeNull();
    expect(adaptPortfolioAnalytics(42)).toBeNull();
    expect(adaptPortfolioAnalytics([])).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(adaptPortfolioAnalytics({})).toBeNull();
    expect(
      adaptPortfolioAnalytics({
        id: "abc",
        portfolio_id: "def",
        computed_at: "2026-04-09T00:00:00Z",
      }),
    ).toBeNull();
  });

  it("returns null when computation_status is invalid", () => {
    const bad = { ...complete, computation_status: "rocket" };
    expect(adaptPortfolioAnalytics(bad)).toBeNull();
  });

  it("parses a complete fixture into the strict shape", () => {
    const parsed = adaptPortfolioAnalytics(complete);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(parsed.computation_status).toBe("complete");
    expect(parsed.total_aum).toBe(10_000_000);
    expect(parsed.portfolio_sharpe).toBeCloseTo(1.42);

    expect(parsed.attribution_breakdown).toHaveLength(3);
    expect(parsed.attribution_breakdown?.[0]).toEqual({
      strategy_id: "cccccccc-0001-4000-8000-000000000001",
      strategy_name: "Stellar Neutral Alpha",
      contribution: 0.072,
      allocation_effect: 0.012,
    });

    expect(parsed.risk_decomposition).toHaveLength(3);
    expect(parsed.risk_decomposition?.[0].marginal_risk_pct).toBe(28);
    expect(parsed.risk_decomposition?.[0].weight_pct).toBe(40);

    expect(parsed.benchmark_comparison).toEqual({
      symbol: "BTC",
      correlation: 0.31,
      benchmark_twr: 0.12,
      portfolio_twr: 0.18,
      stale: false,
    });

    expect(parsed.optimizer_suggestions).toHaveLength(2);
    expect(parsed.optimizer_suggestions?.[0].strategy_name).toBe(
      "Vega Volatility Harvester",
    );

    expect(parsed.portfolio_equity_curve).toHaveLength(7);
    expect(parsed.portfolio_equity_curve?.[0]).toEqual({
      date: "2025-10-09",
      value: 1.0,
    });

    expect(parsed.rolling_correlation).not.toBeNull();
    expect(
      Object.keys(parsed.rolling_correlation ?? {}),
    ).toHaveLength(2);
    expect(
      parsed.rolling_correlation?.[
        "cccccccc-0001-4000-8000-000000000001:cccccccc-0001-4000-8000-000000000002"
      ],
    ).toHaveLength(3);

    expect(parsed.correlation_matrix).not.toBeNull();
    expect(
      parsed.correlation_matrix?.[
        "cccccccc-0001-4000-8000-000000000001"
      ]?.["cccccccc-0001-4000-8000-000000000002"],
    ).toBe(0.18);
  });

  it("handles a row with benchmark_comparison set to null", () => {
    const parsed = adaptPortfolioAnalytics(partialNullBenchmark);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.benchmark_comparison).toBeNull();
    expect(parsed.attribution_breakdown).toHaveLength(1);
    expect(parsed.optimizer_suggestions).toBeNull(); // empty array → null
  });

  it("handles empty rolling_correlation", () => {
    const parsed = adaptPortfolioAnalytics(emptyRollingCorr);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.rolling_correlation).toBeNull();
    expect(parsed.benchmark_comparison?.symbol).toBe("BTC");
  });

  it("handles an all-null fixture", () => {
    const parsed = adaptPortfolioAnalytics(allNull);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.computation_status).toBe("pending");
    expect(parsed.total_aum).toBeNull();
    expect(parsed.attribution_breakdown).toBeNull();
    expect(parsed.risk_decomposition).toBeNull();
    expect(parsed.benchmark_comparison).toBeNull();
    expect(parsed.optimizer_suggestions).toBeNull();
    expect(parsed.portfolio_equity_curve).toBeNull();
    expect(parsed.rolling_correlation).toBeNull();
    expect(parsed.correlation_matrix).toBeNull();
  });

  it("accepts a legacy flat-array rolling_correlation under the _legacy key", () => {
    const parsed = adaptPortfolioAnalytics(malformedRollingCorr);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.rolling_correlation).not.toBeNull();
    expect(Object.keys(parsed.rolling_correlation ?? {})).toEqual(["_legacy"]);
    expect(parsed.rolling_correlation?._legacy).toHaveLength(3);
  });

  it("handles computation_status=failed by returning the row unchanged", () => {
    const parsed = adaptPortfolioAnalytics(computedStatusFailed);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.computation_status).toBe("failed");
    expect(parsed.computation_error).toContain("Analytics computation failed");
    expect(parsed.attribution_breakdown).toHaveLength(1);
    expect(parsed.benchmark_comparison?.symbol).toBe("BTC");
  });

  it("handles a row that only has narrative_summary", () => {
    const parsed = adaptPortfolioAnalytics(narrativeOnly);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.computation_status).toBe("computing");
    expect(parsed.narrative_summary).toBe("Portfolio analytics pending computation.");
    expect(parsed.attribution_breakdown).toBeNull();
  });

  it("drops attribution rows that lack required fields", () => {
    const parsed = adaptPortfolioAnalytics({
      ...allNull,
      attribution_breakdown: [
        { strategy_id: "valid", contribution: 0.05 },
        { contribution: 0.1 }, // missing strategy_id
        { strategy_id: "no_contribution" }, // missing contribution
      ],
    });
    expect(parsed?.attribution_breakdown).toHaveLength(1);
    expect(parsed?.attribution_breakdown?.[0].strategy_id).toBe("valid");
  });

  it("coerces stringified numbers in JSONB", () => {
    const parsed = adaptPortfolioAnalytics({
      ...allNull,
      total_aum: "10000000",
      portfolio_sharpe: "1.42",
    });
    expect(parsed?.total_aum).toBe(10_000_000);
    expect(parsed?.portfolio_sharpe).toBe(1.42);
  });

  it("returns null for non-finite numbers", () => {
    const parsed = adaptPortfolioAnalytics({
      ...allNull,
      total_aum: "not a number",
      portfolio_sharpe: NaN,
    });
    expect(parsed?.total_aum).toBeNull();
    expect(parsed?.portfolio_sharpe).toBeNull();
  });

  it("rejects empty strings and booleans as numbers (no silent 0)", () => {
    const parsed = adaptPortfolioAnalytics({
      ...allNull,
      total_aum: "",
      portfolio_sharpe: "   ",
      portfolio_volatility: false,
      portfolio_max_drawdown: true,
    });
    expect(parsed?.total_aum).toBeNull();
    expect(parsed?.portfolio_sharpe).toBeNull();
    expect(parsed?.portfolio_volatility).toBeNull();
    expect(parsed?.portfolio_max_drawdown).toBeNull();
  });

  it("strips dangerous keys from correlation matrix", () => {
    const parsed = adaptPortfolioAnalytics({
      ...allNull,
      correlation_matrix: {
        __proto__: { evil: 1 },
        constructor: { evil: 1 },
        "sid-a": { "sid-a": 1, "sid-b": 0.3, __proto__: 999 },
      },
    });
    // The "sid-a" row survives but its __proto__ cell is filtered.
    const matrix = parsed?.correlation_matrix ?? {};
    expect(Object.keys(matrix).sort()).toEqual(["sid-a"]);
    expect(matrix["sid-a"]?.["sid-b"]).toBe(0.3);
    // Prototype should be untouched.
    const proto = Object.getPrototypeOf({});
    expect((proto as Record<string, unknown>).evil).toBeUndefined();
  });

  it("collapses an empty correlation_matrix object to null", () => {
    // Regression test for PR 0 review: the empty-object path for
    // correlation_matrix was covered only by the all-null fixture (which
    // sets it to null). Verify `{}` also collapses to null so downstream
    // `<CorrelationHeatmap>` shows the empty-state card, not a zero-row grid.
    const parsed = adaptPortfolioAnalytics({
      ...allNull,
      correlation_matrix: {},
    });
    expect(parsed?.correlation_matrix).toBeNull();
  });

  it("strips dangerous keys from rolling correlation", () => {
    const parsed = adaptPortfolioAnalytics({
      ...allNull,
      rolling_correlation: {
        "sid-a:sid-b": [{ date: "2026-01-01", value: 0.5 }],
        __proto__: [{ date: "2026-01-01", value: 999 }],
      },
    });
    const rolling = parsed?.rolling_correlation ?? {};
    expect(Object.keys(rolling)).toEqual(["sid-a:sid-b"]);
  });
});
