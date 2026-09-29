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
// would promise panels once enough days of history are available — a wrong
// reason, since the history is withheld, not short). Holdings-backed chrome
// (InsightStrip) stays. Phase 167.1.2 D-15 (2026-09-27) supersedes IN-01
// (2026-09-25): the copy is chosen by state, never by a snapshot count, so a
// brand-new book under "rebuilding" gets the panel and its reason too. The
// warm-up note renders only in the "ready" branch, where more days do build
// the panels (review C3 WR-01: its count is measured against the real builder
// in `AllocationDashboardV2.warmup.test.tsx`).
//
// The factsheet body mock renders a "Sharpe" label and the payload builder
// returns a non-null stub, so a regression that let the factsheet mount would
// show a Sharpe label here. The "ready" case is the positive control: the same
// mocks DO render the curve and the Sharpe label when the state allows it.
// ---------------------------------------------------------------------------

const buildPayloadSpy = vi.fn((..._args: unknown[]) => ({ stub: true }));

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
  buildAllocatorPortfolioFactsheetPayload: (...args: unknown[]) =>
    buildPayloadSpy(...args),
}));

// The one authored line per rebuild reason, over the closed set of
// `EquityHistoryRebuildReason`. Shared by the per-reason arm and the D-15
// reason-and-count arm below, so the two cannot drift apart.
const REASON_LINES = [
  [
    "duplicate_account",
    "Two of your keys read the same exchange account. Disconnect one of them on the Exchanges page and the history rebuilds.",
  ],
  [
    // Review C2 WR-02: the line no longer promises the NEXT sync succeeds.
    // The stamper runs after every successful poll, and that is all the
    // line claims.
    "account_identity_pending",
    "We are confirming which exchange account each key reads. Each daily sync checks it again.",
  ],
  [
    // Review C2 round 2 IN-04: with no key list to name from (a payload
    // without the ids), the line stays true for any number of keys.
    "key_not_syncing",
    "A key is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.",
  ],
  [
    "awaiting_derivation",
    "Your history is recomputed from each account's returns and cash flows once a day.",
  ],
  [
    "derivation_rejected",
    "The latest rebuild of your history did not pass its checks, so it is not shown.",
  ],
  [
    // Review C2 round 2 IN-05: active voice (DESIGN.md Voice).
    "history_read_failed",
    "We could not load your history just now. Reload the page to try again.",
  ],
  [
    // Review C2 round 3 R3-WR-03: the cause and the unlock, never "did not
    // pass its checks". No account and no number (T-167.1.2-22a).
    "shared_account_no_working_key",
    "The keys that read one of your exchange accounts are all failing to sync, so that account's history stops. Fix or reconnect one of them on the Exchanges page.",
  ],
  [
    "shared_account_history_truncated",
    "One of your exchange accounts changed keys, and we cannot join its history from before the change to the new key's yet, so your history is not shown.",
  ],
] as const satisfies ReadonlyArray<
  readonly [NonNullable<MyAllocationDashboardPayload["equityHistoryRebuildReason"]>, string]
