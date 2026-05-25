import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BridgeWidget } from "./BridgeWidget";
import type { OutcomeRow } from "@/lib/queries";

// ---------------------------------------------------------------------------
// PR2 (HANDOFF G4) — empty-state polish coverage
// ---------------------------------------------------------------------------
//
// The "No active breaches" branch used to render a plain white card. PR2
// replaces it with the prototype's cream-tone empty state that surfaces the
// most recent recorded outcome. Tests below pin:
//   - copy ("All clear" instead of "No active breaches")
//   - last-reviewed relative date computed from outcomes[0].created_at
//   - reviews-on-file count
//   - graceful fallback when outcomes[] is empty
//   - CTA always points at the Outcomes tab (NOT a dismissal toggle —
//     CONTEXT §specifics, app.jsx:131 designer bug)
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-04-26T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function makeOutcome(daysAgo: number, overrides: Partial<OutcomeRow> = {}): OutcomeRow {
  const ts = new Date(FIXED_NOW.getTime() - daysAgo * 86_400_000);
  return {
    id: `outcome-${daysAgo}`,
    kind: "allocated",
    percent_allocated: 5,
    allocated_at: ts.toISOString().slice(0, 10),
    rejection_reason: null,
    note: null,
    delta_30d: null,
    delta_90d: null,
    delta_180d: null,
    estimated_delta_bps: null,
    estimated_days: null,
    needs_recompute: false,
    created_at: ts.toISOString(),
    replacement_strategy: null,
    match_decision: null,
    ...overrides,
  } as OutcomeRow;
}

describe("BridgeWidget — empty state (no breaches, with outcomes)", () => {
  it('shows the serif "All clear" headline + cream-tone container', () => {
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(3)]}
      />,
    );
    expect(screen.getByText("All clear")).toBeTruthy();
    // Region role + accessible label preserved
    const region = screen.getByRole("region", { name: /bridge status/i });
    expect(region).toBeTruthy();
    // Cream tone applied via inline style (Tailwind doesn't have this exact gradient).
    // Phase 09.1 UI-FLAG-01: hex literals replaced with bridge token family
    // (--color-bridge-bg-100 = #FFF7ED, --color-bridge-bg-50 = #FFFAF3,
    // --color-bridge-border-100 = #FED7AA). JSDom doesn't resolve CSS vars
    // so we assert on the variable references in the inline style attribute.
    const styleAttr = (region as HTMLElement).getAttribute("style") ?? "";
    expect(styleAttr).toMatch(/linear-gradient/);
    expect(styleAttr).toMatch(/var\(--color-bridge-bg-100\)/);
    expect(styleAttr).toMatch(/var\(--color-bridge-bg-50\)/);
    expect(styleAttr).toMatch(/var\(--color-bridge-border-100\)/);
  });

  it('formats the last-reviewed date as "3 days ago" for a 3-day-old outcome', () => {
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(3)]}
      />,
    );
    expect(screen.getByTestId("bridge-empty-last-reviewed").textContent).toBe(
      "3 days ago",
    );
  });

  it('renders "yesterday" for a 1-day-old outcome and "today" for the same day', () => {
    const { rerender } = render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(1)]}
      />,
    );
    expect(screen.getByTestId("bridge-empty-last-reviewed").textContent).toBe(
      "yesterday",
    );
    rerender(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(0)]}
      />,
    );
    expect(screen.getByTestId("bridge-empty-last-reviewed").textContent).toBe(
      "today",
    );
  });

  // ---------------------------------------------------------------------------
  // L-0069 — formatRelativeDate boundary buckets. The existing cases cover
  // days 0, 1, 2, 3. The if-chain (BridgeWidget.tsx:64-77) has transitions at
  // exactly 7 ("a week ago"), 14 ("2 weeks ago"), 60 ("2 months ago"), 365
  // (absolute date), and a negative-elapsed (future timestamp → "today")
  // branch that are unpinned. A refactor that swapped Math.floor for
  // Math.round, or flipped a `<` to `<=`, would silently mis-bucket the
  // boundary day with zero test failures.
  // ---------------------------------------------------------------------------
  it("L-0069 — day 7 boundary → 'a week ago' (NOT '1 weeks ago')", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(7)]}
      />,
    );
    expect(screen.getByTestId("bridge-empty-last-reviewed").textContent).toBe(
      "a week ago",
    );
  });

  it("L-0069 — day 14 boundary → '2 weeks ago'", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(14)]}
      />,
    );
    expect(screen.getByTestId("bridge-empty-last-reviewed").textContent).toBe(
      "2 weeks ago",
    );
  });

  it("L-0069 — day 60 boundary → '2 months ago' (60/30 = 2)", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(60)]}
      />,
    );
    expect(screen.getByTestId("bridge-empty-last-reviewed").textContent).toBe(
      "2 months ago",
    );
  });

  it("L-0069 — 366 days ago → absolute toLocaleDateString form (>= 1 year boundary)", () => {
    const outcome = makeOutcome(366);
    // The absolute branch formats `new Date(Date.parse(created_at))` via
    // toLocaleDateString("en-US", {month:'short', day:'numeric', year:'numeric'}).
    // Derive the expected string from the SAME timestamp the component parses,
    // so this never hardcodes a locale-/TZ-fragile literal.
    const expected = new Date(
      Date.parse(outcome.created_at),
    ).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[outcome]}
      />,
    );
    const text = screen.getByTestId("bridge-empty-last-reviewed").textContent;
    expect(text).toBe(expected);
    // Sanity: the absolute branch must NOT collapse to a relative phrase.
    expect(text).not.toMatch(/ago/);
  });

  it("L-0069 — future timestamp (negative elapsed) clamps to 'today'", () => {
    // makeOutcome(-1) → created_at is one day in the FUTURE relative to
    // FIXED_NOW, so elapsedMs < 0 and `days` is negative.
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(-1)]}
      />,
    );
    expect(screen.getByTestId("bridge-empty-last-reviewed").textContent).toBe(
      "today",
    );
  });

  it("shows a singular review count when only one outcome is on file", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(5)]}
      />,
    );
    expect(screen.getByTestId("bridge-empty-review-count").textContent).toBe(
      "1 review on file",
    );
  });

  it("shows a plural review count when multiple outcomes exist (and uses outcomes[0] for last-reviewed)", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(2), makeOutcome(40), makeOutcome(120)]}
      />,
    );
    expect(screen.getByTestId("bridge-empty-review-count").textContent).toBe(
      "3 reviews on file",
    );
    // Picks up outcomes[0] (most recent), not the older entries
    expect(screen.getByTestId("bridge-empty-last-reviewed").textContent).toBe(
      "2 days ago",
    );
  });

  it('CTA reads "View outcomes" and routes to /allocations?tab=outcomes', () => {
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(7)]}
      />,
    );
    const link = screen.getByRole("link", { name: /view outcomes/i });
    expect(link.getAttribute("href")).toBe("/allocations?tab=outcomes");
  });
});

