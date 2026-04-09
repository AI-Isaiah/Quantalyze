import { describe, expect, it } from "vitest";
import {
  computeAllInsights,
  computeBiggestRisk,
  computeConcentrationCreep,
  computeRegimeChange,
  computeUnderperformance,
} from "./portfolio-insights";
import type { PortfolioAnalytics } from "./types";

function buildAnalytics(
  partial: Partial<PortfolioAnalytics> = {},
): PortfolioAnalytics {
  return {
    id: "1",
    portfolio_id: "1",
    computed_at: "2026-04-09T00:00:00Z",
    computation_status: "complete",
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
    ...partial,
  };
}

describe("computeBiggestRisk", () => {
  it("returns null when analytics is null", () => {
    expect(computeBiggestRisk(null)).toBeNull();
  });

  it("returns null when no rule fires", () => {
    expect(computeBiggestRisk(buildAnalytics())).toBeNull();
  });

  it("flags drawdown when below -15%", () => {
    const insight = computeBiggestRisk(
      buildAnalytics({ portfolio_max_drawdown: -0.18 }),
    );
    expect(insight?.key).toBe("biggest_risk_drawdown");
    expect(insight?.severity).toBe("high");
    expect(insight?.sentence).toContain("18% below peak");
  });

  it("flags concentration when top risk dwarfs top weight", () => {
    const insight = computeBiggestRisk(
      buildAnalytics({
        risk_decomposition: [
          {
            strategy_id: "a",
            strategy_name: "Alpha",
            marginal_risk_pct: 60,
            weight_pct: 30,
            standalone_vol: 0.2,
            component_var: 0.04,
          },
          {
            strategy_id: "b",
            strategy_name: "Beta",
            marginal_risk_pct: 40,
            weight_pct: 70,
            standalone_vol: 0.05,
            component_var: 0.02,
          },
        ],
      }),
    );
    expect(insight?.key).toBe("biggest_risk_concentration");
    expect(insight?.sentence).toContain("Alpha");
    expect(insight?.sentence).toContain("60%");
    expect(insight?.sentence).toContain("30%");
  });

  it("flags correlation when avg pairwise > 0.5", () => {
    const insight = computeBiggestRisk(
      buildAnalytics({ avg_pairwise_correlation: 0.62 }),
    );
    expect(insight?.key).toBe("biggest_risk_correlation");
    expect(insight?.sentence).toContain("62%");
  });

  it("prioritizes drawdown over concentration over correlation", () => {
    const insight = computeBiggestRisk(
      buildAnalytics({
        portfolio_max_drawdown: -0.2,
        avg_pairwise_correlation: 0.7,
        risk_decomposition: [
          {
            strategy_id: "a",
            strategy_name: "Alpha",
            marginal_risk_pct: 80,
            weight_pct: 10,
            standalone_vol: 0,
            component_var: 0,
          },
        ],
      }),
    );
    expect(insight?.key).toBe("biggest_risk_drawdown");
  });

  it("does not fire concentration when top risk is below threshold", () => {
    const insight = computeBiggestRisk(
      buildAnalytics({
        risk_decomposition: [
          {
            strategy_id: "a",
            strategy_name: "Alpha",
            marginal_risk_pct: 25,
            weight_pct: 20,
            standalone_vol: 0,
            component_var: 0,
          },
        ],
      }),
    );
    expect(insight).toBeNull();
  });
});

describe("computeRegimeChange", () => {
  it("returns null when rolling_correlation is missing", () => {
    expect(computeRegimeChange(null)).toBeNull();
    expect(computeRegimeChange(buildAnalytics())).toBeNull();
  });

  it("returns null when series is too short", () => {
    const insight = computeRegimeChange(
      buildAnalytics({
        rolling_correlation: {
          "a:b": [
            { date: "2026-01-01", value: 0.1 },
            { date: "2026-01-02", value: 0.2 },
          ],
        },
      }),
    );
    expect(insight).toBeNull();
  });

  it("detects a tightening regime", () => {
    const series = [
      { date: "1", value: 0.1 },
      { date: "2", value: 0.1 },
      { date: "3", value: 0.1 },
      { date: "4", value: 0.1 },
      { date: "5", value: 0.1 },
      { date: "6", value: 0.5 },
      { date: "7", value: 0.5 },
      { date: "8", value: 0.5 },
      { date: "9", value: 0.5 },
      { date: "10", value: 0.5 },
    ];
    const insight = computeRegimeChange(
      buildAnalytics({ rolling_correlation: { "a:b": series } }),
      { window: 5, minDelta: 0.15 },
    );
    expect(insight?.key).toBe("regime_change");
    expect(insight?.sentence).toContain("tightened");
    expect(insight?.sentence).toContain("0.10");
    expect(insight?.sentence).toContain("0.50");
  });

  it("returns null when delta is below noise floor", () => {
    const series = [
      { date: "1", value: 0.1 },
      { date: "2", value: 0.1 },
      { date: "3", value: 0.1 },
      { date: "4", value: 0.1 },
      { date: "5", value: 0.1 },
      { date: "6", value: 0.15 },
      { date: "7", value: 0.15 },
      { date: "8", value: 0.15 },
      { date: "9", value: 0.15 },
      { date: "10", value: 0.15 },
    ];
    const insight = computeRegimeChange(
      buildAnalytics({ rolling_correlation: { "a:b": series } }),
      { window: 5, minDelta: 0.2 },
    );
    expect(insight).toBeNull();
  });
});

