import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlendHeader } from "./BlendHeader";
import type { ComputedMetrics } from "@/lib/scenario";
import type { CoverageWindow } from "@/lib/scenario-window";

/**
 * Phase 58 / 58-01 Task 1 — BlendHeader (COVERAGE-03).
 *
 * The always-visible honest blend header reads the engine's single membership
 * axis (`member_count` / `effective_start` / `effective_end`) — never a locally
 * recomputed `covers()` / `coverageEligible` count (Pitfall 1, divisor desync).
 * It degrades honestly across four branches and is a non-blocking live region
 * (`role="status"`, NEVER `role="alert"`).
 *
 * Branch coverage (per 58-UI-SPEC §Copywriting Contract, verbatim strings):
 *   - N=0            → "No strategies span the selected window"
 *   - N=1            → "1 strategy — not a blend"
 *   - N>=2 normal    → "Mean of {N} strategies · {effStart}–{effEnd}"
 *   - N>=2 truncated → appends "· window truncated from full range"
 */

const EMPTY_METRICS: ComputedMetrics = {
  n: 0,
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

describe("BlendHeader (COVERAGE-03)", () => {
  it("N=0 → honest empty state, never a fabricated zero", () => {
    const metrics: ComputedMetrics = { ...EMPTY_METRICS, member_count: 0 };
    render(<BlendHeader metrics={metrics} unionSpan={null} />);
    expect(
      screen.getByText("No strategies span the selected window"),
    ).toBeInTheDocument();
  });

  it("undefined member_count is read as N=0 (?? 0)", () => {
    render(<BlendHeader metrics={EMPTY_METRICS} unionSpan={null} />);
    expect(
      screen.getByText("No strategies span the selected window"),
    ).toBeInTheDocument();
  });

  it("N=1 → 'not a blend' degrade", () => {
    const metrics: ComputedMetrics = {
      ...EMPTY_METRICS,
      member_count: 1,
      effective_start: "2023-01-01",
      effective_end: "2024-12-31",
    };
    render(<BlendHeader metrics={metrics} unionSpan={null} />);
    expect(screen.getByText(/1 strategy — not a blend/)).toBeInTheDocument();
  });

  it("N>=2, not truncated → 'Mean of N strategies · start–end'", () => {
    const metrics: ComputedMetrics = {
      ...EMPTY_METRICS,
      member_count: 3,
      effective_start: "2022-06-15",
      effective_end: "2024-06-15",
    };
    const unionSpan: CoverageWindow = { start: "2022-06-15", end: "2024-06-15" };
    render(<BlendHeader metrics={metrics} unionSpan={unionSpan} />);
    // The label spans wrap N + dates in mono; assert the visible composed text.
    expect(screen.getByText(/Mean of/)).toHaveTextContent(
      "Mean of 3 strategies · 2022-06-15–2024-06-15",
    );
    // Not truncated → no truncation note.
    expect(
      screen.queryByText(/window truncated from full range/),
    ).not.toBeInTheDocument();
  });

  it("N>=2, effective window narrower than union → appends truncation note", () => {
    const metrics: ComputedMetrics = {
      ...EMPTY_METRICS,
      member_count: 2,
      effective_start: "2023-01-01",
      effective_end: "2024-01-01",
    };
    // Union is wider than the effective window on both bounds → truncated.
    const unionSpan: CoverageWindow = { start: "2022-01-01", end: "2025-01-01" };
    render(<BlendHeader metrics={metrics} unionSpan={unionSpan} />);
    expect(
      screen.getByText(/window truncated from full range/),
    ).toBeInTheDocument();
  });

  it("root is a polite live region (role=status, never role=alert)", () => {
    const metrics: ComputedMetrics = { ...EMPTY_METRICS, member_count: 0 };
    const { container } = render(
      <BlendHeader metrics={metrics} unionSpan={null} />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
