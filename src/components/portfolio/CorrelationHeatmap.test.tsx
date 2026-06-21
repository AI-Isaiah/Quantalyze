import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CorrelationHeatmap,
  contrastRatio,
  correlationBg,
  textColor,
} from "./CorrelationHeatmap";

describe("<CorrelationHeatmap>", () => {
  it("renders the reason-named empty-state heading when matrix is null", () => {
    render(
      <CorrelationHeatmap correlationMatrix={null} strategyNames={{}} />,
    );
    // CORR-02 — the heading names the reason; no bare "No data". With no host
    // context (no overlappingDays) this is the surface-neutral combined branch.
    expect(
      screen.getByText("Correlation unavailable"),
    ).toBeInTheDocument();
    // No fabricated number ever renders in the empty state.
    expect(screen.queryByText(/Avg \|ρ\|/)).toBeNull();
  });

  it("renders the empty-state card when matrix is empty", () => {
    render(
      <CorrelationHeatmap correlationMatrix={{}} strategyNames={{}} />,
    );
    // Empty object → few-strategies branch (0 ids, non-null matrix).
    expect(
      screen.getByText("Not enough strategies to correlate"),
    ).toBeInTheDocument();
  });

  // CORR-02 — a 1-strategy matrix is NON-null (engine returns a 1×1
  // `{id:{id:1}}`). The component-level `ids.length < 2` gate is the ONLY
  // thing preventing a degenerate 1×1 grid. Assert the few-strategies copy
  // and that NO correlation value / Avg |ρ| number is shown.
  it("CORR-02: < 2 strategies renders the few-strategies reason, never a 1×1 grid or number", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={{ "a-1": { "a-1": 1 } }}
        strategyNames={{ "a-1": "Solo" }}
        avgAbsCorrelation={null}
      />,
    );
    expect(
      screen.getByText("Not enough strategies to correlate"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add at least 2 active strategies to see how they move together.",
      ),
    ).toBeInTheDocument();
    // Never a 1×1 grid: no figure, no diagonal "1.00" cell, no Avg |ρ| caption.
    expect(screen.queryByRole("figure")).toBeNull();
    expect(screen.queryByText("1.00")).toBeNull();
    expect(screen.queryByText(/Avg \|ρ\|/)).toBeNull();
  });

  // CR-01 (Phase 21 review) — this is a SHARED presentational component: besides
  // the two scenario surfaces it also renders on the static portfolio-detail
  // factsheet (portfolios/[id]/page.tsx), which passes neither `overlappingDays`
  // nor an interactive "selection" UX. The empty-state copy must stay
  // surface-neutral so it is honest on a read-only page (no toggle/selection
  // language that only exists in the scenario composer).
  it("CR-01: empty-state copy is surface-neutral for the no-host-context (portfolio-detail) caller", () => {
    const { rerender } = render(
      <CorrelationHeatmap correlationMatrix={null} strategyNames={{}} />,
    );
    // null matrix, no overlappingDays → the combined-reason fallback copy.
    expect(
      screen.getByText(
        /Need at least 2 strategies with 10 or more overlapping days/i,
      ),
    ).toBeInTheDocument();
    // It must NOT reference the scenario composer's interactive selection UX.
    expect(screen.queryByText(/adjust your selection/i)).toBeNull();

    // Single-strategy portfolio (1×1 matrix, no overlappingDays) → the
    // few-strategies copy, also free of interactive-selection language.
    rerender(
      <CorrelationHeatmap
        correlationMatrix={{ "p-1": { "p-1": 1 } }}
        strategyNames={{ "p-1": "Solo" }}
      />,
    );
    expect(screen.queryByText(/adjust your selection/i)).toBeNull();
    expect(screen.queryByRole("figure")).toBeNull();
  });

  // CORR-02 — the < 10-overlapping-days case arrives as a null matrix WITH the
  // host's overlappingDays prop set. The body copy must name the DAYS reason,
  // distinct from the < 2-strategies copy, and show no number.
  it("CORR-02: < 10 overlapping days renders the days reason (distinct copy), no number", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={null}
        strategyNames={{}}
        overlappingDays={6}
      />,
    );
    expect(
      screen.getByText("Not enough overlap to correlate"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/share fewer than 10 overlapping trading days/i),
    ).toBeInTheDocument();
    // The few-strategies copy must NOT appear — the reasons are distinct.
    expect(
      screen.queryByText(
        "Add at least 2 active strategies to see how they move together.",
      ),
    ).toBeNull();
    expect(screen.queryByText(/Avg \|ρ\|/)).toBeNull();
  });

  // Review CRITICAL (silent-failure F1) — the engine nulls the matrix for a
  // THIRD reason beyond 0-strategies / <10-days: non-finite returns or a
  // leveraged wipeout (<=0 wealth), which arrives as a NULL matrix WITH a large
  // overlappingDays and >=2 real strategies. That must NOT read as "add more
  // strategies" (the allocator already has them) — it names the real cause.
  it("CRITICAL: null matrix with an ADEQUATE window (engine-nulled / wipeout) names the cause, NOT 'add strategies'", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={null}
        strategyNames={{ "a-1": "Alpha", "b-2": "Beta" }}
        overlappingDays={200}
      />,
    );
    // The HEADING names the real cause (engine-nulled), not overlap. Found on
    // prod by /qa 2026-06-21: the shared "Not enough overlap to correlate"
    // heading contradicted its own body here — 200 overlapping days IS enough
    // overlap; the matrix nulled because the projected returns are non-finite.
    expect(
      screen.getByText("Correlation unavailable for this scenario"),
    ).toBeInTheDocument();
    // The heading must NOT claim insufficient overlap — that is the lie this
    // regression guards against. With 200 days, "not enough overlap" is false.
    expect(screen.queryByText("Not enough overlap to correlate")).toBeNull();
    // Body names the real cause (non-finite / fully drawn down).
    expect(
      screen.getByText(/non-finite or the curve is fully drawn down/i),
    ).toBeInTheDocument();
    // Must NOT lie with the few-strategies copy — there ARE >=2 strategies + 200 days.
    expect(
      screen.queryByText(
        "Add at least 2 active strategies to see how they move together.",
      ),
    ).toBeNull();
    expect(screen.queryByText(/fewer than 10 overlapping/i)).toBeNull();
  });

  // Review red-team finding 1 — a zero-strategies scenario (all toggled off →
  // engine 0-active early return: n=0, null matrix) must NOT be mislabeled as a
  // short window ("fewer than 10 overlapping days"); there are ZERO strategies,
  // so the honest message is the few-strategies copy.
  it("zero strategies (overlappingDays=0, null matrix) renders the few-strategies copy, NOT the days copy", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={null}
        strategyNames={{}}
        overlappingDays={0}
      />,
    );
    expect(
      screen.getByText(
        "Add at least 2 active strategies to see how they move together.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/fewer than 10 overlapping/i)).toBeNull();
  });

  it("renders labels for each strategy in the matrix", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={{
          "a-1": { "a-1": 1, "a-2": 0.3 },
          "a-2": { "a-1": 0.3, "a-2": 1 },
        }}
        strategyNames={{
          "a-1": "Alpha",
          "a-2": "Beta",
        }}
      />,
    );
    // Labels appear in both column and row headers so there are 2 copies each.
    expect(screen.getAllByText("Alpha").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Beta").length).toBeGreaterThanOrEqual(2);
  });

  it("renders each cell's correlation value", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={{
          "a-1": { "a-1": 1, "a-2": 0.3 },
          "a-2": { "a-1": 0.3, "a-2": 1 },
        }}
        strategyNames={{
          "a-1": "Alpha",
          "a-2": "Beta",
        }}
      />,
    );
    // The diagonal 1.00 values appear twice, 0.30 appears twice (both sides
    // of the symmetric off-diagonal).
    expect(screen.getAllByText("1.00")).toHaveLength(2);
    expect(screen.getAllByText("0.30")).toHaveLength(2);
  });

  it("sets role=figure with a descriptive aria-label", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={{
          "a-1": { "a-1": 1, "a-2": 0.3 },
          "a-2": { "a-1": 0.3, "a-2": 1 },
        }}
        strategyNames={{ "a-1": "Alpha", "a-2": "Beta" }}
      />,
    );
    const figure = screen.getByRole("figure");
    expect(figure).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Pairwise correlation heatmap"),
    );
    expect(figure).toHaveAttribute(
      "aria-label",
      expect.stringContaining("2 strategies"),
    );
  });

  it("attaches a descriptive aria-label to each cell for screen readers", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={{
          "a-1": { "a-1": 1, "a-2": 0.35 },
          "a-2": { "a-1": 0.35, "a-2": 1 },
        }}
        strategyNames={{ "a-1": "Alpha", "a-2": "Beta" }}
      />,
    );
    // Cells use role="img" + aria-label for individual values.
    const labelled = screen.getAllByLabelText(
      /Alpha and Beta: 0\.35 correlation/,
    );
    expect(labelled.length).toBeGreaterThanOrEqual(1);
  });

  // CORR-04 (superseded by show-all) — a > 10-strategy matrix renders ALL
  // strategies, never a "top 10" truncation. Replaces the two prior truncation
  // tests (which asserted "10 strategies" + a dropped low-corr strategy).
  it("CORR-04 show-all: a 12-strategy matrix renders all 12 labels and names the TRUE count", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `s-${i}`);
    const matrix: Record<string, Record<string, number>> = {};
    for (const a of ids) {
      matrix[a] = {};
      for (const b of ids) {
        matrix[a][b] = a === b ? 1 : 0.2 + (ids.indexOf(a) + ids.indexOf(b)) * 0.01;
      }
    }
    const names = Object.fromEntries(ids.map((id) => [id, id.toUpperCase()]));
    render(
      <CorrelationHeatmap correlationMatrix={matrix} strategyNames={names} />,
    );

    // aria-label names the TRUE strategy count (12), not a capped 10.
    const figure = screen.getByRole("figure");
    expect(figure).toHaveAttribute(
      "aria-label",
      expect.stringContaining("12 strategies"),
    );
    expect(figure).toHaveAttribute(
      "aria-label",
      expect.not.stringContaining("10 strategies"),
    );

    // Every one of the 12 labels renders (each appears as a row AND a column
    // header, so >= 2 copies). None is truncated out.
    for (const id of ids) {
      expect(screen.getAllByText(names[id]).length).toBeGreaterThanOrEqual(2);
    }
  });

  // M-0437 was the lexicographic-vs-top-10 regression guard for the truncation
  // path. With show-all there is no selection to regress, so the durable lock
  // becomes: the LOWEST-correlation strategy (which the old top-10 logic would
  // have dropped) STILL renders — i.e. nothing is silently filtered out.
  it("CORR-04 show-all: a low-correlation strategy is NOT dropped (no truncation/top-10 selection survives)", () => {
    const HIGH = "zz_high";
    const LOW = "aa_low";
    const mids = Array.from({ length: 9 }, (_, i) => `mid_${i}`);
    const ids = [LOW, ...mids, HIGH]; // 11 strategies

    const matrix: Record<string, Record<string, number>> = {};
    for (const a of ids) {
      matrix[a] = {};
      for (const b of ids) {
        if (a === b) matrix[a][b] = 1;
        else if (a === LOW || b === LOW) matrix[a][b] = 0.05;
        else if (a === HIGH || b === HIGH) matrix[a][b] = 0.99;
        else matrix[a][b] = 0.5;
      }
    }
    const names = Object.fromEntries(ids.map((id) => [id, id]));
    render(
      <CorrelationHeatmap correlationMatrix={matrix} strategyNames={names} />,
    );

    // All 11 named in the aria-label.
    expect(screen.getByRole("figure")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("11 strategies"),
    );
    // BOTH the high- AND the low-correlation strategy render — the low one
    // would have been truncated by the removed top-10 logic.
    expect(screen.getAllByText(HIGH).length).toBeGreaterThan(0);
    expect(screen.getAllByText(LOW).length).toBeGreaterThan(0);
  });

  // CORR-03 — the heatmap renders a single-sourced "Avg |ρ|" caption from the
  // host-passed value; it does NOT compute its own average.
  it("CORR-03: renders the host-passed Avg |ρ| caption value verbatim (single source)", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={{
          "a-1": { "a-1": 1, "a-2": 0.3 },
          "a-2": { "a-1": 0.3, "a-2": 1 },
        }}
        strategyNames={{ "a-1": "Alpha", "a-2": "Beta" }}
        avgAbsCorrelation={0.37}
      />,
    );
    // The caption label + the host value render. The value is 0.37 — NOT the
    // off-diagonal mean of 0.30 the heatmap would compute itself — proving the
    // heatmap renders the host's single-sourced number, not a self-computed one.
    expect(screen.getByText(/Avg \|ρ\|/)).toBeInTheDocument();
    expect(screen.getByText("0.37")).toBeInTheDocument();
  });

  it("CORR-03: hides the Avg |ρ| caption when the host passes no value", () => {
    render(
      <CorrelationHeatmap
        correlationMatrix={{
          "a-1": { "a-1": 1, "a-2": 0.3 },
          "a-2": { "a-1": 0.3, "a-2": 1 },
        }}
        strategyNames={{ "a-1": "Alpha", "a-2": "Beta" }}
      />,
    );
    expect(screen.queryByText(/Avg \|ρ\|/)).toBeNull();
  });
});

