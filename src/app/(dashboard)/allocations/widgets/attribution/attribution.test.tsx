import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import AlphaBetaDecomposition from "./AlphaBetaDecomposition";
import { CONSTANT_YIELDS, navConstantYield } from "@/__tests__/fixtures/dispersion-nav";

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

  // Phase 166.2 review round 1 (WR-04), founder decision D7: when every strategy
  // is a compounding constant yield, the equal-weight benchmark has no dispersion,
  // so beta does not exist and neither does alpha. The widget must say "—", never
  // a beta of 0 that labels the whole return "alpha".
  it("renders alpha as a dash, with no chart, when the benchmark has no dispersion", () => {
    const flat = navConstantYield(CONSTANT_YIELDS["apy_1pct"], dailyReturns.length);
    const flatStrategy = (id: string, name: string, weight: number) => {
      const s = mockStrategy(id, name, weight);
      return {
        ...s,
        strategy: {
          ...s.strategy,
          strategy_analytics: {
            ...s.strategy.strategy_analytics,
            daily_returns: dailyReturns.map((d, i) => ({ date: d.date, value: flat[i] })),
          },
        },
      };
    };
    render(
      <AlphaBetaDecomposition
        {...widgetProps}
        data={{
          ...mockData,
          strategies: [flatStrategy("s1", "A", 0.5), flatStrategy("s2", "B", 0.5)],
        }}
      />,
    );
    expect(screen.getByTestId("alpha-value").textContent).toBe("—");
    expect(screen.getByText(/the benchmark has no dispersion/)).toBeTruthy();
  });

  // Phase 166.2 review round 2 (IN-02 / SFH-R2 LOW-2): the muted line names the
  // benchmark's dispersion only when that is the cause. Here the benchmark
  // DISPERSES, but one day's equal-weight sum overflows to Infinity (two finite
  // 1e308 returns), so beta is undefined for a different reason. Blaming "no
  // dispersion" would send the reader after the wrong fault.
  it("uses neutral wording when beta is undefined for a reason other than a flat benchmark", () => {
    const overflowStrategy = (id: string, name: string, weight: number) => {
      const s = mockStrategy(id, name, weight);
      return {
        ...s,
        strategy: {
          ...s.strategy,
          strategy_analytics: {
            ...s.strategy.strategy_analytics,
            daily_returns: dailyReturns.map((d, i) => (i === 30 ? { ...d, value: 1e308 } : d)),
          },
        },
      };
    };
    render(
      <AlphaBetaDecomposition
        {...widgetProps}
        data={{
          ...mockData,
          strategies: [overflowStrategy("s1", "A", 0.5), overflowStrategy("s2", "B", 0.5)],
        }}
      />,
    );
    expect(screen.getByTestId("alpha-value").textContent).toBe("—");
    expect(screen.getByText("Alpha and beta cannot be measured over this window.")).toBeTruthy();
    expect(screen.queryByText(/no dispersion/)).toBeNull();
  });

  it("control: a dispersing benchmark renders a signed percentage alpha, not a dash", () => {
    render(<AlphaBetaDecomposition {...widgetProps} />);
    expect(screen.queryByTestId("alpha-value")).toBeNull();
    expect(screen.getByText("annualized")).toBeTruthy();
  });
});
