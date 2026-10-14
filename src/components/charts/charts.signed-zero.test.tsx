import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * Phase 170.6 DISPLAYPOLISH plan 06 (D-02, D-03, D-06) — the shared chart components print and
 * fill on the sign of the value ROUNDED to the precision they print. Every expected string below
 * is typed by hand; none is computed by the code under test.
 *
 *   - Heatmap text follows the rule; heatmap FILLS do not change (D-06). The fill cases pin
 *     today's strings, so a "fix" that moved a fill goes red.
 *   - Recharts ticks / tooltips are read by recording the props the chart hands to its axis and
 *     tooltip components, then calling those formatters with a hand-typed value.
 */

// ---------------------------------------------------------------------------
// Recorders. Recharts does not lay out in jsdom, so every recharts component the charts under
// test use records its props and renders its children. TouchTooltip is recorded the same way, so
// the tooltip `formatter` the chart wires is the thing under test.
// ---------------------------------------------------------------------------
interface CapturedNode {
  type: string;
  props: Record<string, unknown>;
}
const captured = vi.hoisted(() => [] as CapturedNode[]);

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  function Recorder(name: string) {
    return function Recorded(props: Record<string, unknown>) {
      captured.push({ type: name, props });
      const children = props.children as React.ReactNode | undefined;
      return React.createElement("div", { "data-recharts": name }, children);
    };
  }
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 240 }}>{children}</div>
    ),
    AreaChart: Recorder("AreaChart"),
    Area: Recorder("Area"),
    BarChart: Recorder("BarChart"),
    Bar: Recorder("Bar"),
    Cell: Recorder("Cell"),
    LineChart: Recorder("LineChart"),
    Line: Recorder("Line"),
    XAxis: Recorder("XAxis"),
    YAxis: Recorder("YAxis"),
    Legend: Recorder("Legend"),
    ReferenceLine: Recorder("ReferenceLine"),
  };
});

vi.mock("./TouchTooltip", () => ({
  TouchTooltip: (props: Record<string, unknown>) => {
    captured.push({ type: "TouchTooltip", props });
    return null;
  },
}));

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { MonthlyHeatmap } from "./MonthlyHeatmap";
import { DailyHeatmap } from "./DailyHeatmap";
import { ReturnQuantiles } from "./ReturnQuantiles";
import { DrawdownChart } from "./DrawdownChart";
import { PRICE_FORMATTER } from "./EquityCurve";
import { YearlyReturns } from "./YearlyReturns";
import { ReturnHistogram } from "./ReturnHistogram";
import { RollingAlphaBetaChart } from "./RollingAlphaBetaChart";
import { RollingSortinoChart } from "./RollingSortinoChart";
import { RollingMetrics } from "./RollingMetrics";
import { CorrelationWithBenchmark } from "./CorrelationWithBenchmark";
import type { StrategyAnalytics } from "@/lib/types";

type TickFormatter = (v: number) => string;
type TooltipFormatter = (v: unknown, name: unknown) => [string, string];

/** The props the chart last handed to the first recorded node of this type. */
function propsOf(type: string): Record<string, unknown> {
  const node = captured.find((c) => c.type === type);
  if (!node) throw new Error(`no recorded ${type}`);
  return node.props;
}

beforeEach(() => {
  captured.length = 0;
});

// ---------------------------------------------------------------------------
// Task 1 — heatmap text and quantile labels
// ---------------------------------------------------------------------------
describe("MonthlyHeatmap — printed text on the rounded sign, fills unchanged (D-02, D-06)", () => {
  const data = { "2024": { Jan: -0.0004, Feb: -0.012, Mar: 0.03 } };

  it("a month of -0.0004 prints '0.0%' in the cell and its title, never '-0.0%'", () => {
    const { container } = render(<MonthlyHeatmap data={data} />);
    const cell = container.querySelector('div[title="0.0%"]');
    expect(cell).not.toBeNull();
    expect(cell?.textContent).toBe("0.0%");
    expect(container.querySelector('div[title="-0.0%"]')).toBeNull();
    expect(container.textContent).not.toMatch(/-0\.0%/);
  });

  it("a month of -0.012 still prints '-1.2%' and a month of 0.03 prints '3.0%'", () => {
    const { container } = render(<MonthlyHeatmap data={data} />);
    expect(container.querySelector('div[title="-1.2%"]')?.textContent).toBe("-1.2%");
    expect(container.querySelector('div[title="3.0%"]')?.textContent).toBe("3.0%");
  });

  it("D-06: the fills are the strings they were before this plan", () => {
    const { container } = render(<MonthlyHeatmap data={data} />);
    // -0.0004 and -0.012 both land in the 'negLight' bucket (#FEE2E2); 0.03 in 'posMid' (#86EFAC).
    // Value cells are the only 'tabular-nums' divs, in Jan, Feb, Mar order.
    const [jan, feb, mar] = Array.from(container.querySelectorAll<HTMLElement>("div.tabular-nums"));
    expect(jan.style.backgroundColor).toBe("rgb(254, 226, 226)");
    expect(feb.style.backgroundColor).toBe("rgb(254, 226, 226)");
    expect(mar.style.backgroundColor).toBe("rgb(134, 239, 172)");
  });
});

