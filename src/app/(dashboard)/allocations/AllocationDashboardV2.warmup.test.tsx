import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import { buildAllocatorPortfolioFactsheetPayload } from "@/lib/factsheet/allocator-portfolio-payload";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 167.1.2 review C3 WR-01 (SFH-C3-03): the Overview's warm-up note in the
// "ready" branch.
//
// Why this matters: the note tells the allocator how much history unlocks the
// factsheet panels. It said "two days" and rendered only when two days were
// already on screen, because the factsheet builder counts RETURNS, not curve
// days, and the writer's first curve day is a join, not a return. A threshold
// the page contradicts reads as broken. So these arms do NOT mock the builder.
// The real `buildAllocatorPortfolioFactsheetPayload` decides whether the note
// renders, and the copy's day count is measured against that same builder, so
// a change to its threshold or to the copy fails here.
//
// This file exists beside `AllocationDashboardV2.rebuilding.test.tsx` because
// that file's `vi.mock` of the builder is hoisted and file-scoped: an unmocked
// arm cannot live there without changing what every other arm exercises.
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
  FactsheetProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/app/factsheet/[id]/v2/FactsheetView", () => ({
  FactsheetBody: ({ topSlot }: { topSlot?: React.ReactNode }) => (
    <div data-testid="mock-factsheet-body">{topSlot}</div>
  ),
}));

const DAY_WORDS: Record<number, string> = {
  2: "two",
  3: "three",
  4: "four",
  5: "five",
};

/**
 * The payload `derivePhase07Fields` (src/lib/queries.ts) emits for a "ready"
 * book whose v2 curve has `days` points. The display curve is the derived
 * curve; the returns are the persisted v2 returns. The writer
 * (`allocator_equity_compose.py::portfolio_returns`, `range(1, len(union))`)
 * emits one return per curve day after the first, so the returns start on
 * day 2. `days` starts at 2: the reader refuses a series with no return
 * (`extractTrustworthyDerivedSeries`), so a one-day ready book does not exist.
 */
function readyShape(days: number): {
  equityDailyPoints: DailyPoint[];
  equityDailyReturns: DailyPoint[];
} {
  const equityDailyPoints: DailyPoint[] = Array.from({ length: days }, (_, i) => ({
    date: `2026-03-${String(10 + i).padStart(2, "0")}`,
    value: 10_000 + 100 * i,
  }));
  const equityDailyReturns: DailyPoint[] = equityDailyPoints
    .slice(1)
    .map((p, i) => ({ date: p.date, value: i % 2 === 0 ? 0.01 : -0.005 }));
  return { equityDailyPoints, equityDailyReturns };
}

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
  analytics: null,
  apiKeys: [] as never,
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
  equitySnapshots: [],
  activeVenues: ["Binance"],
  snapshotCount: 0,
  minHistoryDepthMonths: 3,
  allocator_id: "alloc-1",
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityBaselineUnknown: false,
  hasConnectedKeys: true,
  equityHistoryState: "ready",
  equityHistoryRebuildReason: null,
  equityCurveSource: "derived",
} as unknown as MyAllocationDashboardPayload;

/** What the real builder returns for this shape, called as the Overview calls it. */
function builderOutput(shape: ReturnType<typeof readyShape>) {
  return buildAllocatorPortfolioFactsheetPayload(shape.equityDailyPoints, {
    allocatorId: "alloc-1",
    portfolioName: "Test Portfolio",
    computedAt: null,
    markets: ["Binance"],
    startDate: shape.equityDailyPoints[0]?.date ?? null,
    aum: null,
    dailyReturns: shape.equityDailyReturns,
  });
}

const CURVE_DAYS = [2, 3, 4] as const;

describe("AllocationDashboardV2: the ready-branch warm-up note follows the real factsheet builder (167.1.2 C3 WR-01)", () => {
  it.each(CURVE_DAYS)(
    "a ready %i-day curve: the warm-up note renders exactly when the real builder returns null",
    (days) => {
      const shape = readyShape(days);
      const builderIsNull = builderOutput(shape) === null;
      render(<AllocationDashboardV2 {...baseProps} {...shape} />);
      // The curve is on screen in both outcomes.
      expect(screen.getByTestId("mock-equity-chart")).toBeInTheDocument();
      expect(screen.queryByTestId("overview-equity-rebuilding")).toBeNull();
      if (builderIsNull) {
        expect(screen.getByTestId("overview-factsheet-warmup")).toBeInTheDocument();
        expect(screen.queryByTestId("mock-factsheet-body")).toBeNull();
      } else {
        expect(screen.queryByTestId("overview-factsheet-warmup")).toBeNull();
        expect(screen.getByTestId("mock-factsheet-body")).toBeInTheDocument();
      }
    },
  );

  it("the note's day count is the smallest ready curve the real builder accepts", () => {
    const outcomes = CURVE_DAYS.map((days) => builderOutput(readyShape(days)) === null);
    // Non-vacuity: the measured range holds both outcomes, so the threshold
    // below is a real boundary and not the edge of the fixture set.
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
    const firstAccepted = CURVE_DAYS.find((days) => builderOutput(readyShape(days)) !== null);
    expect(firstAccepted).toBeDefined();
    const word = DAY_WORDS[firstAccepted as number];
    expect(word).toBeDefined();

    // Render the largest curve the builder still refuses, the only state the
    // note appears in, and read the promise it makes.
    const lastRefused = CURVE_DAYS.filter(
      (days) => builderOutput(readyShape(days)) === null,
    ).at(-1) as number;
    render(<AllocationDashboardV2 {...baseProps} {...readyShape(lastRefused)} />);
    expect(screen.getByTestId("overview-factsheet-warmup").textContent).toContain(
      `Aggregated factsheet panels appear once at least ${word} days of blended equity history are available.`,
    );
  });

  // Review C3 IN-01: the note's count line described `snapshotCount`, the
  // LEGACY allocator_equity_snapshots row count, beside the DERIVED curve drawn
  // above it. The two are unrelated since plan 11, so a two-day curve read
  // "1 snapshot recorded so far" or nothing at all. The count now reads the
  // curve on screen, in the same unit as the threshold above it.
  it.each([0, 1, 60])(
    "a ready 2-day curve beside %i legacy snapshots: the note counts the 2 curve days, never the snapshots",
    (snapshotCount) => {
      const shape = readyShape(2);
      expect(builderOutput(shape)).toBeNull();
      render(
        <AllocationDashboardV2
          {...baseProps}
          {...shape}
          snapshotCount={snapshotCount}
        />,
      );
      const note = screen.getByTestId("overview-factsheet-warmup");
      expect(note.textContent).toContain("2 days of blended equity history so far.");
      expect(note.textContent).not.toMatch(/snapshot/);
    },
  );
});
