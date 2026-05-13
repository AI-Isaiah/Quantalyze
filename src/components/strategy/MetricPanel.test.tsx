import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MetricPanel } from "./MetricPanel";
import type { StrategyAnalytics, TradeMetrics } from "@/lib/types";

const makeAnalytics = (overrides?: Partial<StrategyAnalytics>): StrategyAnalytics => ({
  id: "1",
  strategy_id: "s1",
  computed_at: new Date().toISOString(),
  computation_status: "complete",
  computation_error: null,
  benchmark: "BTC",
  cumulative_return: 0.523,
  cagr: 0.182,
  volatility: 0.24,
  sharpe: 1.45,
  sortino: 2.1,
  calmar: 1.8,
  max_drawdown: -0.185,
  max_drawdown_duration_days: 45,
  six_month_return: 0.08,
  sparkline_returns: null,
  sparkline_drawdown: null,
  metrics_json: {
    var_1d_95: -0.02,
    cvar: -0.035,
    mtd: 0.012,
    ytd: 0.15,
    best_day: 0.08,
    worst_day: -0.06,
    skewness: -0.3,
    kurtosis: 2.1,
    avg_win: 0.015,
    avg_loss: -0.012,
  },
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
});

describe("MetricPanel", () => {
  it("renders main metrics group", () => {
    render(<MetricPanel analytics={makeAnalytics()} />);
    expect(screen.getByText("Main Metrics")).toBeDefined();
    expect(screen.getByText("CAGR")).toBeDefined();
    expect(screen.getByText("Sharpe")).toBeDefined();
    expect(screen.getByText("Max Drawdown")).toBeDefined();
  });

  it("renders metric values correctly", () => {
    render(<MetricPanel analytics={makeAnalytics()} />);
    // CAGR of 0.182 should display as +18.20%
    expect(screen.getAllByText("+18.20%").length).toBeGreaterThan(0);
    // Sharpe of 1.45
    expect(screen.getAllByText("1.45").length).toBeGreaterThan(0);
  });

  it("renders dash for null values", () => {
    const analytics = makeAnalytics({ six_month_return: null });
    render(<MetricPanel analytics={analytics} />);
    // Six month return is null, should show —
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("hides benchmark group when no alpha/beta", () => {
    const analytics = makeAnalytics({
      metrics_json: { mtd: 0.01, ytd: 0.05, best_day: 0.03, worst_day: -0.02 },
    });
    render(<MetricPanel analytics={analytics} />);
    expect(screen.queryByText("Benchmark Metrics")).toBeNull();
  });

  it("shows benchmark group when alpha present", () => {
    const analytics = makeAnalytics({
      metrics_json: {
        alpha: 0.05,
        beta: 0.8,
        mtd: 0.01,
        ytd: 0.05,
        best_day: 0.03,
        worst_day: -0.02,
      },
    });
    render(<MetricPanel analytics={analytics} />);
    expect(screen.getByText("Benchmark Metrics")).toBeDefined();
  });

  it("hides trade metrics when null", () => {
    render(<MetricPanel analytics={makeAnalytics({ trade_metrics: null })} />);
    expect(screen.queryByText("Trade Metrics")).toBeNull();
  });

  // ---- Block F / P2035: Trade Metrics chip aligns with actual TradeMetrics shape ----
  // Pre-fix the chip read `total_trades`, `maker_pct`, `long_pct` — none of which exist
  // on TradeMetrics — so 3 of 4 rows always rendered "—". Tests below pin the chip to
  // the real type contract (total_positions, win_rate, long_count/total, trade_mix).

  it("Trade Metrics chip renders actual values from TradeMetrics (4-bucket trade_mix)", () => {
    const tm: TradeMetrics = {
      total_positions: 100,
      closed_positions: 100,
      open_positions: 0,
      win_rate: 0.62,
      avg_roi: 0.03,
      avg_duration_days: 4.2,
      long_count: 60,
      short_count: 40,
      best_trade_roi: 0.1,
      worst_trade_roi: -0.05,
      expectancy: 0.012,
      risk_reward_ratio: 1.4,
      weighted_risk_reward_ratio: 1.3,
      sqn: 2.1,
      profit_factor_long: 1.5,
      profit_factor_short: 1.2,
      trade_mix: {
        long_maker: { count: 30, total_notional: 30_000 },
        long_taker: { count: 30, total_notional: 30_000 },
        short_maker: { count: 20, total_notional: 20_000 },
        short_taker: { count: 20, total_notional: 20_000 },
      },
    };
    render(<MetricPanel analytics={makeAnalytics({ trade_metrics: tm })} />);

    // Trade Metrics chip is collapsed by default — expand it first.
    fireEvent.click(screen.getByText("Trade Metrics"));

    // Locate the chip body so we don't false-match rows in other groups.
    // heading is the <button>; its parent is the chip wrapper <div class="border-b ...">.
    const heading = screen.getByText("Trade Metrics");
    const chip = heading.parentElement;
    expect(chip).toBeTruthy();
    const scoped = within(chip as HTMLElement);

    // Row labels exist.
    expect(scoped.getByText("Total Positions")).toBeInTheDocument();
    expect(scoped.getByText("Win Rate")).toBeInTheDocument();
    expect(scoped.getByText("Long Share")).toBeInTheDocument();
    expect(scoped.getByText("Maker Share")).toBeInTheDocument();

    // Row values — match what formatPercent / toLocaleString actually produce.
    // formatPercent is signed-by-default with 2 decimals.
    expect(scoped.getByText("100")).toBeInTheDocument();          // total_positions
    expect(scoped.getByText("+62.00%")).toBeInTheDocument();      // win_rate
    expect(scoped.getByText("+60.00%")).toBeInTheDocument();      // long_share = 60/100
    expect(scoped.getByText("+50.00%")).toBeInTheDocument();      // maker_share = (30+20)/100

    // Regression guard: legacy labels that read non-existent fields must be gone.
    expect(scoped.queryByText("Total Trades")).not.toBeInTheDocument();
    expect(scoped.queryByText("Maker %")).not.toBeInTheDocument();
    expect(scoped.queryByText("Long %")).not.toBeInTheDocument();
  });

  it("Trade Metrics chip omits Maker Share when trade_mix is 2-bucket", () => {
    const tm: TradeMetrics = {
      total_positions: 50,
      closed_positions: 50,
      open_positions: 0,
      win_rate: 0.5,
      avg_roi: 0,
      avg_duration_days: 2,
      long_count: 30,
      short_count: 20,
      best_trade_roi: 0.1,
      worst_trade_roi: -0.1,
      expectancy: null,
      risk_reward_ratio: null,
      weighted_risk_reward_ratio: null,
      sqn: null,
      profit_factor_long: null,
      profit_factor_short: null,
      trade_mix: {
        long: { count: 30, total_notional: 30_000 },
        short: { count: 20, total_notional: 20_000 },
      },
    };
    render(<MetricPanel analytics={makeAnalytics({ trade_metrics: tm })} />);
    fireEvent.click(screen.getByText("Trade Metrics"));

    const heading = screen.getByText("Trade Metrics");
    const chip = heading.parentElement;
    const scoped = within(chip as HTMLElement);

    // Long Share still renders (computed from long_count / total_positions).
    expect(scoped.getByText("Long Share")).toBeInTheDocument();
    expect(scoped.getByText("+60.00%")).toBeInTheDocument();      // 30/50

    // Maker Share is hidden because the 2-bucket variant has no maker/taker split.
    expect(scoped.queryByText("Maker Share")).not.toBeInTheDocument();
  });

  it("Trade Metrics chip omits Maker Share when trade_mix is absent", () => {
    const tm: TradeMetrics = {
      total_positions: 10,
      closed_positions: 10,
      open_positions: 0,
      win_rate: 0.4,
      avg_roi: 0,
      avg_duration_days: 1,
      long_count: 4,
      short_count: 6,
      best_trade_roi: 0.05,
      worst_trade_roi: -0.05,
      expectancy: null,
      risk_reward_ratio: null,
      weighted_risk_reward_ratio: null,
      sqn: null,
      profit_factor_long: null,
      profit_factor_short: null,
    };
    render(<MetricPanel analytics={makeAnalytics({ trade_metrics: tm })} />);
    fireEvent.click(screen.getByText("Trade Metrics"));

    const heading = screen.getByText("Trade Metrics");
    const chip = heading.parentElement;
    const scoped = within(chip as HTMLElement);

    expect(scoped.queryByText("Maker Share")).not.toBeInTheDocument();
  });

  it("renders all visible groups without crashing", () => {
    const fullAnalytics = makeAnalytics({
      metrics_json: {
        var_1d_95: -0.02,
        cvar: -0.035,
        mtd: 0.012,
        ytd: 0.15,
        best_day: 0.08,
        worst_day: -0.06,
        skewness: -0.3,
        kurtosis: 2.1,
        avg_win: 0.015,
        avg_loss: -0.012,
        alpha: 0.05,
        beta: 0.8,
      },
      trade_metrics: {
        total_positions: 150,
        open_positions: 0,
        closed_positions: 150,
        win_rate: 0.55,
        avg_roi: 0.0,
        avg_duration_days: 0,
        long_count: 0,
        short_count: 0,
        best_trade_roi: 0.0,
        worst_trade_roi: 0.0,
        expectancy: null,
        risk_reward_ratio: null,
        weighted_risk_reward_ratio: null,
        sqn: null,
        profit_factor_long: null,
        profit_factor_short: null,
        trade_mix: undefined,
      },
    });
    const { container } = render(<MetricPanel analytics={fullAnalytics} />);
    // Should render without throwing
    expect(container.querySelector("div")).toBeDefined();
  });
});
