import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// NEW-C09-04 (B14, audit-2026-05-07) — Freshness-banner contract.
//
// `allKeysStale` + `lastSyncAt` are computed by `getMyAllocationDashboard`
// from each active api_key's `last_sync_at`. Before this fix the V2
// Overview never consumed the signal, so a 5-day-old portfolio showed the
// same full-confidence chrome as a 5-minute-old one. The banner here is
// the surface where that staleness becomes observable.
//
// Three properties matter:
//   1. allKeysStale=true AND hasSyncing=false → banner rendered.
//   2. allKeysStale=true AND hasSyncing=true  → banner suppressed (don't
//      double up with the in-flight SyncProgress pill).
//   3. allKeysStale=false                      → banner absent regardless
//      of hasSyncing — fresh keys don't get a misleading staleness cue.
//
// We mount the dashboard against the minimal Overview branch
// (factsheetPayload != null is unnecessary to assert the banner; we just
// need apiKeys present + holdingsSummary non-empty so it doesn't bail to
// the EmptyState early return).
// ---------------------------------------------------------------------------

// Minimal child mocks so we don't pull EquityChartWidget / FactsheetBody
// into the test renderer. The banner under test sits ABOVE these mounts,
// so they can be empty stubs.
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
  // Return null so the dashboard falls through to the warm-up branch
  // (no Factsheet provider needed) — irrelevant to the banner contract.
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
      exchange: "binance",
      is_active: true,
      sync_status: "complete",
      last_sync_at: null,
      sync_error: null,
      disconnected_at: null,
      label: "Test Key",
    },
  ] as never,
  holdingsSummary: [
    {
      symbol: "BTC",
      quantity: 1,
      mark_price_usd: 50_000,
      value_usd: 50_000,
      venue: "binance",
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
  minHistoryDepthMonths: null,
  allocator_id: "alloc-1",
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  weightSnapshots: [],
  positionsBySource: { spot: [], derivative: [] },
} as unknown as MyAllocationDashboardPayload;

describe("AllocationDashboardV2 — NEW-C09-04 staleness banner", () => {
  // Pin "now" so relative-age copy is deterministic across runs.
  const FROZEN_NOW = new Date("2026-05-28T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders banner with relative-age copy when allKeysStale=true AND not syncing", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        allKeysStale
        hasSyncing={false}
        // 3d ago in absolute terms — the banner should say "3d ago".
        lastSyncAt="2026-05-25T12:00:00Z"
      />,
    );
    const banner = screen.getByTestId("dashboard-staleness-banner");
    expect(banner.textContent).toContain("Analytics may be stale");
    expect(banner.textContent).toContain("3d ago");
  });

  it("renders 'No successful sync recorded yet' when lastSyncAt is null", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        allKeysStale
        hasSyncing={false}
        lastSyncAt={null}
      />,
    );
    const banner = screen.getByTestId("dashboard-staleness-banner");
    expect(banner.textContent).toContain("No successful sync recorded yet");
  });

  it("suppresses banner when allKeysStale=true AND hasSyncing=true (avoid double-message)", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        allKeysStale
        hasSyncing
        lastSyncAt="2026-05-25T12:00:00Z"
      />,
    );
    expect(
      screen.queryByTestId("dashboard-staleness-banner"),
    ).toBeNull();
  });

  it("does not render banner when allKeysStale=false (fresh data)", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        allKeysStale={false}
        hasSyncing={false}
        lastSyncAt="2026-05-28T11:00:00Z"
      />,
    );
    expect(
      screen.queryByTestId("dashboard-staleness-banner"),
    ).toBeNull();
  });
});
