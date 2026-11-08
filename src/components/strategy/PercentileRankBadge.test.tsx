import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PercentileRankBadge } from "./PercentileRankBadge";
import { shortTrackMarkerTitle } from "@/lib/figure-gate";

/**
 * Phase 194 plan 18 (D-11 as superseded by D-15, founder-decided 2026-11-07): a peer rank of
 * an annualised figure for a record that cleared D-15's minimum but spans under a year shows,
 * qualified by the `<1y` marker. The marker carries its reason in `title` and in sr-only text
 * so a screen reader hears it. The badge only renders what its caller decides; whether a rank
 * exists (a withheld record has none) is decided upstream.
 */
afterEach(cleanup);

describe("PercentileRankBadge - short-track marker", () => {
  it("renders the rank text plus <1y with the reason in title and sr-only text when shortTrackDays is given", () => {
    render(<PercentileRankBadge metric="sharpe" percentile={80} shortTrackDays={200} />);

    const badge = screen.getByTestId("percentile-rank-badge");
    expect(badge).toHaveTextContent("Sharpe");
    expect(badge).toHaveTextContent("80th");
    expect(badge).toHaveTextContent("<1y");

    const reason = shortTrackMarkerTitle(200);
    // `title` on the marker itself, and the same sentence for assistive technology.
    expect(screen.getByTitle(reason)).toHaveTextContent("<1y");
    const sr = badge.querySelector(".sr-only");
    expect(sr).not.toBeNull();
    expect(sr).toHaveTextContent(reason);
  });

  it("renders exactly as before when shortTrackDays is absent or null", () => {
    const { container, rerender } = render(<PercentileRankBadge metric="sharpe" percentile={80} />);
    const without = container.innerHTML;
    expect(without).not.toContain("<1y");
    expect(container.querySelector(".sr-only")).toBeNull();

    rerender(<PercentileRankBadge metric="sharpe" percentile={80} shortTrackDays={null} />);
    expect(container.innerHTML).toBe(without);
  });

  it("renders nothing for a null percentile even when shortTrackDays is given (a withheld record has no rank to qualify)", () => {
    const { container } = render(
      <PercentileRankBadge metric="sharpe" percentile={null} shortTrackDays={200} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the unqualified title untouched", () => {
    render(
      <PercentileRankBadge metric="cagr" percentile={63} categoryLabel="momentum" shortTrackDays={120} />,
    );
    expect(screen.getByTestId("percentile-rank-badge")).toHaveAttribute(
      "title",
      "CAGR is in the 63rd percentile in momentum",
    );
  });
});
