import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import { buildAllocatorPortfolioFactsheetPayload } from "@/lib/factsheet/allocator-portfolio-payload";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 188 (TINYBASE) plan 08, D-02 and D-06 - the hop from the dashboard prop to the payload
// the Overview hands its factsheet body.
//
// The mock set is `AllocationDashboardV2.options-caveat.test.tsx`'s. The allocator payload
// builder stays REAL (wrapped in a spy so the meta it receives can be read): the hop under test
// is the prop reaching the builder's meta and landing on `payload.dataQuality.tinyBaseDays`. A
// mocked builder would pass whatever the prop did. The note's copy and its day format are
// rendered and pinned by plan 07's FactsheetView test, not here.
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
  FactsheetBody: ({ payload }: { payload: { dataQuality?: { tinyBaseDays?: string[] } } }) => (
    <div data-testid="fs-tiny">{JSON.stringify(payload.dataQuality?.tinyBaseDays ?? null)}</div>
  ),
}));
vi.mock("@/lib/factsheet/allocator-portfolio-payload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/factsheet/allocator-portfolio-payload")>();
  return {
    ...actual,
    buildAllocatorPortfolioFactsheetPayload: vi.fn(actual.buildAllocatorPortfolioFactsheetPayload),
  };
});

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

const builder = vi.mocked(buildAllocatorPortfolioFactsheetPayload);
const lastMeta = () => builder.mock.calls[builder.mock.calls.length - 1][1] as { tinyBaseDays?: unknown };

describe("AllocationDashboardV2 - 188 D-02, D-06 the tiny-base days reach the factsheet body", () => {
  it("tinyBaseDays given: the builder gets that list in its meta and the payload handed to the body carries it", () => {
    builder.mockClear();
    render(<AllocationDashboardV2 {...baseProps} tinyBaseDays={["2026-10-27", "2026-10-28"]} />);
    expect(lastMeta().tinyBaseDays).toEqual(["2026-10-27", "2026-10-28"]);
    expect(screen.getByTestId("fs-tiny").textContent).toBe('["2026-10-27","2026-10-28"]');
  });

  it("tinyBaseDays absent (a legacy payload): the builder gets [] and the payload carries nothing", () => {
    builder.mockClear();
    render(<AllocationDashboardV2 {...baseProps} />);
    expect(lastMeta().tinyBaseDays).toEqual([]);
    expect(screen.getByTestId("fs-tiny").textContent).toBe("null");
  });

  it("while the history is rebuilding the builder is not called", () => {
    builder.mockClear();
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="rebuilding"
        tinyBaseDays={["2026-10-27", "2026-10-28"]}
      />,
    );
    expect(builder).not.toHaveBeenCalled();
  });
});
