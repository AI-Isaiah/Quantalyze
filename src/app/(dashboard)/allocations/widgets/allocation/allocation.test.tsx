import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import AllocationDonut from "./AllocationDonut";
import AllocationOverTime from "./AllocationOverTime";
import WeightDriftMonitor from "./WeightDriftMonitor";
import RebalanceSuggestions from "./RebalanceSuggestions";
import StrategyComparison from "./StrategyComparison";

// ---------------------------------------------------------------------------
// Mock data matching MyAllocationDashboardPayload shape
// ---------------------------------------------------------------------------

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
    start_date: "2023-01-01",
    strategy_analytics: {
      daily_returns: [
        { date: "2024-01-01", value: 0.01 },
        { date: "2024-01-02", value: -0.005 },
        { date: "2024-01-03", value: 0.008 },
        { date: "2024-01-04", value: 0.003 },
        { date: "2024-01-05", value: -0.002 },
      ],
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
    attribution_breakdown: null,
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

describe("AllocationDonut", () => {
  it("renders without crash with mock data", () => {
    const { container } = render(<AllocationDonut {...widgetProps} />);
    // Should render SVG pie or the AllocationPie component
    expect(container.querySelector("svg") || container.querySelector("button")).toBeTruthy();
  });

  it("shows fallback when no strategies", () => {
    render(
      <AllocationDonut
        {...widgetProps}
        data={{ ...mockData, strategies: [] }}
      />,
    );
    expect(screen.getByText("Allocation data unavailable.")).toBeTruthy();
  });
});

describe("AllocationOverTime", () => {
  it("renders without crash", () => {
    render(<AllocationOverTime {...widgetProps} />);
  });

  it("shows TODO message", () => {
    render(<AllocationOverTime {...widgetProps} />);
    expect(
      screen.getByText(/Historical weight data not yet available/),
    ).toBeTruthy();
  });

  it("has correct test ID", () => {
    render(<AllocationOverTime {...widgetProps} />);
    expect(screen.getByTestId("allocation-over-time-todo")).toBeTruthy();
  });
});

describe("WeightDriftMonitor", () => {
  it("renders without crash with mock data", () => {
    render(<WeightDriftMonitor {...widgetProps} />);
    expect(screen.getByTestId("weight-drift-table")).toBeTruthy();
  });

  it("renders correct number of rows", () => {
    render(<WeightDriftMonitor {...widgetProps} />);
    const table = screen.getByTestId("weight-drift-table");
    // 3 strategy rows (tbody tr elements)
    const rows = table.querySelectorAll("tbody tr");
    expect(rows.length).toBe(3);
  });

  it("shows strategy names", () => {
    render(<WeightDriftMonitor {...widgetProps} />);
    expect(screen.getByText("Alpha Seeker")).toBeTruthy();
    expect(screen.getByText("Beta Neutral")).toBeTruthy();
    expect(screen.getByText("Gamma Scalper")).toBeTruthy();
  });

  it("shows fallback when no strategies", () => {
    render(
      <WeightDriftMonitor
        {...widgetProps}
        data={{ ...mockData, strategies: [] }}
      />,
    );
    expect(screen.getByText("No strategy data available.")).toBeTruthy();
  });
});

describe("RebalanceSuggestions", () => {
  it("renders without crash with mock data", () => {
    render(<RebalanceSuggestions {...widgetProps} />);
    expect(screen.getByTestId("rebalance-table")).toBeTruthy();
  });

  it("renders Apply All button (disabled)", () => {
    render(<RebalanceSuggestions {...widgetProps} />);
    const button = screen.getByText("Apply All");
    expect(button).toBeTruthy();
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("shows buy/sell/hold badges", () => {
    render(<RebalanceSuggestions {...widgetProps} />);
    // With 3 strategies at different weights vs equal-weight target,
    // at least one should show "sell" and one "buy"
    const badges = screen.getAllByText(/^(buy|sell|hold)$/);
    expect(badges.length).toBe(3);
  });
});

describe("StrategyComparison", () => {
  it("renders without crash with mock data", () => {
    render(<StrategyComparison {...widgetProps} />);
    expect(screen.getByTestId("strategy-comparison-table")).toBeTruthy();
  });

  it("renders sortable headers", () => {
    render(<StrategyComparison {...widgetProps} />);
    expect(screen.getByText(/CAGR/)).toBeTruthy();
    expect(screen.getByText(/Sharpe/)).toBeTruthy();
    expect(screen.getByText(/Max DD/)).toBeTruthy();
  });

  it("renders all strategy names", () => {
    render(<StrategyComparison {...widgetProps} />);
    expect(screen.getByText("Alpha Seeker")).toBeTruthy();
    expect(screen.getByText("Beta Neutral")).toBeTruthy();
    expect(screen.getByText("Gamma Scalper")).toBeTruthy();
  });
});
