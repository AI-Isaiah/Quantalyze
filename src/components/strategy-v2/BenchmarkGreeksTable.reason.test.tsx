import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

/**
 * Phase 170.5 plan 07 Task 2 (D-07, D-06) - the Benchmark greeks strip is five
 * cells in the factsheet's order, printed with the factsheet's digits, with ONE
 * reason line when a cell is a dash.
 *
 * Before 170.5 the strip was four cells (no correlation) at 3 decimals and a
 * dash had no cause. The tone of each cell comes from the ROUNDED printed value
 * (DESIGN Numbers Contract), and IR is never sign-flagged.
 */

let cells: Array<{ label: string; value: string | null; negative?: boolean }> = [];
vi.mock("./MetricCell", () => ({
  MetricCell: (props: { label: string; value: string | null; negative?: boolean }) => {
    cells.push(props);
    return <div data-testid="metric-cell" data-label={props.label} />;
  },
}));

import { BenchmarkGreeksTable } from "./BenchmarkGreeksTable";

beforeEach(() => {
  cells = [];
});

const byLabel = () => new Map(cells.map((c) => [c.label, c]));

describe("BenchmarkGreeksTable five-cell strip (D-07)", () => {
  it("renders five cells in factsheet order inside grid grid-cols-5 gap-3 max-md:grid-cols-3", () => {
    const { container } = render(
      <BenchmarkGreeksTable alpha={0.1} beta={0.4} correlation={0.4} ir={0.5} treynor={0.1} />,
    );
    const cls = (container.firstChild as HTMLElement).getAttribute("class") ?? "";
    for (const token of ["grid", "grid-cols-5", "gap-3", "max-md:grid-cols-3"]) {
      expect(cls.split(/\s+/)).toContain(token);
    }
    expect(cells.map((c) => c.label)).toEqual(["alpha (ann)", "beta", "correlation", "IR", "Treynor"]);
  });

  it("prints the factsheet's strings and flags only the rounded-negative cells (IR never)", () => {
    render(
      <BenchmarkGreeksTable alpha={0.123456} beta={0.38412} correlation={0.4} ir={-0.31} treynor={-0.005} />,
    );
    expect(cells.map((c) => c.value)).toEqual(["+12.35%", "0.38", "0.40", "-0.31", "-0.01"]);
    expect(cells.map((c) => !!c.negative)).toEqual([false, false, false, false, true]);
  });

  it("a beta that rounds to zero prints 0.00 and is neutral", () => {
    render(<BenchmarkGreeksTable alpha={0.1} beta={-0.004} correlation={0.4} ir={0.5} treynor={0.1} />);
    expect(byLabel().get("beta")).toMatchObject({ value: "0.00" });
    expect(!!byLabel().get("beta")!.negative).toBe(false);
  });

  it("an alpha that rounds to zero prints 0.00% and is neutral", () => {
    render(<BenchmarkGreeksTable alpha={-0.00004} beta={0.4} correlation={0.4} ir={0.5} treynor={0.1} />);
    expect(byLabel().get("alpha (ann)")!.value).toBe("0.00%");
    expect(!!byLabel().get("alpha (ann)")!.negative).toBe(false);
  });

  it("a null correlation (or an omitted one) is null for the em dash and never coloured", () => {
    render(<BenchmarkGreeksTable alpha={0.1} beta={0.4} correlation={null} ir={0.5} treynor={0.1} />);
    expect(byLabel().get("correlation")!.value).toBeNull();
    expect(!!byLabel().get("correlation")!.negative).toBe(false);
    cells = [];
    render(<BenchmarkGreeksTable alpha={0.1} beta={0.4} ir={0.5} treynor={0.1} />);
    expect(byLabel().get("correlation")!.value).toBeNull();
  });

  it("NaN and Infinity print null, never 0", () => {
    render(
      <BenchmarkGreeksTable alpha={Number.NaN} beta={Number.POSITIVE_INFINITY} correlation={Number.NEGATIVE_INFINITY} ir={null} treynor={Number.NaN} />,
    );
    for (const c of cells) {
      expect(c.value).toBeNull();
      expect(!!c.negative).toBe(false);
    }
  });
});

describe("BenchmarkGreeksTable reason line", () => {
  const LINE = "IR reads — when tracking error is zero.";

  it("renders one p[data-testid=greeks-reason] in the caption token, as a sibling of the grid", () => {
    const { container } = render(
      <BenchmarkGreeksTable alpha={0.1} beta={0.4} correlation={0.4} ir={null} treynor={0.1} reason={LINE} />,
    );
    const lines = container.querySelectorAll('p[data-testid="greeks-reason"]');
    expect(lines).toHaveLength(1);
    const p = lines[0] as HTMLElement;
    expect(p.textContent).toBe(LINE);
    expect(p.getAttribute("class")).toBe("mt-2 text-xs font-normal text-text-muted");
    expect(p.hasAttribute("tabindex")).toBe(false);
    expect(p.hasAttribute("aria-live")).toBe(false);
    // The grid stays the first child; the reason line is a sibling, not inside it.
    expect((container.firstChild as HTMLElement).contains(p)).toBe(false);
  });

  it("renders no reason element for null, undefined or an empty string", () => {
    for (const reason of [null, undefined, ""]) {
      const { container, unmount } = render(
        <BenchmarkGreeksTable alpha={0.1} beta={0.4} correlation={0.4} ir={0.5} treynor={0.1} reason={reason} />,
      );
      expect(container.querySelector('[data-testid="greeks-reason"]')).toBeNull();
      unmount();
    }
  });
});
