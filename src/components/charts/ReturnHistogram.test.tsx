import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ReturnHistogram } from "./ReturnHistogram";

/**
 * Phase 14b-02 / DESIGN-01 — ReturnHistogram identity audit.
 *
 * Tests:
 *   1. Positive-value bin Cell uses fill="#16A34A" (NOT legacy emerald #059669)
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
  it("Test 1+2: positive bin Cell fill='#16A34A', negative bin Cell fill='#DC2626'", () => {
    captured.length = 0;
    // Build cumulative equity that produces both positive and negative
    // daily returns: 1.0 → 1.05 → 0.95 → 1.10 → ... over 30 points.
    const series = makeReturns(30, (i) => 1 + Math.sin(i / 3) * 0.1);
    render(<ReturnHistogram returns={series} />);
    const cells = captured.filter((c) => c.type === "Cell");
    const fills = new Set(cells.map((c) => c.props.fill as string));
    expect(fills.has("#16A34A")).toBe(true);
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
