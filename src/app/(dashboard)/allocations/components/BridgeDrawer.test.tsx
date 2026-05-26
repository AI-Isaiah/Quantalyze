import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Phase 09.1 Plan 09 Task 3 — BridgeDrawer state-machine test.
 *
 * Asserts on the EXTRACTED helper call (`sendBridgeIntro`), NOT a
 * speculative endpoint literal. Per D-16: the only contract that
 * matters is "the drawer routes through the shared helper" — the
 * helper itself owns the wire shape, and ScenarioFlaggedHoldingsList's
 * existing test already pins that.
 *
 * Cases:
 *   1. isOpen=false → renders nothing.
 *   2. isOpen=true → browse stage default; backdrop + close button + Esc dismiss.
 *   3. Click candidate → confirm stage with From/To row.
 *   4. Confirm → Send intro → calls sendBridgeIntro with the right args, closes.
 *   5. sendBridgeIntro error → drawer stays open + error rendered.
 *   6. Back button → returns to browse stage.
 *   7. flaggedHoldings=[] → empty-state copy + no candidates list.
 */

// Mock the shared helper. The test asserts on its call shape — not on
// any /api/match/decisions/holding string literal. The helper itself
// owns the wire contract (locked by ScenarioFlaggedHoldingsList tests).
const mockSendBridgeIntro = vi.fn();
vi.mock("@/lib/bridge/send-intro", () => ({
  sendBridgeIntro: (args: unknown) => mockSendBridgeIntro(args),
}));

import { BridgeDrawer } from "./BridgeDrawer";
import type { FlaggedHolding } from "../lib/holding-outcome-adapter";

const FLAGGED_A: FlaggedHolding = {
  venue: "binance",
  symbol: "BTC/USDT",
  holding_type: "spot",
  value_usd: 50_000,
  top_candidate_strategy_id: "strat-a",
  top_candidate_name: "Momentum Alpha",
  top_candidate_composite: 78,
  breach_reasons: ["max_weight"],
};

const FLAGGED_B: FlaggedHolding = {
  venue: "okx",
  symbol: "ETH/USDT",
  holding_type: "spot",
  value_usd: 30_000,
  top_candidate_strategy_id: "strat-b",
  top_candidate_name: "Mean Reversion Beta",
  top_candidate_composite: 64,
  breach_reasons: ["correlation_ceiling"],
};

