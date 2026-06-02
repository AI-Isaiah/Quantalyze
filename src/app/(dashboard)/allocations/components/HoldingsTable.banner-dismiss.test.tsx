import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HoldingsTable } from "./HoldingsTable";
import type { DesignHoldingRow } from "../lib/holdings-adapter";

// ---------------------------------------------------------------------------
// H-1220 (F1 loud-fail) — banner dismiss → router.refresh() failure must be
// surfaced, not swallowed.
//
// By the time BridgeOutcomeBanner.onDismiss fires, the dismissal POST has
// already committed server-side. The HoldingsTable handler then calls
// router.refresh() to re-fetch the dashboard so the now-dismissed holding
// drops out of `flaggedHoldings` and the banner unmounts. If router.refresh()
// throws (auth blip, network failure), the banner stays on screen looking
// "dismissed" while the view is stale — and prior to the fix the failure was
// invisible (no log, no feedback). This conflation of refresh-failure with
// refresh-success is exactly the F1 class. The fix wraps router.refresh() in a
// try/catch and console.error's the dropped refresh so it is observable.
//
// `refresh` is the ONLY router method made to throw here; the mock banner is
// given a real dismiss button that invokes props.onDismiss so the handler path
// is genuinely exercised.
// ---------------------------------------------------------------------------

const mockRouterRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRouterRefresh,
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/allocations",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock the banner with a real dismiss button wired to props.onDismiss so the
// HoldingsTable onDismiss handler (which calls router.refresh) actually runs.
vi.mock("./BridgeOutcomeBanner", () => ({
  BridgeOutcomeBanner: (props: {
    strategyId: string;
    onDismiss: () => void;
  }) => (
    <div data-testid="bridge-outcome-banner" data-strategy-id={props.strategyId}>
      <button
        type="button"
        data-testid="mock-dismiss"
        onClick={() => props.onDismiss()}
      >
        dismiss
      </button>
    </div>
  ),
}));

function makeRow(overrides: Partial<DesignHoldingRow> = {}): DesignHoldingRow {
  return {
    id: "holding:binance:BTC:spot",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    strategy: "Test Strategy",
    manager: "TST-001",
    tag: "trend",
    alloc: 100_000,
    weight: 0.5,
    mtd: 0.02,
    sharpe: 1.5,
    dd: -0.08,
    age: 90,
    status: "ok",
    bridgeCandidate: true,
    ...overrides,
  };
}

const FLAGGED_BY_REF = {
  "holding:binance:BTC:spot": { top_candidate_strategy_id: "strat-123" },
};

describe("HoldingsTable banner dismiss — router.refresh loud-fail (H-1220)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRouterRefresh.mockReset();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("logs the dropped refresh when router.refresh() throws (failure not swallowed)", () => {
    mockRouterRefresh.mockImplementation(() => {
      throw new Error("RSC fetch failed");
    });

    render(
      <HoldingsTable rows={[makeRow()]} flaggedHoldingsByRef={FLAGGED_BY_REF} />,
    );

    // Dismissing must not throw out of the handler — the failure is caught.
    expect(() =>
      fireEvent.click(screen.getByTestId("mock-dismiss")),
    ).not.toThrow();

    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
    // The swallowed branch is now observable via console.error with the
    // H-1220 stable prefix. Without the fix, refresh would throw uncaught
    // (fireEvent rethrows) OR be silently dropped — either way this assertion
    // fails because no [HoldingsTable] error is logged.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[HoldingsTable] router.refresh after banner dismiss failed",
      expect.any(Error),
    );
  });

  it("happy path: successful dismiss calls router.refresh once and does not log an error", () => {
    render(
      <HoldingsTable rows={[makeRow()]} flaggedHoldingsByRef={FLAGGED_BY_REF} />,
    );

    fireEvent.click(screen.getByTestId("mock-dismiss"));

    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
