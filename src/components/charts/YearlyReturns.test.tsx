import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { YearlyReturns } from "./YearlyReturns";

/**
 * Phase 14b-02 / DESIGN-01 — YearlyReturns identity audit.
 *
 * Tests:
 *   4. Positive-bar Cell fill="#16A34A" (replacing legacy #059669)
 *   5. XAxis + YAxis tick spreads CHART_TICK_STYLE — no inline {fontSize, fill, fontFamily} literal
 */

interface CapturedNode {
  type: string;
  props: Record<string, unknown>;
}
const captured: CapturedNode[] = [];

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
    BarChart: Recorder("BarChart"),
    XAxis: Recorder("XAxis"),
    YAxis: Recorder("YAxis"),
    Tooltip: Recorder("Tooltip"),
    Bar: Recorder("Bar"),
    Cell: Recorder("Cell"),
  };
});

describe("YearlyReturns — DESIGN-01 identity (14b-02)", () => {
  it("Test 4: positive Cell fill='#16A34A', negative '#DC2626' — no #059669", () => {
    captured.length = 0;
    const monthlyReturns = {
      "2023": { Jan: 0.02, Feb: 0.03, Mar: 0.01 }, // positive year
      "2024": { Jan: -0.05, Feb: -0.02, Mar: -0.01 }, // negative year
    };
    render(<YearlyReturns monthlyReturns={monthlyReturns} />);
    const cells = captured.filter((c) => c.type === "Cell");
    const fills = new Set(cells.map((c) => c.props.fill as string));
    expect(fills.has("#16A34A")).toBe(true);
    expect(fills.has("#DC2626")).toBe(true);
    expect(fills.has("#059669")).toBe(false);
  });

  it("Test 5: XAxis + YAxis tick uses CHART_TICK_STYLE", () => {
    captured.length = 0;
    const monthlyReturns = { "2023": { Jan: 0.01 } };
    render(<YearlyReturns monthlyReturns={monthlyReturns} />);
    const xAxis = captured.find((c) => c.type === "XAxis");
    const yAxis = captured.find((c) => c.type === "YAxis");
    const xTick = xAxis?.props.tick as { fill?: string; fontSize?: number; fontFamily?: string } | undefined;
    const yTick = yAxis?.props.tick as { fill?: string; fontSize?: number; fontFamily?: string } | undefined;
    expect(xTick?.fill).toBe("#64748B");
    expect(xTick?.fontSize).toBe(12);
    expect(yTick?.fill).toBe("#64748B");
    expect(yTick?.fontSize).toBe(12);
    // Y-axis should now use the centralized CHART_FONT_MONO token, NOT
    // the legacy hand-rolled "'JetBrains Mono', monospace" literal.
    expect(yTick?.fontFamily).toContain("var(--font-mono)");
  });
});
