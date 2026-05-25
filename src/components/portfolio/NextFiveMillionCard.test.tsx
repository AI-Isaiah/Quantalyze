import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NextFiveMillionCard } from "./NextFiveMillionCard";
import type { OptimizerSuggestionRow } from "@/lib/types";

/**
 * Parse the rendered dollar cells back to numbers and sum them. The card
 * renders each allocation via formatCurrency → "$X.YM" (1-decimal at the
 * million scale). Each row therefore carries up to ±$50K of display
 * rounding, so a 3-row sum can drift up to ±$150K from the true total —
 * but a real math regression (e.g. allocating half the amount, or
 * dividing by the wrong denominator) would blow far past that tolerance.
 */
function sumRenderedAllocations(): number {
  const list = screen.getByRole("list");
  const cells = within(list).getAllByText(/^\$[\d.]+[MK]?$/);
  return cells.reduce((sum, el) => {
    const txt = el.textContent ?? "";
    const m = txt.match(/^\$([\d.]+)([MK]?)$/);
    if (!m) return sum;
    const n = parseFloat(m[1]);
    const scale = m[2] === "M" ? 1_000_000 : m[2] === "K" ? 1_000 : 1;
    return sum + n * scale;
  }, 0);
}

function suggestion(
  strategy_id: string,
  strategy_name: string,
  score: number,
): OptimizerSuggestionRow {
  return {
    strategy_id,
    strategy_name,
    corr_with_portfolio: 0,
    sharpe_lift: 0,
    dd_improvement: 0,
    score,
  };
}

describe("<NextFiveMillionCard>", () => {
  it("returns null when suggestions is null", () => {
    const { container } = render(
      <NextFiveMillionCard suggestions={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when suggestions is empty", () => {
    const { container } = render(<NextFiveMillionCard suggestions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the top 3 suggestions weighted by score", () => {
    render(
      <NextFiveMillionCard
        suggestions={[
          suggestion("a", "Alpha", 0.4),
          suggestion("b", "Beta", 0.3),
          suggestion("c", "Gamma", 0.2),
          suggestion("d", "Delta", 0.1),
        ]}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
    expect(screen.queryByText("Delta")).toBeNull();
    expect(screen.getByText("$2.2M")).toBeInTheDocument(); // 5M * 0.4 / 0.9
  });

  it("distributes equally when all scores are zero", () => {
    render(
      <NextFiveMillionCard
        suggestions={[
          suggestion("a", "Alpha", 0),
          suggestion("b", "Beta", 0),
          suggestion("c", "Gamma", 0),
        ]}
      />,
    );
    const cells = screen.getAllByText("$1.7M");
    expect(cells).toHaveLength(3);
  });

  // M-0446 (audit-2026-05-07) — the per-row display checks above never
  // assert the allocations SUM to the deployable amount. A published IC
  // report that adds to $4.9M or $5.1M is an embarrassment. These pin the
  // total (within display-rounding tolerance) for both the equal-split and
  // an uneven 7-strategy score distribution.
  it("M-0446: equal-split allocations sum to ~$5M", () => {
    render(
      <NextFiveMillionCard
        suggestions={[
          suggestion("a", "Alpha", 0),
          suggestion("b", "Beta", 0),
          suggestion("c", "Gamma", 0),
        ]}
      />,
    );
    // 3 rows of $1.7M displayed; underlying raw split is exactly 5M/3 each,
    // summing to 5_000_000. Display rounding tolerance: ±$150K over 3 rows.
    // Tolerance: ±$50K display rounding per row × 3 rows = ±$150K.
    expect(Math.abs(sumRenderedAllocations() - 5_000_000)).toBeLessThanOrEqual(150_000);
  });

  it("M-0446: uneven 7-strategy scores still allocate ~$5M across the top 3", () => {
    render(
      <NextFiveMillionCard
        suggestions={[
          suggestion("a", "Alpha", 0.42),
          suggestion("b", "Beta", 0.27),
          suggestion("c", "Gamma", 0.18),
          suggestion("d", "Delta", 0.07),
          suggestion("e", "Epsilon", 0.03),
          suggestion("f", "Zeta", 0.02),
          suggestion("g", "Eta", 0.01),
        ]}
      />,
    );
    // Only the top 3 (Alpha/Beta/Gamma) render; their proportional shares of
    // $5M sum to exactly $5M before display rounding.
    expect(screen.queryByText("Delta")).toBeNull();
    // Tolerance: ±$50K display rounding per row × 3 rows = ±$150K.
    expect(Math.abs(sumRenderedAllocations() - 5_000_000)).toBeLessThanOrEqual(150_000);
  });

  it("respects custom amount", () => {
    render(
      <NextFiveMillionCard
        amount={1_000_000}
        suggestions={[suggestion("a", "Alpha", 1)]}
      />,
    );
    expect(screen.getByText("$1.0M")).toBeInTheDocument();
    expect(
      screen.getByText(/Where would the next \$1.0M go/),
    ).toBeInTheDocument();
  });

  it("allocates 100% of the amount to a single suggestion", () => {
    // Missing 10th test called out by PR 7 review: with a single positive
    // suggestion, the entire amount should flow to that row.
    render(
      <NextFiveMillionCard
        amount={3_000_000}
        suggestions={[suggestion("a", "Solo", 0.9)]}
      />,
    );
    expect(screen.getByText("Solo")).toBeInTheDocument();
    expect(screen.getByText("$3.0M")).toBeInTheDocument();
  });
});
