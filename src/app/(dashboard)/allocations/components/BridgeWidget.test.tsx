import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

// ---------------------------------------------------------------------------
// Phase 201 plan 28 — F-04 / U-26: "Bridge" is retired from user-visible copy.
// The card reads in plain words in every state: the eyebrow is "Mandate check"
// (Term Form A around "Mandate" only, D-01 / D-06), the load-failed message
// reads "Couldn’t check your holdings against your mandate.", and the active
// regions are named "Replacement suggestions". The rendered arm at the bottom
// reads text plus every aria-label / title over all five states and fails if
// the retired word returns. Identifiers, `bridge-*` test ids and
// `--color-bridge-*` tokens are unchanged (copy only).
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
    const region = screen.getByRole("region", { name: "Mandate check" });
    expect(region).toBeTruthy();
    // D-01 / D-06: the eyebrow's "Mandate" opens its definition (Form A, key `mandate`).
    expect(region.querySelector('[data-term="mandate"]')?.textContent).toBe("Mandate");
    expect(region.querySelector('[data-term="bridge"]')).toBeNull();
    expect(region.querySelector('[data-term="mandate"]')?.closest("span.inline")?.nextSibling?.textContent).toBe(
      " check",
    );
    // Flat cream fill applied via inline style ("no gradients" is a top-level
    // DESIGN.md rule — the prior linear-gradient was removed for a flat
    // --color-bridge-bg-100 fill, keeping the Bridge cream identity).
    // Phase 09.1 UI-FLAG-01: hex literals replaced with bridge token family
    // (--color-bridge-bg-100 = #FFF7ED, --color-bridge-border-100 = #FED7AA).
    // JSDom doesn't resolve CSS vars so we assert on the variable references
    // in the inline style attribute.
    const styleAttr = (region as HTMLElement).getAttribute("style") ?? "";
    expect(styleAttr).not.toMatch(/linear-gradient/);
    expect(styleAttr).toMatch(/var\(--color-bridge-bg-100\)/);
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

  it("L-0069 — 366 days ago → the one date format, `Mon D, YYYY` (>= 1 year boundary)", () => {
    // Phase 201 D-11: the absolute branch prints through `formatDay`, so the
    // string is the same on the server and in the browser. The literal is
    // fixed (FIXED_NOW minus 366 days is 2025-04-25T12:00Z), not derived from
    // the runtime locale.
    const outcome = makeOutcome(366);
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[outcome]}
      />,
    );
    const text = screen.getByTestId("bridge-empty-last-reviewed").textContent;
    expect(text).toBe("Apr\u00a025,\u00a02025");
    // Sanity: the absolute branch must NOT collapse to a relative phrase.
    expect(text).not.toMatch(/ago/);
  });

  it("T-201-19 — an outcome stamped 23:30 UTC names that UTC day, whatever the runtime zone (U-13)", () => {
    // 2025-04-25T23:30Z is 365.5 days before FIXED_NOW, so it takes the
    // absolute branch. A zone-local read east of UTC would print Apr 26.
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[makeOutcome(366, { created_at: "2025-04-25T23:30:00.000Z" })]}
      />,
    );
    expect(screen.getByTestId("bridge-empty-last-reviewed").textContent).toBe(
      "Apr\u00a025,\u00a02025",
    );
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

