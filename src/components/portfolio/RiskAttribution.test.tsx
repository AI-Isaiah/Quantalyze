import type React from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RiskAttribution } from "./RiskAttribution";
import { adaptPortfolioAnalytics } from "@/lib/portfolio-analytics-adapter";
import complete from "@/__tests__/fixtures/portfolio-analytics/complete.json";

type Captured = Record<string, unknown>;

// 169 D-49 / PATTERNS B4: the chart's props are recorded so the stacked bar's
// unit can be asserted against its axis domain and its tooltip. The components
// still render nothing (no measured layout in jsdom); BarChart and
// ResponsiveContainer pass their children through.
const captured = vi.hoisted(() => ({
  barChart: [] as Record<string, unknown>[],
  xAxis: [] as Record<string, unknown>[],
  tooltip: [] as Record<string, unknown>[],
}));

vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const NullComponent = () => null;
  const BarChart = (props: Captured & { children?: React.ReactNode }) => {
    captured.barChart.push(props);
    return <div>{props.children}</div>;
  };
  const XAxis = (props: Captured) => {
    captured.xAxis.push(props);
    return null;
  };
  return {
    ResponsiveContainer: Passthrough,
    BarChart,
    Bar: NullComponent,
    XAxis,
    YAxis: NullComponent,
  };
});
vi.mock("@/components/charts/TouchTooltip", () => ({
  TouchTooltip: (props: Captured) => {
    captured.tooltip.push(props);
    return null;
  },
}));

beforeEach(() => {
  captured.barChart.length = 0;
  captured.xAxis.length = 0;
  captured.tooltip.length = 0;
});

/** The last render's stacked-bar datum: `{ label, [strategy_name]: plotted value }`. */
function plottedDatum(): Record<string, string | number> {
  const props = captured.barChart.at(-1);
  expect(props).toBeDefined();
  const data = props?.data as Record<string, string | number>[];
  expect(data).toHaveLength(1);
  return data[0];
}

/** The producer's rows, parsed exactly as `/portfolios/[id]` parses them. */
function producerRows() {
  const parsed = adaptPortfolioAnalytics(complete);
  const rows = parsed?.risk_decomposition;
  if (!rows || rows.length !== 3) {
    throw new Error("complete.json no longer carries the three-row risk_decomposition this test reads");
  }
  return rows;
}

/** Strategy | Weight % | Risk % | Standalone Vol | Assessment, for one strategy's row. */
function cellsOf(strategyName: string): HTMLElement[] {
  const row = screen.getByText(strategyName).closest("tr");
  expect(row).not.toBeNull();
  return within(row as HTMLElement).getAllByRole("cell");
}

/**
 * 169 D-49 (routed 2026-09-26, R1). The producer
 * (`analytics-service/services/portfolio_risk.py` `compute_risk_decomposition`,
 * `analytics-service/routers/portfolio.py`) sends `marginal_risk_pct` and
 * `weight_pct` in PERCENT, 0 to 100, and the adapter passes them through
 * unchanged. `formatPercent` takes a FRACTION, so a 28% risk share fed straight
 * to it rendered "+2800.00%". These rows come from the adapter's own fixture,
 * so a unit drift at the producer's end or at this component reddens here.
 * No "+" on a weight or a share. (A share is NOT unsigned, though: a hedge's
 * is negative and keeps its minus; see the IN-05 block at the end.)
 */
describe("<RiskAttribution> — the producer's percent shape (169 D-49)", () => {
  it("renders each weight and risk share once, unsigned, at 1 decimal place", () => {
    const rows = producerRows();
    render(<RiskAttribution data={rows} />);

    const expected = [
      { weight: "40.0%", share: "28.0%" },
      { weight: "35.0%", share: "58.0%" },
      { weight: "25.0%", share: "14.0%" },
    ];
    rows.forEach((row, i) => {
      const cells = cellsOf(row.strategy_name);
      expect(cells[1].textContent).toBe(expected[i].weight);
      expect(cells[2].textContent).toBe(expected[i].share);
      // The Standalone Vol cell (index 3) is left alone (D-49), so the
      // no-sign / no-double-scale checks are scoped to the two percent cells.
      for (const cell of [cells[1], cells[2]]) {
        expect(cell.textContent).not.toContain("+");
        expect(cell.textContent).not.toMatch(/\d{3,}\.\d%/);
      }
    });
  });

  it("assesses each row percent against percent: Balanced, Overweight risk, Balanced", () => {
    const rows = producerRows();
    render(<RiskAttribution data={rows} />);

    // 28 <= 40 x 1.3; 58 > 35 x 1.3 (45.5); 14 <= 25 x 1.3.
    const expected = ["Balanced", "Overweight risk", "Balanced"];
    rows.forEach((row, i) => {
      expect(cellsOf(row.strategy_name)[4].textContent).toBe(expected[i]);
    });
  });
});

