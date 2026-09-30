import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Review C4 SFH-C4-04. The derive leaves out a departed account the history
// rule includes when the balance its history is measured from is gone, and
// still marks the curve trustworthy, so the Overview reads "ready" over a
// smaller book than the one the owner ran. The Overview says so in one line.
// The payload's flag carries no count, so the line says "at least one".
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
  equitySnapshots: [],
  activeVenues: [],
  snapshotCount: 0,
  minHistoryDepthMonths: 3,
  allocator_id: "alloc-1",
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  allKeysStale: false,
  lastSyncAt: "2026-05-28T11:00:00Z",
  hasSyncing: false,
} as unknown as MyAllocationDashboardPayload;

const LINE =
  "This curve leaves out the history of at least one disconnected account, because the balance that history is measured from is not available.";

describe("AllocationDashboardV2: departed history left out of a ready curve (SFH-C4-04)", () => {
  it("says so on a ready curve when the payload flag is raised", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="ready"
        departedHistoryUnavailable
      />,
    );
    expect(screen.getByTestId("dashboard-departed-history-note").textContent).toBe(LINE);
  });

  it("says nothing when the flag is not raised", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="ready"
        departedHistoryUnavailable={false}
      />,
    );
    expect(screen.queryByTestId("dashboard-departed-history-note")).toBeNull();
  });

  it("says nothing while the history is rebuilding (no curve is shown)", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="rebuilding"
        departedHistoryUnavailable
      />,
    );
    expect(screen.queryByTestId("dashboard-departed-history-note")).toBeNull();
  });
});
