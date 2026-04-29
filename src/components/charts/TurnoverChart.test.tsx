import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CHART_ACCENT } from "./chart-tokens";

/**
 * Phase 14b-05 Task 1 — TurnoverChart unit tests.
 *
 * Single-line LineChart, height=200, Y-axis renders percent with 1 decimal:
 * `(v) => (v * 100).toFixed(1) + '%'`. Returns null on empty data.
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
      data-data-key={String(props.dataKey ?? "")}
    />
  );
  Line.displayName = "RechartsMockLine";
  const ResponsiveContainer = (props: {
    children?: React.ReactNode;
    height?: number;
  }) => (
    <div data-testid="responsive-container" data-height={String(props.height ?? "")}>
      {props.children}
    </div>
  );
  ResponsiveContainer.displayName = "RechartsMockResponsiveContainer";
  const XAxis = (props: Record<string, unknown>) => {
    const tick = (props.tick ?? {}) as Record<string, unknown>;
    return (
      <div
        data-testid="x-axis"
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
        data-formatter-sample={formatter ? formatter(0.21) : ""}
      />
    );
  };
  YAxis.displayName = "RechartsMockYAxis";
  const NullComponent = () => null;
  NullComponent.displayName = "RechartsMockNull";
  return {
    ResponsiveContainer,
    LineChart: makePassthrough("LineChart"),
    Line,
    XAxis,
    YAxis,
    Tooltip: NullComponent,
    Legend: NullComponent,
  };
});

import { TurnoverChart } from "./TurnoverChart";

describe("TurnoverChart — Phase 14b-05 Task 1", () => {
  const sample = [
    { date: "2024-01-01", value: 0.21 },
    { date: "2024-01-02", value: 0.19 },
    { date: "2024-01-03", value: 0.25 },
  ];

  it("Test 7: renders single Line with stroke=CHART_ACCENT, strokeWidth=1.5", () => {
    const { getAllByTestId } = render(<TurnoverChart data={sample} />);
    const lines = getAllByTestId("line");
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute("data-stroke")).toBe(CHART_ACCENT);
    expect(lines[0].getAttribute("data-stroke-width")).toBe("1.5");
  });

  it("Test 7b: returns null on empty data", () => {
    const { container } = render(<TurnoverChart data={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("Test 8: ResponsiveContainer height=200; axes spread CHART_TICK_STYLE; Y-formatter renders percent with 1 decimal", () => {
    const { getByTestId } = render(<TurnoverChart data={sample} />);
    expect(getByTestId("responsive-container").getAttribute("data-height")).toBe("200");
    expect(getByTestId("x-axis").getAttribute("data-tick-font-size")).toBe("12");
    expect(getByTestId("x-axis").getAttribute("data-tick-tabular")).toBe("tabular-nums");
    expect(getByTestId("y-axis").getAttribute("data-tick-font-size")).toBe("12");
    expect(getByTestId("y-axis").getAttribute("data-tick-tabular")).toBe("tabular-nums");
    // (0.21 * 100).toFixed(1) + '%' = "21.0%"
    expect(getByTestId("y-axis").getAttribute("data-formatter-sample")).toBe("21.0%");
  });

  it("Test 9: outer wrapper has role='img' + aria-label='Daily turnover as percent of NAV'", () => {
    const { container } = render(<TurnoverChart data={sample} />);
    const wrapper = container.querySelector('[role="img"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("aria-label")).toBe(
      "Daily turnover as percent of NAV",
    );
  });

  it("Test 10: source has zero inline tick={{ ... fontSize literals", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/charts/TurnoverChart.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/tick=\{\{[^}]*fontSize/);
  });
});
