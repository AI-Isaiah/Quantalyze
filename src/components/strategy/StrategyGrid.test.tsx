/**
 * Phase 13 / Plan 13-04 / DISCO-04 — StrategyGrid sparkline color rule.
 *
 * Card-view counterpart to the StrategyTable.test.tsx DISCO-04 block.
 * Asserts the sparkline_returns Sparkline at StrategyGrid.tsx:109-114 picks
 * its color via the sparklineColor helper (final-value-sign rule). The
 * card view has no drawdown sparkline, so this file only covers the three
 * branches (final > 0, final < 0, final === 0).
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StrategyGrid } from "./StrategyGrid";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

const STRATEGY_ID = "22222222-0000-4000-8000-000000000001";

function makeAnalytics(
  overrides?: Partial<StrategyAnalytics>,
): StrategyAnalytics {
  return {
    id: "an-1",
    strategy_id: "s-1",
    computed_at: "2026-01-01T00:00:00Z",
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.42,
    cagr: 0.18,
    volatility: 0.22,
    sharpe: 1.5,
    sortino: 1.9,
    calmar: 1.1,
    max_drawdown: -0.12,
    max_drawdown_duration_days: 30,
    six_month_return: 0.21,
    sparkline_returns: [0, 1, 2, 3, 4],
    sparkline_drawdown: [0, -0.1, -0.2, -0.05, 0],
    metrics_json: null,
    returns_series: null,
    drawdown_series: null,
    monthly_returns: null,
    daily_returns: null,
    rolling_metrics: null,
    return_quantiles: null,
    trade_metrics: null,
    volume_metrics: null,
    exposure_metrics: null,
    data_quality_flags: null,
    ...overrides,
  };
}

function makeStrategy(
  overrides: Partial<Strategy> & { id: string; name: string },
): StrategyWithAnalytics {
  return {
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
    analytics: makeAnalytics({ strategy_id: overrides.id }),
  };
}

function getCardSparklineStroke(): string | null {
  // The card's sparkline is the only stroked <path> in the card body.
  const path = document.querySelector("path[stroke]");
  return path?.getAttribute("stroke") ?? null;
}

describe("StrategyGrid — DISCO-04 sparkline color rule on grid card", () => {
  it("renders the card sparkline with var(--color-accent) when final > 0", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID, name: "Alpha Card" });
    fixture.analytics.sparkline_returns = [0, 0.05, 0.1];
    render(<StrategyGrid strategies={[fixture]} categorySlug="crypto-sma" />);
    expect(getCardSparklineStroke()).toBe("var(--color-accent)");
  });

  it("renders the card sparkline with var(--color-negative) when final < 0", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID, name: "Alpha Card" });
    fixture.analytics.sparkline_returns = [0, -0.02, -0.05];
    render(<StrategyGrid strategies={[fixture]} categorySlug="crypto-sma" />);
    expect(getCardSparklineStroke()).toBe("var(--color-negative)");
  });

  it("renders the card sparkline with var(--color-chart-benchmark) when final === 0", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID, name: "Alpha Card" });
    fixture.analytics.sparkline_returns = [0.01, -0.01, 0];
    render(<StrategyGrid strategies={[fixture]} categorySlug="crypto-sma" />);
    expect(getCardSparklineStroke()).toBe("var(--color-chart-benchmark)");
  });
});