describe("BridgeWidget — empty state (no breaches, no outcomes)", () => {
  it("falls back to 'No reviews recorded yet.' when outcomes[] is empty", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[]}
      />,
    );
    expect(screen.getByText("All clear")).toBeTruthy();
    expect(screen.getByText("No reviews recorded yet.")).toBeTruthy();
    expect(screen.queryByTestId("bridge-empty-last-reviewed")).toBeNull();
    expect(screen.queryByTestId("bridge-empty-review-count")).toBeNull();
  });

  it('CTA falls back to "Show last recommendation" when no outcomes exist', () => {
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[]}
      />,
    );
    const link = screen.getByRole("link", { name: /show last recommendation/i });
    expect(link.getAttribute("href")).toBe("/allocations?tab=outcomes");
  });

  it("degrades gracefully when the `outcomes` prop is omitted entirely", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    expect(screen.getByText("All clear")).toBeTruthy();
    expect(screen.getByText("No reviews recorded yet.")).toBeTruthy();
  });
});

describe("BridgeWidget — active-breach state preserved", () => {
  it("still renders the hero card when flaggedHoldings has entries (PR2 must not regress active state)", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[
          {
            symbol: "BTC",
            venue: "okx",
            holding_type: "perp",
            top_candidate_composite: 0.92,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(3)]}
      />,
    );
    // Active state has its own region label + "Bridge flagged" pill copy
    expect(
      screen.getByRole("region", { name: /bridge recommendations/i }),
    ).toBeTruthy();
    expect(screen.getByText(/Bridge flagged/i)).toBeTruthy();
    // Empty-state copy must NOT render when there are active breaches
    expect(screen.queryByText("All clear")).toBeNull();
  });
});
