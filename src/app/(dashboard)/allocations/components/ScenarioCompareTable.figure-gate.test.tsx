import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComputedMetrics } from "@/lib/scenario";
import { ScenarioCompareTable, type ScenarioColumn } from "./ScenarioCompareTable";

/**
 * 194.1 plan 03 (194 D-04 as superseded by D-15, census B7): each saved-scenario compare
 * column's CAGR, Sharpe, Sortino and Volatility are judged on THAT column's blend record:
 * the engine's effective window, its observation count, and the basis it was annualised at
 * (`periodsPerYear`, carried from `computeDraftColumn`). Every sentence below is typed by
 * hand, never read back from `figure-gate`, so a reworded constant fails here.
 */

const START = "2024-01-01";
const DAY_MS = 86_400_000;

/** The ISO end date whose record from START covers exactly `days` days, both ends counted (D-20). */
function endAfter(days: number): string {
  return new Date(Date.parse(`${START}T00:00:00Z`) + (days - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** A healthy ComputedMetrics over a record covering `days` days with `n` observations. */
function metricsFor(
  days: number,
  n: number,
  over: Partial<ComputedMetrics> = {},
): ComputedMetrics {
  return {
    n,
    twr: 0.25,
    cagr: 0.18,
    volatility: 0.12,
    sharpe: 1.5,
    sortino: 2.1,
    max_drawdown: -0.08,
    max_dd_days: 12,
    correlation_matrix: null,
    avg_pairwise_correlation: null,
    equity_curve: [],
    effective_start: START,
    effective_end: endAfter(days),
    ...over,
  };
}

function column(
  name: string,
  metrics: ComputedMetrics,
  periodsPerYear?: number,
): ScenarioColumn {
  return { name, metrics, periodsPerYear };
}

function cell(name: string, key: string): HTMLElement {
  return screen.getByTestId(`cell-${name}-${key}`);
}

/** A second column so the table renders (it needs two). Its Sharpe leads, so no column under test wins by default. */
const PEER = column("Peer", metricsFor(400, 400, { sharpe: 2.0 }), 365);

describe("ScenarioCompareTable - figure gate per column (194.1 plan 03)", () => {
  it("a crypto column with 40 days of record withholds Sharpe: a dash with the reason in title", () => {
    render(
      <ScenarioCompareTable
        columns={[column("Short", metricsFor(40, 40), 365), PEER]}
        liveBook={null}
      />,
    );
    const c = cell("Short", "sharpe");
    expect(c.textContent?.startsWith("—")).toBe(true);
    expect(c.textContent).not.toMatch(/1\.50/);
    expect(c.querySelector("[title]")?.getAttribute("title")).toBe(
      "Withheld until the record reaches 90 days (40 days so far).",
    );
  });

  it("a crypto column with 200 days of record prints the figure plus the under-one-year marker", () => {
    render(
      <ScenarioCompareTable
        columns={[column("Mid", metricsFor(200, 140), 365), PEER]}
        liveBook={null}
      />,
    );
    const c = cell("Mid", "sharpe");
    expect(c.textContent).toContain("1.50");
    expect(c.textContent).toContain("<1y");
    const marker = Array.from(c.querySelectorAll("[title]")).find((el) =>
      el.textContent?.includes("<1y"),
    );
    expect(marker?.getAttribute("title")).toBe(
      "Annualized from 200 days of record, under one year.",
    );
  });

  it("a column with 400 days of record prints exactly as before: no title, no marker", () => {
    render(
      <ScenarioCompareTable
        columns={[column("Full", metricsFor(400, 400), 365), PEER]}
        liveBook={null}
      />,
    );
    const c = cell("Full", "sharpe");
    expect(c.textContent).toBe("1.50");
    expect(c.querySelector("[title]")).toBeNull();
  });

  it("a crypto column with 70 days and 70 observations is withheld: the basis, not the observation count, decides", () => {
    // 70 observations would clear a non-crypto column (60), but a crypto record needs 90
    // covered days, so the 365 basis carried from the engine must withhold it.
    render(
      <ScenarioCompareTable
        columns={[column("Seventy", metricsFor(70, 70), 365), PEER]}
        liveBook={null}
      />,
    );
    const c = cell("Seventy", "sharpe");
    expect(c.textContent?.startsWith("—")).toBe(true);
    expect(c.querySelector("[title]")?.getAttribute("title")).toBe(
      "Withheld until the record reaches 90 days (70 days so far).",
    );
  });
});

describe("ScenarioCompareTable - a withheld column never wins (194.1 plan 03)", () => {
  it("two columns, the higher Sharpe withheld: no winner mark and no Best Sharpe callout", () => {
    render(
      <ScenarioCompareTable
        columns={[
          column("A", metricsFor(40, 40, { sharpe: 3.1 }), 365),
          column("B", metricsFor(400, 400, { sharpe: 1.2 }), 365),
        ]}
        liveBook={null}
      />,
    );
    expect(screen.queryByTestId("winner-sharpe")).toBeNull();
    expect(screen.queryByTestId("sharpe-leader")).toBeNull();
    expect(cell("A", "sharpe").textContent?.startsWith("—")).toBe(true);
    expect(cell("A", "sharpe").textContent).not.toMatch(/3\.10/);
  });

  it("three columns, A withheld: the mark is on B and the callout reads Best Sharpe: B", () => {
    render(
      <ScenarioCompareTable
        columns={[
          column("A", metricsFor(40, 40, { sharpe: 3.1 }), 365),
          column("B", metricsFor(400, 400, { sharpe: 1.2 }), 365),
          column("C", metricsFor(400, 400, { sharpe: 0.8 }), 365),
        ]}
        liveBook={null}
      />,
    );
    const marks = screen.getAllByTestId("winner-sharpe");
    expect(marks).toHaveLength(1);
    expect(cell("B", "sharpe").contains(marks[0])).toBe(true);
    expect(screen.getByTestId("sharpe-leader").textContent).toBe("Best Sharpe: B");
  });

  it("a non-crypto column with 59 observations is withheld; with 60 over 84 days it is short and can win", () => {
    const { unmount } = render(
      <ScenarioCompareTable
        columns={[
          column("Trad", metricsFor(84, 59, { sharpe: 3.1 }), 252),
          column("B", metricsFor(400, 400, { sharpe: 1.2 }), 365),
        ]}
        liveBook={null}
      />,
    );
    expect(cell("Trad", "sharpe").textContent?.startsWith("—")).toBe(true);
    expect(cell("Trad", "sharpe").querySelector("[title]")?.getAttribute("title")).toBe(
      "Withheld until the record reaches 60 trading days (59 so far).",
    );
    expect(screen.queryByTestId("sharpe-leader")).toBeNull();
    unmount();

    render(
      <ScenarioCompareTable
        columns={[
          column("Trad", metricsFor(84, 60, { sharpe: 3.1 }), 252),
          column("B", metricsFor(400, 400, { sharpe: 1.2 }), 365),
        ]}
        liveBook={null}
      />,
    );
    expect(cell("Trad", "sharpe").textContent).toContain("3.10");
    expect(cell("Trad", "sharpe").textContent).toContain("<1y");
    expect(cell("Trad", "sharpe").querySelector("[data-testid='winner-sharpe']")).not.toBeNull();
    expect(screen.getByTestId("sharpe-leader").textContent).toBe("Best Sharpe: Trad");
  });

  it("a column with n 0 and no basis prints exactly as before: no title, no marker", () => {
    render(
      <ScenarioCompareTable
        columns={[
          column("NoBasis", metricsFor(40, 0, { sharpe: 0.5 })),
          column("ZeroN", metricsFor(40, 0, { sharpe: 0.4 }), 365),
          PEER,
        ]}
        liveBook={null}
      />,
    );
    for (const name of ["NoBasis", "ZeroN"]) {
      for (const key of ["cagr", "sharpe", "sortino", "volatility"]) {
        expect(cell(name, key).querySelector("[title]")).toBeNull();
        expect(cell(name, key).textContent).not.toContain("<1y");
        expect(cell(name, key).textContent).not.toBe("—");
      }
    }
    expect(cell("NoBasis", "sharpe").textContent).toBe("0.50");
  });

  it("an undecodable column keeps its dash cells with no reason", () => {
    render(
      <ScenarioCompareTable
        columns={[
          { name: "Old", metrics: metricsFor(40, 0, { sharpe: null }), undecodable: true, periodsPerYear: 365 },
          PEER,
        ]}
        liveBook={null}
      />,
    );
    expect(cell("Old", "sharpe").textContent).toBe("—");
    expect(cell("Old", "sharpe").querySelector("[title]")).toBeNull();
  });

  it("Cumulative Return and Max Drawdown winners do not change when a column's annualised figures are withheld", () => {
    render(
      <ScenarioCompareTable
        columns={[
          column("A", metricsFor(40, 40, { twr: 0.9, max_drawdown: -0.01 }), 365),
          column("B", metricsFor(400, 400, { twr: 0.25, max_drawdown: -0.08 }), 365),
        ]}
        liveBook={null}
      />,
    );
    expect(cell("A", "twr").querySelector("[data-testid='winner-twr']")).not.toBeNull();
    expect(
      cell("A", "max_drawdown").querySelector("[data-testid='winner-max_drawdown']"),
    ).not.toBeNull();
    expect(cell("B", "twr").querySelector("[data-testid='winner-twr']")).toBeNull();
  });

  it("a stored cumulative return of 12345678901.23 prints like any finite value (no size test)", () => {
    render(
      <ScenarioCompareTable
        columns={[
          column("Huge", metricsFor(40, 40, { twr: 12345678901.23 }), 365),
          PEER,
        ]}
        liveBook={null}
      />,
    );
    const text = cell("Huge", "twr").textContent ?? "";
    expect(text).not.toBe("—");
    expect(text).toMatch(/1[,\s]?234[,\s]?567[,\s]?890[,\s]?123/);
  });
});
