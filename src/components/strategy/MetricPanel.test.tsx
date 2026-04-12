import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricPanel } from "./MetricPanel";
import type { StrategyAnalytics } from "@/lib/types";

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
      trade_metrics: { total_trades: 150, win_rate: 0.55 },
    });
    const { container } = render(<MetricPanel analytics={fullAnalytics} />);
    // Should render without throwing
    expect(container.querySelector("div")).toBeDefined();
  });
});
