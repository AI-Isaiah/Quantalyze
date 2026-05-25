import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CorrelationMatrix } from "./CorrelationMatrix";
import { CorrelationOverTime } from "./CorrelationOverTime";
import { VarExpectedShortfall } from "./VarExpectedShortfall";
import { RiskDecomposition } from "./RiskDecomposition";
import { TailRisk } from "./TailRisk";
import { TrackingError } from "./TrackingError";

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

/** Generate N days of synthetic daily returns starting from a date. */
function makeDailyReturns(n: number, base = 0.001, seed = 42): { date: string; value: number }[] {
  const returns: { date: string; value: number }[] = [];
  let s = seed;
  const startDate = new Date("2024-01-01");
  for (let i = 0; i < n; i++) {
    // Simple PRNG
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((s % 1000) / 1000 - 0.5) * 0.04;
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    returns.push({
      date: d.toISOString().slice(0, 10),
      value: base + noise,
    });
  }
  return returns;
}

const MOCK_STRATEGIES = [
  {
    strategy_id: "s1",
    current_weight: 0.5,
    alias: "AlphaOne",
    strategy: {
      id: "s1",
      name: "Alpha Strategy",
      codename: "ALPHA",
      disclosure_tier: "full",
      strategy_types: ["momentum"],
      markets: ["BTC"],
      start_date: "2024-01-01",
      strategy_analytics: {
        daily_returns: makeDailyReturns(200, 0.001, 42),
        cagr: 0.15,
        sharpe: 1.2,
        volatility: 0.12,
        max_drawdown: -0.08,
      },
    },
  },
  {
    strategy_id: "s2",
    current_weight: 0.3,
    alias: "BetaTwo",
    strategy: {
      id: "s2",
      name: "Beta Strategy",
      codename: "BETA",
      disclosure_tier: "full",
      strategy_types: ["mean-reversion"],
      markets: ["ETH"],
      start_date: "2024-01-01",
      strategy_analytics: {
        daily_returns: makeDailyReturns(200, 0.002, 99),
        cagr: 0.20,
        sharpe: 1.5,
        volatility: 0.15,
        max_drawdown: -0.10,
      },
    },
  },
  {
    strategy_id: "s3",
    current_weight: 0.2,
    alias: "GammaTre",
    strategy: {
      id: "s3",
      name: "Gamma Strategy",
      codename: "GAMMA",
      disclosure_tier: "full",
      strategy_types: ["arbitrage"],
      markets: ["SOL"],
      start_date: "2024-01-01",
      strategy_analytics: {
        daily_returns: makeDailyReturns(200, -0.0005, 7),
        cagr: 0.05,
        sharpe: 0.8,
        volatility: 0.18,
        max_drawdown: -0.15,
      },
    },
  },
];

const MOCK_DATA = {
  strategies: MOCK_STRATEGIES,
  analytics: null,
};

const WIDGET_PROPS = {
  data: MOCK_DATA,
  timeframe: "YTD",
  width: 4,
  height: 3,
};

// ---------------------------------------------------------------------------
// Tests: each widget renders without crash
// ---------------------------------------------------------------------------

