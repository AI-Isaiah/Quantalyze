import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHART_ACCENT, CHART_TICK_STYLE } from "./chart-tokens";
import { EdgeFitXTick } from "./EdgeFitXTick";

/**
 * Phase 14b-03 Task 1 — RollingSortinoChart unit tests. Identical structure
 * to the Volatility chart but YAxis formatter renders unitless ratio
 * (v.toFixed(2)) — Sortino is a ratio, not a percent.
 */

vi.mock("recharts", () => {
  function makePassthrough(name: string) {
    const Component = ({ children }: { children?: React.ReactNode }) => (
      <div data-recharts={name}>{children}</div>
    );
    Component.displayName = `RechartsMock(${name})`;
    return Component;
  }
  const Line = (props: Record<string, unknown>) => (
    <div
      data-testid="line"
      data-stroke={String(props.stroke ?? "")}
      data-stroke-width={String(props.strokeWidth ?? "")}
      data-stroke-dasharray={String(props.strokeDasharray ?? "")}
      data-data-key={String(props.dataKey ?? "")}
    />
  );
  Line.displayName = "RechartsMockLine";
  const XAxis = (props: Record<string, unknown>) => {
    // 2026-10-21 (Phase 170.1.3 NARROWCHARTS plan 03, D-03b): the XAxis `tick` is now an
    // `<EdgeFitXTick {...CHART_TICK_STYLE} />` element. Resolve the style from the element's props
    // when it is an element and from the object itself otherwise, so every assertion below keeps
    // its intent (font size, tabular numerals).
    const rawTick = props.tick;
    const tick = (React.isValidElement(rawTick)
      ? rawTick.props
      : (rawTick ?? {})) as Record<string, unknown>;
    return (
      <div
        data-testid="x-axis"
        data-tick-type={React.isValidElement(rawTick) ? (rawTick.type === EdgeFitXTick ? "EdgeFitXTick" : "other") : ""}
        data-tick-font-size={String(tick.fontSize ?? "")}
        data-tick-tabular={String(tick.fontVariantNumeric ?? "")}
      />
    );
  };
  XAxis.displayName = "RechartsMockXAxis";
  const YAxis = (props: Record<string, unknown>) => {
    const tick = (props.tick ?? {}) as Record<string, unknown>;
    const formatter = props.tickFormatter as ((v: number) => string) | undefined;
    return (
      <div
        data-testid="y-axis"
        data-tick-font-size={String(tick.fontSize ?? "")}
        data-tick-tabular={String(tick.fontVariantNumeric ?? "")}
        data-formatter-sample={formatter ? formatter(1.234) : ""}
      />
    );
  };
  YAxis.displayName = "RechartsMockYAxis";
  const NullComponent = () => null;
  NullComponent.displayName = "RechartsMockNull";
  return {
    ResponsiveContainer: makePassthrough("ResponsiveContainer"),
    // RollingXAxis reads the chart context; outside a real chart both hooks are undefined.
    useChartWidth: () => undefined,
    usePlotArea: () => undefined,
    LineChart: makePassthrough("LineChart"),
    Line,
    XAxis,
    YAxis,
    Tooltip: NullComponent,
    Legend: NullComponent,
  };
});

import { RollingSortinoChart } from "./RollingSortinoChart";

describe("RollingSortinoChart — Phase 14b-03 Task 1", () => {
  const sample = [
    { date: "2024-01-01", value: 1.234 },
    { date: "2024-01-02", value: 1.5 },
  ];

  it("Test 3: renders single Line with stroke=CHART_ACCENT, strokeWidth=1.5", () => {
    const { getAllByTestId } = render(<RollingSortinoChart data={sample} />);
    const lines = getAllByTestId("line");
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute("data-stroke")).toBe(CHART_ACCENT);
    expect(lines[0].getAttribute("data-stroke-width")).toBe("1.5");
  });

  it("Test 3b: returns null on empty data", () => {
    const { container } = render(<RollingSortinoChart data={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("Test 4: axes spread CHART_TICK_STYLE; Y-formatter renders 2-decimal ratio (no %)", () => {
    const { getByTestId } = render(<RollingSortinoChart data={sample} />);
    expect(getByTestId("x-axis").getAttribute("data-tick-font-size")).toBe("12");
    expect(getByTestId("x-axis").getAttribute("data-tick-tabular")).toBe("tabular-nums");
    expect(getByTestId("y-axis").getAttribute("data-formatter-sample")).toBe("1.23");
  });

  it("Test 4b: the XAxis tick is an EdgeFitXTick element carrying CHART_TICK_STYLE (D-03b)", () => {
    const { getByTestId } = render(<RollingSortinoChart data={sample} />);
    const x = getByTestId("x-axis");
    expect(x.getAttribute("data-tick-type")).toBe("EdgeFitXTick");
    expect(x.getAttribute("data-tick-font-size")).toBe(String(CHART_TICK_STYLE.fontSize));
    expect(x.getAttribute("data-tick-tabular")).toBe(CHART_TICK_STYLE.fontVariantNumeric);
  });

  it("Test 9: source contains height={250} ResponsiveContainer", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/charts/RollingSortinoChart.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/<ResponsiveContainer[^>]*height=\{?250\}?/);
  });

  it("Test 10: outer wrapper carries role=img + aria-label='Rolling Sortino'", () => {
    const { container } = render(<RollingSortinoChart data={sample} />);
    const wrapper = container.querySelector('[role="img"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("aria-label")).toBe("Rolling Sortino");
  });

  it("Test 8: source file has zero inline tick={{ ... fontSize literals", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/charts/RollingSortinoChart.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/tick=\{\{[^}]*fontSize/);
  });
});
