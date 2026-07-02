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
 *
 * v1.5 PERSIST-03 adds the per-column effective-window label pins:
 *   8. A verdict.ok column AUGMENTS its day-count stamp with the effective
 *      {start}–{end} window (engine-emitted bounds, font-mono tabular-nums,
 *      en-dash) — quiet text-text-muted caption, never accent/warning.
 *   9. Two columns with different windows render DIFFERENT ranges (heterogeneous).
 *  10. Undecodable + below-floor columns SUPPRESS the range (no honest window);
 *      a verdict.ok column with null bounds shows just the day-count stamp.
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

    // Assert EVERY one of the degenerate column's six value cells is an
    // em-dash and NONE is a fabricated 0 / "0.00%" / "N/A". Each value cell
    // carries data-testid="cell-{name}-{metricKey}".
    const metricKeys = ["twr", "cagr", "sharpe", "sortino", "max_drawdown", "volatility"];
    for (const key of metricKeys) {
      const cell = screen.getByTestId(`cell-Empty-${key}`);
      expect(cell.textContent).toBe("—");
      // Honesty invariant: a fabricated 0 must FAIL this test.
      expect(cell.textContent).not.toMatch(/0\.00/);
      expect(cell.textContent).not.toMatch(/0%/);
      expect(cell.textContent).not.toMatch(/\bN\/A\b/);
      expect(cell.textContent).not.toBe("0");
    }
  });

  it("stamps each column's OWN methodologyLine(n) — heterogeneous, no shared header", () => {
    render(
      <ScenarioCompareTable
        columns={[col("Long", healthy(120)), col("Short", healthy(65))]}
        liveBook={col("Live book", healthy(90))}
      />,
    );

    // Distinct per-column stamps, NOT one shared-window header. The day-count
    // caption is now AUGMENTED with the effective window (PERSIST-03), so the
    // methodologyLine text is one node among several in the stamp <span> — match
    // it as a substring (exact:false) rather than an exact single-node match.
    expect(screen.getByText(methodologyLine(120), { exact: false })).toBeInTheDocument();
    expect(screen.getByText(methodologyLine(65), { exact: false })).toBeInTheDocument();
    expect(screen.getByText(methodologyLine(90), { exact: false })).toBeInTheDocument();
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

    // Max Drawdown: computeScenario stores it as a NEGATIVE number, so the
    // least-severe drawdown is the HIGHEST value → higherIsBetter=true (matching
    // the shipped CompareTable flag). Alpha (-5%) is least-severe and wins;
    // a winner-inverted flag (false) would crown the WORST (-30%) — this asserts
    // we did NOT invert.
    const ddWinner = screen.getByTestId("winner-max_drawdown");
    expect(ddWinner.textContent).toContain("-5.00%");
    expect(ddWinner.textContent).not.toContain("-30.00%");
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

    // n=30 is below SAMPLE_FLOOR_OVERLAPPING_DAYS (60) → neutral floor copy
    // in that column's window-stamp cell (data-testid="stamp-{name}").
    const thinStamp = screen.getByTestId("stamp-Thin");
    expect(within(thinStamp).getByText(/Not enough history for this estimate/)).toBeInTheDocument();
    // Honest absence is calm — no alert role, no red/amber.
    expect(thinStamp.querySelector('[role="alert"]')).toBeNull();
    expect(thinStamp.innerHTML).not.toMatch(/text-negative|text-warning|border-negative|border-warning/);

    // A healthy column keeps its window stamp, not the floor copy. The stamp is
    // AUGMENTED with the effective window (PERSIST-03), so match as a substring.
    const healthyStamp = screen.getByTestId("stamp-Healthy");
    expect(within(healthyStamp).getByText(methodologyLine(120), { exact: false })).toBeInTheDocument();
  });

  it("suppresses the winner ✓ when only one column has a real value for a metric", () => {
    // One real column + one fully-degenerate (em-dash) column. The metric has a
    // single real value, so there is no comparison — NO ✓ may render for it
    // (a lone ✓ would imply a comparison that didn't happen).
    render(
      <ScenarioCompareTable
        columns={[col("Real", healthy(120, { sharpe: 1.7 })), col("Empty", degenerate(0))]}
        liveBook={null}
      />,
    );

    // No winner mark for sharpe (only one real value).
    expect(screen.queryByTestId("winner-sharpe")).toBeNull();
    // The real value is still rendered (just without the ✓ / accent).
    const realCell = screen.getByTestId("cell-Real-sharpe");
    expect(realCell.textContent).toContain("1.70");
    expect(realCell.textContent).not.toContain("✓");
    // The Sharpe-leader callout is also suppressed (no comparison happened).
    expect(screen.queryByTestId("sharpe-leader")).toBeNull();
  });

  it("still shows the winner ✓ when two columns have real values", () => {
    // Two real columns → a genuine comparison → the ✓ appears on the leader.
    render(
      <ScenarioCompareTable
        columns={[
          col("Low", healthy(120, { sharpe: 1.0 })),
          col("High", healthy(120, { sharpe: 2.5 })),
        ]}
        liveBook={null}
      />,
    );

    const winner = screen.getByTestId("winner-sharpe");
    expect(winner.textContent).toContain("2.50");
    expect(winner.textContent).toContain("✓");
    expect(winner.className).toContain("text-accent");
    // And the Sharpe-leader callout names the leader.
    expect(screen.getByTestId("sharpe-leader")).toHaveTextContent("High");
  });

  // =======================================================================
  // v1.5 PERSIST-03 — per-column effective-window label in the <tfoot> Window row
  // WHY: compare shows 2+ scenarios each at its OWN persisted window. The Window
  // row must display both HOW MANY days (methodologyLine) and OVER WHICH window
  // ({start}–{end}) per column, so heterogeneous windows read honestly. The label
  // reads engine-emitted effective bounds only (never re-derives) and is
  // suppressed where there is no honest window: undecodable + below-floor columns.
  // =======================================================================

  it("appends the column's effective {start}–{end} window to the verdict.ok stamp", () => {
    render(
      <ScenarioCompareTable
        columns={[
          col("Alpha", healthy(120, { effective_start: "2024-01-02", effective_end: "2024-06-01" })),
          col("Beta", healthy(120, { effective_start: "2024-01-02", effective_end: "2024-06-01" })),
        ]}
        liveBook={null}
      />,
    );

    const alphaStamp = screen.getByTestId("stamp-Alpha");
    // The day-count stamp is preserved (augmented, not replaced) — the
    // methodologyLine text is now one node among several, so match as substring.
    expect(within(alphaStamp).getByText(methodologyLine(120), { exact: false })).toBeInTheDocument();
    // Both effective bounds render, joined by an en-dash, after a " · " separator.
    expect(alphaStamp.textContent).toContain("2024-01-02");
    expect(alphaStamp.textContent).toContain("2024-06-01");
    expect(alphaStamp.textContent).toMatch(/·\s*2024-01-02–2024-06-01/);
    // Dates use the BlendHeader font-mono tabular-nums treatment.
    const dateSpans = alphaStamp.querySelectorAll("span.font-mono.tabular-nums");
    expect(dateSpans.length).toBe(2);
    // The label stays the quiet honesty caption — never accent/warning/winner.
    expect(alphaStamp.innerHTML).not.toMatch(/text-accent|text-negative|text-warning/);
  });

  it("renders DIFFERENT date ranges for two columns with heterogeneous windows", () => {
    render(
      <ScenarioCompareTable
        columns={[
          col("Early", healthy(80, { effective_start: "2023-01-02", effective_end: "2023-06-01" })),
          col("Late", healthy(80, { effective_start: "2024-01-02", effective_end: "2024-06-03" })),
        ]}
        liveBook={null}
      />,
    );

    const earlyStamp = screen.getByTestId("stamp-Early");
    const lateStamp = screen.getByTestId("stamp-Late");
    // Heterogeneous windows are visible — each column shows its OWN range.
    expect(earlyStamp.textContent).toMatch(/2023-01-02–2023-06-01/);
    expect(lateStamp.textContent).toMatch(/2024-01-02–2024-06-03/);
    // They are DIFFERENT — not force-aligned to a shared window.
    expect(earlyStamp.textContent).not.toBe(lateStamp.textContent);
  });

  it("suppresses the date range on an undecodable (older-format) column", () => {
    render(
      <ScenarioCompareTable
        columns={[
          col("Healthy", healthy(120)),
          { ...col("Older", degenerate(0)), undecodable: true },
        ]}
        liveBook={null}
      />,
    );

    const olderStamp = screen.getByTestId("stamp-Older");
    // Only the older-format stamp — no date range (no honest window to show).
    expect(
      within(olderStamp).getByText(/Saved in an older format — can't be compared/),
    ).toBeInTheDocument();
    expect(olderStamp.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(olderStamp.querySelector("span.font-mono.tabular-nums")).toBeNull();
  });

  it("suppresses the date range on a below-sample-floor column", () => {
    render(
      <ScenarioCompareTable
        columns={[col("Healthy", healthy(120)), col("Thin", healthy(30))]}
        liveBook={null}
      />,
    );

    const thinStamp = screen.getByTestId("stamp-Thin");
    // Below-floor column shows only the neutral sample-floor copy — no date range.
    expect(
      within(thinStamp).getByText(/Not enough history for this estimate/),
    ).toBeInTheDocument();
    expect(thinStamp.textContent).not.toMatch(/·\s*\d{4}-\d{2}-\d{2}–/);
    expect(thinStamp.querySelector("span.font-mono.tabular-nums")).toBeNull();
  });

  it("omits the date range when a verdict.ok column has null effective bounds (degenerate but usable)", () => {
    // A column that clears the sample floor (n >= 60) but whose engine returned
    // null effective bounds shows just the day-count stamp — no fabricated range.
    render(
      <ScenarioCompareTable
        columns={[
          col("Healthy", healthy(120)),
          col("NoBounds", healthy(80, { effective_start: null, effective_end: null })),
        ]}
        liveBook={null}
      />,
    );

    const stamp = screen.getByTestId("stamp-NoBounds");
    // The day-count stamp still renders; no date range.
    expect(within(stamp).getByText(methodologyLine(80))).toBeInTheDocument();
    expect(stamp.querySelector("span.font-mono.tabular-nums")).toBeNull();
  });

  it("renders the under-selection hint with fewer than 2 columns", () => {
    render(<ScenarioCompareTable columns={[]} liveBook={null} />);
    expect(
      screen.getByText("Select 2 or more scenarios (or the live book) to compare."),
    ).toBeInTheDocument();
  });

  it("renders the older-format stamp for an undecodable column, NOT the overlap-days floor copy", () => {
    // An undecodable (codec 'reset') column carries n=0 NULL metrics AND the
    // undecodable flag → its footer must say "older format", not "shares 0
    // overlapping days — fewer than the 60 needed" (the #509 conflation).
    render(
      <ScenarioCompareTable
        columns={[
          col("Healthy", healthy(120)),
          { ...col("Older", degenerate(0)), undecodable: true },
        ]}
        liveBook={null}
      />,
    );

    const olderStamp = screen.getByTestId("stamp-Older");
    expect(
      within(olderStamp).getByText(/Saved in an older format — can't be compared/),
    ).toBeInTheDocument();
    // The sample-floor "overlapping days" copy must NOT appear for this column.
    expect(olderStamp.textContent).not.toMatch(/overlapping days/);
    expect(olderStamp.textContent).not.toMatch(/Not enough history for this estimate/);
  });

  it("a decodable-but-degenerate n=0 column STILL shows the sample-floor copy (not older-format)", () => {
    // A genuinely degenerate column (n=0 but DECODABLE — no undecodable flag)
    // must keep the floor copy; only the reset-decode case changes (FIX 6).
    render(
      <ScenarioCompareTable
        columns={[col("Healthy", healthy(120)), col("Degenerate", degenerate(0))]}
        liveBook={null}
      />,
    );

    const degenStamp = screen.getByTestId("stamp-Degenerate");
    // n=0 < floor(60) → the below-floor body names the actual overlap (0 days).
    expect(within(degenStamp).getByText(/overlapping days/)).toBeInTheDocument();
    expect(degenStamp.textContent).not.toMatch(/Saved in an older format/);
  });

  it("treats a NaN/non-finite metric as honest absence ('—'), never the winner", () => {
    // A NaN twr must read as "—" at the SOURCE (getValue), so it cannot be
    // crowned the Cumulative Return winner. Three columns: one NaN + two finite,
    // so winner logic still has >= 2 real values (FIX 7 only suppresses the ✓
    // when fewer than 2 columns are real — irrelevant here).
    const nanCol = healthy(120, { twr: NaN });
    const lowReal = healthy(120, { twr: 0.1 });
    const highReal = healthy(120, { twr: 0.25 });
    render(
      <ScenarioCompareTable
        columns={[col("Broken", nanCol), col("Low", lowReal), col("High", highReal)]}
        liveBook={null}
      />,
    );

    // The NaN column's twr cell renders the em-dash, not "NaN" / "NaN%".
    const brokenCell = screen.getByTestId("cell-Broken-twr");
    expect(brokenCell.textContent).toBe("—");
    expect(brokenCell.textContent).not.toMatch(/NaN/i);

    // The winner is the highest FINITE column — the NaN column never wins.
    const twrWinner = screen.getByTestId("winner-twr");
    expect(twrWinner.textContent).toContain("25.00%");
    expect(twrWinner.textContent).not.toMatch(/NaN|—/);
  });
});