describe("computeUnderperformance", () => {
  it("returns null with no attribution", () => {
    expect(computeUnderperformance(null)).toBeNull();
    expect(computeUnderperformance(buildAnalytics())).toBeNull();
  });

  it("returns null when worst contributor is small", () => {
    expect(
      computeUnderperformance(
        buildAnalytics({
          attribution_breakdown: [
            { strategy_id: "a", strategy_name: "A", contribution: -0.005, allocation_effect: 0 },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("flags a clear underperformer", () => {
    const insight = computeUnderperformance(
      buildAnalytics({
        attribution_breakdown: [
          { strategy_id: "a", strategy_name: "Alpha", contribution: 0.05, allocation_effect: 0 },
          { strategy_id: "b", strategy_name: "Beta",  contribution: -0.04, allocation_effect: 0 },
          { strategy_id: "c", strategy_name: "Gamma", contribution: 0.03, allocation_effect: 0 },
        ],
      }),
    );
    expect(insight?.sentence).toContain("Beta");
    expect(insight?.sentence).toContain("4.00%");
  });

  it("does not single out a worst strategy when 2 are tied", () => {
    const insight = computeUnderperformance(
      buildAnalytics({
        attribution_breakdown: [
          { strategy_id: "a", strategy_name: "Alpha", contribution: -0.04, allocation_effect: 0 },
          { strategy_id: "b", strategy_name: "Beta",  contribution: -0.04, allocation_effect: 0 },
        ],
      }),
    );
    expect(insight).toBeNull();
  });
});

describe("computeConcentrationCreep", () => {
  it("returns null with too few strategies", () => {
    expect(
      computeConcentrationCreep(
        buildAnalytics({
          risk_decomposition: [
            {
              strategy_id: "a",
              strategy_name: "Alpha",
              marginal_risk_pct: 50,
              weight_pct: 50,
              standalone_vol: 0,
              component_var: 0,
            },
            {
              strategy_id: "b",
              strategy_name: "Beta",
              marginal_risk_pct: 50,
              weight_pct: 50,
              standalone_vol: 0,
              component_var: 0,
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("flags a strategy 50% over equal-weight baseline", () => {
    // 5 strategies → equal-weight baseline = 20%; trip threshold is 30%.
    const insight = computeConcentrationCreep(
      buildAnalytics({
        risk_decomposition: [
          { strategy_id: "a", strategy_name: "Alpha", marginal_risk_pct: 0, weight_pct: 50, standalone_vol: 0, component_var: 0 },
          { strategy_id: "b", strategy_name: "Beta",  marginal_risk_pct: 0, weight_pct: 20, standalone_vol: 0, component_var: 0 },
          { strategy_id: "c", strategy_name: "Gamma", marginal_risk_pct: 0, weight_pct: 15, standalone_vol: 0, component_var: 0 },
          { strategy_id: "d", strategy_name: "Delta", marginal_risk_pct: 0, weight_pct: 10, standalone_vol: 0, component_var: 0 },
          { strategy_id: "e", strategy_name: "Eps",   marginal_risk_pct: 0, weight_pct: 5,  standalone_vol: 0, component_var: 0 },
        ],
      }),
    );
    expect(insight?.sentence).toContain("Alpha");
    expect(insight?.sentence).toContain("50%");
    expect(insight?.sentence).toContain("20%");
  });
});

describe("computeAllInsights", () => {
  it("returns insights ordered by severity", () => {
    const insights = computeAllInsights(
      buildAnalytics({
        portfolio_max_drawdown: -0.2,
        avg_pairwise_correlation: 0.6,
      }),
    );
    expect(insights[0].severity).toBe("high");
  });
});
