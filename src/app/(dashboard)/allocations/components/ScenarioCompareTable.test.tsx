import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ComputedMetrics } from "@/lib/scenario";
import { methodologyLine } from "@/lib/scenario-history";
import { ScenarioCompareTable, type ScenarioColumn } from "./ScenarioCompareTable";

/**
 * TDD pins for the compare grid (Plan 23-03, Task 2).
 *
 * `ScenarioCompareTable` mirrors `CompareTable` EXACTLY for the scaffold +
 * winner logic, reading keys from `ComputedMetrics`. The load-bearing
 * DIVERGENCE from CompareTable is that each column stamps its OWN
 * `methodologyLine(n)` — heterogeneous windows are correct; there is NO single
 * shared-window header. The honesty invariants are assertions, not prose:
 *
 *   1. Six metric rows × N scenario columns + the "Live book" column render.
 *   2. A null/degenerate column renders "—" in every value cell — never "0",
 *      "0.00", "0%", or "N/A". The test FAILS if a 0 is shown for that column.
 *   3. Each column renders its OWN methodologyLine(n) — two columns with
 *      different n show DIFFERENT stamps (no single shared-window header).
 *   4. The per-metric winner cell carries text-accent font-bold + " ✓" via
 *      findWinner; Max Drawdown + Volatility use higherIsBetter=false.
 *   5. A "Best Sharpe: {name}" callout names the Sharpe leader (neutral).
 *   6. A whole below-floor column (n < 60) is gated to neutral sample-floor
 *      copy (no red/amber, no role="alert").
 *   7. Under-selection (< 2 columns) renders the UI-SPEC hint.
 */

// =========================================================================
// Fixture helpers
// =========================================================================

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

/** A degenerate ComputedMetrics — engine nulled every metric (n below usable). */
function degenerate(n: number): ComputedMetrics {
  return {
    n,
    twr: null,
    cagr: null,
    volatility: null,
    sharpe: null,
    sortino: null,
    max_drawdown: null,
    max_dd_days: null,
    correlation_matrix: null,
    avg_pairwise_correlation: null,
    equity_curve: [],
    effective_start: null,
    effective_end: null,
  };
}

function col(name: string, metrics: ComputedMetrics): ScenarioColumn {
  return { name, metrics };
}

// =========================================================================
// Tests
// =========================================================================

describe("ScenarioCompareTable", () => {
  it("renders the six metric rows plus the Live book column", () => {
    render(
      <ScenarioCompareTable
        columns={[col("Alpha", healthy(120)), col("Beta", healthy(120))]}
        liveBook={col("Live book", healthy(120))}
      />,
    );

    for (const label of [
      "Cumulative Return",
      "CAGR",
      "Sharpe",
      "Sortino",
      "Max Drawdown",
      "Volatility",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Live book")).toBeInTheDocument();
  });

  it("renders '—' in every cell of a degenerate column — never a fabricated 0", () => {
    render(
      <ScenarioCompareTable
        columns={[col("Healthy", healthy(120)), col("Empty", degenerate(4))]}
        liveBook={col("Live book", healthy(120))}
      />,
    );

    // The degenerate column has its own scope so we can assert ALL of its
    // value cells are em-dashes and NONE of them is a fabricated 0/0.00%/N/A.
    const emptyCol = screen.getByTestId("scenario-col-Empty");
    const dashes = within(emptyCol).getAllByText("—");
    expect(dashes.length).toBe(6); // all six metric cells

    const emptyText = emptyCol.textContent ?? "";
    expect(emptyText).not.toMatch(/0\.00/);
    expect(emptyText).not.toMatch(/0%/);
    expect(emptyText).not.toMatch(/\bN\/A\b/);
    // No bare "0" value cell (the methodology stamp n is allowed elsewhere).
    expect(within(emptyCol).queryByText("0")).toBeNull();
    expect(within(emptyCol).queryByText("0.00")).toBeNull();
  });

  it("stamps each column's OWN methodologyLine(n) — heterogeneous, no shared header", () => {
    render(
      <ScenarioCompareTable
        columns={[col("Long", healthy(120)), col("Short", healthy(65))]}
        liveBook={col("Live book", healthy(90))}
      />,
    );

    // Distinct per-column stamps, NOT one shared-window header.
    expect(screen.getByText(methodologyLine(120))).toBeInTheDocument();
    expect(screen.getByText(methodologyLine(65))).toBeInTheDocument();
    expect(screen.getByText(methodologyLine(90))).toBeInTheDocument();
    // These three stamps are different strings — proves no single header.
    expect(methodologyLine(120)).not.toBe(methodologyLine(65));
  });

  it("highlights the per-metric winner with text-accent font-bold + ✓", () => {
    // Beta has the higher Sharpe; Alpha has the better (less-negative) Max DD.
    const alpha = healthy(120, { sharpe: 1.2, max_drawdown: -0.05 });
    const beta = healthy(120, { sharpe: 2.4, max_drawdown: -0.2 });
    render(
      <ScenarioCompareTable
        columns={[col("Alpha", alpha), col("Beta", beta)]}
        liveBook={col("Live book", healthy(120, { sharpe: 0.5, max_drawdown: -0.3 }))}
      />,
    );

    // The Sharpe winner (Beta, 2.40) carries the accent + check styling.
    const sharpeWinner = screen.getByTestId("winner-sharpe");
    expect(sharpeWinner.className).toContain("text-accent");
    expect(sharpeWinner.className).toContain("font-bold");
    expect(sharpeWinner.textContent).toContain("✓");
    expect(sharpeWinner.textContent).toContain("2.40");

    // Max Drawdown is higherIsBetter=false → the LEAST-negative (Alpha, -5%) wins.
    const ddWinner = screen.getByTestId("winner-max_drawdown");
    expect(ddWinner.textContent).toContain("-5.00%");
    expect(ddWinner.className).toContain("text-accent");
  });

  it("names the Sharpe leader in a neutral 'Best Sharpe' callout", () => {
    render(
      <ScenarioCompareTable
        columns={[
          col("Alpha", healthy(120, { sharpe: 1.0 })),
          col("Beta", healthy(120, { sharpe: 3.3 })),
        ]}
        liveBook={col("Live book", healthy(120, { sharpe: 0.4 }))}
      />,
    );

    const callout = screen.getByTestId("sharpe-leader");
    expect(callout.textContent).toContain("Best Sharpe: Beta");
    // Neutral styling — not accent, not negative.
    expect(callout.className).toContain("text-text-secondary");
    expect(callout.className).not.toContain("text-negative");
  });

  it("gates a whole below-floor column to neutral sample-floor copy (no alert)", () => {
    render(
      <ScenarioCompareTable
        columns={[col("Healthy", healthy(120)), col("Thin", healthy(30))]}
        liveBook={col("Live book", healthy(120))}
      />,
    );

    // n=30 is below SAMPLE_FLOOR_OVERLAPPING_DAYS (60) → neutral floor copy.
    const thinCol = screen.getByTestId("scenario-col-Thin");
    expect(within(thinCol).getByText(/Not enough history for this estimate/)).toBeInTheDocument();
    // Honest absence is calm — no alert role, no red/amber.
    expect(thinCol.querySelector('[role="alert"]')).toBeNull();
    expect(thinCol.className).not.toMatch(/text-negative|text-warning|border-negative|border-warning/);
  });

  it("renders the under-selection hint with fewer than 2 columns", () => {
    render(<ScenarioCompareTable columns={[]} liveBook={null} />);
    expect(
      screen.getByText("Select 2 or more scenarios (or the live book) to compare."),
    ).toBeInTheDocument();
  });
});
