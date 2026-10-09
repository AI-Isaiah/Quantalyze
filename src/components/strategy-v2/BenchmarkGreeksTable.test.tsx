import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * Phase 14b-05 Task 2 — BenchmarkGreeksTable unit tests.
 *
 * Strip composed from MetricCell (Plan 14b-04). Negative styling when the
 * ROUNDED value is < 0; IR never marked negative; null → em-dash via MetricCell.
 *
 * 2026-10-09 Phase 170.5 (D-07, UI-SPEC "Layout decision"): the strip is five
 * cells (alpha (ann) / beta / correlation / IR / Treynor) at the factsheet's
 * digits (2 dp, alpha as a signed percent). Tests 1-4c below were edited to
 * that contract with dated comments; see BenchmarkGreeksTable.reason.test.tsx
 * for the reason line and the rounded-sign cases.
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
  // 2026-10-09 Phase 170.5 (D-07, UI-SPEC "Layout decision"): five cells, factsheet digits
  it("Test 1: renders 5 MetricCells in grid grid-cols-5 gap-3 max-md:grid-cols-3 with verbatim labels", () => {
    const { container } = render(
      <BenchmarkGreeksTable alpha={0.05} beta={1.2} correlation={0.4} ir={0.8} treynor={0.04} />,
    );
    const grid = container.firstChild as HTMLElement;
    const cls = grid.getAttribute("class") ?? "";
    expect(cls).toContain("grid");
    expect(cls).toContain("grid-cols-5");
    expect(cls).toContain("gap-3");
    expect(cls).toContain("max-md:grid-cols-3");
    expect(metricCellCalls).toHaveLength(5);
    expect(metricCellCalls.map((c) => c.label)).toEqual([
      "alpha (ann)",
      "beta",
      "correlation",
      "IR",
      "Treynor",
    ]);
  });

  // 2026-10-09 Phase 170.5 (D-07, UI-SPEC "Layout decision"): five cells, factsheet digits
  it("Test 2: values render at the factsheet's digits (alpha a signed percent, the rest 2 dp)", () => {
    render(
      <BenchmarkGreeksTable alpha={0.05} beta={1.2} correlation={0.4} ir={0.8} treynor={0.04} />,
    );
    const byLabel = new Map(metricCellCalls.map((c) => [c.label, c.value]));
    expect(byLabel.get("alpha (ann)")).toBe("+5.00%");
    expect(byLabel.get("beta")).toBe("1.20");
    expect(byLabel.get("correlation")).toBe("0.40");
    expect(byLabel.get("IR")).toBe("0.80");
    expect(byLabel.get("Treynor")).toBe("0.04");
  });

  it("Test 3: null values render as null (em-dash via MetricCell)", () => {
    // 2026-10-09 Phase 170.5 (D-07): label is now "alpha (ann)"; correlation is a fifth cell
    render(
      <BenchmarkGreeksTable alpha={null} beta={null} correlation={null} ir={null} treynor={null} />,
    );
    const byLabel = new Map(metricCellCalls.map((c) => [c.label, c.value]));
    expect(byLabel.get("alpha (ann)")).toBeNull();
    expect(byLabel.get("correlation")).toBeNull();
    expect(byLabel.get("beta")).toBeNull();
    expect(byLabel.get("IR")).toBeNull();
    expect(byLabel.get("Treynor")).toBeNull();
  });

  it("Test 4: negative={true} when alpha/beta/Treynor < 0; IR never marked negative", () => {
    render(
      <BenchmarkGreeksTable alpha={-0.02} beta={-0.5} correlation={-0.2} ir={-0.3} treynor={-0.01} />,
    );
    const byLabel = new Map(metricCellCalls.map((c) => [c.label, c.negative]));
    // 2026-10-09 Phase 170.5 (D-07): label is "alpha (ann)"; correlation is flagged like beta
    expect(byLabel.get("alpha (ann)")).toBe(true);
    expect(byLabel.get("correlation")).toBe(true);
    expect(byLabel.get("beta")).toBe(true);
    expect(byLabel.get("Treynor")).toBe(true);
    // IR never gets negative flag (information ratio sign-conventions are
    // ambiguous — caller decides at composition time; we don't sign-flip).
    expect(byLabel.get("IR")).toBeFalsy();
  });

  it("Test 4b: positive values do NOT receive negative flag", () => {
    render(
      <BenchmarkGreeksTable alpha={0.05} beta={1.2} correlation={0.4} ir={0.8} treynor={0.04} />,
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
        correlation={NaN}
        ir={-Infinity}
        treynor={NaN}
      />,
    );
    metricCellCalls.forEach((c) => {
      expect(c.value).toBeNull();
    });
  });
});