/**
 * 169 D-49 / PATTERNS B4. The stacked bar, its axis and its tooltip must state
 * one unit. Before, the bar plotted the producer's percent (28 + 58 + 14 = 100)
 * against a fraction axis `[0, 1]`, and the tooltip multiplied that percent by
 * 100 again ("2800.0%").
 */
describe("<RiskAttribution> — the stacked bar states the table's unit (169 D-49)", () => {
  it("plots risk shares that fill the axis domain, and the tooltip shows the table's percent", () => {
    const rows = producerRows();
    render(<RiskAttribution data={rows} />);

    const datum = plottedDatum();
    const plotted = rows.map((row) => datum[row.strategy_name]);
    for (const v of plotted) expect(typeof v).toBe("number");

    const domain = captured.xAxis.at(-1)?.domain as [number, number];
    expect(domain).toHaveLength(2);
    const sum = (plotted as number[]).reduce((a, b) => a + b, 0);
    // The shares apportion the whole portfolio risk, so the stacked bar
    // spans the axis exactly (float tolerance for 0.28 + 0.58 + 0.14).
    expect(sum).toBeGreaterThanOrEqual(domain[0]);
    expect(sum).toBeLessThanOrEqual(domain[1] + 1e-9);
    expect(sum).toBeCloseTo(domain[1], 9);

    const formatter = captured.tooltip.at(-1)?.formatter as (
      value: unknown,
      name: string,
    ) => [string, string];
    expect(typeof formatter).toBe("function");
    const expectedShare = ["28.0%", "58.0%", "14.0%"];
    rows.forEach((row, i) => {
      const [text, name] = formatter(datum[row.strategy_name], row.strategy_name);
      expect(name).toBe(row.strategy_name);
      expect(text).toBe(expectedShare[i]);
      expect(text).toBe(cellsOf(row.strategy_name)[2].textContent);
    });
  });
});

/**
 * 166.1 D7 (founder 2026-09-26) / round-1 SFH MEDIUM-2. A portfolio that
 * carries no risk (two constant yields, or all-zero legs) has no risk share to
 * apportion, so the producer emits `marginal_risk_pct: null`. The table must
 * show "—" for the share and for the assessment. Before, the share arrived as
 * 0 and the row read "+0.00%" and "Balanced": a claim about a split that does
 * not exist.
 */
describe("<RiskAttribution> — a risk share that does not exist", () => {
  it("renders a null risk share and its assessment as a colorless dash", () => {
    render(
      <RiskAttribution
        data={[
          { strategy_id: "a", strategy_name: "Yield A", marginal_risk_pct: null, weight_pct: 50, standalone_vol: 0 },
          { strategy_id: "b", strategy_name: "Yield B", marginal_risk_pct: null, weight_pct: 50, standalone_vol: 0 },
        ]}
      />,
    );
    const row = screen.getByText("Yield A").closest("tr");
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement).getAllByRole("cell");
    // Strategy | Weight % | Risk % | Standalone Vol | Assessment
    expect(cells[2].textContent).toBe("—");
    expect(cells[4].textContent).toBe("—");
    expect(within(row as HTMLElement).queryByText("Balanced")).toBeNull();
    expect(within(row as HTMLElement).queryByText("Overweight risk")).toBeNull();
    expect(cells[4].querySelector(".text-positive, .text-negative")).toBeNull();
    // Left out of the stacked bar: a gap, never a 0-width segment.
    expect(plottedDatum()).not.toHaveProperty("Yield A");
    expect(plottedDatum()).not.toHaveProperty("Yield B");
  });

  it("keeps the assessment for a real risk share", () => {
    // Percent, as the producer sends it (169 D-49): 80 > 30 x 1.3 (39) is
    // overweight; 20 <= 70 x 1.3 (91) is balanced.
    render(
      <RiskAttribution
        data={[
          { strategy_id: "a", strategy_name: "Alpha", marginal_risk_pct: 80, weight_pct: 30, standalone_vol: 0.2 },
          { strategy_id: "b", strategy_name: "Beta", marginal_risk_pct: 20, weight_pct: 70, standalone_vol: 0.1 },
        ]}
      />,
    );
    expect(cellsOf("Alpha")[4].textContent).toBe("Overweight risk");
    expect(cellsOf("Beta")[4].textContent).toBe("Balanced");
  });
});

