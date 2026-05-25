import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BridgeWidget } from "./BridgeWidget";
import type { FlaggedHolding } from "../lib/holding-outcome-adapter";

// ---------------------------------------------------------------------------
// H-0088 — the existing BridgeWidget.test.tsx pre-dates the Plan 09 component
// rewrite and only exercises the empty state + the default ("full") active
// variant. These tests cover the parts of the rewrite that are otherwise
// untested:
//   - the three active-breach variants ("full" / "card" / "subtle")
//   - singular vs plural "holding"/"holdings" copy
//   - the slice(0,3) hero list + "…and N more" overflow line
//   - the Review CTA opening the BridgeDrawer (drawer mocked to a sentinel)
//
// BridgeDrawer is mocked so we can assert the open/closed transition without
// pulling in its own state machine.
// ---------------------------------------------------------------------------

vi.mock("./BridgeDrawer", () => ({
  BridgeDrawer: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="bridge-drawer-open">drawer</div> : null,
}));

function holding(overrides: Partial<FlaggedHolding> = {}): FlaggedHolding {
  return {
    venue: "okx",
    symbol: "BTC",
    holding_type: "spot",
    value_usd: 10_000,
    top_candidate_strategy_id: "strat-1",
    top_candidate_name: "Momentum Alpha",
    top_candidate_composite: 91,
    breach_reasons: ["max_weight"],
    ...overrides,
  };
}

describe("BridgeWidget — active-breach variants (H-0088)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("full variant (default) — singular copy for a single flagged holding + composite shown", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[holding()]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    // Singular: "1 holding needs review" (no trailing "s" on holding/needs).
    expect(screen.getByText(/1 holding needs review/i)).toBeInTheDocument();
    // The per-holding line renders the composite value.
    expect(screen.getByText("91")).toBeInTheDocument();
    // Drawer starts closed.
    expect(screen.queryByTestId("bridge-drawer-open")).not.toBeInTheDocument();
  });

  it("full variant — plural copy for multiple holdings", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[
          holding({ symbol: "BTC" }),
          holding({ symbol: "ETH" }),
        ]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    expect(screen.getByText(/2 holdings need review/i)).toBeInTheDocument();
  });

  it("full variant — lists at most 3 holdings then shows the '…and N more' overflow line", () => {
    const five = ["BTC", "ETH", "SOL", "XRP", "ADA"].map((symbol) =>
      holding({ symbol }),
    );
    render(
      <BridgeWidget flaggedHoldings={five} matchDecisionsByHoldingRef={{}} />,
    );
    // First three symbols listed.
    expect(screen.getByText(/BTC/)).toBeInTheDocument();
    expect(screen.getByText(/ETH/)).toBeInTheDocument();
    expect(screen.getByText(/SOL/)).toBeInTheDocument();
    // 4th + 5th collapse into the overflow line "…and 2 more".
    expect(screen.getByText(/…and 2 more/)).toBeInTheDocument();
    expect(screen.queryByText(/XRP/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ADA/)).not.toBeInTheDocument();
  });

  it("full variant — Review CTA opens the BridgeDrawer", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[holding()]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    expect(screen.queryByTestId("bridge-drawer-open")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Review candidates/i }));
    expect(screen.getByTestId("bridge-drawer-open")).toBeInTheDocument();
  });

  it("card variant — renders the compact 'N holdings flagged' summary + opens drawer", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[holding(), holding({ symbol: "ETH" })]}
        matchDecisionsByHoldingRef={{}}
        variant="card"
      />,
    );
    expect(screen.getByText(/2 holdings flagged/i)).toBeInTheDocument();
    // The card variant does NOT render the hero "need review" headline.
    expect(screen.queryByText(/need review/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Review candidates/i }));
    expect(screen.getByTestId("bridge-drawer-open")).toBeInTheDocument();
  });

  it("subtle variant — renders the one-line summary with inline Review link + opens drawer", () => {
    render(
      <BridgeWidget
        flaggedHoldings={[holding()]}
        matchDecisionsByHoldingRef={{}}
        variant="subtle"
      />,
    );
    expect(
      screen.getByText(/Bridge flagged 1 holding/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Review/i }));
    expect(screen.getByTestId("bridge-drawer-open")).toBeInTheDocument();
  });
});
