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
      screen.getByText(/Scenario builder coming soon/i),
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
      screen.getByText(/Scenario builder coming soon/i),
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
      screen.queryByText(/Scenario builder coming soon/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("BTC")).toBeInTheDocument();
  });
});
