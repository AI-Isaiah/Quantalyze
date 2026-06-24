import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// CL9 / NEW-C01-11 — baseline-unknown banner contract.
//
// `equityBaselineUnknown` is computed by getMyAllocationDashboard: it is true
// whenever ANY reconstructed snapshot was built against an unknown absolute
// baseline (OKX 90-day terminus clamped the funding deposit out of the fetch
// window). Those rows are excluded server-side from equityDailyPoints / KPIs,
// so the curve simply starts later — WITHOUT a banner that reads as a broken
// connection ("connect an exchange") rather than what it is (history horizon).
//
// Properties under test:
//   1. equityBaselineUnknown=true  → banner rendered, explains the gap AND
//      that live holdings / AUM remain accurate (the WHY — don't mislead the
//      user into reconnecting).
//   2. equityBaselineUnknown=false → banner absent (a clean curve gets no
//      misleading caveat).
//
// Mounts the same minimal Overview branch the staleness test uses: child
// widgets are stubbed (the banner sits above them); holdingsSummary non-empty
// so the dashboard doesn't bail to the EmptyState early return.
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

describe("AllocationDashboardV2 — CL9 baseline-unknown banner", () => {
  it("renders the banner when equityBaselineUnknown=true, explaining the gap and that live holdings stay accurate", () => {
    render(<AllocationDashboardV2 {...baseProps} equityBaselineUnknown />);
    const banner = screen.getByTestId("dashboard-baseline-unknown-banner");
    expect(banner.textContent).toContain("Limited equity history");
    // The WHY: it must NOT read as a broken connection — live data is accurate.
    expect(banner.textContent).toContain("live holdings");
    expect(banner.textContent?.toLowerCase()).toContain("accurate");
  });

  it("does not render the banner when equityBaselineUnknown=false (clean curve)", () => {
    render(
      <AllocationDashboardV2 {...baseProps} equityBaselineUnknown={false} />,
    );
    expect(
      screen.queryByTestId("dashboard-baseline-unknown-banner"),
    ).toBeNull();
  });

  // CL9 review (silent-failure-hunter / red-team): a terminus-clamped allocator
  // whose holdings poll hasn't landed yet hits the holdingsEmpty early-return
  // (a SEPARATE data source from equityBaselineUnknown). Without the fix the
  // banner is unreachable and the user sees only the bare "connect an exchange"
  // CTA — actively wrong. The banner must survive that branch.
  it("still renders the banner in the empty-holdings branch (banner is not unreachable)", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        holdingsSummary={[] as never}
        hasSyncing={false}
        equityBaselineUnknown
      />,
    );
    expect(
      screen.getByTestId("dashboard-baseline-unknown-banner"),
    ).toBeInTheDocument();
  });

  it("does not render the banner in the empty-holdings branch when baseline is known", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        holdingsSummary={[] as never}
        hasSyncing={false}
        equityBaselineUnknown={false}
      />,
    );
    expect(
      screen.queryByTestId("dashboard-baseline-unknown-banner"),
    ).toBeNull();
  });
});