describe("BridgeDrawer — Phase 09.1 Plan 09 / D-15 / D-16", () => {
  beforeEach(() => {
    mockSendBridgeIntro.mockReset();
    mockSendBridgeIntro.mockResolvedValue({
      ok: true,
      match_decision_id: "decision-123",
    });
  });

  it("isOpen=false → renders nothing", () => {
    const { container } = render(
      <BridgeDrawer
        isOpen={false}
        onClose={vi.fn()}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("isOpen=true → browse stage default; backdrop click dismisses", () => {
    const onClose = vi.fn();
    render(
      <BridgeDrawer
        isOpen
        onClose={onClose}
        flaggedHoldings={[FLAGGED_A, FLAGGED_B]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    expect(screen.getByText("Review candidates")).toBeInTheDocument();
    expect(screen.getByText(/Mandate gates failed/i)).toBeInTheDocument();
    // BTC/USDT and ETH/USDT each render in two places (breach list + candidate
    // button), and React splits them across text nodes. Match by candidate
    // testid which is the more reliable assertion.
    expect(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("bridge-candidate-holding:okx:ETH/USDT:spot"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("bridge-drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("close button (×) dismisses", () => {
    const onClose = vi.fn();
    render(
      <BridgeDrawer
        isOpen
        onClose={onClose}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Close drawer"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc key dismisses", () => {
    const onClose = vi.fn();
    render(
      <BridgeDrawer
        isOpen
        onClose={onClose}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("click candidate → confirm stage with From/To row", () => {
    render(
      <BridgeDrawer
        isOpen
        onClose={vi.fn()}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    const candidateButton = screen.getByTestId(
      "bridge-candidate-holding:binance:BTC/USDT:spot",
    );
    fireEvent.click(candidateButton);

    expect(screen.getByText("Confirm intro")).toBeInTheDocument();
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("To")).toBeInTheDocument();
    expect(screen.getByText("Momentum Alpha")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Send intro/ }),
    ).toBeInTheDocument();
  });

  it("Send intro → calls sendBridgeIntro with extracted helper, then closes", async () => {
    const onClose = vi.fn();
    render(
      <BridgeDrawer
        isOpen
        onClose={onClose}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Send intro/ }));

    // Wait for the async helper to settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSendBridgeIntro).toHaveBeenCalledTimes(1);
    expect(mockSendBridgeIntro).toHaveBeenCalledWith({
      holdingRef: "holding:binance:BTC/USDT:spot",
      topCandidateStrategyId: "strat-a",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sendBridgeIntro error → drawer stays open + error rendered", async () => {
    mockSendBridgeIntro.mockResolvedValueOnce({
      ok: false,
      error: "server fell over",
    });
    const onClose = vi.fn();
    render(
      <BridgeDrawer
        isOpen
        onClose={onClose}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Send intro/ }));

    // setTimeout(r, 0) was racing the React state flush under CI load —
    // waitFor polls until the alert mounts, deterministic on slow runners.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("server fell over");
    });

    expect(onClose).not.toHaveBeenCalled();
    // Still on confirm stage
    expect(screen.getByText("Confirm intro")).toBeInTheDocument();
  });

  it("Back button → returns to browse stage", () => {
    render(
      <BridgeDrawer
        isOpen
        onClose={vi.fn()}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    expect(screen.getByText("Confirm intro")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Back to candidates/ }));
    expect(screen.getByText("Review candidates")).toBeInTheDocument();
    expect(screen.queryByText("Confirm intro")).not.toBeInTheDocument();
  });

  it("flaggedHoldings=[] → empty-state copy + no candidates list", () => {
    render(
      <BridgeDrawer
        isOpen
        onClose={vi.fn()}
        flaggedHoldings={[]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    expect(screen.getByText("No flagged holdings.")).toBeInTheDocument();
    expect(screen.getByText("No candidates available.")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // H-0081 — state-machine error paths missing: thrown helper, network-error
  // rejection, and concurrent click double-fire.
  // -------------------------------------------------------------------------

  // H-0081 fix is in place: handleSendIntro now wraps `await sendBridgeIntro`
  // in try/catch + finally. A rejected helper must be caught, the submit button
  // re-enabled (finally), AND the error surfaced via setError (catch), mirroring
  // the resolved {ok:false} path. This test pins BOTH halves of that contract.
  it(
    "H-0081: sendBridgeIntro that REJECTS (throws) re-enables the button AND surfaces the rejection message for retry",
    async () => {
      mockSendBridgeIntro.mockRejectedValueOnce(new Error("network exploded"));
      const onClose = vi.fn();
      render(
        <BridgeDrawer
          isOpen
          onClose={onClose}
          flaggedHoldings={[FLAGGED_A]}
          matchDecisionsByHoldingRef={{}}
        />,
      );
      fireEvent.click(
        screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
      );
      fireEvent.click(screen.getByRole("button", { name: /Send intro/ }));

      // CORRECT behaviour assertion: the button should recover to "Send intro"
      // (no longer submitting) so the allocator can retry.
      await waitFor(() => {
        const btn = screen.getByRole("button", { name: /Send intro|Sending/ });
        expect(btn).not.toBeDisabled();
        expect(btn).toHaveTextContent("Send intro");
      });
      // The rejection's message must be SURFACED to the allocator — not just the
      // button recovered. The catch block does TWO things (finally re-enables
      // the button AND setError shows the failure); a partial revert that kept
      // the finally but dropped the setError would still pass the recovery
      // assertion above yet leave the allocator with a stuck-looking failure and
      // no message. Mirror the sibling {ok:false} case's role="alert" assertion.
      expect(screen.getByRole("alert")).toHaveTextContent("network exploded");
      // And the drawer must not have silently closed on a failed send.
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it("H-0081: resolved {ok:false} (network-error message) surfaces the error and re-enables the button for retry", async () => {
    mockSendBridgeIntro.mockResolvedValueOnce({
      ok: false,
      error: "Network error — could not reach server",
    });
    const onClose = vi.fn();
    render(
      <BridgeDrawer
        isOpen
        onClose={onClose}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Send intro/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Network error — could not reach server",
      );
    });
    // Button is re-enabled so the allocator can retry; drawer stays open.
    const btn = screen.getByRole("button", { name: /Send intro/ });
    expect(btn).not.toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("H-0081: concurrent double-click on Send intro fires the helper only once (disabled guard)", () => {
    // Helper stays pending so `submitting` remains true after the first click;
    // the button's disabled guard must swallow the second click.
    let resolveIntro: ((v: { ok: boolean }) => void) | null = null;
    mockSendBridgeIntro.mockImplementationOnce(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveIntro = resolve;
        }),
    );
    render(
      <BridgeDrawer
        isOpen
        onClose={vi.fn()}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    const sendBtn = screen.getByRole("button", { name: /Send intro/ });
    fireEvent.click(sendBtn);
    // Second click while the first is in flight (button now disabled/"Sending…").
    fireEvent.click(sendBtn);

    expect(mockSendBridgeIntro).toHaveBeenCalledTimes(1);

    // Drain the pending promise so the test doesn't leak. Cast at the call
    // site — TS narrows the closure-assigned binding to its initial `null`.
    (resolveIntro as unknown as (v: { ok: boolean }) => void)?.({ ok: true });
  });

  it("D-16 invariant — drawer never calls fetch directly; routes through sendBridgeIntro", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.resolve(__dirname, "BridgeDrawer.tsx");
    const source = await fs.readFile(file, "utf8");
    // Strip comments so we don't match prose. The acceptance criterion is
    // that NO fetch call lives in this file — all wire calls go through
    // the extracted sendBridgeIntro helper.
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/\bfetch\s*\(/);
    // And the helper is the wired call site.
    expect(codeOnly).toMatch(/sendBridgeIntro\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// Phase 10 Plan 05 Task 3 — "Add to scenario" CTA extension cases.
//
// The existing 10 cases above pin the Phase 09.1 / D-16 send-intro flow
// verbatim. The cases below verify the additive onAddToScenario contract
// without breaking any of those invariants:
//
//   - T_AS1 → no second CTA when prop omitted (backward-compat)
//   - T_AS2 → second CTA appears alongside "Send intro" when prop provided
//   - T_AS3 → click fires callback with (holdingScopeRef, candidate) args
//   - T_AS4 → click also fires onClose (drawer closes per UI-SPEC contract)
//   - T_AS5 → click does NOT fire sendBridgeIntro (client-only action)
//   - T_AS6 → existing send-intro flow still works (regression guard)
//   - T_AS7 — both buttons accessible (type=button, accent style)
// ---------------------------------------------------------------------------
describe("BridgeDrawer — Phase 10 Plan 05 / Task 3 'Add to scenario' CTA", () => {
  beforeEach(() => {
    mockSendBridgeIntro.mockReset();
    mockSendBridgeIntro.mockResolvedValue({
      ok: true,
      match_decision_id: "decision-123",
    });
  });

  it("T_AS1 — onAddToScenario NOT provided → no 'Add to scenario' CTA renders (backward-compat)", () => {
    render(
      <BridgeDrawer
        isOpen
        onClose={vi.fn()}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    // Confirm stage rendered.
    expect(screen.getByText("Confirm intro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send intro/ })).toBeInTheDocument();
    // No second CTA.
    expect(
      screen.queryByRole("button", { name: /Add to scenario/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("bridge-add-to-scenario")).not.toBeInTheDocument();
  });

  it("T_AS2 — onAddToScenario provided → confirm stage renders BOTH 'Send intro' AND 'Add to scenario'", () => {
    render(
      <BridgeDrawer
        isOpen
        onClose={vi.fn()}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
        onAddToScenario={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    expect(screen.getByRole("button", { name: /Send intro/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add to scenario/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("bridge-add-to-scenario")).toBeInTheDocument();
  });

  it("T_AS3 — click 'Add to scenario' → onAddToScenario fires once with (holdingScopeRef, candidate)", () => {
    const onAddToScenario = vi.fn();
    render(
      <BridgeDrawer
        isOpen
        onClose={vi.fn()}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
        onAddToScenario={onAddToScenario}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    fireEvent.click(screen.getByTestId("bridge-add-to-scenario"));

    expect(onAddToScenario).toHaveBeenCalledTimes(1);
    expect(onAddToScenario).toHaveBeenCalledWith(
      "holding:binance:BTC/USDT:spot",
      {
        id: "strat-a",
        name: "Momentum Alpha",
        markets: ["binance"],
        strategy_types: [],
      },
    );
  });

  it("T_AS4 — click 'Add to scenario' → onClose called once (drawer closes per UI-SPEC)", () => {
    const onClose = vi.fn();
    render(
      <BridgeDrawer
        isOpen
        onClose={onClose}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
        onAddToScenario={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    fireEvent.click(screen.getByTestId("bridge-add-to-scenario"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("T_AS5 — click 'Add to scenario' → sendBridgeIntro NOT called (client-only action)", () => {
    render(
      <BridgeDrawer
        isOpen
        onClose={vi.fn()}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
        onAddToScenario={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    fireEvent.click(screen.getByTestId("bridge-add-to-scenario"));

    expect(mockSendBridgeIntro).not.toHaveBeenCalled();
  });

  it("T_AS6 — existing 'Send intro' wiring unchanged when onAddToScenario also provided (regression guard for Phase 09 D-16)", async () => {
    const onClose = vi.fn();
    render(
      <BridgeDrawer
        isOpen
        onClose={onClose}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
        onAddToScenario={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Send intro/ }));

    await new Promise((r) => setTimeout(r, 0));

    expect(mockSendBridgeIntro).toHaveBeenCalledTimes(1);
    expect(mockSendBridgeIntro).toHaveBeenCalledWith({
      holdingRef: "holding:binance:BTC/USDT:spot",
      topCandidateStrategyId: "strat-a",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("T_AS7 — both buttons have type='button' and accent styling classes", () => {
    render(
      <BridgeDrawer
        isOpen
        onClose={vi.fn()}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
        onAddToScenario={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    const sendBtn = screen.getByRole("button", { name: /Send intro/ });
    const addBtn = screen.getByTestId("bridge-add-to-scenario");

    expect(sendBtn).toHaveAttribute("type", "button");
    expect(addBtn).toHaveAttribute("type", "button");
    expect(sendBtn.className).toMatch(/bg-accent/);
    expect(addBtn.className).toMatch(/bg-accent/);
  });

  // ---------------------------------------------------------------------------
  // H-0085 (supersedes the old M-0055 try/finally contract) — the audit ruled
  // the previous "always onClose via finally, even on throw" shape a Rule 12
  // (Fail loud) violation: `addStrategyBridge` throwing (quota exceeded,
  // duplicate strategy_id, malformed state) would dismiss the drawer cleanly
  // while the strategy was silently NOT added — the allocator saw success.
  //
  // CORRECTED contract (mirrors handleSendIntro's {ok:false} path):
  //   - the throw is CAUGHT inside handleAddToScenario (no window 'error'),
  //   - onClose is NOT called (drawer stays open),
  //   - the error message surfaces in the confirm stage's role="alert",
  //   - on a NON-throwing call, onClose still fires (happy path, T_AS4).
  //
  // This test FAILS against the pre-fix try/finally code (which called onClose
  // and let the throw escape to the window 'error' event).
  // ---------------------------------------------------------------------------
  it("H-0085 — onAddToScenario throwing does NOT close the drawer and surfaces the error (Fail loud)", () => {
    const onAddToScenario = vi.fn(() => {
      throw new Error("host blew up");
    });
    const onClose = vi.fn();
    // Guard against a regression to the OLD behaviour: if the throw were to
    // escape the handler again (try/finally with no catch), React 19 would
    // route it to the window 'error' event. Capture any such escape so the
    // test fails loudly rather than crashing the runner — but the fix means
    // nothing should be captured (the throw is handled in-component).
    const escaped: ErrorEvent[] = [];
    const handler = (e: ErrorEvent) => {
      if (e.error instanceof Error && e.error.message === "host blew up") {
        escaped.push(e);
        e.preventDefault();
      }
    };
    window.addEventListener("error", handler);
    try {
      render(
        <BridgeDrawer
          isOpen
          onClose={onClose}
          flaggedHoldings={[FLAGGED_A]}
          matchDecisionsByHoldingRef={{}}
          onAddToScenario={onAddToScenario}
        />,
      );
      fireEvent.click(
        screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
      );
      fireEvent.click(screen.getByTestId("bridge-add-to-scenario"));
    } finally {
      window.removeEventListener("error", handler);
    }
    // The callback was invoked exactly once...
    expect(onAddToScenario).toHaveBeenCalledTimes(1);
    // ...but because it threw, the drawer must NOT close (Fail loud).
    expect(onClose).not.toHaveBeenCalled();
    // The failure is surfaced to the allocator via the existing alert region,
    // not swallowed — and the throw was handled in-component (did not escape).
    expect(screen.getByRole("alert")).toHaveTextContent("host blew up");
    expect(escaped.length).toBe(0);
    // Drawer stays on the confirm stage so the allocator can see the error.
    expect(screen.getByText("Confirm intro")).toBeInTheDocument();
  });

  it("H-0085 — non-throwing onAddToScenario still closes the drawer (happy path preserved)", () => {
    const onAddToScenario = vi.fn();
    const onClose = vi.fn();
    render(
      <BridgeDrawer
        isOpen
        onClose={onClose}
        flaggedHoldings={[FLAGGED_A]}
        matchDecisionsByHoldingRef={{}}
        onAddToScenario={onAddToScenario}
      />,
    );
    fireEvent.click(
      screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
    );
    fireEvent.click(screen.getByTestId("bridge-add-to-scenario"));
    expect(onAddToScenario).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // M-0057 — the "← Back to candidates" button is a state-machine transition.
  // The existing "Back button → returns to browse stage" case only asserts the
  // happy-path stage flip. It does NOT pin whether a previously-surfaced error
  // (set on a failed Send intro) is cleared when the allocator backs out and
  // re-enters the confirm stage. The CORRECT behaviour is that backing out
  // clears the transient error so a stale "server fell over" alert never
  // re-appears on the next confirm view.
  // ---------------------------------------------------------------------------
  it(
    "M-0057: error surfaced on a failed Send intro is NOT cleared when going Back then re-entering confirm — fix in follow-up (Back handler should setError(null))",
    async () => {
      mockSendBridgeIntro.mockResolvedValueOnce({
        ok: false,
        error: "server fell over",
      });
      render(
        <BridgeDrawer
          isOpen
          onClose={vi.fn()}
          flaggedHoldings={[FLAGGED_A]}
          matchDecisionsByHoldingRef={{}}
        />,
      );
      // Enter confirm, trigger a failing send → error alert appears.
      fireEvent.click(
        screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
      );
      fireEvent.click(screen.getByRole("button", { name: /Send intro/ }));
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("server fell over");
      });

      // Back out to browse, then re-enter confirm for the same candidate.
      fireEvent.click(
        screen.getByRole("button", { name: /Back to candidates/ }),
      );
      fireEvent.click(
        screen.getByTestId("bridge-candidate-holding:binance:BTC/USDT:spot"),
      );

      // CORRECT behaviour: the confirm stage should be clean — no stale alert.
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );
});
