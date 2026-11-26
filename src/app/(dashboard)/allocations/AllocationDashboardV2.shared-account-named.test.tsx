import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import type { KeyDataGap } from "./lib/key-data-gaps";

// ---------------------------------------------------------------------------
// Phase 235 HOLD-05 (SC-4). The payload attributes the all-failing shared
// accounts (`sharedAccountFailingGroups`); the Overview must hand them to the
// missing-data message, or a second all-failing account whose history reaches
// yesterday (no dated gap) stays unnamed on the page with no fallback either.
// O1 fails if the Overview stops passing the groups; O2 fails if a legacy
// payload without the field stops keeping the shipped book fallback.
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
      id: "a1-0001",
      exchange: "binance",
      is_active: true,
      sync_status: "complete",
      last_sync_at: "2026-05-28T11:00:00Z",
      sync_error: null,
      disconnected_at: null,
      label: "a1",
    },
    {
      id: "a2-0002",
      exchange: "binance",
      is_active: true,
      sync_status: "complete",
      last_sync_at: "2026-05-28T11:00:00Z",
      sync_error: null,
      disconnected_at: null,
      label: "a2",
    },
    {
      id: "b1-0003",
      exchange: "binance",
      is_active: true,
      sync_status: "complete",
      last_sync_at: "2026-05-28T11:00:00Z",
      sync_error: null,
      disconnected_at: null,
      label: "b1",
    },
    {
      id: "b2-0004",
      exchange: "binance",
      is_active: true,
      sync_status: "complete",
      last_sync_at: "2026-05-28T11:00:00Z",
      sync_error: null,
      disconnected_at: null,
      label: "b2",
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

const REASON = "shared_account_no_working_key" as const;
// Hand-typed on purpose: never read back from the registry or the component.
const UNDATED_B =
  "Binance — b1 and Binance — b2: these keys read one exchange account and every one of them is failing to sync.";
const FALLBACK_START =
  "The keys that read one of your exchange accounts are all failing to sync, so that account's history stops.";
const A_GAP: KeyDataGap = {
  apiKeyIds: ["a1-0001", "a2-0002"],
  cause: "shared_account_failing",
  firstMissingDay: "2026-10-05",
  ranges: [{ from: "2026-10-05", to: "2026-10-11" }],
};

describe("AllocationDashboardV2: the payload's shared-account groups reach the missing-data message (HOLD-05)", () => {
  // Review WR-01: B is named only by the undated line, so the book fallback stays beside it.
  it("O1: a two-account payload names every failing key and keeps the book fallback", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="rebuilding"
        equityHistoryRebuildReason={REASON}
        keyDataGaps={[A_GAP]}
        sharedAccountFailingGroups={[
          ["a1-0001", "a2-0002"],
          ["b1-0003", "b2-0004"],
        ]}
      />,
    );
    const text = screen.getByTestId("overview-missing-data").textContent ?? "";
    expect(text).toContain(UNDATED_B);
    expect(text).toContain("Binance — a1 and Binance — a2: no data for");
    expect(text).toContain(FALLBACK_START);
  });

  it("O2: a legacy payload without the field keeps the book fallback and prints no undated line", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="rebuilding"
        equityHistoryRebuildReason={REASON}
        keyDataGaps={[]}
      />,
    );
    const text = screen.getByTestId("overview-missing-data").textContent ?? "";
    expect(text).toContain(FALLBACK_START);
    expect(text).not.toContain("these keys read one exchange account");
  });
});