describe("DailyHeatmap — printed text on the rounded sign, fills unchanged (D-02, D-06)", () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => {
    getContextSpy.mockRestore();
  });

  const small = [
    { date: "2024-03-15", value: -0.00004 },
    { date: "2024-03-16", value: -0.0123 },
  ];

  it("SVG: a day of -0.00004 reads '2024-03-15: 0.00%', a day of -0.0123 reads '2024-03-16: -1.23%'", () => {
    const { container } = render(<DailyHeatmap data={small} />);
    const titles = Array.from(container.querySelectorAll("svg title")).map((t) => t.textContent);
    expect(titles).toEqual(["2024-03-15: 0.00%", "2024-03-16: -1.23%"]);
  });

  it("SVG: the cell fills are the strings they were before this plan (both in the -2%..0 bucket)", () => {
    const { container } = render(<DailyHeatmap data={small} />);
    expect(container.querySelector('[data-cell="2024-03-15"]')?.getAttribute("fill")).toBe("#FEE2E2");
    expect(container.querySelector('[data-cell="2024-03-16"]')?.getAttribute("fill")).toBe("#FEE2E2");
  });

  it("Canvas branch: the screen-reader table cell reads '2024-01-01: 0.00%' for -0.00004", () => {
    // 400 consecutive days from 2024-01-01 is over the 365-cell SVG threshold.
    const big = Array.from({ length: 400 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      return { date: d.toISOString().slice(0, 10), value: i === 0 ? -0.00004 : 0.01 };
    });
    const { container } = render(<DailyHeatmap data={big} />);
    expect(container.querySelector("canvas")).not.toBeNull();
    const first = container.querySelector("table td");
    expect(first?.textContent).toBe("2024-01-01: 0.00%");
    expect(container.querySelector("table")?.textContent).not.toMatch(/-0\.00%/);
  });
});

describe("ReturnQuantiles — y-axis labels on the rounded sign (D-02)", () => {
  it("a quantile of -0.0004 labels '0.0%', never '-0.0%'", () => {
    // min = -0.0004, so the frac-0 gridline value is exactly -0.0004.
    const { container } = render(
      <ReturnQuantiles data={{ Daily: [-0.0004, 0, 0.001, 0.002, 0.003] }} />,
    );
    const labels = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(labels).toContain("0.0%");
    expect(labels).not.toContain("-0.0%");
    expect(labels).toContain("0.3%");
  });
});

// ---------------------------------------------------------------------------
// Task 2 — drawdown, equity, yearly-return and histogram ticks, tooltips and bar fills
// ---------------------------------------------------------------------------
describe("DrawdownChart — tick and tooltip on the rounded sign (D-02)", () => {
  const series = [
    { date: "2024-01-01", value: -0.01 },
    { date: "2024-01-02", value: -0.03 },
  ];

  it("the y tick at -0.003 reads '0%' (it printed '-0%'); at -0.0342 it reads '-3%'", () => {
    render(<DrawdownChart data={series} />);
    const tick = propsOf("YAxis").tickFormatter as TickFormatter;
    expect(tick(-0.003)).toBe("0%");
    expect(tick(-0.0342)).toBe("-3%");
  });

  it("the tooltip at -0.00004 reads '0.00%'; at -0.0342 reads '-3.42%'; the series label is kept", () => {
    render(<DrawdownChart data={series} />);
    const tooltip = propsOf("TouchTooltip").formatter as TooltipFormatter;
    expect(tooltip(-0.00004, "value")).toEqual(["0.00%", "Drawdown"]);
    expect(tooltip(-0.0342, "value")).toEqual(["-3.42%", "Drawdown"]);
    expect(tooltip(-0.0342, "benchmarkDrawdown")).toEqual(["-3.42%", "BTC"]);
  });
});

describe("EquityCurve — growth formatter on the rounded sign (D-02)", () => {
  it("a level of 0.9996 reads '0.0%' (it printed '-0.0%'); 1.25 reads '25.0%'; 0.9 reads '-10.0%'", () => {
    expect(PRICE_FORMATTER(0.9996)).toBe("0.0%");
    expect(PRICE_FORMATTER(1.25)).toBe("25.0%");
    expect(PRICE_FORMATTER(0.9)).toBe("-10.0%");
  });
});