>;

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
    // Review round 1 (WR-04 / IN-03): a labelled region with an h2. The page
    // h1 is the only heading above the panel, so an h3 fails axe
    // `heading-order`; and a static panel is not a live region.
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Your equity history is being rebuilt",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Your equity history is being rebuilt" }),
    ).toBe(panel);
    expect(panel).not.toHaveAttribute("role");
    expect(panel).not.toHaveAttribute("aria-live");
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

  // Phase 167.1.2 D-15 (2026-09-27) supersedes IN-01 (2026-09-25): under
  // 'rebuilding' the copy is chosen by state, never by count, because the
  // warm-up line promises a timer the D-02 hold never honours.
  // IN-01 gave a brand-new book (no legacy snapshot, no derived curve) the
  // warm-up note, "Aggregated factsheet panels appear once at least two days
  // of blended equity history are available". Under "rebuilding" no number of
  // days flips the state; only the conditions the reason names do. So this
  // book gets the panel and its reason. Do NOT restore the IN-01 branch.
  // This is a first connect: no holdings yet and a sync in flight.
  it("rebuilding + a brand-new book (0 snapshots, no derived curve): the rebuilding panel and its reason render, never the warm-up timer (D-15)", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="rebuilding"
        equityHistoryRebuildReason="awaiting_derivation"
        equityDailyPoints={[]}
        snapshotCount={0}
        equityCurveSource="legacy"
        holdingsSummary={[] as never}
        hasSyncing
      />,
    );
    const panel = screen.getByTestId("overview-equity-rebuilding");
    expect(panel.textContent).toContain(
      "Your history is recomputed from each account's returns and cash flows once a day.",
    );
    expect(screen.queryByTestId("overview-factsheet-warmup")).toBeNull();
    expect(screen.queryByText(/appear once/)).toBeNull();
    // D-02 still holds: no curve, no factsheet, no KPI built.
    expect(screen.queryByTestId("overview-equity-curve")).toBeNull();
    expect(screen.queryByTestId("mock-equity-chart")).toBeNull();
    expect(screen.queryByTestId("mock-factsheet-body")).toBeNull();
    expect(screen.queryByText("Sharpe")).toBeNull();
    expect(buildPayloadSpy).not.toHaveBeenCalled();
  });

  // Phase 167.1.2 D-15 (2026-09-27) supersedes IN-01 (2026-09-25): under
  // 'rebuilding' the copy is chosen by state, never by count, because the
  // warm-up line promises a timer the D-02 hold never honours.
  // This arm replaced a count-driven one (a derived curve, or one legacy
  // snapshot, turned the panel on). Now every reason in the closed set, on
  // every combination of the two history sources, gets the panel with that
  // reason's line, and the warm-up note never renders.
  const HISTORY_SHAPES = [
    ["0 snapshots, legacy source", 0, "legacy"],
    ["0 snapshots, derived source", 0, "derived"],
    ["1 snapshot, legacy source", 1, "legacy"],
  ] as const;
  it.each(
    REASON_LINES.flatMap(([reason, line]) =>
      HISTORY_SHAPES.map(
        ([shape, snapshotCount, equityCurveSource]) =>
          [reason, shape, snapshotCount, equityCurveSource, line] as const,
      ),
    ),
  )(
    "rebuilding reason %s with %s: the panel renders that reason's line and the warm-up note does not (D-15)",
    (reason, _shape, snapshotCount, equityCurveSource, line) => {
      render(
        <AllocationDashboardV2
          {...baseProps}
          equityHistoryState="rebuilding"
          equityHistoryRebuildReason={reason}
          snapshotCount={snapshotCount}
          equityCurveSource={equityCurveSource}
        />,
      );
      expect(
        screen.getByTestId("overview-equity-rebuilding").textContent,
      ).toContain(line);
      expect(screen.queryByTestId("overview-factsheet-warmup")).toBeNull();
      expect(screen.queryByText(/appear once/)).toBeNull();
      expect(screen.queryByTestId("overview-equity-curve")).toBeNull();
      expect(screen.queryByText("Sharpe")).toBeNull();
      expect(buildPayloadSpy).not.toHaveBeenCalled();
    },
  );

  // D-15: the warm-up note keeps exactly one home, the "ready" branch, where
  // the curve IS shown and is too short for factsheet panels. Review C3 WR-01
  // moved that arm to `AllocationDashboardV2.warmup.test.tsx`: it mocked the
  // builder and pinned a two-day threshold the real builder does not have. The
  // arm there runs the real builder on a producer-shaped ready payload.

  // Positive control (moved behaviour, D-02): with the state explicitly "ready"
  // the same fixture DOES render the curve and the factsheet, so the absences
  // asserted above are the gate, not a broken fixture.
  it("ready: the curve and the factsheet render and the rebuilding panel does not", () => {
    const equityDailyReturns = [
      { date: "2026-03-11", value: 0.01 },
      { date: "2026-03-12", value: -0.02 },
    ];
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="ready"
        equityDailyReturns={equityDailyReturns}
      />,
    );
    expect(screen.getByTestId("overview-equity-curve")).toBeInTheDocument();
    expect(screen.getByTestId("mock-factsheet-body")).toBeInTheDocument();
    expect(screen.getByText("Sharpe")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-equity-rebuilding")).toBeNull();
    // D-06: the builder receives the persisted returns, not a curve-derived series.
    expect(buildPayloadSpy).toHaveBeenCalledWith(
      baseProps.equityDailyPoints,
      expect.objectContaining({ dailyReturns: equityDailyReturns }),
    );
  });

  it.each(REASON_LINES)("rebuilding reason %s renders its one line", (reason, line) => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        equityHistoryState="rebuilding"
        equityHistoryRebuildReason={reason}
      />,
    );
    const panel = screen.getByTestId("overview-equity-rebuilding");
    expect(panel.textContent).toContain(line);
    // Review C2 round 3 R3-WR-03: neither shared-account line falls back to
    // the generic refusal.
    if (reason.startsWith("shared_account_")) {
      expect(panel.textContent).not.toContain("did not pass its checks");
    }
    if (
      reason === "duplicate_account" ||
      reason === "key_not_syncing" ||
      reason === "shared_account_no_working_key"
    ) {
      expect(screen.getByRole("link", { name: "Exchanges page" })).toHaveAttribute(
        "href",
        "/profile?tab=exchanges",
      );
    }
  });

  // Review C2 round 2 IN-04. The key_not_syncing line names the key when there
  // is exactly one, with the label the Exchanges page and the Scenario rows
  // use (`{Exchange} — {nickname}`, or the masked id tail when the key has no
  // nickname). Two or more keys get a plural line, never "one of your keys".
  const notSyncing = (id: string, exchange: string, label: string) => ({
    id,
    exchange,
    label,
    is_active: true,
    sync_status: "error",
    last_sync_at: null,
    account_balance_usdt: null,
    created_at: "2026-01-01T00:00:00Z",
    sync_error: null,
    last_429_at: null,
    disconnected_at: null,
  });
  it.each([
    [
      "one key with a nickname is named",
      [notSyncing("k-bad-0001", "okx", "Main")],
      ["k-bad-0001"],
      "Your key OKX — Main is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.",
    ],
    [
      "one key with no nickname is named by its masked tail",
      [notSyncing("k-bad-7f3a", "bybit", "  ")],
      ["k-bad-7f3a"],
      "Your key Bybit — ••••7f3a is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.",
    ],
    [
      "two keys get the plural line",
      [notSyncing("k-a", "okx", "Main"), notSyncing("k-b", "binance", "Spare")],
      ["k-a", "k-b"],
      "Some of your keys are not syncing, so we cannot confirm which exchange accounts they read. Check them on the Exchanges page.",
    ],
    [
      "an id missing from the key list falls back to the unnamed line",
      [notSyncing("k-a", "okx", "Main")],
      ["k-gone"],
      "A key is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.",
    ],
  ])("key_not_syncing: %s", (_label, apiKeys, ids, line) => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        apiKeys={apiKeys as never}
        equityHistoryState="rebuilding"
        equityHistoryRebuildReason="key_not_syncing"
        equityHistoryNotSyncingKeyIds={ids}
      />,
    );
    const panel = screen.getByTestId("overview-equity-rebuilding");
    expect(panel.textContent).toContain(line);
    expect(screen.getByRole("link", { name: "Exchanges page" })).toHaveAttribute(
      "href",
      "/profile?tab=exchanges",
    );
  });
});
