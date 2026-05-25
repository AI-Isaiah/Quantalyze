import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WidgetProps } from "../../lib/types";

import EquityCurve from "./EquityCurve";
import DrawdownChart from "./DrawdownChart";
import MonthlyReturns from "./MonthlyReturns";
import AnnualReturns from "./AnnualReturns";
import CumulativeVsBenchmark from "./CumulativeVsBenchmark";
import RollingSharpe from "./RollingSharpe";
import RollingVolatility from "./RollingVolatility";
import ReturnDistribution from "./ReturnDistribution";
import BestWorstPeriods from "./BestWorstPeriods";
import WinRateProfitFactor from "./WinRateProfitFactor";

// ---------------------------------------------------------------------------
// Mock data matching the WidgetProps shape
// ---------------------------------------------------------------------------

/** Generate N daily returns starting from a date. */
function makeDailyReturns(n: number, startDate = "2023-01-01") {
  const pts: Array<{ date: string; value: number }> = [];
  const d = new Date(startDate + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const dateStr = d.toISOString().slice(0, 10);
    // Deterministic "random" returns between -2% and +2%
    const value = Math.sin(i * 0.7) * 0.02;
    pts.push({ date: dateStr, value });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

const MOCK_DAILY = makeDailyReturns(300);

const MOCK_DATA: WidgetProps["data"] = {
  strategies: [
    {
      strategy_id: "s-1",
      weight: 0.6,
      strategy: {
        name: "Alpha Strategy",
        strategy_analytics: {
          daily_returns: MOCK_DAILY,
        },
      },
    },
    {
      strategy_id: "s-2",
      weight: 0.4,
      strategy: {
        name: "Beta Strategy",
        strategy_analytics: {
          daily_returns: makeDailyReturns(300, "2023-01-01"),
        },
      },
    },
  ],
  portfolio: {
    created_at: "2023-01-01T00:00:00Z",
  },
  analytics: null,
};

const EMPTY_DATA: WidgetProps["data"] = {
  strategies: [],
  portfolio: null,
  analytics: null,
};

const baseProps: Omit<WidgetProps, "data"> = {
  timeframe: "all",
  width: 6,
  height: 4,
};

// ---------------------------------------------------------------------------
// Empty-state tests — every widget handles missing data gracefully
// ---------------------------------------------------------------------------

describe("Performance widgets — empty state", () => {
  const widgets = [
    { name: "EquityCurve", Component: EquityCurve, emptyText: /no equity curve/i },
    { name: "DrawdownChart", Component: DrawdownChart, emptyText: /no drawdown/i },
    { name: "MonthlyReturns", Component: MonthlyReturns, emptyText: /no monthly/i },
    { name: "AnnualReturns", Component: AnnualReturns, emptyText: /no annual/i },
    { name: "CumulativeVsBenchmark", Component: CumulativeVsBenchmark, emptyText: /no cumulative/i },
    { name: "RollingSharpe", Component: RollingSharpe, emptyText: /insufficient data.*sharpe/i },
    { name: "RollingVolatility", Component: RollingVolatility, emptyText: /insufficient data.*volatility/i },
    { name: "ReturnDistribution", Component: ReturnDistribution, emptyText: /no return distribution/i },
    { name: "BestWorstPeriods", Component: BestWorstPeriods, emptyText: /no period/i },
    { name: "WinRateProfitFactor", Component: WinRateProfitFactor, emptyText: /no win rate/i },
  ] as const;

  for (const { name, Component, emptyText } of widgets) {
    it(`${name} renders empty state without crashing`, () => {
      render(<Component {...baseProps} data={EMPTY_DATA} />);
      expect(screen.getByText(emptyText)).toBeInTheDocument();
    });
  }
});

// ---------------------------------------------------------------------------
// Render tests with mock data — widgets render without crashing
// ---------------------------------------------------------------------------

describe("Performance widgets — render with data", () => {
  it("EquityCurve renders the SVG chart", () => {
    const { container } = render(
      <EquityCurve {...baseProps} data={MOCK_DATA} />,
    );
    // MultiLineEquityChart renders an SVG
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("DrawdownChart renders without showing empty state", () => {
    render(
      <DrawdownChart {...baseProps} data={MOCK_DATA} />,
    );
    // If data computed correctly, the empty-state message is absent
    expect(screen.queryByText(/no drawdown/i)).not.toBeInTheDocument();
  });

  it("MonthlyReturns renders a table with year rows", () => {
    render(<MonthlyReturns {...baseProps} data={MOCK_DATA} />);
    // Should have 2023 as a year
    expect(screen.getByText("2023")).toBeInTheDocument();
    // Should have month headers
    expect(screen.getByText("Jan")).toBeInTheDocument();
    expect(screen.getByText("Dec")).toBeInTheDocument();
  });

  it("AnnualReturns renders without showing empty state", () => {
    render(
      <AnnualReturns {...baseProps} data={MOCK_DATA} />,
    );
    expect(screen.queryByText(/no annual/i)).not.toBeInTheDocument();
  });

  it("CumulativeVsBenchmark renders the chart and benchmark note", () => {
    render(
      <CumulativeVsBenchmark {...baseProps} data={MOCK_DATA} />,
    );
    expect(screen.queryByText(/no cumulative/i)).not.toBeInTheDocument();
    expect(screen.getByText(/benchmark.*coming soon/i)).toBeInTheDocument();
  });

  it("RollingSharpe renders without showing empty state", () => {
    render(
      <RollingSharpe {...baseProps} data={MOCK_DATA} />,
    );
    // 300 data points supports all 3 windows (30d, 90d, 180d)
    expect(screen.queryByText(/insufficient data.*sharpe/i)).not.toBeInTheDocument();
  });

  it("RollingVolatility renders without showing empty state", () => {
    render(
      <RollingVolatility {...baseProps} data={MOCK_DATA} />,
    );
    expect(screen.queryByText(/insufficient data.*volatility/i)).not.toBeInTheDocument();
  });

  it("ReturnDistribution renders without showing empty state", () => {
    render(
      <ReturnDistribution {...baseProps} data={MOCK_DATA} />,
    );
    expect(screen.queryByText(/no return distribution/i)).not.toBeInTheDocument();
  });

  it("BestWorstPeriods renders a table with period rows", () => {
    render(<BestWorstPeriods {...baseProps} data={MOCK_DATA} />);
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.getByText("Week")).toBeInTheDocument();
    expect(screen.getByText("Month")).toBeInTheDocument();
    expect(screen.getByText("Quarter")).toBeInTheDocument();
  });

  it("WinRateProfitFactor renders win rate and profit factor", () => {
    render(<WinRateProfitFactor {...baseProps} data={MOCK_DATA} />);
    expect(screen.getByText("Win Rate")).toBeInTheDocument();
    expect(screen.getByText("Profit Factor")).toBeInTheDocument();
    expect(screen.getByText("Avg Win")).toBeInTheDocument();
    expect(screen.getByText("Avg Loss")).toBeInTheDocument();
    expect(screen.getByText("Expectancy")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// M-0211 — RollingSharpe edge fixtures. The shared makeDailyReturns codomain
// is a smooth ~[-2%, +2%] sine with no extreme tail; RollingSharpe was only
// asserted at n=300. These pin the bug-prone edges: all-zero (sharpe
// divide-by-zero), a single -50% outlier, and the exact window-length
// boundary (n=30 renders the 30d line; n=29 collapses to insufficient-data).
// We feed `compositeReturns` directly (the widget reads data.compositeReturns
// ?? buildCompositeReturns) so the fixtures are deterministic.
// ---------------------------------------------------------------------------

function makeComposite(
  n: number,
  valueAt: (i: number) => number,
  startDate = "2023-01-01",
): Array<{ date: string; value: number }> {
  const pts: Array<{ date: string; value: number }> = [];
  const d = new Date(startDate + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: valueAt(i) });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

function rollingSharpeData(
  compositeReturns: Array<{ date: string; value: number }>,
): WidgetProps["data"] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { strategies: [], portfolio: null, analytics: null, compositeReturns } as any;
}

describe("RollingSharpe — M-0211 edge fixtures", () => {
  it("(a) all-zero returns render without NaN and without the insufficient-data state", () => {
    // stdDev of an all-zero window is 0, so the sharpe code path takes the
    // `s > 0 ? ... : 0` branch → value 0 (finite), NOT NaN. With 300 points
    // all 3 windows produce series, so the chart renders. Assert the
    // insufficient-data copy is absent and no "NaN" text leaks into the DOM.
    const { container } = render(
      <RollingSharpe {...baseProps} data={rollingSharpeData(makeComposite(300, () => 0))} />,
    );
    expect(
      screen.queryByText(/insufficient data.*sharpe/i),
    ).not.toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/NaN/);
  });

  it("(b) a single -50% outlier renders without crashing or degrading to insufficient-data", () => {
    const data = rollingSharpeData(
      makeComposite(60, (i) => (i === 10 ? -0.5 : 0.005)),
    );
    const { container } = render(<RollingSharpe {...baseProps} data={data} />);
    expect(
      screen.queryByText(/insufficient data.*sharpe/i),
    ).not.toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/NaN/);
  });

  it("(c) boundary: exactly 30 points renders the chart (30d window yields 1 point)", () => {
    const data = rollingSharpeData(
      makeComposite(30, (i) => Math.sin(i) * 0.01),
    );
    render(<RollingSharpe {...baseProps} data={data} />);
    // The 30d window produces exactly one merged row → chart renders, so the
    // insufficient-data copy must be absent at the boundary.
    expect(
      screen.queryByText(/insufficient data.*sharpe/i),
    ).not.toBeInTheDocument();
  });

  it("(c) boundary: 29 points (one below the smallest window) collapses to the insufficient-data state", () => {
    const data = rollingSharpeData(
      makeComposite(29, (i) => Math.sin(i) * 0.01),
    );
    render(<RollingSharpe {...baseProps} data={data} />);
    // Below the 30d window every series is empty → insufficient-data state.
    expect(
      screen.getByText(/insufficient data.*sharpe/i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Barrel export test
// ---------------------------------------------------------------------------

describe("Barrel export", () => {
  it("re-exports all 10 widgets from index", async () => {
    const barrel = await import("./index");
    const exportedNames = Object.keys(barrel);
    expect(exportedNames).toContain("EquityCurve");
    expect(exportedNames).toContain("DrawdownChart");
    expect(exportedNames).toContain("MonthlyReturns");
    expect(exportedNames).toContain("AnnualReturns");
    expect(exportedNames).toContain("CumulativeVsBenchmark");
    expect(exportedNames).toContain("RollingSharpe");
    expect(exportedNames).toContain("RollingVolatility");
    expect(exportedNames).toContain("ReturnDistribution");
    expect(exportedNames).toContain("BestWorstPeriods");
    expect(exportedNames).toContain("WinRateProfitFactor");
    expect(exportedNames).toHaveLength(10);
  });
});
