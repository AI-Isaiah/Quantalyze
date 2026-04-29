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
 * Phase 14b-03 Task 1 — RollingAlphaBetaChart unit tests.
 *
 * Two-line chart: alpha solid CHART_ACCENT, beta dashed CHART_TEXT_MUTED
 * with strokeDasharray=CHART_REFERENCE_DASH. Legend renders alpha + beta
 * entries (lowercase per UI-SPEC §10.4 Greek-letter convention).
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
  const Legend = () => <div data-testid="legend" />;
  Legend.displayName = "RechartsMockLegend";
  const NullComponent = () => null;
  NullComponent.displayName = "RechartsMockNull";
  return {
    ResponsiveContainer: makePassthrough("ResponsiveContainer"),
    LineChart: makePassthrough("LineChart"),
    Line,
    XAxis: NullComponent,
    YAxis: NullComponent,
    Tooltip: NullComponent,
    Legend,
  };
});

import { RollingAlphaBetaChart } from "./RollingAlphaBetaChart";

describe("RollingAlphaBetaChart — Phase 14b-03 Task 1", () => {
  const alpha = [
    { date: "2024-01-01", value: 0.05 },
    { date: "2024-01-02", value: 0.04 },
  ];
  const beta = [
    { date: "2024-01-01", value: 0.92 },
    { date: "2024-01-02", value: 0.88 },
  ];

  it("Test 5: renders two Lines — alpha CHART_ACCENT solid 1.5px; beta CHART_TEXT_MUTED dashed", () => {
    const { getAllByTestId } = render(
      <RollingAlphaBetaChart alpha={alpha} beta={beta} />,
    );
    const lines = getAllByTestId("line");
    expect(lines).toHaveLength(2);
    const byKey = new Map(lines.map((l) => [l.getAttribute("data-data-key"), l]));
    const a = byKey.get("alpha");
    const b = byKey.get("beta");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.getAttribute("data-stroke")).toBe(CHART_ACCENT);
    expect(a?.getAttribute("data-stroke-width")).toBe("1.5");
    expect(a?.getAttribute("data-stroke-dasharray")).toBe("");
    expect(b?.getAttribute("data-stroke")).toBe(CHART_TEXT_MUTED);
    expect(b?.getAttribute("data-stroke-width")).toBe("1");
    expect(b?.getAttribute("data-stroke-dasharray")).toBe(CHART_REFERENCE_DASH);
  });

  it("Test 6: Legend renders", () => {
    const { getByTestId } = render(
      <RollingAlphaBetaChart alpha={alpha} beta={beta} />,
    );
    expect(getByTestId("legend")).not.toBeNull();
  });

  it("Test 7a: returns null when both arrays are empty", () => {
    const { container } = render(<RollingAlphaBetaChart alpha={[]} beta={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("Test 7b: renders only alpha when beta is empty", () => {
    const { getAllByTestId } = render(
      <RollingAlphaBetaChart alpha={alpha} beta={[]} />,
    );
    const lines = getAllByTestId("line");
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute("data-data-key")).toBe("alpha");
  });

  it("Test 7c: renders only beta when alpha is empty", () => {
    const { getAllByTestId } = render(
      <RollingAlphaBetaChart alpha={[]} beta={beta} />,
    );
    const lines = getAllByTestId("line");
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute("data-data-key")).toBe("beta");
  });

  it("Test 9: source contains height={250} ResponsiveContainer", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/charts/RollingAlphaBetaChart.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/<ResponsiveContainer[^>]*height=\{?250\}?/);
  });

  it("Test 10: outer wrapper carries role=img + aria-label='Rolling alpha and beta'", () => {
    const { container } = render(
      <RollingAlphaBetaChart alpha={alpha} beta={beta} />,
    );
    const wrapper = container.querySelector('[role="img"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("aria-label")).toBe("Rolling alpha and beta");
  });

  it("Test 8: source file has zero inline tick={{ ... fontSize literals", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/charts/RollingAlphaBetaChart.tsx"),
      "utf-8",
    );
    expect(src).not.toMatch(/tick=\{\{[^}]*fontSize/);
  });

  it("ensures beta line uses CHART_REFERENCE_DASH constant from chart-tokens", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/charts/RollingAlphaBetaChart.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/CHART_REFERENCE_DASH/);
  });
});
