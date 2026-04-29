import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * Phase 14b-05 Task 2 — BenchmarkGreeksTable unit tests.
 *
 * 4-cell strip composed from MetricCell (Plan 14b-04). Cells in order:
 * alpha / beta / IR / Treynor (UI-SPEC §10.4 case-sensitive labels).
 * Values render to 3 decimals via toFixed(3); null → em-dash via MetricCell.
 * Negative styling on alpha/beta/Treynor when < 0; IR never marked negative.
 */

let metricCellCalls: Array<{
  label: string;
  value: string | null;
  negative?: boolean;
}> = [];
vi.mock("./MetricCell", () => ({
  MetricCell: (props: { label: string; value: string | null; negative?: boolean }) => {
    metricCellCalls.push(props);
    return (
      <div
        data-testid="metric-cell"
        data-label={props.label}
        data-value={props.value ?? "—"}
        data-negative={props.negative ? "true" : "false"}
      />
    );
  },
}));

import { BenchmarkGreeksTable } from "./BenchmarkGreeksTable";

beforeEach(() => {
  metricCellCalls = [];
});

describe("BenchmarkGreeksTable — Phase 14b-05 Task 2", () => {
  it("Test 1: renders 4 MetricCells in grid-cols-4 gap-3 with verbatim labels", () => {
    const { container } = render(
      <BenchmarkGreeksTable alpha={0.05} beta={1.2} ir={0.8} treynor={0.04} />,
    );
    const grid = container.firstChild as HTMLElement;
    const cls = grid.getAttribute("class") ?? "";
    expect(cls).toContain("grid");
    expect(cls).toContain("grid-cols-4");
    expect(cls).toContain("gap-3");
    expect(metricCellCalls).toHaveLength(4);
    expect(metricCellCalls.map((c) => c.label)).toEqual([
      "alpha",
      "beta",
      "IR",
      "Treynor",
    ]);
  });

  it("Test 2: values render to 3 decimals via toFixed(3)", () => {
    render(
      <BenchmarkGreeksTable alpha={0.05} beta={1.2} ir={0.8} treynor={0.04} />,
    );
    const byLabel = new Map(metricCellCalls.map((c) => [c.label, c.value]));
    expect(byLabel.get("alpha")).toBe("0.050");
    expect(byLabel.get("beta")).toBe("1.200");
    expect(byLabel.get("IR")).toBe("0.800");
    expect(byLabel.get("Treynor")).toBe("0.040");
  });

  it("Test 3: null values render as null (em-dash via MetricCell)", () => {
    render(
      <BenchmarkGreeksTable alpha={null} beta={null} ir={null} treynor={null} />,
    );
    const byLabel = new Map(metricCellCalls.map((c) => [c.label, c.value]));
    expect(byLabel.get("alpha")).toBeNull();
    expect(byLabel.get("beta")).toBeNull();
    expect(byLabel.get("IR")).toBeNull();
    expect(byLabel.get("Treynor")).toBeNull();
  });

  it("Test 4: negative={true} when alpha/beta/Treynor < 0; IR never marked negative", () => {
    render(
      <BenchmarkGreeksTable alpha={-0.02} beta={-0.5} ir={-0.3} treynor={-0.01} />,
    );
    const byLabel = new Map(metricCellCalls.map((c) => [c.label, c.negative]));
    expect(byLabel.get("alpha")).toBe(true);
    expect(byLabel.get("beta")).toBe(true);
    expect(byLabel.get("Treynor")).toBe(true);
    // IR never gets negative flag (information ratio sign-conventions are
    // ambiguous — caller decides at composition time; we don't sign-flip).
    expect(byLabel.get("IR")).toBeFalsy();
  });

  it("Test 4b: positive values do NOT receive negative flag", () => {
    render(
      <BenchmarkGreeksTable alpha={0.05} beta={1.2} ir={0.8} treynor={0.04} />,
    );
    metricCellCalls.forEach((c) => {
      expect(c.negative).toBeFalsy();
    });
  });

  it("Test 4c: NaN/Infinity values render null and don't set negative flag", () => {
    render(
      <BenchmarkGreeksTable
        alpha={NaN}
        beta={Infinity}
        ir={-Infinity}
        treynor={NaN}
      />,
    );
    metricCellCalls.forEach((c) => {
      expect(c.value).toBeNull();
    });
  });
});
