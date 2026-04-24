import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { HoldingsTable } from "./HoldingsTable";
import type { DesignHoldingRow } from "../lib/holdings-adapter";

// next/navigation mock — DesignHoldingsTable calls useRouter() so the banner
// dismiss handler can fire router.refresh() (Plan 09.1 simplify pass).
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

/**
 * Phase 09.1 Plan 08 — HoldingsTable sub-row tests.
 *
 * Covers the new design-mode behaviour:
 *   1. Row click opens HoldingDetail with Metrics tab default.
 *   2. Clicking the "Record outcome" tab switches the visible sub-tab.
 *   3. Clicking the "Notes" tab switches to notes.
 *   4. Expanding row B while row A is expanded closes A (one-open-at-a-time).
 *   5. Pressing the same row again collapses it (toggle behaviour).
 *   6. bridgeCandidate=false → "Record outcome" tab shows the no-candidate copy.
 *   7. bridgeCandidate=true  → "Record outcome" tab mounts OutcomeForm.
 *   8. (D-14, S3 accepted) bridgeCandidate=true rows render BridgeOutcomeBanner
 *      as a non-expanded inline banner — present in the DOM regardless of
 *      whether the row is currently expanded.
 *   9. (D-14) bridgeCandidate=false rows do NOT render BridgeOutcomeBanner.
 *  10. (C1 accepted) OutcomeForm Modified option is present with
 *      aria-disabled="true" and clicking it does NOT change action state.
 */

// Mock Phase 08 note primitives so the test focuses on tab routing.
vi.mock("@/components/notes/NoteRender", () => ({
  NoteRender: ({ content }: { content: string }) => (
    <div data-testid="note-render">{content}</div>
  ),
}));
vi.mock("@/components/notes/NoteSaveStatus", () => ({
  NoteSaveStatus: () => <div data-testid="note-save-status" />,
}));
vi.mock("@/components/notes/useNoteAutoSave", () => ({
  useNoteAutoSave: () => ({
    saveState: "idle",
    lastSavedAt: null,
    save: vi.fn(),
  }),
}));

// Mock the BridgeOutcomeBanner so we can spot its presence/absence by testid
// without exercising its dismiss fetch path.
vi.mock("./BridgeOutcomeBanner", () => ({
  BridgeOutcomeBanner: (props: { strategyId: string }) => (
    <div
      data-testid="bridge-outcome-banner"
      data-strategy-id={props.strategyId}
    >
      mock banner
    </div>
  ),
}));

// Mock postBridgeOutcome so the form renders without network.
vi.mock("@/lib/bridge-outcome-schema", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bridge-outcome-schema")>(
      "@/lib/bridge-outcome-schema",
    );
  return {
    ...actual,
    postBridgeOutcome: vi.fn(async () => ({
      ok: true,
      outcome: {
        id: "outcome-test",
        kind: "allocated",
        percent_allocated: 1,
        allocated_at: "2026-04-24",
        rejection_reason: null,
        note: null,
        delta_30d: null,
        delta_90d: null,
        delta_180d: null,
        estimated_delta_bps: null,
        estimated_days: null,
        needs_recompute: false,
        created_at: "2026-04-24T00:00:00Z",
      },
    })),
  };
});

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
    bridgeCandidate: false,
    ...overrides,
  };
}

beforeEach(() => {
  // jsdom fetch stub — HoldingDetail's Notes tab fires GET /api/notes lazily.
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ content: "", updated_at: null }),
    }),
  ) as unknown as typeof fetch;
});

