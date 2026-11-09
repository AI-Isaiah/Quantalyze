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
// The factsheet body mock renders a "Factsheet Sharpe" label and the payload builder
// returns a non-null stub, so a regression that let the factsheet mount would
// show that label here. The "ready" case is the positive control: the same
// mocks DO render the curve and the label when the state allows it.
// Phase 198 plan 01 (C7): the at-a-glance panel prints its own `Sharpe` cell
// whatever the history state, so the mock's label is distinct from it.
//
// Phase 198 plan 09 (D-01, ROUTE-07): the generic "equity history" panel and its
// four class headings are retired from the Overview. D-01 names the key and the
// days, so a rebuilding book now gets `overview-missing-data`, a section under
// the glance panel with one line per affected key (or one book-level line). The
// assertions below that used to read the panel read that section instead, and a
// negative arm pins that no reason prints the old headings.
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
      <span>Factsheet Sharpe</span>
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
    // 170.6.2 D-02: "One of your keys", not "A key".
    "key_not_syncing",
    "One of your keys is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.",
  ],
  [
    // 198-09 (D-01): the Overview says whose history: the book's.
    // 198-UAT-01 (D-10): and names what it hides, never return or risk.
    "awaiting_derivation",
    "Your book's history is recomputed once a day from each account's returns and cash flows. The equity chart and the ratios built from it appear after the next recompute.",
  ],
  [
    "derivation_rejected",
    "The latest rebuild of your book's history did not pass its checks, so it is not shown. The equity chart and the ratios built from it are hidden.",
  ],
  [
    // Review C2 round 2 IN-05: active voice (DESIGN.md Voice).
    "history_read_failed",
    "We could not load your book's history just now. Reload the page to try again.",
  ],
  [
    // Review C2 round 3 R3-WR-03: the cause and the unlock, never "did not
    // pass its checks". No account and no number (T-167.1.2-22a).
    "shared_account_no_working_key",
    "The keys that read one of your exchange accounts are all failing to sync, so that account's history stops. Fix or reconnect one of them on the Exchanges page.",
  ],
  [
    // 170.6.2 D-03: no "yet", it implies a heal that never ships.
    "shared_account_history_truncated",
    "One of your exchange accounts changed keys, and we cannot join its history from before the change to the new key's, so your history is not shown.",
  ],
] as const satisfies ReadonlyArray<
  readonly [NonNullable<MyAllocationDashboardPayload["equityHistoryRebuildReason"]>, string]
>;

// 198-09 (D-01): the four class headings of the retired panel (170.6.2 D-04),
// typed by hand. No reason may print any of them on the Overview now.
const RETIRED_HEADINGS = [
  "Your equity history is waiting on a key",
  "We could not load your equity history",
  "Your equity history is being rebuilt",
  "We are holding back your equity history",
] as const;

const REASONS = REASON_LINES.map(([reason]) => reason);

const HIDDEN_FOR_NOW =
  "The equity chart and the ratios built from it are hidden for now.";

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
  activeVenues: ["Binance"],
  snapshotCount: 3,
  allocator_id: "alloc-1",
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  hasConnectedKeys: true,
} as unknown as MyAllocationDashboardPayload;

