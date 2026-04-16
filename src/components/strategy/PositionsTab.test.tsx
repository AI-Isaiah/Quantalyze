import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PositionsTab } from "./PositionsTab";
import type { StrategyAnalytics, Position } from "@/lib/types";

const makeAnalytics = (overrides?: Partial<StrategyAnalytics>): StrategyAnalytics => ({
  id: "a1",
  strategy_id: "s1",
  computed_at: new Date().toISOString(),
  computation_status: "complete",
  computation_error: null,
  benchmark: "BTC",
  cumulative_return: 0.1,
  cagr: 0.1,
  volatility: 0.2,
  sharpe: 1.0,
  sortino: 1.5,
  calmar: 1.2,
  max_drawdown: -0.1,
  max_drawdown_duration_days: 10,
  six_month_return: 0.05,
  sparkline_returns: null,
  sparkline_drawdown: null,
  metrics_json: {},
  returns_series: null,
  drawdown_series: null,
  monthly_returns: null,
  daily_returns: null,
  rolling_metrics: null,
  return_quantiles: null,
  trade_metrics: {
    total_positions: 1,
    closed_positions: 1,
    open_positions: 0,
    win_rate: 1,
    long_count: 1,
    short_count: 0,
    avg_duration_days: 1,
    avg_roi: 0.1,
    best_trade_roi: 0.1,
    worst_trade_roi: 0.1,
  },
  volume_metrics: null,
  exposure_metrics: null,
  data_quality_flags: null,
  ...overrides,
});

const makePosition = (overrides?: Partial<Position>): Position => ({
  id: "p1",
  strategy_id: "s1",
  symbol: "BTCUSDT",
  side: "long",
  status: "closed",
  entry_price_avg: 100,
  exit_price_avg: 110,
  size_base: 1,
  size_peak: 1,
  realized_pnl: 10,
  fee_total: 0,
  fill_count: 2,
  opened_at: "2024-01-01T00:00:00Z",
  closed_at: "2024-01-02T00:00:00Z",
  duration_days: 1,
  roi: 0.1,
  funding_pnl: 0,
  ...overrides,
});

describe("PositionsTab — ROI label + tooltip (Sprint 5.6 funding cutover)", () => {
  it("shows plain 'ROI' heading + 'Price ROI excludes funding payments' tooltip when all funding_pnl = 0", () => {
    const analytics = makeAnalytics();
    const positions: Position[] = [makePosition({ funding_pnl: 0 })];
    render(<PositionsTab analytics={analytics} positions={positions} />);

    // Heading reverts to plain "ROI"
    expect(screen.getByText("ROI")).toBeDefined();
    expect(screen.queryByText("Total ROI (incl. funding)")).toBeNull();

    // Tooltip text is the legacy "excludes funding" copy
    const tooltip = screen.getByTestId("roi-tooltip");
    expect(tooltip.textContent).toContain("Price ROI excludes funding payments");
    expect(tooltip.textContent).not.toContain("Funding:");
  });

  it("shows 'Total ROI (incl. funding)' heading + breakdown tooltip when any funding_pnl != 0", () => {
    const analytics = makeAnalytics();
    const positions: Position[] = [
      makePosition({ id: "p1", realized_pnl: 10, funding_pnl: -2.5 }),
      makePosition({ id: "p2", realized_pnl: 5, funding_pnl: 0 }),
    ];
    render(<PositionsTab analytics={analytics} positions={positions} />);

    expect(screen.getByText("Total ROI (incl. funding)")).toBeDefined();
    expect(screen.queryByText("ROI")).toBeNull();

    const tooltip = screen.getByTestId("roi-tooltip");
    // Breakdown renders both numbers with signed formatting.
    // totalRealizedPnl = 10 + 5 = 15; totalFundingPnl = -2.5 + 0 = -2.5
    expect(tooltip.textContent).toContain("Price ROI:");
    expect(tooltip.textContent).toContain("Funding:");
  });

  it("falls back to 'ROI' heading when positions list is empty (no funding to report)", () => {
    const analytics = makeAnalytics({
      trade_metrics: {
        total_positions: 1,
        closed_positions: 0,
        open_positions: 1,
        win_rate: 0,
        long_count: 1,
        short_count: 0,
        avg_duration_days: 0,
        avg_roi: 0,
        best_trade_roi: 0,
        worst_trade_roi: 0,
      },
    });
    const openPos = makePosition({
      status: "open",
      realized_pnl: null,
      roi: null,
      funding_pnl: 5,
    });
    render(<PositionsTab analytics={analytics} positions={[openPos]} />);

    // closedPositions is empty → totalFundingPnl = 0 → heading is plain "ROI"
    expect(screen.getByText("ROI")).toBeDefined();
  });
});