describe("HoldingsTable design-mode sub-row (09.1-08)", () => {
  it("1: row click opens HoldingDetail with Metrics tab default", () => {
    const row = makeRow();
    render(<HoldingsTable rows={[row]} />);
    fireEvent.click(screen.getByText("Test Strategy"));
    const region = screen.getByRole("region", {
      name: /Holding detail for BTC/,
    });
    const metricsTab = within(region).getByRole("tab", { name: "Metrics" });
    expect(metricsTab.getAttribute("aria-selected")).toBe("true");
  });

  it("2: clicking 'Record outcome' tab switches the visible sub-tab", () => {
    const row = makeRow();
    render(<HoldingsTable rows={[row]} />);
    fireEvent.click(screen.getByText("Test Strategy"));
    const region = screen.getByRole("region", {
      name: /Holding detail for BTC/,
    });
    const outcomeTab = within(region).getByRole("tab", {
      name: "Record outcome",
    });
    fireEvent.click(outcomeTab);
    expect(outcomeTab.getAttribute("aria-selected")).toBe("true");
  });

  it("3: clicking 'Notes' tab switches to notes", () => {
    const row = makeRow();
    render(<HoldingsTable rows={[row]} />);
    fireEvent.click(screen.getByText("Test Strategy"));
    const region = screen.getByRole("region", {
      name: /Holding detail for BTC/,
    });
    const notesTab = within(region).getByRole("tab", { name: "Notes" });
    fireEvent.click(notesTab);
    expect(notesTab.getAttribute("aria-selected")).toBe("true");
  });

  it("4: one-open-at-a-time — expanding row B closes A", () => {
    const a = makeRow({ id: "holding:binance:BTC:spot", strategy: "Alpha" });
    const b = makeRow({
      id: "holding:binance:ETH:spot",
      symbol: "ETH",
      strategy: "Beta",
    });
    render(<HoldingsTable rows={[a, b]} />);
    fireEvent.click(screen.getByText("Alpha"));
    expect(
      screen.queryByRole("region", { name: /Holding detail for BTC/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Beta"));
    // Row A's region is gone; row B's is mounted.
    expect(
      screen.queryByRole("region", { name: /Holding detail for BTC/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /Holding detail for ETH/ }),
    ).toBeInTheDocument();
  });

  it("5: clicking the same row again collapses it (toggle)", () => {
    const row = makeRow();
    render(<HoldingsTable rows={[row]} />);
    fireEvent.click(screen.getByText("Test Strategy"));
    expect(
      screen.queryByRole("region", { name: /Holding detail for BTC/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Test Strategy"));
    expect(
      screen.queryByRole("region", { name: /Holding detail for BTC/ }),
    ).not.toBeInTheDocument();
  });

  it("6: bridgeCandidate=false → Record-outcome tab shows no-candidate copy", () => {
    const row = makeRow({ bridgeCandidate: false });
    render(<HoldingsTable rows={[row]} />);
    fireEvent.click(screen.getByText("Test Strategy"));
    fireEvent.click(screen.getByRole("tab", { name: "Record outcome" }));
    expect(
      screen.getByText(/not flagged for Bridge action/i),
    ).toBeInTheDocument();
  });

  it("7: bridgeCandidate=true → Record-outcome tab mounts OutcomeForm", () => {
    const row = makeRow({
      bridgeCandidate: true,
      id: "holding:binance:BTC:spot",
    });
    const flaggedHoldingsByRef = {
      "holding:binance:BTC:spot": {
        top_candidate_strategy_id: "strat-123",
      },
    };
    render(
      <HoldingsTable
        rows={[row]}
        flaggedHoldingsByRef={flaggedHoldingsByRef}
      />,
    );
    fireEvent.click(screen.getByText("Test Strategy"));
    fireEvent.click(screen.getByRole("tab", { name: "Record outcome" }));
    expect(screen.getByTestId("outcome-form")).toBeInTheDocument();
  });

  it("8: D-14 banner invariant — bridgeCandidate=true row renders BridgeOutcomeBanner even when not expanded", () => {
    const row = makeRow({
      bridgeCandidate: true,
      id: "holding:binance:BTC:spot",
    });
    const flaggedHoldingsByRef = {
      "holding:binance:BTC:spot": {
        top_candidate_strategy_id: "strat-123",
      },
    };
    render(
      <HoldingsTable
        rows={[row]}
        flaggedHoldingsByRef={flaggedHoldingsByRef}
      />,
    );
    // No row click — the banner should already be in the DOM.
    expect(screen.getByTestId("bridge-outcome-banner")).toBeInTheDocument();
    // Expansion region is absent because we haven't clicked the row.
    expect(
      screen.queryByRole("region", { name: /Holding detail for BTC/ }),
    ).not.toBeInTheDocument();
  });

  it("9: D-14 banner absence — bridgeCandidate=false row does NOT render BridgeOutcomeBanner", () => {
    const row = makeRow({ bridgeCandidate: false });
    render(<HoldingsTable rows={[row]} />);
    expect(
      screen.queryByTestId("bridge-outcome-banner"),
    ).not.toBeInTheDocument();
  });

  it("10: C1 accepted — OutcomeForm Modified option is aria-disabled and clicking does NOT change action", () => {
    const row = makeRow({
      bridgeCandidate: true,
      id: "holding:binance:BTC:spot",
    });
    const flaggedHoldingsByRef = {
      "holding:binance:BTC:spot": {
        top_candidate_strategy_id: "strat-123",
      },
    };
    render(
      <HoldingsTable
        rows={[row]}
        flaggedHoldingsByRef={flaggedHoldingsByRef}
      />,
    );
    fireEvent.click(screen.getByText("Test Strategy"));
    fireEvent.click(screen.getByRole("tab", { name: "Record outcome" }));
    const modifiedBtn = screen.getByRole("button", {
      name: /Modified \(coming soon\)/,
    });
    expect(modifiedBtn).toHaveAttribute("aria-disabled", "true");
    expect(modifiedBtn).toBeDisabled();
    // Initial action is "allocated" — verify Allocated is pressed.
    const allocatedBtn = screen.getByRole("button", { name: "Allocated" });
    expect(allocatedBtn.getAttribute("aria-pressed")).toBe("true");
    // Click the disabled Modified button — action state must not change.
    fireEvent.click(modifiedBtn);
    expect(allocatedBtn.getAttribute("aria-pressed")).toBe("true");
    expect(modifiedBtn.getAttribute("aria-pressed")).toBe("false");
  });
});
