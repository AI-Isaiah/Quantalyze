import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHART_ACCENT,
  CHART_TEXT_MUTED,
  CHART_REFERENCE_DASH,
} from "./chart-tokens";

/**
 * Phase 14b-05 Task 1 — NetGrossExposureChart unit tests.
 *
 * ComposedChart with: gross filled area (CHART_ACCENT, fillOpacity 0.2) +
 * net solid line (CHART_ACCENT, 1.5px) + reference line at y=0
 * (CHART_TEXT_MUTED, dashed). Y-axis tickFormatter renders percent.
 */

vi.mock("recharts", () => {
  function makePassthrough(name: string) {
    const Component = ({ children }: { children?: React.ReactNode }) => (
      <div data-recharts={name}>{children}</div>
    );
    Component.displayName = `RechartsMock(${name})`;
    return Component;
  }
  const Area = (props: Record<string, unknown>) => (
    <div
      data-testid="area"
      data-fill={String(props.fill ?? "")}
      data-fill-opacity={String(props.fillOpacity ?? "")}
      data-stroke={String(props.stroke ?? "")}
      data-data-key={String(props.dataKey ?? "")}
      data-name={String(props.name ?? "")}
    />
  );
  Area.displayName = "RechartsMockArea";
  const Line = (props: Record<string, unknown>) => (
    <div
      data-testid="line"
      data-stroke={String(props.stroke ?? "")}
      data-stroke-width={String(props.strokeWidth ?? "")}
      data-data-key={String(props.dataKey ?? "")}
      data-name={String(props.name ?? "")}
    />
  );
  Line.displayName = "RechartsMockLine";
  const ReferenceLine = (props: Record<string, unknown>) => (
    <div
      data-testid="reference-line"
      data-y={String(props.y ?? "")}
      data-stroke={String(props.stroke ?? "")}
      data-stroke-dasharray={String(props.strokeDasharray ?? "")}
    />
  );
  ReferenceLine.displayName = "RechartsMockReferenceLine";
  const Legend = () => <div data-testid="legend" />;
  Legend.displayName = "RechartsMockLegend";
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
    return (
      <div
        data-testid="y-axis"
        data-tick-font-size={String(tick.fontSize ?? "")}
        data-tick-tabular={String(tick.fontVariantNumeric ?? "")}
      />
    );
  };
  YAxis.displayName = "RechartsMockYAxis";
  const NullComponent = () => null;
  NullComponent.displayName = "RechartsMockNull";
  return {
    ResponsiveContainer,
    ComposedChart: makePassthrough("ComposedChart"),
    Area,
    Line,
    XAxis,
    YAxis,
    Tooltip: NullComponent,
    Legend,
    ReferenceLine,
  };
});

import { NetGrossExposureChart } from "./NetGrossExposureChart";

describe("NetGrossExposureChart — Phase 14b-05 Task 1", () => {
  const sample = [
    { date: "2024-01-01", gross: 0.8, net: 0.5 },
    { date: "2024-01-02", gross: 0.85, net: 0.4 },
    { date: "2024-01-03", gross: 0.9, net: -0.1 },
  ];

  it("Test 1: renders one Area + one Line (returns null when data empty)", () => {
    const { getAllByTestId } = render(<NetGrossExposureChart data={sample} />);
    expect(getAllByTestId("area")).toHaveLength(1);
    expect(getAllByTestId("line")).toHaveLength(1);
  });

  it("Test 1b: returns null on empty data", () => {
    const { container } = render(<NetGrossExposureChart data={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("Test 2: Area fill=CHART_ACCENT + fillOpacity=0.2; Line stroke=CHART_ACCENT + strokeWidth=1.5", () => {
    const { getByTestId } = render(<NetGrossExposureChart data={sample} />);
    const area = getByTestId("area");
    expect(area.getAttribute("data-fill")).toBe(CHART_ACCENT);
    expect(area.getAttribute("data-fill-opacity")).toBe("0.2");
    expect(area.getAttribute("data-data-key")).toBe("gross");
    const line = getByTestId("line");
    expect(line.getAttribute("data-stroke")).toBe(CHART_ACCENT);
    expect(line.getAttribute("data-stroke-width")).toBe("1.5");
    expect(line.getAttribute("data-data-key")).toBe("net");
  });

  it("Test 3: ReferenceLine y=0 with CHART_TEXT_MUTED + CHART_REFERENCE_DASH", () => {
    const { getByTestId } = render(<NetGrossExposureChart data={sample} />);
    const ref = getByTestId("reference-line");
    expect(ref.getAttribute("data-y")).toBe("0");
    expect(ref.getAttribute("data-stroke")).toBe(CHART_TEXT_MUTED);
    expect(ref.getAttribute("data-stroke-dasharray")).toBe(CHART_REFERENCE_DASH);
  });

  it("Test 4: ResponsiveContainer height=240; both axes spread CHART_TICK_STYLE", () => {
    const { getByTestId } = render(<NetGrossExposureChart data={sample} />);
    expect(getByTestId("responsive-container").getAttribute("data-height")).toBe("240");
    expect(getByTestId("x-axis").getAttribute("data-tick-font-size")).toBe("12");
    expect(getByTestId("x-axis").getAttribute("data-tick-tabular")).toBe("tabular-nums");
    expect(getByTestId("y-axis").getAttribute("data-tick-font-size")).toBe("12");
    expect(getByTestId("y-axis").getAttribute("data-tick-tabular")).toBe("tabular-nums");
  });

  it("Test 5: outer wrapper has role='img' + aria-label='Net and gross exposure over time'", () => {
    const { container } = render(<NetGrossExposureChart data={sample} />);
    const wrapper = container.querySelector('[role="img"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("aria-label")).toBe(
      "Net and gross exposure over time",
    );
  });

  it("Test 6: Legend renders + Area name='Gross', Line name='Net'", () => {
    const { getByTestId } = render(<NetGrossExposureChart data={sample} />);
    expect(getByTestId("legend")).not.toBeNull();
    expect(getByTestId("area").getAttribute("data-name")).toBe("Gross");
    expect(getByTestId("line").getAttribute("data-name")).toBe("Net");
  });

  it("Test 10: source has zero inline tick={{ ... fontSize literals", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/charts/NetGrossExposureChart.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/tick=\{\{[^}]*fontSize/);
  });

  it("source uses ComposedChart import", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/charts/NetGrossExposureChart.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/ComposedChart/);
  });
});