describe("Risk Widgets — render without crash", () => {
  it("CorrelationMatrix renders", () => {
    render(<CorrelationMatrix {...WIDGET_PROPS} />);
    expect(screen.getByTestId("correlation-matrix")).toBeInTheDocument();
  });

  // M-0220 — the prior `if (chart) {...} else {empty}` branch passed
  // vacuously whether the chart rendered OR silently degraded to empty.
  // Split into two deterministically-tuned cases so each outcome is pinned.
  it("M-0220: CorrelationOverTime renders the chart with >= 90 aligned days, 2+ strategies (chart MUST appear)", () => {
    render(<CorrelationOverTime {...WIDGET_PROPS} />);
    // MOCK_STRATEGIES carry 200 aligned, non-flat daily returns → > the
    // 90-day rolling window with non-zero variance, so the chart MUST
    // render. The insufficient-data empty state MUST be absent.
    expect(screen.getByTestId("correlation-over-time")).toBeInTheDocument();
    expect(
      screen.queryByText(/Insufficient data for rolling correlation/i),
    ).not.toBeInTheDocument();
  });

  it("M-0220: CorrelationOverTime shows the empty state below the 90-day window (empty MUST appear)", () => {
    // Two strategies but only 50 aligned days — strictly below the 90-day
    // ROLLING_WINDOW, so no rolling-correlation points exist and the chart
    // MUST collapse to the insufficient-data state.
    const shortStrategies = MOCK_STRATEGIES.slice(0, 2).map((s, i) => ({
      ...s,
      strategy: {
        ...s.strategy,
        strategy_analytics: {
          ...s.strategy.strategy_analytics,
          daily_returns: makeDailyReturns(50, 0.001 + i * 0.001, 42 + i),
        },
      },
    }));
    render(
      <CorrelationOverTime
        data={{ strategies: shortStrategies, analytics: null }}
        timeframe="YTD"
        width={4}
        height={3}
      />,
    );
    expect(screen.queryByTestId("correlation-over-time")).toBeNull();
    expect(
      screen.getByText(/Insufficient data for rolling correlation/i),
    ).toBeInTheDocument();
  });

  it("VarExpectedShortfall renders", () => {
    render(<VarExpectedShortfall {...WIDGET_PROPS} />);
    expect(screen.getByTestId("var-expected-shortfall")).toBeInTheDocument();
  });

  it("RiskDecomposition renders", () => {
    render(<RiskDecomposition {...WIDGET_PROPS} />);
    expect(screen.getByTestId("risk-decomposition")).toBeInTheDocument();
  });

  // M-0220 — same vacuous-branch fix as CorrelationOverTime. TailRisk
  // renders the histogram iff >= 3 composite returns fall below -2%, else
  // the "No extreme loss events" empty state. Pin both outcomes with
  // explicit compositeReturns fixtures.
  it("M-0220: TailRisk renders the histogram when >= 3 returns are below -2% (chart MUST appear)", () => {
    // Six returns below -2% guarantees the >= 3 tail-event threshold.
    const compositeReturns = [
      { date: "2024-01-01", value: -0.03 },
      { date: "2024-01-02", value: -0.04 },
      { date: "2024-01-03", value: -0.05 },
      { date: "2024-01-04", value: -0.025 },
      { date: "2024-01-05", value: -0.06 },
      { date: "2024-01-06", value: -0.035 },
      { date: "2024-01-07", value: 0.01 },
      { date: "2024-01-08", value: 0.02 },
    ];
    render(
      <TailRisk
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ strategies: [], analytics: null, compositeReturns } as any}
        timeframe="YTD"
        width={4}
        height={3}
      />,
    );
    expect(screen.getByTestId("tail-risk")).toBeInTheDocument();
    expect(screen.getByText(/6 events/)).toBeInTheDocument();
    expect(screen.queryByText(/No extreme loss/i)).toBeNull();
  });

  it("M-0220: TailRisk shows the empty state when no return breaches -2% (empty MUST appear)", () => {
    // All returns above the -2% tail threshold → zero tail events.
    const compositeReturns = [
      { date: "2024-01-01", value: 0.01 },
      { date: "2024-01-02", value: -0.005 },
      { date: "2024-01-03", value: 0.012 },
      { date: "2024-01-04", value: -0.018 },
      { date: "2024-01-05", value: 0.003 },
    ];
    render(
      <TailRisk
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ strategies: [], analytics: null, compositeReturns } as any}
        timeframe="YTD"
        width={4}
        height={3}
      />,
    );
    expect(screen.queryByTestId("tail-risk")).toBeNull();
    expect(
      screen.getByText(/No extreme loss events detected/i),
    ).toBeInTheDocument();
  });

  it("TrackingError renders", () => {
    render(<TrackingError {...WIDGET_PROPS} />);
    expect(screen.getByTestId("tracking-error")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: empty data handling
// ---------------------------------------------------------------------------

describe("Risk Widgets — empty data handling", () => {
  const emptyProps = {
    data: { strategies: [], analytics: null },
    timeframe: "YTD",
    width: 4,
    height: 3,
  };

  it("CorrelationMatrix shows empty state with no strategies", () => {
    render(<CorrelationMatrix {...emptyProps} />);
    expect(screen.getByText(/No correlation data/i)).toBeInTheDocument();
  });

  it("VarExpectedShortfall shows empty state with no strategies", () => {
    render(<VarExpectedShortfall {...emptyProps} />);
    expect(screen.getByText(/Insufficient return data/i)).toBeInTheDocument();
  });

  it("RiskDecomposition shows empty state with no strategies", () => {
    render(<RiskDecomposition {...emptyProps} />);
    expect(screen.getByText(/No strategy data/i)).toBeInTheDocument();
  });

  it("TrackingError shows empty state with no strategies", () => {
    render(<TrackingError {...emptyProps} />);
    expect(screen.getByText(/Insufficient data/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: CorrelationMatrix cell count for 3x3 matrix
// ---------------------------------------------------------------------------

describe("CorrelationMatrix — 3x3 cell count", () => {
  it("renders 9 cells (3 rows x 3 columns) for a 3-strategy portfolio", () => {
    render(<CorrelationMatrix {...WIDGET_PROPS} />);
    const cells = screen.getAllByTestId("corr-cell");
    // 3 strategies = 3x3 = 9 cells
    expect(cells).toHaveLength(9);
  });

  it("renders diagonal values as 1.00", () => {
    render(<CorrelationMatrix {...WIDGET_PROPS} />);
    const cells = screen.getAllByTestId("corr-cell");
    // Diagonal cells (index 0, 4, 8) should be 1.00
    const diagonalValues = [cells[0], cells[4], cells[8]].map(
      (c) => c.textContent,
    );
    expect(diagonalValues).toEqual(["1.00", "1.00", "1.00"]);
  });

  it("renders pre-computed correlation matrix when analytics provides one", () => {
    const dataWithMatrix = {
      strategies: MOCK_STRATEGIES,
      analytics: {
        correlation_matrix: {
          s1: { s1: 1, s2: 0.45, s3: -0.32 },
          s2: { s1: 0.45, s2: 1, s3: 0.12 },
          s3: { s1: -0.32, s2: 0.12, s3: 1 },
        },
      },
    };
    render(
      <CorrelationMatrix
        data={dataWithMatrix}
        timeframe="YTD"
        width={4}
        height={3}
      />,
    );
    const cells = screen.getAllByTestId("corr-cell");
    expect(cells).toHaveLength(9);
    // Check a specific off-diagonal value
    expect(cells[1].textContent).toBe("0.45");
    expect(cells[2].textContent).toBe("-0.32");
  });
});
