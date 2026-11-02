import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 185 (DERIBITFLOWTIME) plan 05, D-04 and SC-3 - the hop from the
// dashboard prop to the payload the Overview hands its factsheet body.
//
// The mock set is `AllocationDashboardV2.staleness.test.tsx`'s EXCEPT the
// allocator payload builder, which stays REAL: the hop under test is the prop
// reaching `buildAllocatorPortfolioFactsheetPayload`'s meta and landing on
// `payload.dataQuality.optionsCashBasis`. A mocked builder would pass whatever
// the prop did.
// ---------------------------------------------------------------------------

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
  FactsheetProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/app/factsheet/[id]/v2/FactsheetView", () => ({
  FactsheetBody: ({ payload }: { payload: { dataQuality?: { optionsCashBasis?: boolean } } }) => (
    <div data-testid="fs-options">{String(payload.dataQuality?.optionsCashBasis === true)}</div>
  ),
}));

/** 30 consecutive days of a small positive return: long enough for the real builder. */
function thirtyDays() {
  const points = [];
  let value = 100_000;
  for (let i = 0; i < 30; i += 1) {
    value *= 1.002;
    const day = String(i + 1).padStart(2, "0");
    points.push({ date: `2026-03-${day}`, value });
  }
  return points;
}
const equityDailyPoints = thirtyDays();
const equityDailyReturns = equityDailyPoints.slice(1).map((p, i) => ({
  date: p.date,
  value: p.value / equityDailyPoints[i].value - 1,
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
      exchange: "deribit",
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
      venue: "deribit",
      holding_type: "spot",
      api_key_id: "k1",
      side: null,
      entry_price: null,
      unrealized_pnl_usd: null,
    },
  ] as never,
  flaggedHoldings: [],
  equityDailyPoints,
  equityDailyReturns,
  equityHistoryState: "ready",
  activeVenues: [],
  snapshotCount: 30,
  allocator_id: "alloc-1",
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  weightSnapshots: [],
  positionsBySource: { spot: [], derivative: [] },
} as unknown as MyAllocationDashboardPayload;

describe("AllocationDashboardV2 - 185 D-04 the options caveat reaches the factsheet body", () => {
  it("optionsCashBasis true: the payload handed to the body carries it", () => {
    render(<AllocationDashboardV2 {...baseProps} optionsCashBasis />);
    expect(screen.getByTestId("fs-options").textContent).toBe("true");
  });

  it("optionsCashBasis false: the payload carries nothing", () => {
    render(<AllocationDashboardV2 {...baseProps} optionsCashBasis={false} />);
    expect(screen.getByTestId("fs-options").textContent).toBe("false");
  });

  it("optionsCashBasis absent (a legacy payload): the payload carries nothing", () => {
    render(<AllocationDashboardV2 {...baseProps} />);
    expect(screen.getByTestId("fs-options").textContent).toBe("false");
  });
});
