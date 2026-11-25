/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 236 FIG-04, review CR-03 (CONTEXT Q1: "Emptied stretches stay in the span. The factsheet
// states the span CAGR covers.") - the allocator book is the surface the deleted TODOS entry
// 167.1.2.2.1-CAGR-EMPTY-SPAN named: a book whose span contains an emptied stretch.
//
// Why this matters: an allocator reading "CAGR 31%" cannot tell 40 days from 4 years without the
// span, and a book with a stretch of no observations is the case where counting observations (or
// subtracting the hole) would print a shorter span than the calendar the CAGR was compounded over.
// The allocator payload carries no stored span keys, so the line must come from the figures the
// CAGR was computed from.
//
// The payload builder, the factsheet provider and the MetricsColumn are all REAL: the line must
// appear through the hop from the dashboard prop to the rendered rail. Only the heavy siblings and
// the rest of the factsheet body are stubbed.
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
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/app/factsheet/[id]/v2/FactsheetView", async () => {
  const { MetricsColumn: Rail } = await import("@/app/factsheet/[id]/v2/MetricsColumn");
  return { FactsheetBody: () => <Rail /> };
});

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
});

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);
const dayAt = (offset: number) => new Date(START + offset * DAY).toISOString().slice(0, 10);

// Days 0..119 and 160..299 are observed: a 40-day hole, days 120..159.
const offsets = [...Array.from({ length: 120 }, (_, i) => i), ...Array.from({ length: 140 }, (_, i) => 160 + i)];

let value = 100_000;
const equityDailyPoints = offsets.map((d, i) => {
  value *= 1 + 0.0009 + Math.sin(i * 0.31) * 0.012;
  return { date: dayAt(d), value };
});
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
  holdingsSummary: [] as never,
  flaggedHoldings: [],
  equityDailyPoints,
  equityDailyReturns,
  equityHistoryState: "ready",
  hasConnectedKeys: true,
  activeVenues: [],
  snapshotCount: equityDailyPoints.length,
  allocator_id: "alloc-1",
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  weightSnapshots: [],
  positionsBySource: { spot: [], derivative: [] },
} as unknown as MyAllocationDashboardPayload;

describe("AllocationDashboardV2 - the allocator book states the span its CAGR covers (CR-03)", () => {
  it("a book with an emptied stretch: the span runs first to last observed day and counts the hole", () => {
    render(<AllocationDashboardV2 {...baseProps} />);
    const line = document.querySelector('[data-testid="cagr-span"]')?.textContent ?? null;
    // The first curve point (Jan 1) is the base, so the first RETURN is Jan 2. Jan 2 to Oct 27 is
    // 298 calendar days, of which 259 carry a return: counting observations, or subtracting the
    // 40-day hole, would print 259 or fewer.
    expect(line).toBe("CAGR over Jan 2, 2026 to Oct 27, 2026 (298 days)");
  });
});
