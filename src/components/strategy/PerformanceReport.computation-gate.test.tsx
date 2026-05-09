import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PerformanceReport } from "./PerformanceReport";
import type { StrategyAnalytics } from "@/lib/types";

/**
 * audit-2026-05-07 G11.A.P70 — gate the chart suite on
 * `analytics.computation_status === 'complete'`. When status is
 * `computing` or `failed`, the parent page already shows a
 * `<ComputeStatus>` banner ABOVE PerformanceReport, but the chart slot
 * was rendering the prior compute's values with the same authoritative
 * styling as a complete report. That's a high-risk misrepresent-risk
 * regression — easy to miss the banner on mobile, hero CAGR/Sharpe/MDD
 * still reads as current.
 *
 * This file locks the gate: when status !== 'complete', the chart suite
 * (WorstDrawdowns, CorrelationWithBenchmark, RollingMetrics, ...) is
 * replaced with a status-aware placeholder. When status === 'complete',
 * all charts render as before.
 */

// -- Recharts mock: prevents jsdom zero-size collapse so child charts
//    actually mount and the Risk-tab assertions can find chart-specific
//    DOM. Pattern borrowed from CorrelationWithBenchmark.test.tsx.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 240 }}>{children}</div>
    ),
  };
});

// Stub the chart subcomponents to a deterministic sentinel each. Cheaper
// than wiring full series fixtures, and lets us assert "this chart did /
// did not render" without depending on internal recharts markup.
vi.mock("@/components/charts/EquityCurve", () => ({
  EquityCurve: () => <div data-testid="chart-equity-curve" />,
}));
vi.mock("@/components/charts/DrawdownChart", () => ({
  DrawdownChart: () => <div data-testid="chart-drawdown" />,
}));
vi.mock("@/components/charts/MonthlyHeatmap", () => ({
  MonthlyHeatmap: () => <div data-testid="chart-monthly-heatmap" />,
}));
vi.mock("@/components/charts/MonthlyReturnsBar", () => ({
  MonthlyReturnsBar: () => <div data-testid="chart-monthly-returns-bar" />,
}));
vi.mock("@/components/charts/ReturnQuantiles", () => ({
  ReturnQuantiles: () => <div data-testid="chart-return-quantiles" />,
}));
vi.mock("@/components/charts/RollingMetrics", () => ({
  RollingMetrics: () => <div data-testid="chart-rolling-metrics" />,
}));
vi.mock("@/components/charts/ReturnHistogram", () => ({
  ReturnHistogram: () => <div data-testid="chart-return-histogram" />,
}));
vi.mock("@/components/charts/RiskOfRuin", () => ({
  RiskOfRuin: () => <div data-testid="chart-risk-of-ruin" />,
}));
vi.mock("@/components/charts/YearlyReturns", () => ({
  YearlyReturns: () => <div data-testid="chart-yearly-returns" />,
}));
vi.mock("@/components/charts/WorstDrawdowns", () => ({
  WorstDrawdowns: () => <div data-testid="chart-worst-drawdowns" />,
}));
vi.mock("@/components/charts/CorrelationWithBenchmark", () => ({
  CorrelationWithBenchmark: () => (
    <div data-testid="chart-correlation-with-benchmark" />
  ),
}));
vi.mock("./MetricPanel", () => ({
  MetricPanel: () => <div data-testid="metric-panel" />,
}));
vi.mock("./VolumeExposureTab", () => ({
  VolumeExposureTab: () => <div data-testid="volume-exposure-tab" />,
}));
vi.mock("./PositionsTab", () => ({
  PositionsTab: () => <div data-testid="positions-tab" />,
}));

