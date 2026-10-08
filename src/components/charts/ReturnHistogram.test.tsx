import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ReturnHistogram } from "./ReturnHistogram";

/**
 * Phase 14b-02 / DESIGN-01 — ReturnHistogram identity audit.
 *
 * Tests:
 *   1. Positive-value bin Cell uses fill="#15803D" (NOT legacy emerald #059669)
 *   2. Negative-value bin Cell uses fill="#DC2626"
 *   3. XAxis + YAxis tick prop spreads CHART_TICK_STYLE (no inline {fontSize, fill} literal)
 *   4. benchmarkReturns overlay renders a SECOND Bar series with CHART_TEXT_MUTED + 0.4 opacity
 *   5. Without benchmarkReturns, only one Bar series renders
 */

// Recharts ResponsiveContainer collapses to zero size in JSDOM. Capture
// the rendered children plus the props passed to XAxis/YAxis/Cell so we
// can assert on them without an actual SVG paint.
interface CapturedNode {
  type: string;
  props: Record<string, unknown>;
}
const captured: CapturedNode[] = [];

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  // Replacement primitives that record their props.
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
    BarChart: Recorder("BarChart"),
    XAxis: Recorder("XAxis"),
    YAxis: Recorder("YAxis"),
    Tooltip: Recorder("Tooltip"),
    Bar: Recorder("Bar"),
    Cell: Recorder("Cell"),
  };
});

function makeReturns(n: number, fn: (i: number) => number): { date: string; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
    value: fn(i),
  }));
}

describe("ReturnHistogram — DESIGN-01 identity (14b-02)", () => {
  it("Test 1+2: positive bin Cell fill='#15803D', negative bin Cell fill='#DC2626'", () => {
    captured.length = 0;
    // Build cumulative equity that produces both positive and negative
    // daily returns: 1.0 → 1.05 → 0.95 → 1.10 → ... over 30 points.
    const series = makeReturns(30, (i) => 1 + Math.sin(i / 3) * 0.1);
    render(<ReturnHistogram returns={series} />);
    const cells = captured.filter((c) => c.type === "Cell");
    const fills = new Set(cells.map((c) => c.props.fill as string));
    expect(fills.has("#15803D")).toBe(true);
    expect(fills.has("#DC2626")).toBe(true);
    // Negative legacy hex must NOT appear.
    expect(fills.has("#059669")).toBe(false);
  });

  it("Test 3: XAxis + YAxis tick prop is the shared CHART_TICK_STYLE object", () => {
    captured.length = 0;
    const series = makeReturns(30, (i) => 1 + (i % 5) * 0.01);
    render(<ReturnHistogram returns={series} />);
    const xAxis = captured.find((c) => c.type === "XAxis");
    const yAxis = captured.find((c) => c.type === "YAxis");
    const xTick = xAxis?.props.tick as { fill?: string; fontSize?: number; fontFamily?: string } | undefined;
    const yTick = yAxis?.props.tick as { fill?: string; fontSize?: number; fontFamily?: string } | undefined;
    expect(xTick?.fill).toBe("#64748B");
    expect(xTick?.fontSize).toBe(12);
    expect(yTick?.fill).toBe("#64748B");
    expect(yTick?.fontSize).toBe(12);
  });

  it("Test 4: benchmarkReturns overlay renders second Bar with CHART_TEXT_MUTED + 0.4 opacity", () => {
    captured.length = 0;
    const series = makeReturns(30, (i) => 1 + (i % 5) * 0.01);
    const benchmark = makeReturns(30, (i) => 1 + (i % 4) * 0.005);
    render(<ReturnHistogram returns={series} benchmarkReturns={benchmark} />);
    const bars = captured.filter((c) => c.type === "Bar");
    expect(bars.length).toBe(2);
    const bmBarIdx = bars.findIndex((b) => b.props.dataKey === "benchmarkCount");
    expect(bmBarIdx).toBeGreaterThanOrEqual(0);
    // Cells under the benchmark Bar — find Cells with key prefix bm-
    const bmCells = captured.filter(
      (c) => c.type === "Cell" && c.props.fill === "#94A3B8",
    );
    expect(bmCells.length).toBeGreaterThan(0);
    expect(bmCells[0].props.fillOpacity).toBe(0.4);
  });

  it("Test 5: without benchmarkReturns, only one Bar series renders", () => {
    captured.length = 0;
    const series = makeReturns(30, (i) => 1 + (i % 5) * 0.01);
    render(<ReturnHistogram returns={series} />);
    const bars = captured.filter((c) => c.type === "Bar");
    expect(bars.length).toBe(1);
    expect(bars[0].props.dataKey).toBe("count");
  });
});

/**
 * Phase 164.6.6.2.2 review WR-05 residual: the histogram differences the stored
 * CURVE into daily returns. It must read the curve by its method (the simple
 * curve is differenced, not divided) and must not fabricate a 0 return from a
 * non-positive level. Expected values are independent of the implementation:
 * the increments are chosen here, and the histogram is read off them.
 */
describe("ReturnHistogram — curve differencing (WR-05)", () => {
  /** 14 unique ascending dates. */
  const dated = (levels: number[]) =>
    levels.map((value, i) => ({
      date: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      value,
    }));

  const histogramData = () => {
    const chart = captured.find((c) => c.type === "BarChart");
    return (chart?.props.data ?? []) as { label: string; count: number }[];
  };

  it("simple curve: the lowest bin edge is the smallest INCREMENT, not an increment over the level", () => {
    captured.length = 0;
    // Increments are +0.10 every day except one -0.05 day (the minimum), so the
    // curve rises to about 2.2 and a ratio reading would give about -2.3%.
    const increments = Array.from({ length: 14 }, (_, i) => (i === 9 ? -0.05 : 0.1));
    const levels = [1];
    for (const inc of increments) levels.push(levels[levels.length - 1] + inc);
    render(<ReturnHistogram returns={dated(levels)} curveMethod="simple" />);
    const data = histogramData();
    expect(data[0].label).toBe("-5.0%");
    expect(data.reduce((a, d) => a + d.count, 0)).toBe(increments.length);
  });

  it("geometric curve with a zero level: the unusable days are absent, never a fabricated 0 return", () => {
    captured.length = 0;
    // 14 levels, one of them 0: the day INTO the zero and the day OUT of it
    // have no defined ratio, so 13 pairs leave 11 returns.
    const levels = [1, 1.02, 1.01, 1.04, 1.03, 0, 1.05, 1.06, 1.04, 1.07, 1.05, 1.08, 1.06, 1.09];
    render(<ReturnHistogram returns={dated(levels)} />);
    const data = histogramData();
    expect(data.reduce((a, d) => a + d.count, 0)).toBe(levels.length - 1 - 2);
  });

  it("renders nothing when no day has a usable pair", () => {
    captured.length = 0;
    const { container } = render(<ReturnHistogram returns={dated(Array(14).fill(0))} />);
    expect(container.innerHTML).toBe("");
  });
});
