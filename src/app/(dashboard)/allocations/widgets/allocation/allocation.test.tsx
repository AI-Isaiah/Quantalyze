import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import AllocationDonut from "./AllocationDonut";
import AllocationByStyleWidget from "./AllocationByStyleWidget";
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
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
};

const widgetProps = {
  data: mockData,
  timeframe: "1YTD" as const,
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

  // M-0165 — AllocationDonut owns a `hiddenIds` Set toggled via the
  // `toggle()` callback it threads into AllocationPie. The prior coverage
  // only asserted render + empty state, so a regression that broke the
  // toggle handler (e.g. dropping the setHiddenIds call) shipped green.
  // AllocationPie renders one legend <button> per slice with
  // aria-pressed={!hidden}; clicking flips the slice into hiddenIds and the
  // percent cell switches from "N.N%" to the "---" hidden marker. These
  // tests drive that real interaction.
  describe("M-0165 — slice toggle (hiddenIds round-trip)", () => {
    it("clicking a visible legend slice hides it (aria-pressed flips true→false, % → '---')", () => {
      render(<AllocationDonut {...widgetProps} />);
      // The Alpha Seeker legend button starts visible (aria-pressed='true').
      const alphaBtn = screen.getByRole("button", { name: /Alpha Seeker/ });
      expect(alphaBtn.getAttribute("aria-pressed")).toBe("true");
      // Its percent cell reads a real percentage, NOT the hidden marker.
      expect(within(alphaBtn).queryByText("---")).toBeNull();

      fireEvent.click(alphaBtn);

      // After the click the same slice's strategy_id is in hiddenIds, so the
      // button now reports aria-pressed='false' and its percent cell shows
      // the "---" hidden marker.
      const alphaAfter = screen.getByRole("button", { name: /Alpha Seeker/ });
      expect(alphaAfter.getAttribute("aria-pressed")).toBe("false");
      expect(within(alphaAfter).getByText("---")).toBeInTheDocument();
      // The OTHER slices remain visible — toggle is per-id, not global.
      expect(
        screen
          .getByRole("button", { name: /Beta Neutral/ })
          .getAttribute("aria-pressed"),
      ).toBe("true");
    });

    it("clicking the same slice twice toggles it back to visible (delete from Set)", () => {
      render(<AllocationDonut {...widgetProps} />);
      const gammaBtn = () =>
        screen.getByRole("button", { name: /Gamma Scalper/ });

      fireEvent.click(gammaBtn());
      expect(gammaBtn().getAttribute("aria-pressed")).toBe("false");

      fireEvent.click(gammaBtn());
      // Back to visible: id removed from hiddenIds, marker gone.
      expect(gammaBtn().getAttribute("aria-pressed")).toBe("true");
      expect(within(gammaBtn()).queryByText("---")).toBeNull();
    });
  });
});

describe("AllocationByStyleWidget", () => {
  // PR1 QA — pixel-faithful port of the prototype's AllocationBreakdown.
  // Three strategies in the mockData all share strategy_types[0] =
  // "trend-following", so the widget should collapse to one style row at
  // 100%; subtitle should read "fully deployed" because Σweights = 1.0.
  it("renders header + style legend with one tag aggregating three strategies", () => {
    render(<AllocationByStyleWidget {...widgetProps} />);
    expect(screen.getByText("Allocation by style")).toBeTruthy();
    // Subtitle: "1 style · fully deployed" (Σweights = 0.4 + 0.35 + 0.25 = 1.0)
    expect(screen.getByText(/1 style · fully deployed/)).toBeTruthy();
    expect(screen.getByText("trend-following")).toBeTruthy();
    expect(screen.getByText("100.0%")).toBeTruthy();
  });

  it("groups multiple style tags and shows cash share when underdeployed", () => {
    const mixed = {
      ...mockData,
      strategies: [
        {
          ...mockData.strategies[0],
          current_weight: 0.5,
          strategy: { ...mockData.strategies[0].strategy, strategy_types: ["arbitrage"] },
        },
        {
          ...mockData.strategies[1],
          current_weight: 0.3,
          strategy: { ...mockData.strategies[1].strategy, strategy_types: ["market-neutral"] },
        },
      ],
    };
    render(<AllocationByStyleWidget {...widgetProps} data={mixed} />);
    // 0.5 + 0.3 = 0.8 → 20% cash, 2 styles
    expect(screen.getByText(/2 styles · 20.0% cash/)).toBeTruthy();
    expect(screen.getByText("arbitrage")).toBeTruthy();
    expect(screen.getByText("market-neutral")).toBeTruthy();
    expect(screen.getByText("50.0%")).toBeTruthy();
    expect(screen.getByText("30.0%")).toBeTruthy();
  });

  it("renders empty-state when no strategies have positive weight", () => {
    render(
      <AllocationByStyleWidget
        {...widgetProps}
        data={{ ...mockData, strategies: [] }}
      />,
    );
    expect(screen.getByText("No active allocations")).toBeTruthy();
  });

  it("falls back to 'Other' when strategy_types is empty", () => {
    const untagged = {
      ...mockData,
      strategies: [
        {
          ...mockData.strategies[0],
          current_weight: 1,
          strategy: { ...mockData.strategies[0].strategy, strategy_types: [] },
        },
      ],
    };
    render(<AllocationByStyleWidget {...widgetProps} data={untagged} />);
    expect(screen.getByText("Other")).toBeTruthy();
  });
});

describe("AllocationOverTime", () => {
  it("renders empty state when no weight snapshots", () => {
    render(<AllocationOverTime {...widgetProps} />);
    expect(
      screen.getByText(/No weight history yet/),
    ).toBeTruthy();
  });

  it("renders chart when weight snapshots provided", () => {
    const propsWithSnapshots = {
      ...widgetProps,
      data: {
        ...mockData,
        weightSnapshots: [
          { id: "w1", portfolio_id: "p1", strategy_id: "s1", snapshot_date: "2024-01-01", target_weight: 0.4, actual_weight: 0.38, created_at: "2024-01-01" },
          { id: "w2", portfolio_id: "p1", strategy_id: "s2", snapshot_date: "2024-01-01", target_weight: 0.6, actual_weight: 0.62, created_at: "2024-01-01" },
        ],
      },
    };
    const { container } = render(<AllocationOverTime {...propsWithSnapshots} />);
    // Recharts renders inside the container (ResponsiveContainer may render a div)
    expect(container.firstChild).toBeTruthy();
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
