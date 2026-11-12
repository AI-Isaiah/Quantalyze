import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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
  activeVenues: [],
  snapshotCount: 0,
  allocator_id: "alloc-1",
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  weightSnapshots: [],
  positionsBySource: { spot: [], derivative: [] },
} as unknown as MyAllocationDashboardPayload;

const EXPECTED_ACTION =
  "Reconnect a key on the Exchanges page, or wait for the next sync.";

describe("AllocationDashboardV2 — NEW-C09-04 staleness banner", () => {
  // Phase 199 plan 03 (D-04, CD-05, SC-4): the banner names the DAY of the newest
  // sync, never a relative age, and one action. The clock is pinned only to prove
  // the copy does not read it: two different "now"s give the same words.
  const NOW_A = new Date("2026-05-28T12:00:00Z").getTime();
  const NOW_B = new Date("2026-09-01T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_A);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the day of the newest sync and one action when allKeysStale=true AND not syncing", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        allKeysStale
        hasSyncing={false}
        lastSyncAt="2026-05-25T12:00:00Z"
      />,
    );
    const banner = screen.getByTestId("dashboard-staleness-banner");
    expect(banner.textContent).toBe(
      `Analytics may be stale: no exchange key has synced since May\u00a025,\u00a02026. ${EXPECTED_ACTION}`,
    );
    // The registry id marks the render site (the scan test attributes it by this).
    expect(banner.querySelector('[data-degrade-id="allocation.staleness"]')).not.toBeNull();
    expect(banner.querySelector("a")?.getAttribute("href")).toBe("/profile?tab=exchanges");
  });

  it("never prints a relative age, whatever the clock says", () => {
    const text = () => {
      cleanup();
      render(
        <AllocationDashboardV2
          {...baseProps}
          allKeysStale
          hasSyncing={false}
          lastSyncAt="2026-05-25T12:00:00Z"
        />,
      );
      return screen.getByTestId("dashboard-staleness-banner").textContent;
    };
    const first = text();
    vi.setSystemTime(NOW_B);
    const second = text();
    expect(second).toBe(first);
    expect(first).not.toMatch(/\bago\b|Last successful sync was/);
  });

  it("keeps its test id, its status role and its amber shell", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        allKeysStale
        hasSyncing={false}
        lastSyncAt="2026-05-25T12:00:00Z"
      />,
    );
    const banner = screen.getByTestId("dashboard-staleness-banner");
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.getAttribute("style")).toContain("var(--color-warning-bg)");
    expect(banner.getAttribute("style")).toContain("var(--color-warning-border)");
  });

  it("with no sync ever, names the key that has not completed one", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        allKeysStale
        hasSyncing={false}
        lastSyncAt={null}
      />,
    );
    const banner = screen.getByTestId("dashboard-staleness-banner");
    expect(banner.textContent).toBe(
      `Analytics may be stale: Binance — Test Key has not completed a sync yet. ${EXPECTED_ACTION}`,
    );
    expect(banner.querySelector('[data-degrade-id="allocation.staleness-never"]')).not.toBeNull();
    expect(banner.textContent).not.toContain("No successful sync recorded yet");
  });

  it("with several keys that never synced, names each sorted by label, and leaves an inactive key out", () => {
    const key = (id: string, exchange: string, label: string, active = true) => ({
      id,
      exchange,
      is_active: active,
      sync_status: "complete",
      last_sync_at: null,
      sync_error: null,
      disconnected_at: null,
      label,
    });
    render(
      <AllocationDashboardV2
        {...baseProps}
        apiKeys={
          [
            key("k2", "okx", "Zed"),
            key("k1", "binance", "Alpha"),
            key("k3", "bybit", "Retired", false),
          ] as never
        }
        allKeysStale
        hasSyncing={false}
        lastSyncAt={null}
      />,
    );
    const text = screen.getByTestId("dashboard-staleness-banner").textContent;
    expect(text).toBe(
      `Analytics may be stale: Binance — Alpha and OKX — Zed have not completed a sync yet. ${EXPECTED_ACTION}`,
    );
    expect(text).not.toContain("Retired");
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