describe("AllocationDashboardV2 — 167.1.2 D-02 rebuilding state", () => {
  beforeEach(() => {
    buildPayloadSpy.mockClear();
  });

  it("rebuilding: the missing-data section renders under the glance; no curve, no factsheet, no warm-up copy, no Sharpe; InsightStrip stays", () => {
    render(
      <AllocationDashboardV2 {...baseProps} equityHistoryState="rebuilding" />,
    );

    // D-01: a labelled region (a static section is not a live region). With no
    // reason known the shipped sentence is the one line, so the Risk section's
    // "See the note above." points at a note that exists.
    const section = screen.getByTestId("overview-missing-data");
    expect(screen.getByRole("region", { name: "What is missing" })).toBe(section);
    expect(section).not.toHaveAttribute("role");
    expect(section).not.toHaveAttribute("aria-live");
    expect(section.textContent).toContain(HIDDEN_FOR_NOW);

    expect(screen.queryByTestId("overview-equity-curve")).toBeNull();
    expect(screen.queryByTestId("mock-equity-chart")).toBeNull();
    expect(screen.queryByTestId("overview-factsheet-warmup")).toBeNull();
    expect(screen.queryByTestId("mock-factsheet-body")).toBeNull();
    expect(screen.queryByText("Factsheet Sharpe")).toBeNull();
    // No KPI is even computed from a curve while rebuilding.
    expect(buildPayloadSpy).not.toHaveBeenCalled();

    expect(screen.getByTestId("mock-insight-strip")).toBeInTheDocument();
  });

  it("a payload WITHOUT equityHistoryState is treated as rebuilding (fail-closed)", () => {
    // `baseProps` deliberately carries no `equityHistoryState` field.
    expect("equityHistoryState" in baseProps).toBe(false);
    render(<AllocationDashboardV2 {...baseProps} />);
    expect(screen.getByTestId("overview-missing-data")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-equity-curve")).toBeNull();
    expect(screen.queryByText("Factsheet Sharpe")).toBeNull();
  });

  // Review round 1 (WR-03 / SFH-05): the panel renders for every allocator
  // with holdings, a first connect (holdingsEmpty && hasSyncing) and a book
  // whose every key is stale. Each sentence must be true for all of them. The
  // old copy named "the earlier chart" (a first connect never saw one), said it
  // "added up snapshots from several keys" (false for a single-key book) and
  // called holdings and AUM "current" directly under a banner saying
  // "Analytics may be stale".
  it("the message copy holds for a stale, single-key book and a first connect: no 'current', no 'earlier chart', no 'several keys'", () => {
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
    const text = screen.getByTestId("overview-missing-data").textContent ?? "";
    expect(text).not.toMatch(/\bcurrent\b/i);
    expect(text).not.toMatch(/earlier chart/i);
    expect(text).not.toMatch(/several keys/i);
    // 198-09: the retired body sentence's duplicate-account cause is gone, and
    // with it the claim that holds only when more than one key reads an account.
    expect(text).not.toContain("when more than one key reads it");

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
      screen.getByTestId("overview-missing-data").textContent,
    ).not.toMatch(/earlier chart/i);
  });

  // Phase 176 (D-07): the "Limited equity history" banner explained rows of the
  // legacy snapshot table that the dashboard no longer reads. A payload built
  // before the removal (a cast object that still carries the flag) must not
  // bring the banner back, in either state.
  it.each([["rebuilding"], ["ready"]])(
    "D-07: a %s payload still carrying equityBaselineUnknown: true renders no baseline banner",
    (state) => {
      render(
        <AllocationDashboardV2
          {...baseProps}
          {...({ equityBaselineUnknown: true } as unknown as object)}
          equityHistoryState={state as never}
        />,
      );
      // Positive control: the Overview did render for this state, so the
      // absence below is the removed banner and not an empty tree.
      expect(
        screen.getByTestId(
          state === "ready" ? "overview-equity-curve" : "overview-missing-data",
        ),
      ).toBeTruthy();
      expect(
        screen.queryByTestId("dashboard-baseline-unknown-banner"),
      ).toBeNull();
      expect(screen.queryByText(/Limited equity history/)).toBeNull();
    },
  );

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
    expect(screen.getByTestId("overview-missing-data")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-equity-curve")).toBeNull();
    expect(screen.queryByTestId("mock-factsheet-body")).toBeNull();
    expect(screen.queryByText("Factsheet Sharpe")).toBeNull();
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
    const panel = screen.getByTestId("overview-missing-data");
    // 198-UAT-01 (D-10): names what the history hides, never return or risk.
    expect(panel.textContent).toContain(
      "Your book's history is recomputed once a day from each account's returns and cash flows. The equity chart and the ratios built from it appear after the next recompute.",
    );
    expect(screen.queryByTestId("overview-factsheet-warmup")).toBeNull();
    expect(screen.queryByText(/appear once/)).toBeNull();
    // D-02 still holds: no curve, no factsheet, no KPI built.
    expect(screen.queryByTestId("overview-equity-curve")).toBeNull();
    expect(screen.queryByTestId("mock-equity-chart")).toBeNull();
    expect(screen.queryByTestId("mock-factsheet-body")).toBeNull();
    expect(screen.queryByText("Factsheet Sharpe")).toBeNull();
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
    "rebuilding reason %s with %s: the message renders that reason's line and the warm-up note does not (D-15)",
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
      const panelText = screen.getByTestId("overview-missing-data").textContent;
      expect(panelText).toContain(line);
      // 170.6.2 D-03: no reason line or panel body promises a heal with "yet".
      expect(panelText).not.toMatch(/\byet\b/);
      expect(screen.queryByTestId("overview-factsheet-warmup")).toBeNull();
      expect(screen.queryByText(/appear once/)).toBeNull();
      expect(screen.queryByTestId("overview-equity-curve")).toBeNull();
      expect(screen.queryByText("Factsheet Sharpe")).toBeNull();
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
    expect(screen.getByText("Factsheet Sharpe")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-missing-data")).toBeNull();
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
    const panel = screen.getByTestId("overview-missing-data");
    expect(panel.textContent).toContain(line);
    // 170.6.2 D-03: no reason line or panel body promises a heal with "yet".
    expect(panel.textContent).not.toMatch(/\byet\b/);
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
  // nickname). 170.6.2 D-02: the singular lines open "One of your keys";
  // two or more keys get the plural "Some of your keys" line instead.
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
      "One of your keys, OKX — Main, is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.",
    ],
    [
      "one key with no nickname is named by its masked tail",
      [notSyncing("k-bad-7f3a", "bybit", "  ")],
      ["k-bad-7f3a"],
      "One of your keys, Bybit — ••••7f3a, is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.",
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
      "One of your keys is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.",
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
    const panel = screen.getByTestId("overview-missing-data");
    expect(panel.textContent).toContain(line);
    // 170.6.2 D-03: every key arm and the panel body carry no "yet".
    expect(panel.textContent).not.toMatch(/\byet\b/);
    // The plural line is NOT a "one of your keys" line (D-02).
    if (ids.length > 1) {
      expect(panel.textContent).not.toContain("One of your keys");
    }
    expect(screen.getByRole("link", { name: "Exchanges page" })).toHaveAttribute(
      "href",
      "/profile?tab=exchanges",
    );
  });

  // 198-09 (D-01): the four class headings are retired. No reason prints any of
  // them, and none prints "We are holding back your equity history", which
  // named nothing. The list is typed by hand above, so renaming a heading in
  // the old component cannot hide a regression here.
  it.each(REASONS)(
    "rebuilding reason %s prints none of the four retired class headings",
    (reason) => {
      render(
        <AllocationDashboardV2
          {...baseProps}
          equityHistoryState="rebuilding"
          equityHistoryRebuildReason={reason}
        />,
      );
      for (const heading of RETIRED_HEADINGS) {
        expect(screen.queryByText(heading)).toBeNull();
        expect(screen.queryByRole("heading", { name: heading })).toBeNull();
      }
        expect(document.body.textContent).not.toContain(
        "We are holding back your equity history",
      );
      // The one section carrying the reason is the missing-data one.
      expect(screen.getAllByTestId("overview-missing-data")).toHaveLength(1);
    },
  );

  // D-01, the point of the phase: a payload with a keyDataGaps entry names the
  // key, the days and the action. The key is labelled through the one key-label
  // rule, and the glance's sr-only pointer says where to read it.
  it("a keyDataGaps entry for K1 prints K1's named line with its range, directly after the glance and before InsightStrip", () => {
    render(
      <AllocationDashboardV2
        {...baseProps}
        apiKeys={[notSyncing("k1-0001", "binance", "Main")] as never}
        equityHistoryState="rebuilding"
        equityHistoryRebuildReason="key_not_syncing"
        equityHistoryNotSyncingKeyIds={["k1-0001"]}
        keyDataGaps={[
          {
            apiKeyIds: ["k1-0001"],
            cause: "not_syncing",
            firstMissingDay: "2026-10-03",
            ranges: [{ from: "2026-10-03", to: "2026-10-11" }],
          },
        ]}
      />,
    );
    const section = screen.getByTestId("overview-missing-data");
    expect(section.textContent).toBe(
      "What is missing" +
        "Binance — Main: no data for Oct 3, 2026 – Oct 11, 2026. Reconnect the key on the Exchanges page or wait for the next sync.",
    );
    // One fact, one sentence: the gap line replaces the unnamed fallback.
    expect(section.textContent).not.toContain("One of your keys");

    const glance = screen.getByRole("region", { name: "Book at a glance" });
    const insight = screen.getByTestId("mock-insight-strip");
    const after = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(glance, section)).toBe(true);
    expect(after(section, insight)).toBe(true);
    expect(glance.nextElementSibling).toBe(section);

    // The glance's pointer is bound to the message existing.
    expect(glance.textContent).toContain("Not shown: see the note below.");
    // The Risk section's pointer points at a note that exists.
    expect(screen.getByText(/See the note above\./)).toBeInTheDocument();
  });

  it("a rebuilding book always has a note: every reason prints at least one line, so the glance pointer and the Risk pointer are true", () => {
    for (const reason of [...REASONS, null]) {
      render(
        <AllocationDashboardV2
          {...baseProps}
          equityHistoryState="rebuilding"
          equityHistoryRebuildReason={reason}
        />,
      );
      const section = screen.getByTestId("overview-missing-data");
      expect(section.querySelectorAll("p").length).toBeGreaterThanOrEqual(2);
      expect(
        screen.getByRole("region", { name: "Book at a glance" }).textContent,
      ).toContain("Not shown: see the note below.");
      cleanup();
    }
  });
});
