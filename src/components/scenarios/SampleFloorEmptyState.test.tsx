import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SampleFloorEmptyState } from "./SampleFloorEmptyState";
import { evaluateSampleFloor } from "@/lib/sample-floor";

/**
 * HONEST-02 — render proof for the below-floor honest empty state.
 *
 * This proves the empty state RENDERS (for export to Phases 26/27); it does NOT
 * wire the gate into the live composer/sandbox projection (RESEARCH Open Q3).
 *
 * Mirrors the Phase-21 `CorrelationHeatmap.test.tsx` empty-state assertion
 * style: name the reason + the numbers, never fabricate, and crucially assert
 * the card is honest absence (no `role="alert"`, no red/warning color) — a
 * below-floor state is NOT an error (UI-SPEC Color).
 */

describe("<SampleFloorEmptyState>", () => {
  it("below-floor verdict renders the heading and a body naming BOTH N and the floor", () => {
    render(
      <SampleFloorEmptyState
        verdict={evaluateSampleFloor(30)}
        feature="stress"
      />,
    );
    expect(
      screen.getByText("Not enough history for this estimate"),
    ).toBeInTheDocument();
    // Body names the actual N (30) and the floor (60) — never "No data".
    const body = screen.getByText(/overlapping days/);
    expect(body.textContent).toContain("30");
    expect(body.textContent).toContain("60");
    expect(body.textContent).not.toMatch(/no data/i);
  });

  it("no-usable-n verdict (n=null) renders a body with NO fabricated number", () => {
    render(<SampleFloorEmptyState verdict={evaluateSampleFloor(null)} />);
    expect(
      screen.getByText("Not enough history for this estimate"),
    ).toBeInTheDocument();
    const body = screen.getByText(/usable return history/);
    expect(body.textContent).not.toMatch(/\d/);
  });

  it("0/1-strategy route (strategyCount<2) names the floor + 2-strategy minimum, no fabricated N", () => {
    render(
      <SampleFloorEmptyState
        verdict={evaluateSampleFloor(null)}
        strategyCount={1}
      />,
    );
    const body = screen.getByText(/Add at least 2 active strategies/);
    expect(body.textContent).toContain("60");
  });

  it("review F3: no-usable-n verdict WITH strategyCount>=2 renders the no-number body, never 'null' or few-strategies", () => {
    // The "engine nulled the metrics despite >=2 strategies" P26/27 state: the
    // strategyCount<2 branch must NOT fire, and the no-usable-n branch must win
    // (never fall through to belowFloorBody(n=null) → a "null overlapping days" leak).
    render(
      <SampleFloorEmptyState
        verdict={evaluateSampleFloor(null)}
        strategyCount={5}
        feature="stress"
      />,
    );
    const body = screen.getByText(/usable return history/);
    expect(body.textContent).not.toMatch(/\d/);
    expect(body.textContent).not.toMatch(/null/i);
    expect(screen.queryByText(/Add at least 2 active strategies/)).toBeNull();
  });

  it("is NOT an alert and carries no negative/warning color class (honest absence, not an error)", () => {
    const { container } = render(
      <SampleFloorEmptyState verdict={evaluateSampleFloor(30)} feature="stress" />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    const html = container.innerHTML;
    // No destructive/warning tokens (UI-SPEC Color: no red, no warning).
    expect(html).not.toMatch(/text-negative|bg-negative|border-negative/);
    expect(html).not.toMatch(/text-warning|bg-warning|border-warning/);
    expect(html).not.toMatch(/text-red|bg-red|border-red/);
  });

  it("WR-02: a passing (ok) verdict renders NOTHING — never a self-contradictory card", () => {
    // A mis-wired call site that passes an ok verdict (n >= floor) must not get
    // a "{n} days — fewer than the {floor} needed" lie; the component fails loud
    // by rendering null so the bug surfaces instead of a dishonest card.
    const { container } = render(
      <SampleFloorEmptyState verdict={evaluateSampleFloor(100)} feature="stress" />,
    );
    expect(evaluateSampleFloor(100).reason).toBe("ok");
    expect(container.innerHTML).toBe("");
    expect(
      screen.queryByText("Not enough history for this estimate"),
    ).toBeNull();
  });

  it("renders the pinned CorrelationHeatmap shell tokens verbatim", () => {
    const { container } = render(
      <SampleFloorEmptyState verdict={evaluateSampleFloor(30)} feature="stress" />,
    );
    const card = container.querySelector(
      ".rounded-lg.border.border-border.bg-surface.px-4.py-8.text-center.text-text-muted.text-sm",
    );
    expect(card).not.toBeNull();
  });
});
