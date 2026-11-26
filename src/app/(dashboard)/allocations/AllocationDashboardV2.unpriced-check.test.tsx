import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 235 HOLD-04. When the dashboard's marker read fails, the Holdings rows
// are KEPT (hiding them would blank the book), so the only thing that stops an
// account's earlier-day positions being shown silently is this one-sentence
// note. Each arm below fails if the note goes missing, shows without rows,
// shows when the read succeeded, sits in the wrong place, or is latched in
// local state instead of following the polled payload.
// ---------------------------------------------------------------------------

import { vi } from "vitest";

vi.mock("@/components/portfolio/InsightStrip", () => ({
  InsightStrip: () => <div data-testid="mock-insight-strip" />,
}));
vi.mock("./components/AlertBanner", () => ({
  AlertBanner: () => <div data-testid="mock-alert-banner" />,
}));
vi.mock("./widgets/performance/EquityChart", () => ({
  default: () => <div data-testid="mock-equity-chart" />,
}));
vi.mock("@/app/factsheet/[id]/v2/factsheet-context", () => ({
  FactsheetProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/app/factsheet/[id]/v2/FactsheetView", () => ({
  FactsheetBody: () => <div data-testid="mock-factsheet-body" />,
}));
vi.mock("@/lib/factsheet/allocator-portfolio-payload", () => ({
  buildAllocatorPortfolioFactsheetPayload: () => null,
}));

const baseProps = {
  portfolio: {
    id: "p1",
    user_id: "u1",
    name: "Test Portfolio",
    description: null,
    created_at: "2023-01-01T00:00:00Z",
    is_test: false,
  },
  strategies: [],
  analytics: {
    total_aum: 100_000,
    return_ytd: 0.1,
    return_mtd: 0.01,
    portfolio_sharpe: 1.2,
    portfolio_max_drawdown: -0.05,
    portfolio_volatility: 0.15,
    avg_pairwise_correlation: 0.25,
    attribution_breakdown: null,
  } as never,
  apiKeys: [
    {
      id: "k1",
      exchange: "okx",
      is_active: true,
      sync_status: "complete",
      last_sync_at: "2026-05-28T11:00:00Z",
      sync_error: null,
      disconnected_at: null,
      label: "OKX Key",
    },
  ] as never,
  holdingsSummary: [
    {
      symbol: "BTC",
      quantity: 1,
      mark_price_usd: 50_000,
      value_usd: 50_000,
      venue: "okx",
      holding_type: "spot",
      api_key_id: "k1",
      side: null,
      entry_price: null,
      unrealized_pnl_usd: null,
    },
  ] as never,
  flaggedHoldings: [],
  equityDailyPoints: [],
  activeVenues: [],
  snapshotCount: 0,
  allocator_id: "alloc-1",
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  allKeysStale: false,
  lastSyncAt: "2026-05-28T11:00:00Z",
  hasSyncing: false,
} as unknown as MyAllocationDashboardPayload;

// Hand-typed on purpose: never read back from the registry, so a registry edit
// cannot move the expectation with it (UI-SPEC 1.2, ASCII apostrophes).
const SENTENCE =
  "We could not check whether each account's newest day could be priced in USD, so the holdings shown may include an account's positions from an earlier day. Reload this page to try again.";
const NOTE = "dashboard-holdings-unpriced-check-note";
const ID_SELECTOR = '[data-degrade-id="allocation.holdings-unpriced-check-failed"]';

describe("AllocationDashboardV2: the unpriced-check note follows a failed marker read (HOLD-04)", () => {
  it("U1: flag true with rows shows the verbatim sentence, as a status, with its id marker, visible at 390px", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="ready"
        holdingsUnpricedCheckFailed
      />,
    );
    const note = screen.getByTestId(NOTE);
    expect(note.textContent).toBe(SENTENCE);
    expect(note.getAttribute("role")).toBe("status");
    expect(note.querySelector(ID_SELECTOR)).not.toBeNull();
    // No breakpoint toggle: the note is visible at a 390px viewport.
    expect(note.className.split(/\s+/)).not.toContain("hidden");
    expect(note.className).not.toContain("md:block");
  });

  it("U2: renders while the history is rebuilding too, after the missing-data message", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="rebuilding"
        equityHistoryRebuildReason="awaiting_derivation"
        holdingsUnpricedCheckFailed
      />,
    );
    const note = screen.getByTestId(NOTE);
    const missing = screen.getByTestId("overview-missing-data");
    // The glance's Holdings group prints in both states, so the note is not
    // gated on the history being ready.
    expect(missing.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("U3: precedes the departed-history note and moves no sibling note", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="ready"
        departedHistoryUnavailable
        holdingsUnpricedCheckFailed
      />,
    );
    const note = screen.getByTestId(NOTE);
    const departed = screen.getByTestId("dashboard-departed-history-note");
    expect(note.compareDocumentPosition(departed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("U4: flag true with zero rows shows nothing (no earlier-day row can be shown)", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        holdingsSummary={[]}
        hasConnectedKeys
        equityHistoryState="ready"
        holdingsUnpricedCheckFailed
      />,
    );
    // Guard against a vacuous pass: with no connected key an empty book returns the
    // connect-a-key card early and the note could never render. A connected key
    // keeps the Overview on its normal path.
    expect(screen.getByTestId("glance-book-equity")).not.toBeNull();
    expect(screen.queryByTestId(NOTE)).toBeNull();
  });

  it("U5: flag false, and flag absent, show nothing and leave no id marker in the DOM", () => {
    const { unmount } = render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="ready"
        holdingsUnpricedCheckFailed={false}
      />,
    );
    expect(screen.queryByTestId(NOTE)).toBeNull();
    expect(document.querySelector(ID_SELECTOR)).toBeNull();
    unmount();
    render(<AllocationDashboardV2 {...baseProps} equityHistoryState="ready" />);
    expect(screen.queryByTestId(NOTE)).toBeNull();
    expect(document.querySelector(ID_SELECTOR)).toBeNull();
  });

  it("U6: follows the polled payload (true, false, true) and is never latched in local state", () => {
    const { rerender } = render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="ready"
        holdingsUnpricedCheckFailed
      />,
    );
    expect(screen.queryByTestId(NOTE)).not.toBeNull();
    rerender(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="ready"
        holdingsUnpricedCheckFailed={false}
      />,
    );
    expect(screen.queryByTestId(NOTE)).toBeNull();
    rerender(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="ready"
        holdingsUnpricedCheckFailed
      />,
    );
    expect(screen.queryByTestId(NOTE)).not.toBeNull();
  });
});
