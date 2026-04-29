import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHART_ACCENT } from "./chart-tokens";

/**
 * Phase 14b-03 Task 1 — RollingVolatilityChart unit tests.
 *
 * Mirrors the recharts mock pattern used by RollingMetrics.test.tsx:
 * pass-through Recharts primitives so we can assert on the rendered
 * <Line> / <XAxis> / <YAxis> props (jsdom Recharts has 0×0 dimensions
 * and otherwise renders nothing).
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
    const tick = (props.tick ?? {}) as Record<string, unknown>;
    return (
      <div
        data-testid="x-axis"
        data-tick-font-size={String(tick.fontSize ?? "")}
        data-tick-font-family={String(tick.fontFamily ?? "")}
        data-tick-fill={String(tick.fill ?? "")}
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
        data-formatter-sample={formatter ? formatter(0.21) : ""}
      />
    );
  };
  YAxis.displayName = "RechartsMockYAxis";
  const NullComponent = () => null;
  NullComponent.displayName = "RechartsMockNull";
  return {
    ResponsiveContainer: makePassthrough("ResponsiveContainer"),
    LineChart: makePassthrough("LineChart"),
    Line,
    XAxis,
    YAxis,
    Tooltip: NullComponent,
    Legend: NullComponent,
  };
});

import { RollingVolatilityChart } from "./RollingVolatilityChart";

describe("RollingVolatilityChart — Phase 14b-03 Task 1", () => {
  const sample = [
    { date: "2024-01-01", value: 0.21 },
    { date: "2024-01-02", value: 0.18 },
  ];

  it("Test 1: renders single Line with stroke=CHART_ACCENT, strokeWidth=1.5", () => {
    const { getAllByTestId } = render(<RollingVolatilityChart data={sample} />);
    const lines = getAllByTestId("line");
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute("data-stroke")).toBe(CHART_ACCENT);
    expect(lines[0].getAttribute("data-stroke-width")).toBe("1.5");
    expect(lines[0].getAttribute("data-data-key")).toBe("value");
  });

  it("Test 1b: returns null on empty data", () => {
    const { container } = render(<RollingVolatilityChart data={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("Test 2: XAxis + YAxis spread CHART_TICK_STYLE; Y-formatter renders percent", () => {
    const { getByTestId } = render(<RollingVolatilityChart data={sample} />);
    const x = getByTestId("x-axis");
    const y = getByTestId("y-axis");
    expect(x.getAttribute("data-tick-font-size")).toBe("12");
    expect(x.getAttribute("data-tick-tabular")).toBe("tabular-nums");
    expect(y.getAttribute("data-tick-tabular")).toBe("tabular-nums");
    expect(y.getAttribute("data-formatter-sample")).toBe("21%");
  });

  it("Test 9: ResponsiveContainer wraps the chart at height=250", () => {
    // The mock makes ResponsiveContainer render its children directly; we
    // assert the source contains the height prop literal (and width 100%).
    const src = readFileSync(
      resolve(process.cwd(), "src/components/charts/RollingVolatilityChart.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/<ResponsiveContainer[^>]*height=\{?250\}?/);
    expect(src).toMatch(/width="100%"/);
  });

  it("Test 10: outer wrapper carries role=img + aria-label='Rolling volatility'", () => {
    const { container } = render(<RollingVolatilityChart data={sample} />);
    const wrapper = container.querySelector('[role="img"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("aria-label")).toBe("Rolling volatility");
  });

  it("Test 8: source file has zero inline tick={{ ... fontSize literals", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/charts/RollingVolatilityChart.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/tick=\{\{[^}]*fontSize/);
  });
});