/**
 * 2026-09-29, Phase 169 review round 1 SFH M-5. The producer's weight can be
 * None (`_safe_float(ordered_weights[i] * 100)`), and the adapter read it as
 * 0: the Weight cell said "0.0%" and `share > 0 * 1.3` marked every row with a
 * risk share "Overweight risk" in red. A weight that does not exist is the
 * em-dash, and with no weight there is nothing to compare the share against,
 * so the assessment is the colorless em-dash too (the null-share rule, 166.1
 * D7). The risk share itself is still a fact and still renders.
 */
describe("<RiskAttribution> — a weight that does not exist (169 M-5)", () => {
  it("renders a null weight and its assessment as a colorless dash, and keeps the share", () => {
    render(
      <RiskAttribution
        data={[
          { strategy_id: "a", strategy_name: "Alpha", marginal_risk_pct: 30, weight_pct: null, standalone_vol: 0.2 },
          { strategy_id: "b", strategy_name: "Beta", marginal_risk_pct: 70, weight_pct: 60, standalone_vol: 0.1 },
        ]}
      />,
    );
    const alpha = cellsOf("Alpha");
    expect(alpha[1].textContent).toBe("—");
    expect(alpha[2].textContent).toBe("30.0%");
    expect(alpha[4].textContent).toBe("—");
    expect(alpha[4].querySelector(".text-positive, .text-negative")).toBeNull();
    // Control: the row with a weight keeps its assessment (70 <= 60 x 1.3 = 78).
    expect(cellsOf("Beta")[4].textContent).toBe("Balanced");
  });
});

/**
 * 2026-09-29, Phase 169 review round 1 IN-05. A risk share is NOT an unsigned
 * domain: `compute_risk_decomposition` (analytics-service/services/
 * portfolio_risk.py) gives component_risk = w_i * (Σw)_i / σ, which is negative
 * for a strategy that offsets the book's risk. The shares still sum to 100, so
 * the others then exceed it. `{ signed: false }` only drops the "+", so the
 * minus must survive in the table cell and in the tooltip. The expected text
 * is the hyphen-minus `formatPercent` renders product-wide today (see the
 * report: DESIGN.md's percentage row asks for U+2212, which is utils.ts's).
 */
describe("<RiskAttribution> — a hedge's negative risk share (169 IN-05)", () => {
  it("renders a negative share with its minus in the table and the tooltip", () => {
    render(
      <RiskAttribution
        data={[
          { strategy_id: "a", strategy_name: "Trend", marginal_risk_pct: 112, weight_pct: 60, standalone_vol: 0.2 },
          { strategy_id: "b", strategy_name: "Hedge", marginal_risk_pct: -12, weight_pct: 40, standalone_vol: 0.15 },
        ]}
      />,
    );
    expect(cellsOf("Hedge")[2].textContent).toBe("-12.0%");
    expect(cellsOf("Trend")[2].textContent).toBe("112.0%");

    const formatter = captured.tooltip.at(-1)?.formatter as (
      value: unknown,
      name: string,
    ) => [string, string];
    const [text] = formatter(plottedDatum()["Hedge"], "Hedge");
    expect(text).toBe("-12.0%");
  });
});
