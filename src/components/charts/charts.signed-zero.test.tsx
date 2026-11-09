import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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

import { ReturnQuantiles } from "./ReturnQuantiles";
import { ReturnHistogram } from "./ReturnHistogram";
import { RollingSortinoChart } from "./RollingSortinoChart";
import { RollingMetrics } from "./RollingMetrics";

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