function makeAnalytics(
  overrides?: Partial<StrategyAnalytics>,
): StrategyAnalytics {
  return {
    id: "a1",
    strategy_id: "s1",
    computed_at: "2026-05-07T00:00:00Z",
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
    returns_series: [{ date: "2024-01-01", value: 0 }],
    drawdown_series: [{ date: "2024-01-01", value: 0 }],
    monthly_returns: {},
    daily_returns: {},
    rolling_metrics: {},
    return_quantiles: {},
    trade_metrics: null,
    volume_metrics: null,
    exposure_metrics: null,
    data_quality_flags: null,
    ...overrides,
  } as unknown as StrategyAnalytics;
}

describe("PerformanceReport — computation_status gate (audit P70)", () => {
  it("renders the full chart suite (Overview tab) when status is 'complete'", () => {
    render(<PerformanceReport analytics={makeAnalytics()} />);

    // Hero metrics shown
    expect(screen.getByText("CAGR")).toBeDefined();
    expect(screen.getByText("Sharpe")).toBeDefined();
    expect(screen.getByText("Max Drawdown")).toBeDefined();
    // Equity curve in hero slot
    expect(screen.getByTestId("chart-equity-curve")).toBeDefined();
    // Overview-tab charts
    expect(screen.getByTestId("chart-drawdown")).toBeDefined();
    expect(screen.getByTestId("chart-worst-drawdowns")).toBeDefined();
    // No placeholder copy
    expect(
      screen.queryByText(/Charts will appear once computation completes/),
    ).toBeNull();
    expect(
      screen.queryByText(/Last computation failed/),
    ).toBeNull();
    expect(screen.queryByText(/Computing analytics/)).toBeNull();
  });

  it("hides the chart suite + hero and shows failed-state copy when status is 'failed'", () => {
    render(
      <PerformanceReport
        analytics={makeAnalytics({
          computation_status: "failed",
          computation_error: "boom",
        })}
      />,
    );

    // Hero metric labels + equity curve are NOT rendered
    expect(screen.queryByText("CAGR")).toBeNull();
    expect(screen.queryByText("Sharpe")).toBeNull();
    expect(screen.queryByText("Max Drawdown")).toBeNull();
    expect(screen.queryByTestId("chart-equity-curve")).toBeNull();
    // Tab strip still rendered (structure preserved)
    expect(screen.getByRole("button", { name: "Overview" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Risk" })).toBeDefined();
    // Chart suite is gone — including the parallel-agent-owned charts.
    expect(screen.queryByTestId("chart-worst-drawdowns")).toBeNull();
    expect(screen.queryByTestId("chart-correlation-with-benchmark")).toBeNull();
    expect(screen.queryByTestId("chart-rolling-metrics")).toBeNull();
    expect(screen.queryByTestId("chart-drawdown")).toBeNull();
    // Failure copy shown
    expect(
      screen.getByText(
        "Last computation failed — charts unavailable until the next compute run.",
      ),
    ).toBeDefined();
  });

  it("hides the chart suite + hero and shows computing copy when status is 'computing'", () => {
    render(
      <PerformanceReport
        analytics={makeAnalytics({ computation_status: "computing" })}
      />,
    );

    expect(screen.queryByText("CAGR")).toBeNull();
    expect(screen.queryByTestId("chart-equity-curve")).toBeNull();
    expect(screen.queryByTestId("chart-worst-drawdowns")).toBeNull();
    expect(screen.queryByTestId("chart-correlation-with-benchmark")).toBeNull();
    expect(screen.queryByTestId("chart-rolling-metrics")).toBeNull();
    expect(
      screen.getByText("Computing analytics… charts will appear once complete."),
    ).toBeDefined();
  });

  it("hides the chart suite and shows generic placeholder when status is 'pending'", () => {
    render(
      <PerformanceReport
        analytics={makeAnalytics({ computation_status: "pending" })}
      />,
    );

    expect(screen.queryByText("CAGR")).toBeNull();
    expect(screen.queryByTestId("chart-worst-drawdowns")).toBeNull();
    expect(
      screen.getByText("Charts will appear once computation completes."),
    ).toBeDefined();
  });
});