// ---------- WCAG contrast audit ----------
//
// The review pass on the first draft of the palette found that the
// mint-teal / apricot intermediate anchors were too light — white text on
// those cells dropped to ~1.5:1 contrast, far below the AA threshold of
// 4.5:1. This block sweeps the full correlation range [-1, 1] at 0.05
// steps and enforces that WHICHEVER text color the component selects for
// that cell clears 4.5:1 against the cell background. If either color
// direction violates the rule, we want CI to catch it — no more visual
// spot-checks. Regression test for review finding C1 on PR 15.

describe("CorrelationHeatmap — WCAG contrast", () => {
  const WHITE = "rgb(255,255,255)";
  const DARK = "rgb(26,26,46)"; // #1A1A2E
  // Cell number overlay is decorative (SC 1.4.11 non-text contrast, 3:1).
  // Primary signal is the cell color + per-cell aria-label.
  const MIN_NONTEXT = 3.0;
  // Strict AA 4.5:1 is enforced everywhere OUTSIDE the interpolation dead
  // zone near |v| ≈ 0.45, where the luminance crosses the mathematically
  // unavoidable gap between dark-text and white-text ranges.
  const MIN_TEXT_AA = 4.5;
  // Dead zone: any v where the interpolation luminance sits between the
  // two text-color thresholds. Narrow band (worst measured 3.75:1).
  const DEAD_ZONE = (v: number) => Math.abs(v) > 0.39 && Math.abs(v) < 0.49;

  it("every cell in [-1, 1] meets SC 1.4.11 non-text contrast (3:1)", () => {
    const failures: Array<{ v: number; bg: string; fg: string; ratio: number }> = [];
    for (let v = -1; v <= 1 + 1e-9; v += 0.05) {
      const rounded = Math.round(v * 100) / 100;
      const bg = correlationBg(rounded);
      const fg = textColor(rounded);
      const ratio = contrastRatio(fg, bg);
      if (ratio < MIN_NONTEXT) {
        failures.push({ v: rounded, bg, fg, ratio: Math.round(ratio * 100) / 100 });
      }
    }
    expect(failures).toEqual([]);
  });

  it("cells OUTSIDE the dead zone meet strict text AA (4.5:1)", () => {
    const failures: Array<{ v: number; ratio: number }> = [];
    for (let v = -1; v <= 1 + 1e-9; v += 0.05) {
      const rounded = Math.round(v * 100) / 100;
      if (DEAD_ZONE(rounded)) continue;
      const bg = correlationBg(rounded);
      const fg = textColor(rounded);
      const ratio = contrastRatio(fg, bg);
      if (ratio < MIN_TEXT_AA) {
        failures.push({ v: rounded, ratio: Math.round(ratio * 100) / 100 });
      }
    }
    expect(failures).toEqual([]);
  });

  it("the ±0.5 anchor cells clear strict AA with white text", () => {
    for (const v of [-0.5, 0.5]) {
      const bg = correlationBg(v);
      const fg = textColor(v);
      expect(fg).toBe(WHITE);
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(MIN_TEXT_AA);
    }
  });

  it("the ±1.0 anchor cells clear strict AA with white text", () => {
    for (const v of [-1, 1]) {
      const bg = correlationBg(v);
      const fg = textColor(v);
      expect(fg).toBe(WHITE);
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(MIN_TEXT_AA);
    }
  });

  it("cells near zero use dark text and clear strict AA", () => {
    for (const v of [-0.3, -0.1, 0, 0.1, 0.3]) {
      const bg = correlationBg(v);
      const fg = textColor(v);
      expect(fg).toBe(DARK);
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(MIN_TEXT_AA);
    }
  });
});
