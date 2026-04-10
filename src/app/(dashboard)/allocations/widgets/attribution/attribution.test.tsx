import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import AttributionWaterfall from "./AttributionWaterfall";
import PerformanceByPeriod from "./PerformanceByPeriod";
import AlphaBetaDecomposition from "./AlphaBetaDecomposition";

// ---------------------------------------------------------------------------
// Recharts ResponsiveContainer needs a measured container. Mock it so
// tests don't fail due to zero-sized container in jsdom.
// ---------------------------------------------------------------------------
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 300 }}>{children}</div>
    ),
  };
});

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const dailyReturns = Array.from({ length: 60 }, (_, i) => ({
  date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
  value: (Math.sin(i * 0.3) * 0.01) + 0.001,
}));

const mockStrategy = (id: string, name: string, weight: number) => ({
  strategy_id: id,
  current_weight: weight,
  allocated_amount: weight * 100_000,
  alias: null,
  strategy: {
    id,
    name,
    codename: null,
    disclosure_tier: "institutional",
    strategy_types: ["trend-following"],
    markets: ["BTC"],
    start_date: "2024-01-01",
    strategy_analytics: {
      daily_returns: dailyReturns,
      cagr: 0.15,
      sharpe: 1.2,
      volatility: 0.18,
      max_drawdown: -0.12,
    },
  },
});

const mockData = {
  portfolio: {
    id: "p1",
    user_id: "u1",
    name: "Test Portfolio",
    description: null,
    created_at: "2023-01-01T00:00:00Z",
    is_test: false,
  },
  analytics: {
    total_aum: 300_000,
    attribution_breakdown: [
      { strategy_id: "s1", strategy_name: "Alpha Seeker", contribution: 0.05, allocation_effect: 0.02 },
      { strategy_id: "s2", strategy_name: "Beta Neutral", contribution: -0.01, allocation_effect: -0.005 },
      { strategy_id: "s3", strategy_name: "Gamma Scalper", contribution: 0.03, allocation_effect: 0.01 },
    ],
  },
  strategies: [
    mockStrategy("s1", "Alpha Seeker", 0.4),
    mockStrategy("s2", "Beta Neutral", 0.35),
    mockStrategy("s3", "Gamma Scalper", 0.25),
  ],
  apiKeys: [],
  alertCount: { high: 0, medium: 0, low: 0, total: 0 },
};

const widgetProps = {
  data: mockData,
  timeframe: "YTD",
  width: 6,
  height: 3,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AttributionWaterfall", () => {
  it("renders without crash with attribution data", () => {
    const { container } = render(<AttributionWaterfall {...widgetProps} />);
    // Recharts renders SVG elements
    expect(container.querySelector("svg") || container.firstChild).toBeTruthy();
  });

  it("shows placeholder when attribution_breakdown is null", () => {
    render(
      <AttributionWaterfall
        {...widgetProps}
        data={{
          ...mockData,
          analytics: { ...mockData.analytics, attribution_breakdown: null },
        }}
      />,
    );
    expect(screen.getByText("Attribution data not available")).toBeTruthy();
  });
});

describe("PerformanceByPeriod", () => {
  it("renders without crash with mock data", () => {
    render(<PerformanceByPeriod {...widgetProps} />);
    expect(screen.getByTestId("performance-by-period-table")).toBeTruthy();
  });

  it("renders period headers", () => {
    render(<PerformanceByPeriod {...widgetProps} />);
    expect(screen.getByText("MTD")).toBeTruthy();
    expect(screen.getByText("QTD")).toBeTruthy();
    expect(screen.getByText("YTD")).toBeTruthy();
    expect(screen.getByText("1Y")).toBeTruthy();
  });

  it("renders portfolio total row", () => {
    render(<PerformanceByPeriod {...widgetProps} />);
    expect(screen.getByText("Portfolio")).toBeTruthy();
  });

  it("renders all strategy names", () => {
    render(<PerformanceByPeriod {...widgetProps} />);
    expect(screen.getByText("Alpha Seeker")).toBeTruthy();
    expect(screen.getByText("Beta Neutral")).toBeTruthy();
    expect(screen.getByText("Gamma Scalper")).toBeTruthy();
  });
});

describe("AlphaBetaDecomposition", () => {
  it("renders without crash with sufficient data", () => {
    const { container } = render(<AlphaBetaDecomposition {...widgetProps} />);
    // Should render either the chart or fallback
    expect(container.firstChild).toBeTruthy();
  });

  it("shows fallback when no strategies", () => {
    render(
      <AlphaBetaDecomposition
        {...widgetProps}
        data={{ ...mockData, strategies: [] }}
      />,
    );
    expect(
      screen.getByText("Insufficient data for alpha/beta decomposition."),
    ).toBeTruthy();
  });
});