// ---------------------------------------------------------------------------
// H-1210 (F1 loud-fail) — unknown ("couldn't load") MUST NOT read as "All
// clear". `flaggedHoldings === null` is the UNKNOWN signal (upstream payload
// failed to resolve the breach data); `[]` is the genuinely-empty result.
// For a safety-relevant widget these two MUST render distinct UI, and the
// swallowed failure must be logged. These tests fail if the discrimination
// regresses (e.g. someone coalesces `null` back to `[]` or drops the error
// branch), per CLAUDE.md Rule 9.
// ---------------------------------------------------------------------------
describe("BridgeWidget — load-failure (unknown) state, H-1210", () => {
  it('renders a distinct "Status unavailable" error state for null flaggedHoldings — NOT "All clear"', () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <BridgeWidget
        flaggedHoldings={null}
        matchDecisionsByHoldingRef={{}}
        outcomes={[]}
      />,
    );
    // Distinct error region + copy.
    expect(
      screen.getByRole("region", { name: "Mandate check unavailable" }),
    ).toBeTruthy();
    expect(screen.getByTestId("bridge-error-state")).toBeTruthy();
    expect(screen.getByText("Status unavailable")).toBeTruthy();
    // D-01 / D-06: the error eyebrow's "Mandate" opens its definition too.
    const errorState = screen.getByTestId("bridge-error-state");
    expect(
      errorState.querySelector('[data-term="mandate"]')?.textContent,
    ).toBe("Mandate");
    expect(errorState.querySelector('[data-term="bridge"]')).toBeNull();
    // F-04 / U-26: the eyebrow reads "Mandate" (Term) + " check"; the message names the failure.
    expect(errorState.querySelector('[data-term="mandate"]')?.closest("span.inline")?.nextSibling?.textContent).toBe(
      " check",
    );
    expect(
      screen.getByText("Couldn\u2019t check your holdings against your mandate."),
    ).toBeTruthy();
    // The reassuring empty state must NOT appear — this is the headline bug:
    // a failed load that looks "All clear" silently misinforms the allocator.
    expect(screen.queryByText("All clear")).toBeNull();
    expect(screen.queryByTestId("bridge-empty-state")).toBeNull();
    // The swallowed failure is observable.
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[BridgeWidget]"),
    );
    errSpy.mockRestore();
  });

  it("invokes onRetry from the error-state Retry button when provided", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onRetry = vi.fn();
    render(
      <BridgeWidget
        flaggedHoldings={null}
        matchDecisionsByHoldingRef={{}}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByTestId("bridge-error-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("an empty array still renders the real 'All clear' state (failure ≠ empty)", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        outcomes={[]}
      />,
    );
    expect(screen.getByText("All clear")).toBeTruthy();
    expect(screen.queryByTestId("bridge-error-state")).toBeNull();
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
    // Active state has its own region label + "Mandate check" eyebrow copy
    const region = screen.getByRole("region", { name: "Replacement suggestions" });
    expect(region).toBeTruthy();
    // D-01 / D-06: the eyebrow's "Mandate" opens its definition; " check" stays text.
    expect(region.querySelector('[data-term="mandate"]')?.textContent).toBe("Mandate");
    expect(region.querySelector('[data-term="bridge"]')).toBeNull();
    expect(region.textContent).toMatch(/Mandate check/);
    // The venue reads as a label, never the raw exchange code.
    expect(screen.getByText(/BTC \(OKX\)/)).toBeTruthy();
    expect(screen.queryByText(/\(okx\)/)).toBeNull();
    // Empty-state copy must NOT render when there are active breaches
    expect(screen.queryByText("All clear")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F-04 / U-26 — the retired word must not render in ANY state of the card.
// Reads container text plus every aria-label and title value. Case-sensitive,
// so lowercase `bridge-*` test ids are not read.
// ---------------------------------------------------------------------------
describe("BridgeWidget — no retired word in any state (F-04, U-26)", () => {
  const FLAGGED = [
    {
      symbol: "BTC",
      venue: "okx",
      holding_type: "perp",
      top_candidate_composite: 0.92,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  ];

  const STATES: Array<{ name: string; props: Record<string, unknown> }> = [
    { name: "load-failed", props: { flaggedHoldings: null } },
    { name: "empty", props: { flaggedHoldings: [] } },
    { name: "subtle", props: { flaggedHoldings: FLAGGED, variant: "subtle" } },
    { name: "card", props: { flaggedHoldings: FLAGGED, variant: "card" } },
    { name: "full", props: { flaggedHoldings: FLAGGED, variant: "full" } },
  ];

  function readable(container: HTMLElement): string[] {
    const attrs = Array.from(
      container.querySelectorAll("[aria-label], [title]"),
    ).flatMap((el) => [el.getAttribute("aria-label"), el.getAttribute("title")]);
    return [container.textContent ?? "", ...attrs].filter(
      (v): v is string => typeof v === "string",
    );
  }

  for (const state of STATES) {
    it(`${state.name}: no /\\bBridge\\b/ in text, aria-label or title, and no bridge Term`, () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { container } = render(
        <BridgeWidget
          flaggedHoldings={null}
          matchDecisionsByHoldingRef={{}}
          outcomes={[]}
          {...(state.props as object)}
        />,
      );
      for (const value of readable(container)) {
        expect(value).not.toMatch(/\bBridge\b/);
      }
      expect(container.querySelector('[data-term="bridge"]')).toBeNull();
    });
  }
});
