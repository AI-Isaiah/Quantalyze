import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CorrelationMatrix } from "./CorrelationMatrix";
import { VarExpectedShortfall } from "./VarExpectedShortfall";
import { RiskDecomposition } from "./RiskDecomposition";
import { TailRisk } from "./TailRisk";

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
  timeframe: "1YTD" as const,
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
        timeframe="1YTD"
        width={4}
        height={3}
      />,
    );
    expect(screen.getByTestId("tail-risk")).toBeInTheDocument();
    expect(screen.getByText(/6 events/)).toBeInTheDocument();
    expect(screen.queryByText(/No extreme loss/i)).toBeNull();
  });

  // M-0218 — the P5/P1 percentile thresholds must actually appear. They used
  // to be <ReferenceLine x={percentile-string}> on a CATEGORY axis, which
  // recharts silently discards (the string never matches a band-scale bin
  // label), so the guides rendered nothing on every histogram. They now live
  // as header text; this pins their presence so the dead-on-arrival regression
  // can't return. Neuter: deleting the P5/P1 header spans fails these.
  it("M-0218: TailRisk surfaces the P5 and P1 percentile thresholds in the histogram header", () => {
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
        timeframe="1YTD"
        width={4}
        height={3}
      />,
    );
    // Each threshold renders as "P5 -x.x%" / "P1 -x.x%" — assert the label AND
    // an accompanying numeric, so a bare "P5" string couldn't pass vacuously.
    expect(screen.getByText(/P5\s*-?\d/)).toBeInTheDocument();
    expect(screen.getByText(/P1\s*-?\d/)).toBeInTheDocument();
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
        timeframe="1YTD"
        width={4}
        height={3}
      />,
    );
    expect(screen.queryByTestId("tail-risk")).toBeNull();
    expect(
      screen.getByText(/No extreme loss events detected/i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: empty data handling
// ---------------------------------------------------------------------------

describe("Risk Widgets — empty data handling", () => {
  const emptyProps = {
    data: { strategies: [], analytics: null },
    timeframe: "1YTD" as const,
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

  // M-0215 — pairwise correlation must align returns by calendar DATE, not by
  // raw array index. When two strategies have offset/gapped date ranges,
  // index-pairing correlates returns from different days → a wrong number.
  it("M-0215: aligns returns by date (not index) for offset-range strategies", () => {
    const mk = (pts: { date: string; value: number }[], alias: string) => ({
      alias,
      strategy: { strategy_analytics: { daily_returns: pts } },
    });
    // S1 spans 01-01..01-03 (rising); S2 spans 01-02..01-04 (a tent).
    // Overlap = {01-02, 01-03}: there S1 rises 0.02→0.03 while S2 falls
    // 0.06→0.02 → perfect NEGATIVE correlation (-1.00) when paired by date.
    // The old index-pairing bug correlated S1=[0.01,0.02,0.03] against
    // S2=[0.06,0.02,0.06], which evaluates to 0.00 — a measurably different
    // cell, so this fixture discriminates the fix from the bug.
    const dataOffset = {
      strategies: [
        mk(
          [
            { date: "2024-01-01", value: 0.01 },
            { date: "2024-01-02", value: 0.02 },
            { date: "2024-01-03", value: 0.03 },
          ],
          "S1",
        ),
        mk(
          [
            { date: "2024-01-02", value: 0.06 },
            { date: "2024-01-03", value: 0.02 },
            { date: "2024-01-04", value: 0.06 },
          ],
          "S2",
        ),
      ],
      analytics: null,
    };
    render(
      <CorrelationMatrix
        data={dataOffset}
        timeframe="1YTD"
        width={4}
        height={3}
      />,
    );
    const cells = screen.getAllByTestId("corr-cell");
    // 2x2: [0]=diag, [1]=corr(S1,S2), [2]=corr(S2,S1), [3]=diag.
    expect(cells).toHaveLength(4);
    expect(cells[0].textContent).toBe("1.00");
    expect(cells[3].textContent).toBe("1.00");
    // Date-aligned off-diagonal = -1.00 (index-pairing bug would render 0.00).
    expect(cells[1].textContent).toBe("-1.00");
    expect(cells[2].textContent).toBe("-1.00");
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
        timeframe="1YTD"
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
