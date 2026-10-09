import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * Phase 170.5 plan 03 (D-03, D-06) — the exposure axis unit.
 *
 * The producer (ExposurePoint in analytics-service position_reconstruction.py)
 * writes USD notional, rounded to cents. The chart used to multiply by 100 and
 * print a percent, so $53,505.06 read "5350506%". The sibling test file's
 * recharts mock DROPS `tickFormatter` and `<Tooltip>` entirely, which is why
 * that shipped: nothing ever called the formatter. This file's mock CALLS both
 * with known producer values and records what they return.
 */

const ticks: { value: number; text: string }[] = [];
let tooltipFormatter:
  | ((v: unknown, name: unknown) => [string, string])
  | null = null;

vi.mock("recharts", () => {
  const pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Nil = () => null;
  return {
    ResponsiveContainer: pass,
    ComposedChart: pass,
    Area: Nil,
    Line: Nil,
    XAxis: Nil,
    Legend: Nil,
    ReferenceLine: Nil,
    Tooltip: Nil,
    YAxis: (props: { tickFormatter?: (v: number) => string }) => {
      for (const value of [53505.06, -48544.8]) {
        ticks.push({ value, text: props.tickFormatter!(value) });
      }
      return null;
    },
  };
});
vi.mock("./TouchTooltip", () => ({
  TouchTooltip: (props: {
    formatter: (v: unknown, name: unknown) => [string, string];
  }) => {
    tooltipFormatter = props.formatter;
    return null;
  },
}));

import { NetGrossExposureChart } from "./NetGrossExposureChart";

// Producer-shaped USD notional, not a ratio.
const DATA = [
  { date: "2026-05-27", gross: 53505.06, net: 53505.06 },
  { date: "2026-06-01", gross: 18164.46, net: -48544.8 },
];

beforeEach(() => {
  ticks.length = 0;
  tooltipFormatter = null;
});

describe("NetGrossExposureChart axis unit (D-03)", () => {
  it("y-axis ticks print compact dollars: 53,505.06 reads $53.5K and -48,544.80 reads -$48.5K", () => {
    render(<NetGrossExposureChart data={DATA} />);
    expect(ticks.map((t) => t.text)).toEqual(["$53.5K", "-$48.5K"]);
  });

  it("tooltip prints whole dollars, and a non-finite value reads an em dash", () => {
    render(<NetGrossExposureChart data={DATA} />);
    expect(tooltipFormatter).not.toBeNull();
    expect(tooltipFormatter!(53505.06, "Gross")).toEqual(["$53,505", "Gross"]);
    expect(tooltipFormatter!(Number.NaN, "Net")).toEqual(["—", "Net"]);
  });

  it("nothing the chart formats is a percent", () => {
    render(<NetGrossExposureChart data={DATA} />);
    const all = [
      ...ticks.map((t) => t.text),
      ...(tooltipFormatter!(53505.06, "Gross") as string[]),
      ...(tooltipFormatter!(-48544.8, "Net") as string[]),
    ];
    for (const s of all) expect(s).not.toContain("%");
  });

  it("the role=img wrapper names the unit", () => {
    const { container } = render(<NetGrossExposureChart data={DATA} />);
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "Net and gross exposure over time, USD notional",
    );
  });
});
