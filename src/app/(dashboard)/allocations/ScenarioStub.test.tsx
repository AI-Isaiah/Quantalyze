/**
 * Phase 09 / Task 4 — TDD RED gate tests for ScenarioStub branch (D-08 + Pitfall 7).
 *
 * Covered behaviours:
 *   1. No flaggedHoldings prop → existing stub card rendered.
 *   2. flaggedHoldings.length === 0 → existing stub card rendered.
 *   3. flaggedHoldings.length > 0 → ScenarioFlaggedHoldingsList rendered; stub card hidden.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenarioStub } from "./ScenarioStub";
import type { FlaggedHolding } from "./lib/holding-outcome-adapter";

// ScenarioFlaggedHoldingsList calls useRouter — mock so tests don't need router context
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const FLAGGED: FlaggedHolding[] = [
  {
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    value_usd: 50000,
    top_candidate_strategy_id: "uuid-btc-cand",
    top_candidate_name: "Momentum-BTC-L",
    top_candidate_composite: 72,
    breach_reasons: ["max_weight"],
  },
];

describe("ScenarioStub — Phase 09 branch (D-08 + Pitfall 7)", () => {
  it("renders existing stub card when flaggedHoldings is undefined or empty", () => {
    render(<ScenarioStub />);
    expect(
      screen.getByRole("heading", { name: "Scenario builder coming soon" }),
    ).toBeInTheDocument();
  });

  it("renders existing stub card when flaggedHoldings.length === 0", () => {
    render(
      <ScenarioStub
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
        existingOutcomesByHoldingRef={{}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Scenario builder coming soon" }),
    ).toBeInTheDocument();
  });

  it("renders ScenarioFlaggedHoldingsList when flaggedHoldings.length > 0", () => {
    render(
      <ScenarioStub
        flaggedHoldings={FLAGGED}
        matchDecisionsByHoldingRef={{}}
        existingOutcomesByHoldingRef={{}}
      />,
    );
    expect(
      screen.queryByRole("heading", { name: "Scenario builder coming soon" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("BTC")).toBeInTheDocument();
  });
});

// Phase 201 plan 34 (F-04, F-08, U-27): the stub heading explains the word Scenario through Form A,
// a Term around only that word, with the visible heading text unchanged. Fails when the Term goes,
// when it grows past the one word, and when the heading's text changes.
describe("ScenarioStub — the heading explains scenario (U-27)", () => {
  it("the h2 still reads Scenario builder coming soon and its word Scenario is the term", () => {
    render(<ScenarioStub />);
    const h2 = screen.getByRole("heading", { level: 2, name: "Scenario builder coming soon" });
    expect(h2.textContent).toBe("Scenario builder coming soon");
    const terms = h2.querySelectorAll('[data-term="scenario"]');
    expect(terms).toHaveLength(1);
    expect(terms[0].textContent).toBe("Scenario");
    // The Term's text is the first word of the heading and nothing else is wrapped.
    expect(h2.textContent?.startsWith(terms[0].textContent ?? "?")).toBe(true);
  });
});