describe("YearlyReturns — tick, tooltip and bar fill on the rounded sign (D-02, D-03)", () => {
  // Annual return of a single-month year is that month's return.
  const years = {
    "2023": { Jan: -0.00004 }, // prints 0.00%
    "2024": { Jan: 0.12 },
    "2025": { Jan: -0.12 },
  };

  it("the y tick at -0.004 reads '0%' (it printed '-0%'); at 0.12 it reads '12%'", () => {
    render(<YearlyReturns monthlyReturns={years} />);
    const tick = propsOf("YAxis").tickFormatter as TickFormatter;
    expect(tick(-0.004)).toBe("0%");
    expect(tick(0.12)).toBe("12%");
  });

  it("the tooltip at -0.00004 reads '0.00%'; at 0.0834 reads '8.34%'", () => {
    render(<YearlyReturns monthlyReturns={years} />);
    const tooltip = propsOf("TouchTooltip").formatter as TooltipFormatter;
    expect(tooltip(-0.00004, "value")).toEqual(["0.00%", "Annual Return"]);
    expect(tooltip(0.0834, "value")).toEqual(["8.34%", "Annual Return"]);
  });

  it("D-03: a year printed 0.00% is filled muted; +12% is positive green; -12% is negative red", () => {
    render(<YearlyReturns monthlyReturns={years} />);
    const fills = captured.filter((c) => c.type === "Cell").map((c) => c.props.fill);
    // CHART_TEXT_MUTED, CHART_POSITIVE, CHART_NEGATIVE
    expect(fills).toEqual(["#94A3B8", "#15803D", "#DC2626"]);
  });

  it("D-03: a year of -0.004 prints '-0.40%' at 2 dp, so it stays red (only a printed zero goes muted)", () => {
    render(<YearlyReturns monthlyReturns={{ "2023": { Jan: -0.004 }, "2024": { Jan: 0.004 } }} />);
    const fills = captured.filter((c) => c.type === "Cell").map((c) => c.props.fill);
    expect(fills).toEqual(["#DC2626", "#15803D"]);
  });
});

describe("ReturnHistogram — bin label and bar fill on the rounded sign (D-02, D-03)", () => {
  /** Cumulative 'simple' curve from hand-typed daily increments, starting at level 1. */
  function curve(increments: number[]): { date: string; value: number }[] {
    let level = 1;
    const levels = [level];
    for (const inc of increments) {
      level = Number((level + inc).toFixed(10));
      levels.push(level);
    }
    return levels.map((value, i) => ({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, value }));
  }
  const histogramData = () => propsOf("BarChart").data as { label: string; value: number }[];
  const cellFills = () => captured.filter((c) => c.type === "Cell").map((c) => c.props.fill);

  it("a bin whose low edge is -0.0004 is labelled '0.0%' (it printed '-0.0%'); its centre (+0.01%) is filled muted", () => {
    // Daily returns span -0.0004 .. 0.0196 over 20 bins of width 0.001.
    const inc = [-0.0004, 0.0196, 0.01, 0.005, 0.0, 0.003, 0.001, 0.002, 0.004, 0.006, 0.008, 0.0123];
    render(<ReturnHistogram returns={curve(inc)} curveMethod="simple" />);
    const data = histogramData();
    expect(data[0].label).toBe("0.0%");
    expect(data[1].label).toBe("0.1%"); // low edge 0.0006
    expect(data[10].label).toBe("1.0%"); // low edge 0.0096
    const fills = cellFills();
    expect(fills[0]).toBe("#94A3B8"); // centre +0.0001 prints 0.0
    expect(fills[1]).toBe("#15803D"); // centre +0.0011 prints 0.1
  });

  it("a bin whose centre rounds to 0.0% is filled muted; the bins either side are red and green", () => {
    // Daily returns span -0.021 .. 0.021 over 21 bins of width 0.002: the middle bin is centred on 0.
    const inc = [-0.021, 0.021, 0.01, -0.01, 0.005, -0.005, 0.0, 0.002, -0.002, 0.003, -0.003, 0.004];
    render(<ReturnHistogram returns={curve(inc)} curveMethod="simple" bins={21} />);
    const data = histogramData();
    expect(data[0].label).toBe("-2.1%");
    expect(data[20].label).toBe("1.9%");
    const fills = cellFills();
    expect(fills).toHaveLength(21);
    expect(fills.slice(0, 10)).toEqual(Array(10).fill("#DC2626")); // centres -2.0% .. -0.1%
    expect(fills[10]).toBe("#94A3B8"); // centre 0.0
    expect(fills.slice(11)).toEqual(Array(10).fill("#15803D")); // centres +0.1% .. +2.0%
  });
});

