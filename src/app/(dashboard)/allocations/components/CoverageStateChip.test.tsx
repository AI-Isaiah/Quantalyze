import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoverageStateChip } from "./CoverageStateChip";
import type { CoverageState } from "./CoverageStateChip";

/**
 * Phase 58 / 58-01 Task 2 — CoverageStateChip (COVERAGE-02).
 *
 * A pure presentational three-state chip whose `state` is derived UPSTREAM in
 * the composer from `selected` + `coverageEligible` — the chip never re-derives
 * membership (never imports `covers` / `coverageSpanOf`).
 *
 * LOCKED state → label → token mapping (58-UI-SPEC §Color, verbatim labels):
 *   in-blend           → "In blend"       (text-accent bg-accent/10)
 *   manually-excluded  → "Excluded"       (text-text-muted bg-track)
 *   auto-excluded      → "Outside window" (text-warning bg-warning-bg border-warning-border)
 *
 * The text label always carries the meaning (color is never the sole signal —
 * WCAG-AA). Auto-excluded is AMBER, never negative/red (it is transient-
 * recoverable — narrowing the window brings the strategy back).
 */

describe("CoverageStateChip (COVERAGE-02)", () => {
  it("in-blend → 'In blend' with accent tokens", () => {
    render(<CoverageStateChip state="in-blend" />);
    const chip = screen.getByText("In blend");
    expect(chip).toBeInTheDocument();
    expect(chip.className).toContain("text-accent");
    expect(chip.className).toContain("bg-accent/10");
  });

  it("manually-excluded → 'Excluded' with muted-neutral tokens", () => {
    render(<CoverageStateChip state="manually-excluded" />);
    const chip = screen.getByText("Excluded");
    expect(chip).toBeInTheDocument();
    expect(chip.className).toContain("text-text-muted");
    expect(chip.className).toContain("bg-track");
  });

  it("auto-excluded → 'Outside window' with amber (warning) tokens, never red", () => {
    render(<CoverageStateChip state="auto-excluded" />);
    const chip = screen.getByText("Outside window");
    expect(chip).toBeInTheDocument();
    expect(chip.className).toContain("text-warning");
    expect(chip.className).toContain("bg-warning-bg");
    expect(chip.className).toContain("border-warning-border");
    // Transient-recoverable → amber, NEVER negative/red.
    expect(chip.className).not.toMatch(/text-negative|bg-red|text-red/);
  });

  it("syncing → 'Syncing' with amber (warning) tokens, never red", () => {
    render(<CoverageStateChip state="syncing" />);
    const chip = screen.getByText("Syncing");
    expect(chip).toBeInTheDocument();
    expect(chip.className).toContain("text-warning");
    expect(chip.className).toContain("bg-warning-bg");
    expect(chip.className).toContain("border-warning-border");
    // The server WILL finish computing on its own → transient-recoverable amber.
    // Red would claim permanence (147-UI-SPEC Semantic-color gate).
    expect(chip.className).not.toMatch(/text-negative|bg-red|text-red/);
  });

  it("no-series → 'No data' with muted tokens, never red", () => {
    render(<CoverageStateChip state="no-series" />);
    const chip = screen.getByText("No data");
    expect(chip).toBeInTheDocument();
    expect(chip.className).toContain("text-text-muted");
    expect(chip.className).toContain("bg-track");
    // Absence is a neutral steady-state fact, not a failure. DESIGN.md:
    // "Red = permanent/negative only… never for absence, never for a zero."
    expect(chip.className).not.toMatch(/text-negative|bg-red|text-red/);
  });

  it("carries the shared Badge ladder base shape on every state", () => {
    // Record<CoverageState, …> makes the ladder EXHAUSTIVE at compile time: a
    // new union member that is not listed here is a type error, so the
    // base-shape pin can never go partially vacuous (147-05 Task 1).
    const labels: Record<CoverageState, string> = {
      "in-blend": "In blend",
      "manually-excluded": "Excluded",
      "auto-excluded": "Outside window",
      syncing: "Syncing",
      "no-series": "No data",
    };
    const states = Object.keys(labels) as CoverageState[];
    expect(states).toHaveLength(5);
    for (const state of states) {
      const { unmount } = render(<CoverageStateChip state={state} />);
      const chip = screen.getByText(labels[state]);
      expect(chip.className).toContain("uppercase");
      expect(chip.className).toContain("text-fixed-11");
      unmount();
    }
  });

  it("merges a passed className", () => {
    render(<CoverageStateChip state="in-blend" className="ml-2" />);
    expect(screen.getByText("In blend").className).toContain("ml-2");
  });
});
