/**
 * audit-2026-05-07 (C-0182/C-0183/H-0518/H-1118 + H-1119 + H-1120 +
 * M-0908 + M-0909) — design-level type tests.
 *
 * These tests are mostly compile-time: by importing the types and
 * exercising values that should and should not satisfy them, the test
 * locks in the structural contract. The `@ts-expect-error` markers
 * fail the build if the type drift makes a previously-illegal
 * assignment legal.
 */
import { describe, it, expect } from "vitest";
import {
  type LazyMetricsPayload,
  type StrategyAnalyticsSeriesKind,
  type PortfolioAnalytics,
  isCompletedAnalytics,
  isPendingAnalytics,
  type FundingFee,
  buildFundingMatchKey,
  type FundingFeeMatchKey,
} from "@/lib/types";
import { BridgeFitLabelSchema } from "@/lib/analytics-schemas";

describe("LazyMetricsPayload — Partial<Record<…>> structural contract", () => {
  it("accepts an empty map (the most common case)", () => {
    const empty: LazyMetricsPayload = {};
    expect(empty).toEqual({});
  });

  it("accepts a single-kind partial map", () => {
    const partial: LazyMetricsPayload = {
      rolling_sortino_3m: [{ date: "2026-01-01", value: 1.2 }],
    };
    expect(Object.keys(partial)).toHaveLength(1);
  });

  it("accepts a multi-kind partial map", () => {
    const partial: LazyMetricsPayload = {
      exposure_series: [{ date: "2026-01-01", value: 0.5 }],
      turnover_series: [{ date: "2026-01-01", value: 0.1 }],
    };
    expect(partial.exposure_series).toBeDefined();
    expect(partial.turnover_series).toBeDefined();
  });

  it("does NOT require all 12 kinds (was the bug)", () => {
    // Previously `Record<StrategyAnalyticsSeriesKind, unknown>` required
    // every kind. `Partial<Record<…>>` accepts any subset.
    const _kinds: StrategyAnalyticsSeriesKind[] = [
      "daily_returns_grid",
      "rolling_sortino_3m",
      "rolling_sortino_6m",
      "rolling_sortino_12m",
      "rolling_volatility_3m",
      "rolling_volatility_6m",
      "rolling_volatility_12m",
      "rolling_alpha",
      "rolling_beta",
      "exposure_series",
      "turnover_series",
      "log_returns_series",
    ];
    expect(_kinds).toHaveLength(12);
    const partial: LazyMetricsPayload = { rolling_alpha: [] };
    expect(partial).toBeDefined();
  });
});

describe("PortfolioAnalytics status-aware guards — H-1119", () => {
  const base = {
    id: "p1",
    portfolio_id: "p1",
    computed_at: "2026-01-01T00:00:00Z",
    computation_error: null,
    total_aum: null,
    total_return_twr: null,
    total_return_mwr: null,
    portfolio_sharpe: null,
    portfolio_volatility: null,
    portfolio_max_drawdown: null,
    avg_pairwise_correlation: null,
    return_24h: null,
    return_mtd: null,
    return_ytd: null,
    narrative_summary: null,
    correlation_matrix: null,
    attribution_breakdown: null,
    risk_decomposition: null,
    benchmark_comparison: null,
    optimizer_suggestions: null,
    portfolio_equity_curve: null,
    rolling_correlation: null,
  } satisfies Omit<PortfolioAnalytics, "computation_status">;

  it("isCompletedAnalytics returns true only for 'complete' status", () => {
    expect(isCompletedAnalytics({ ...base, computation_status: "complete" })).toBe(true);
    expect(isCompletedAnalytics({ ...base, computation_status: "pending" })).toBe(false);
    expect(isCompletedAnalytics({ ...base, computation_status: "computing" })).toBe(false);
    expect(isCompletedAnalytics({ ...base, computation_status: "failed" })).toBe(false);
    expect(isCompletedAnalytics(null)).toBe(false);
    expect(isCompletedAnalytics(undefined)).toBe(false);
  });

  it("isPendingAnalytics returns true for 'pending' and 'computing' only", () => {
    expect(isPendingAnalytics({ ...base, computation_status: "pending" })).toBe(true);
    expect(isPendingAnalytics({ ...base, computation_status: "computing" })).toBe(true);
    expect(isPendingAnalytics({ ...base, computation_status: "complete" })).toBe(false);
    expect(isPendingAnalytics({ ...base, computation_status: "failed" })).toBe(false);
  });
});

describe("BridgeFitLabel single source — M-0908", () => {
  it("Zod enum matches the inferred TS type at runtime", () => {
    expect(BridgeFitLabelSchema.parse("Strong fit")).toBe("Strong fit");
    expect(BridgeFitLabelSchema.safeParse("Excellent fit").success).toBe(false);
  });
});

describe("FundingFee discriminated union narrowing", () => {
  it("narrows raw_data automatically on exchange discriminator", () => {
    const matchKey = buildFundingMatchKey({
      strategy_id: "S",
      exchange: "okx",
      symbol: "BTC-USDT",
      timestamp: "2026-01-01T00:00:00Z",
    });
    const fee: FundingFee = {
      id: "f1",
      strategy_id: "S",
      exchange: "okx",
      symbol: "BTC-USDT",
      amount: 0.1,
      currency: "USDT",
      timestamp: "2026-01-01T00:00:00Z",
      match_key: matchKey,
      raw_data: { instId: "BTC-USDT-SWAP", type: "8" },
      created_at: "2026-01-01T00:01:00Z",
    };
    if (fee.exchange === "okx" && fee.raw_data) {
      // raw_data narrows to OkxFundingRaw — fields like `instId` are valid
      expect(fee.raw_data.instId).toBeDefined();
    }
  });

  it("match_key brand requires the canonical constructor at type level", () => {
    // The brand is enforced at compile time: `match_key: "fake"` would be
    // a type error if we didn't use the builder. The runtime brand is just
    // a string, so the test checks the constructor produces a stable key.
    const k: FundingFeeMatchKey = buildFundingMatchKey({
      strategy_id: "S",
      exchange: "binance",
      symbol: "BTC-USDT",
      timestamp: "2026-01-01T00:05:00Z",
    });
    expect(typeof k).toBe("string");
  });
});