// ---------------------------------------------------------------------------
// Task 3 — rolling-ratio and rolling-correlation ticks and tooltips
// ---------------------------------------------------------------------------
describe("RollingAlphaBetaChart — tick and tooltip on the rounded sign (D-02)", () => {
  const alpha = [
    { date: "2024-01-01", value: 0.1 },
    { date: "2024-01-02", value: -0.2 },
  ];
  const beta = [{ date: "2024-01-01", value: 0.9 }];

  it("the y tick at -0.004 reads '0.00' (it printed '-0.00'); at -0.5 it reads '-0.50'", () => {
    render(<RollingAlphaBetaChart alpha={alpha} beta={beta} />);
    const tick = propsOf("YAxis").tickFormatter as TickFormatter;
    expect(tick(-0.004)).toBe("0.00");
    expect(tick(-0.5)).toBe("-0.50");
  });

  it("the tooltip at -0.0004 reads '0.000' (it printed '-0.000'); at 0.1234 reads '0.123'; the name is kept", () => {
    render(<RollingAlphaBetaChart alpha={alpha} beta={beta} />);
    const tooltip = propsOf("TouchTooltip").formatter as TooltipFormatter;
    expect(tooltip(-0.0004, "alpha")).toEqual(["0.000", "alpha"]);
    expect(tooltip(0.1234, "beta")).toEqual(["0.123", "beta"]);
    expect(tooltip(-0.1234, "beta")).toEqual(["-0.123", "beta"]);
  });
});

describe("RollingSortinoChart — tick and tooltip on the rounded sign (D-02)", () => {
  const data = [
    { date: "2024-01-01", value: 1.5 },
    { date: "2024-01-02", value: -0.5 },
  ];

  it("the y tick and the tooltip at -0.004 both read '0.00'; at -1.234 they read '-1.23'", () => {
    render(<RollingSortinoChart data={data} />);
    const tick = propsOf("YAxis").tickFormatter as TickFormatter;
    const tooltip = propsOf("TouchTooltip").formatter as TooltipFormatter;
    expect(tick(-0.004)).toBe("0.00");
    expect(tick(-1.234)).toBe("-1.23");
    expect(tooltip(-0.004, "value")).toEqual(["0.00", "Sortino"]);
    expect(tooltip(-1.234, "value")).toEqual(["-1.23", "Sortino"]);
  });
});

describe("RollingMetrics — tooltip on the rounded sign (D-02)", () => {
  const data = {
    sharpe_30d: [
      { date: "2024-01-01", value: 1.1 },
      { date: "2024-01-02", value: -0.3 },
    ],
  };

  it("the tooltip at -0.004 reads '0.00' (it printed '-0.00'); at 1.234 reads '1.23'; the label is kept", () => {
    render(<RollingMetrics data={data} />);
    const tooltip = propsOf("TouchTooltip").formatter as TooltipFormatter;
    expect(tooltip(-0.004, "sharpe_30d")).toEqual(["0.00", "30d"]);
    expect(tooltip(1.234, "sharpe_30d")).toEqual(["1.23", "30d"]);
    expect(tooltip(-1.234, "sharpe_30d")).toEqual(["-1.23", "30d"]);
  });
});

describe("CorrelationWithBenchmark — tick and tooltip on the rounded sign (D-02)", () => {
  const analytics = {
    returns_series: null,
    metrics_json: {
      btc_rolling_correlation_90d: [
        { date: "2024-04-01", value: 0.12 },
        { date: "2024-04-02", value: -0.18 },
        { date: "2024-04-03", value: 0.22 },
      ],
    },
    computation_status: "complete",
  } as unknown as StrategyAnalytics;

  it("the tooltip at -0.0004 reads '0.000' (it printed '-0.000'); at 0.1234 reads '0.123'; NaN keeps the dash", () => {
    render(<CorrelationWithBenchmark analytics={analytics} />);
    const tooltip = propsOf("TouchTooltip").formatter as TooltipFormatter;
    expect(tooltip(-0.0004, "value")).toEqual(["0.000", "90d correlation"]);
    expect(tooltip(0.1234, "value")).toEqual(["0.123", "90d correlation"]);
    expect(tooltip(Number.NaN, "value")).toEqual(["—", "90d correlation"]);
  });

  it("the y tick at -0.04 reads '0.0' (it printed '-0.0'); at -0.5 it reads '-0.5'; at 1 it reads '1.0'", () => {
    render(<CorrelationWithBenchmark analytics={analytics} />);
    const tick = propsOf("YAxis").tickFormatter as TickFormatter;
    expect(tick(-0.04)).toBe("0.0");
    expect(tick(-0.5)).toBe("-0.5");
    expect(tick(1)).toBe("1.0");
  });
});
