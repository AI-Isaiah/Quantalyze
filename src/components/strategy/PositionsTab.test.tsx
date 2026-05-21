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
    expectancy: null,
    risk_reward_ratio: null,
    weighted_risk_reward_ratio: null,
    sqn: null,
    profit_factor_long: null,
    profit_factor_short: null,
    trade_mix: undefined,
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
  duration_seconds: 86400,
  roi: 0.1,
  funding_pnl: 0,
  ...overrides,
});

describe("PositionsTab — ROI label + tooltip (Sprint 5.6 funding cutover)", () => {
  it("shows plain 'ROI' heading + 'Price ROI excludes funding payments' tooltip when all funding_pnl = 0", () => {
    const analytics = makeAnalytics();
    const positions: Position[] = [makePosition({ funding_pnl: 0 })];
    render(
      <PositionsTab
        analytics={analytics}
        positions={positions}
        exchange="binance"
      />,
    );

    // Heading reverts to plain "ROI"
    expect(screen.getByText("ROI")).toBeDefined();
    expect(screen.queryByText("Total ROI (incl. funding)")).toBeNull();

    // Tooltip text is the legacy "excludes funding" copy
    const tooltip = screen.getByTestId("roi-tooltip");
    expect(tooltip.textContent).toContain("Price ROI excludes funding payments");
    expect(tooltip.textContent).not.toContain("Funding:");
  });

  it("shows 'Total ROI (incl. funding)' heading + breakdown tooltip when any funding_pnl != 0 (binance)", () => {
    const analytics = makeAnalytics();
    const positions: Position[] = [
      makePosition({ id: "p1", realized_pnl: 10, funding_pnl: -2.5 }),
      makePosition({ id: "p2", realized_pnl: 5, funding_pnl: 0 }),
    ];
    render(
      <PositionsTab
        analytics={analytics}
        positions={positions}
        exchange="binance"
      />,
    );

    expect(screen.getByText("Total ROI (incl. funding)")).toBeDefined();
    expect(screen.queryByText("ROI")).toBeNull();

    const tooltip = screen.getByTestId("roi-tooltip");
    // Breakdown renders both numbers with signed formatting.
    // totalRealizedPnl = 10 + 5 = 15; totalFundingPnl = -2.5 + 0 = -2.5
    expect(tooltip.textContent).toContain("Price ROI:");
    expect(tooltip.textContent).toContain("Funding:");
  });

  /**
   * G14-003 + C-0319 (Bybit cutover): with the OKX type=8 funding-bill
   * filter and the Bybit cumEntryValue/cumExitValue reconstruction both
   * live in analytics-service/services/exchange.py, all three CEX
   * integrations now exclude funding from realized_pnl. The "+ Funding"
   * tooltip is therefore mathematically correct for okx and bybit too,
   * and the gate is allowlisted to include them.
   */
  it.each(["okx", "bybit"] as const)(
    "C-0319: shows funding breakdown for exchange=%s when funding_pnl != 0",
    (ex) => {
      const analytics = makeAnalytics();
      const positions: Position[] = [
        makePosition({ id: "p1", realized_pnl: 10, funding_pnl: -2.5 }),
      ];
      render(
        <PositionsTab
          analytics={analytics}
          positions={positions}
          exchange={ex}
        />,
      );

      expect(screen.getByText("Total ROI (incl. funding)")).toBeDefined();
      expect(screen.queryByText("ROI")).toBeNull();
      const tooltip = screen.getByTestId("roi-tooltip");
      expect(tooltip.textContent).toContain("Price ROI:");
      expect(tooltip.textContent).toContain("Funding:");
    },
  );

  it("G14-003: suppresses funding breakdown when exchange prop is not provided (safe default)", () => {
    const analytics = makeAnalytics();
    const positions: Position[] = [
      makePosition({ id: "p1", realized_pnl: 10, funding_pnl: -2.5 }),
    ];
    render(<PositionsTab analytics={analytics} positions={positions} />);

    expect(screen.queryByText("Total ROI (incl. funding)")).toBeNull();
    const tooltip = screen.getByTestId("roi-tooltip");
    expect(tooltip.textContent).not.toContain("Funding:");
  });

  /**
   * Audit 2026-05-07 G12.G.5 regression: when the server-side positions
   * fetch fails, PositionsTab MUST render an explicit error banner — never
   * the silent "No positions reconstructed yet" placeholder, which is
   * indistinguishable from a truly empty result and gives operators no
   * signal to investigate. The page wires up `positionsError` based on the
   * `error` field of the Supabase response (previously ignored entirely).
   */
  it("renders an error banner when positionsError=true (audit G12.G.5)", () => {
    const analytics = makeAnalytics({ trade_metrics: null });
    render(
      <PositionsTab
        analytics={analytics}
        positions={null}
        positionsError={true}
      />,
    );

    expect(screen.getByText(/Couldn.+t load positions/)).toBeDefined();
    // The silent empty-state copy must not appear when an error is in
    // flight — that's the whole bug.
    expect(
      screen.queryByText(/No positions reconstructed yet/),
    ).toBeNull();
  });

  it("does NOT show the error banner when positionsError is unset (legacy path stays empty)", () => {
    const analytics = makeAnalytics({ trade_metrics: null });
    render(<PositionsTab analytics={analytics} positions={null} />);

    expect(screen.queryByText(/Couldn.+t load positions/)).toBeNull();
    expect(
      screen.getByText(/No positions reconstructed yet/),
    ).toBeDefined();
  });

  /**
   * Audit 2026-05-07 G12.G.7 regression: snapshot-inconsistency. The
   * worker writes `trade_metrics` AFTER deleting+reinserting positions,
   * so mid-window the API can return tm.total_positions=23 alongside
   * an empty positions list. Pre-audit guard required BOTH
   * positions-empty AND tm-null to render the empty state, so the
   * dashboard rendered "Total: 23" with empty Best/Worst tables —
   * visibly self-contradictory state with no detection path. After the
   * fix (recipe option c), EITHER signal of inconsistency triggers the
   * empty state. Operators see a clean placeholder until both sides
   * align — safer default than mixed UI.
   */
  it("renders empty state when positions=[] but tm is non-null (audit G12.G.7)", () => {
    const analytics = makeAnalytics({
      trade_metrics: {
        total_positions: 23,
        closed_positions: 23,
        open_positions: 0,
        win_rate: 0.5,
        long_count: 12,
        short_count: 11,
        avg_duration_days: 2,
        avg_roi: 0.05,
        best_trade_roi: 0.2,
        worst_trade_roi: -0.1,
        expectancy: null,
        risk_reward_ratio: null,
        weighted_risk_reward_ratio: null,
        sqn: null,
        profit_factor_long: null,
        profit_factor_short: null,
        trade_mix: undefined,
      },
    });
    // Stale tm (Total: 23) + empty positions (mid-window state).
    render(<PositionsTab analytics={analytics} positions={[]} />);
    expect(
      screen.getByText(/No positions reconstructed yet/),
    ).toBeDefined();
    // The "Total: 23" hero MUST NOT render — that was the visibly
    // contradictory state the pre-audit guard allowed.
    expect(screen.queryByText("23")).toBeNull();
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
        expectancy: null,
        risk_reward_ratio: null,
        weighted_risk_reward_ratio: null,
        sqn: null,
        profit_factor_long: null,
        profit_factor_short: null,
        trade_mix: undefined,
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
