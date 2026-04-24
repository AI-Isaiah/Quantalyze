import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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

    await new Promise((r) => setTimeout(r, 0));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("server fell over");
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
