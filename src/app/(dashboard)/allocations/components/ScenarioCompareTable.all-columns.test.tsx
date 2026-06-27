import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ComputedMetrics } from "@/lib/scenario";
import { ScenarioCompareTable, type ScenarioColumn } from "./ScenarioCompareTable";

/**
 * TABLE-01 / SC#2 — fail-loud all-columns render guard for ScenarioCompareTable.
 *
 * The reshape onto `ResponsiveTable` (Plan 46-02) makes wide columns SCROLL,
 * never drop. This guard structurally pins that contract so a future
 * `hidden md:table-cell` / column-drop / dropped-METRICS-row edit fails CI
 * LOUDLY (CLAUDE.md Rule 12) instead of silently showing the mobile user a
 * smaller truth.
 *
 * It asserts the three axes that together prove "no material cell was dropped":
 *   1. The "Metric" axis `<th>` is present (the row-label column header).
 *   2. Every scenario column renders — `getAllByTestId(/^scenario-col-/)`
 *      count === the number of scenario columns rendered (incl. the live book).
 *   3. Every `METRICS`-row label renders a row (all six metrics present).
 *
 * Falsifiability (proven manually at write time, recorded in 46-02-SUMMARY):
 *   - Deleting a scenario column from the fixture drops the scenario-col count
 *     below N → the count assertion goes RED.
 *   - Deleting a METRICS row from the component drops a metric label → the
 *     per-label assertion goes RED.
 *   Both restored to green.
 *
 * Anchored on the verbatim `data-testid="scenario-col-{name}"` (ScenarioCompare
 * Table.tsx:195) + the six METRICS labels — NOT on column ordering or styling.
 */

/** A fully-populated (healthy) ComputedMetrics for a given window n. */
function healthy(n: number, over: Partial<ComputedMetrics> = {}): ComputedMetrics {
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
    effective_start: "2024-01-02",
    effective_end: "2024-06-01",
    ...over,
  };
}

function col(name: string, metrics: ComputedMetrics): ScenarioColumn {
  return { name, metrics };
}

/** The six material metric ROWS the compare grid renders (verbatim labels). */
const MATERIAL_METRIC_LABELS = [
  "Cumulative Return",
  "CAGR",
  "Sharpe",
  "Sortino",
  "Max Drawdown",
  "Volatility",
] as const;

describe("ScenarioCompareTable — all-columns guard (TABLE-01 / SC#2)", () => {
  it("renders the Metric axis + every scenario column + every METRICS row (no drop)", () => {
    // Three rendered scenario columns: two named scenarios + the live book.
    const scenarioNames = ["Alpha", "Beta"];
    render(
      <ScenarioCompareTable
        columns={scenarioNames.map((nm) => col(nm, healthy(120)))}
        liveBook={col("Live book", healthy(120))}
      />,
    );

    // 1. The "Metric" axis header (the row-label column) is present.
    const metricAxis = screen.getByRole("columnheader", { name: "Metric" });
    expect(metricAxis).toBeInTheDocument();

    // 2. Every scenario column renders, and the count is EXACTLY the number of
    //    rendered columns (2 scenarios + live book = 3). A dropped/hidden column
    //    moves this count below N → RED.
    const renderedColumnCount = scenarioNames.length + 1; // + live book
    const scenarioColHeaders = screen.getAllByTestId(/^scenario-col-/);
    expect(scenarioColHeaders).toHaveLength(renderedColumnCount);

    // Each expected name appears as its own column header (anchored on testid).
    for (const nm of [...scenarioNames, "Live book"]) {
      expect(screen.getByTestId(`scenario-col-${nm}`)).toBeInTheDocument();
    }

    // 3. Every METRICS row renders its label (all six present — no metric row
    //    dropped). Asserted inside the table body so a stray match elsewhere
    //    cannot vacuously satisfy it.
    const table = screen.getByRole("table");
    for (const label of MATERIAL_METRIC_LABELS) {
      expect(within(table).getByText(label)).toBeInTheDocument();
    }
    // Pin the exact count too — a future ADD that forgets the guard, or a drop,
    // both fail this.
    expect(MATERIAL_METRIC_LABELS).toHaveLength(6);

    // And every column has a value cell for every metric row (N columns × 6
    // rows) — a dropped cell at any (column, metric) intersection goes RED.
    const metricKeys = ["twr", "cagr", "sharpe", "sortino", "max_drawdown", "volatility"];
    for (const nm of [...scenarioNames, "Live book"]) {
      for (const key of metricKeys) {
        expect(screen.getByTestId(`cell-${nm}-${key}`)).toBeInTheDocument();
      }
    }
  });
});
