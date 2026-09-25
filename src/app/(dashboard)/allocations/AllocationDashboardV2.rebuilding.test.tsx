import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 167.1.2 / D-02 ("Hide it until correct") — the Overview's rebuilding
// state.
//
// Why this matters: the allocator equity curve could count one exchange account
// twice or read a day with no sync as zero. The founder's own book showed a
// +100% jump, a -50% "crash" and Sharpe 1.44 beside -42.8% cumulative. While
// `equityHistoryState === "rebuilding"` the Overview must show NONE of it: no
// curve, no factsheet KPI built from the curve, and not the warm-up copy (which
// would promise panels "once two days of history are available" — a wrong
// reason, since the history is withheld, not short). Holdings-backed chrome
// (InsightStrip) stays.
//
// The factsheet body mock renders a "Sharpe" label and the payload builder
// returns a non-null stub, so a regression that let the factsheet mount would
// show a Sharpe label here. The "ready" case is the positive control: the same
// mocks DO render the curve and the Sharpe label when the state allows it.
// ---------------------------------------------------------------------------

const buildPayloadSpy = vi.fn(() => ({ stub: true }));

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
    <div data-testid="mock-factsheet-body">
      {topSlot}
      <span>Sharpe</span>
    </div>
  ),
}));
vi.mock("@/lib/factsheet/allocator-portfolio-payload", () => ({
  buildAllocatorPortfolioFactsheetPayload: () => buildPayloadSpy(),
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
  // A non-empty curve: the rebuilding gate must hide it even if a stale or
  // hand-built payload still carries one.
  equityDailyPoints: [
    { date: "2026-03-10", value: 10_000 },
    { date: "2026-03-11", value: 20_000 },
    { date: "2026-03-12", value: 10_000 },
  ],
  equitySnapshots: [],
  activeVenues: ["Binance"],
  snapshotCount: 3,
  minHistoryDepthMonths: 3,
  allocator_id: "alloc-1",
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityBaselineUnknown: false,
  hasConnectedKeys: true,
} as unknown as MyAllocationDashboardPayload;

describe("AllocationDashboardV2 — 167.1.2 D-02 rebuilding state", () => {
  beforeEach(() => {
    buildPayloadSpy.mockClear();
  });

  it("rebuilding: the rebuilding panel renders; no curve, no factsheet, no warm-up copy, no Sharpe; InsightStrip stays", () => {
    render(
      <AllocationDashboardV2 {...baseProps} equityHistoryState="rebuilding" />,
    );

    const panel = screen.getByTestId("overview-equity-rebuilding");
    expect(panel).toHaveAttribute("role", "status");
    expect(
      screen.getByRole("heading", {
        name: "Your equity history is being rebuilt",
      }),
    ).toBeInTheDocument();
    expect(panel.textContent).toContain(
      "Holdings and AUM on this page do not use that history.",
    );

    expect(screen.queryByTestId("overview-equity-curve")).toBeNull();
    expect(screen.queryByTestId("mock-equity-chart")).toBeNull();
    expect(screen.queryByTestId("overview-factsheet-warmup")).toBeNull();
    expect(screen.queryByTestId("mock-factsheet-body")).toBeNull();
    expect(screen.queryByText("Sharpe")).toBeNull();
    // No KPI is even computed from a curve while rebuilding.
    expect(buildPayloadSpy).not.toHaveBeenCalled();

    expect(screen.getByTestId("mock-insight-strip")).toBeInTheDocument();
  });

  it("a payload WITHOUT equityHistoryState is treated as rebuilding (fail-closed)", () => {
    // `baseProps` deliberately carries no `equityHistoryState` field.
    expect("equityHistoryState" in baseProps).toBe(false);
    render(<AllocationDashboardV2 {...baseProps} />);
    expect(screen.getByTestId("overview-equity-rebuilding")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-equity-curve")).toBeNull();
    expect(screen.queryByText("Sharpe")).toBeNull();
  });

  // Review round 1 (WR-03 / SFH-05): the panel renders for every allocator
  // with holdings, a first connect (holdingsEmpty && hasSyncing) and a book
  // whose every key is stale. Each sentence must be true for all of them. The
  // old copy named "the earlier chart" (a first connect never saw one), said it
  // "added up snapshots from several keys" (false for a single-key book) and
  // called holdings and AUM "current" directly under a banner saying
  // "Analytics may be stale".
  it("the panel copy holds for a stale, single-key book and a first connect: no 'current', no 'earlier chart', no 'several keys'", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="rebuilding"
        allKeysStale
        lastSyncAt="2026-03-01T00:00:00Z"
      />,
    );
    // The stale banner IS on screen, so the contradiction would be visible.
    expect(screen.getByTestId("dashboard-staleness-banner")).toBeInTheDocument();
    const text = screen.getByTestId("overview-equity-rebuilding").textContent ?? "";
    expect(text).not.toMatch(/\bcurrent\b/i);
    expect(text).not.toMatch(/earlier chart/i);
    expect(text).not.toMatch(/several keys/i);
    // The duplicate-account cause is stated as conditional on more than one key.
    expect(text).toContain("when more than one key reads it");

    cleanup();
    // First connect: no holdings yet, a sync in flight. The panel still renders
    // (this branch passes the holdingsEmpty && !hasSyncing guard).
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="rebuilding"
        holdingsSummary={[] as never}
        hasSyncing
      />,
    );
    expect(
      screen.getByTestId("overview-equity-rebuilding").textContent,
    ).not.toMatch(/earlier chart/i);
  });

  // Review round 1 (SFH-05): the baseline-unknown banner promised "a full
  // performance history builds up from here as daily snapshots accrue" while
  // the panel below it said the history is withheld however much accrues.
  it("rebuilding: the baseline-unknown banner keeps the data-horizon reason and drops the accrual promise; 'ready' keeps it", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="rebuilding"
        equityBaselineUnknown
      />,
    );
    const banner = screen.getByTestId("dashboard-baseline-unknown-banner");
    expect(banner.textContent).toContain("Limited equity history");
    expect(banner.textContent).toContain("available data window");
    expect(banner.textContent).not.toMatch(/accrue|builds up/i);
    expect(banner.textContent).toContain(
      "Your live holdings and AUM do not use that history.",
    );

    cleanup();
    // Positive control: the "ready" variant still carries the promise, so the
    // absence above is the rebuilding gate and not a deleted sentence.
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="ready"
        equityBaselineUnknown
      />,
    );
    expect(
      screen.getByTestId("dashboard-baseline-unknown-banner").textContent,
    ).toMatch(/builds up from here as daily snapshots accrue/);
  });

  // Review round 1 (WR-01 / SFH-01): a destructuring default fires on
  // `undefined` alone, so a gate written as `=== "rebuilding"` let null, "" or
  // any state added later (plan 11 may add one; a nullable DB column serialises
  // as null) SHOW the curve and every KPI. Only an explicit "ready" may show it.
  it.each([
    ["null", null],
    ["an empty string", ""],
    ["an unrecognised state", "partial"],
    ["a mis-cased ready", "Ready"],
  ])("equityHistoryState = %s is treated as rebuilding (fail-closed)", (_label, value) => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState={value as never}
      />,
    );
    expect(screen.getByTestId("overview-equity-rebuilding")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-equity-curve")).toBeNull();
    expect(screen.queryByTestId("mock-factsheet-body")).toBeNull();
    expect(screen.queryByText("Sharpe")).toBeNull();
    expect(buildPayloadSpy).not.toHaveBeenCalled();
  });

  // Positive control (moved behaviour, D-02): with the state explicitly "ready"
  // the same fixture DOES render the curve and the factsheet, so the absences
  // asserted above are the gate, not a broken fixture.
  it("ready: the curve and the factsheet render and the rebuilding panel does not", () => {
    render(<AllocationDashboardV2 {...baseProps} equityHistoryState="ready" />);
    expect(screen.getByTestId("overview-equity-curve")).toBeInTheDocument();
    expect(screen.getByTestId("mock-factsheet-body")).toBeInTheDocument();
    expect(screen.getByText("Sharpe")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-equity-rebuilding")).toBeNull();
    expect(buildPayloadSpy).toHaveBeenCalled();
  });
});
