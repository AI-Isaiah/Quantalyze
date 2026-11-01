import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 167.1.2.1 plan 06 (D-09, D-14) named a capped key on the Overview in
// one muted line. Phase 176 retired the note with the job (see below).
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

const NOTE = "dashboard-history-reconstruct-failed-note";

// Phase 176 LEGACYRETIRE PR 2 review fix round 1 (MD-01). The reconstruct job is
// retired, so nothing can stamp the marker or reset the counter: a capped key
// stays capped for ever, and "could not be rebuilt ... the curve shows what was
// recorded" is false (the derived series IS the curve). The note must never
// render, whatever the payload flag says.
describe("AllocationDashboardV2: the retired 'history could not be rebuilt' note never renders (176 MD-01)", () => {
  it("says nothing on a ready curve even when the payload flag is raised", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="ready"
        historyReconstructFailed
      />,
    );
    expect(screen.queryByTestId(NOTE)).toBeNull();
    expect(document.body.textContent).not.toContain("could not be rebuilt");
  });

  it("says nothing when the flag is not raised", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="ready"
        historyReconstructFailed={false}
      />,
    );
    expect(
      screen.queryByTestId(NOTE),
    ).toBeNull();
  });

  it("says nothing while the history is rebuilding (no curve is shown)", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="rebuilding"
        historyReconstructFailed
      />,
    );
    expect(
      screen.queryByTestId(NOTE),
    ).toBeNull();
  });
});
