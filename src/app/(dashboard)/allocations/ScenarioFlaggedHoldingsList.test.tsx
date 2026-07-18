/**
 * Phase 09 / Task 4 — TDD RED gate tests for ScenarioFlaggedHoldingsList
 * (LIVE-04 / finding f2 click-path).
 *
 * Covered behaviours:
 *   1. Renders one row per flagged holding with symbol + candidate name + composite + breach chip.
 *   2. One-open-at-a-time: expanding row 2 collapses row 1.
 *   3. Finding f2: no decision yet → clicking "Allocated" POSTs to /api/match/decisions/holding
 *      BEFORE AllocatedForm mounts; on 2xx form mounts.
 *   4. Finding f2: on 4xx response → error shown; form does NOT mount.
 *   5. Skips POST when matchDecisionsByHoldingRef[ref] already present → AllocatedForm mounts directly.
 *   6. Renders OutcomeRecordedRow directly when existingOutcome present (skip banner AND skip POST).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ScenarioFlaggedHoldingsList } from "./ScenarioFlaggedHoldingsList";
import type { FlaggedHolding } from "./lib/holding-outcome-adapter";
import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";

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
  {
    venue: "binance",
    symbol: "ETH",
    holding_type: "spot",
    value_usd: 30000,
    top_candidate_strategy_id: "uuid-eth-cand",
    top_candidate_name: "MeanRev-ETH",
    top_candidate_composite: 61,
    breach_reasons: ["correlation_ceiling"],
  },
];

// Mock next/navigation router.refresh
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("ScenarioFlaggedHoldingsList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  it("renders one row per flagged holding with symbol + candidate + composite", () => {
    render(
      <ScenarioFlaggedHoldingsList
        flaggedHoldings={FLAGGED}
        matchDecisionsByHoldingRef={{}}
        existingOutcomesByHoldingRef={{}}
      />,
    );
    expect(screen.getByText("BTC")).toBeInTheDocument();
    expect(screen.getByText(/Momentum-BTC-L/)).toBeInTheDocument();
    expect(screen.getByText(/72/)).toBeInTheDocument();
    expect(screen.getByText(/max_weight/i)).toBeInTheDocument();
  });

  it("one-open-at-a-time: expanding row 2 collapses row 1", () => {
    render(
      <ScenarioFlaggedHoldingsList
        flaggedHoldings={FLAGGED}
        matchDecisionsByHoldingRef={{
          "holding:binance:BTC:spot": { id: "dec-1" },
          "holding:binance:ETH:spot": { id: "dec-2" },
        }}
        existingOutcomesByHoldingRef={{}}
      />,
    );
    const expandBtns = screen.getAllByRole("button", { name: /expand|review/i });
    // Expand BTC row
    fireEvent.click(expandBtns[0]);
    expect(
      screen.getByTestId("flagged-expanded-holding:binance:BTC:spot"),
    ).toBeInTheDocument();
    // Expand ETH row — BTC should collapse
    fireEvent.click(expandBtns[1]);
    expect(
      screen.queryByTestId("flagged-expanded-holding:binance:BTC:spot"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("flagged-expanded-holding:binance:ETH:spot"),
    ).toBeInTheDocument();
  });

  it("finding f2 click-path: no decision yet → click 'Allocated' POSTs to /api/match/decisions/holding BEFORE AllocatedForm mounts; on 2xx form mounts", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ match_decision_id: "new-decision-uuid" }),
    });
    render(
      <ScenarioFlaggedHoldingsList
        flaggedHoldings={[FLAGGED[0]]}
        matchDecisionsByHoldingRef={{}}
        existingOutcomesByHoldingRef={{}}
      />,
    );
    // Expand the row
    fireEvent.click(screen.getByRole("button", { name: /expand|review/i }));
    // Click "Allocated" button shown in banner
    fireEvent.click(screen.getByRole("button", { name: /allocated/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/match/decisions/holding",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("holding:binance:BTC:spot"),
        }),
      );
    });
    // After 2xx response, AllocatedForm mounts (has a percent input = spinbutton)
    await waitFor(() => {
      expect(screen.getByRole("spinbutton")).toBeInTheDocument();
    });
  });

  it("finding f2 click-path: on 4xx response → error shown; form does NOT mount", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Unauthorized" }),
    });
    render(
      <ScenarioFlaggedHoldingsList
        flaggedHoldings={[FLAGGED[0]]}
        matchDecisionsByHoldingRef={{}}
        existingOutcomesByHoldingRef={{}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expand|review/i }));
    fireEvent.click(screen.getByRole("button", { name: /allocated/i }));
    await waitFor(() => {
      expect(screen.getByText(/Unauthorized|not available/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("skips POST when matchDecisionsByHoldingRef[ref] already present — mounts AllocatedForm directly", async () => {
    global.fetch = vi.fn();
    render(
      <ScenarioFlaggedHoldingsList
        flaggedHoldings={[FLAGGED[0]]}
        matchDecisionsByHoldingRef={{ "holding:binance:BTC:spot": { id: "dec-1" } }}
        existingOutcomesByHoldingRef={{}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expand|review/i }));
    fireEvent.click(screen.getByRole("button", { name: /allocated/i }));
    // No POST should have been made
    expect(global.fetch).not.toHaveBeenCalled();
    // AllocatedForm mounted directly
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });

  // Phase 117 / UIFIX-02 — clip-proof focus indicator (WCAG 2.4.7).
  //
  // WHY: the expand/collapse button lives inside an `overflow-x-auto` card and
  // today has NO focus-visible class → it relies on the browser default outline,
  // which paints OUTSIDE the button and is CLIPPED at the scroll-container edge.
  // The inset ring paints INSIDE the button → always visible under the clip.
  it("[UIFIX-02] the expand/collapse button carries a clip-proof inset focus ring", () => {
    render(
      <ScenarioFlaggedHoldingsList
        flaggedHoldings={[FLAGGED[0]]}
        matchDecisionsByHoldingRef={{}}
        existingOutcomesByHoldingRef={{}}
      />,
    );
    const expandBtn = screen.getByRole("button", { name: "Expand review" });
    expect(expandBtn.className).toContain("focus-visible:ring-2");
    expect(expandBtn.className).toContain("focus-visible:ring-inset");
    expect(expandBtn.className).toContain("focus-visible:ring-accent");
    // Full-opacity accent only — /20 fails WCAG 1.4.11 ≥3:1.
    expect(expandBtn.className).not.toContain("ring-accent/20");
  });

  it("renders OutcomeRecordedRow directly when existingOutcome present (skip banner AND skip POST)", async () => {
    const existing: BridgeOutcome = {
      id: "outcome-1",
      kind: "allocated",
      strategy_id: "uuid-btc-cand",
      allocated_at: "2026-04-20",
      delta_30d: null,
      percent_allocated: null,
      note: null,
    } as unknown as BridgeOutcome;
    render(
      <ScenarioFlaggedHoldingsList
        flaggedHoldings={[FLAGGED[0]]}
        matchDecisionsByHoldingRef={{ "holding:binance:BTC:spot": { id: "dec-1" } }}
        existingOutcomesByHoldingRef={{ "holding:binance:BTC:spot": existing }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expand|review/i }));
    // The "Allocated" banner button must NOT appear — outcome already recorded
    expect(screen.queryByRole("button", { name: /^allocated$/i })).not.toBeInTheDocument();
    // OutcomeRecordedRow renders instead
    expect(screen.getByTestId("outcome-recorded-row")).toBeInTheDocument();
  });
});
