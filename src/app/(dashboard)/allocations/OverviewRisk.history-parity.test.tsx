import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import type {
  EquityHistoryRebuildReason,
  MyAllocationDashboardPayload,
} from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 198 plan 06 (D-02, LEAN-06, ROUTE-07) — the Overview's Risk section.
//
// Why this file still exists: after D-02 the Risk tab is gone and Risk is a
// section of the Overview, so there is no second tab to compare against. What
// stays is the reason the gate is SINGLE. On 2026-10-03 PROD, an allocator with
// a connected key and an empty book saw the rebuilding panel on Risk and "No
// positions to analyze yet" on Overview, so switching tabs changed what the
// page said about the allocator's history (Phase 170.4 plan 04, D-04, D-07,
// D-09). Now ONE `historyGate` call in the Overview decides the whole page:
// the connect-a-key card, the rebuilding panel and the Risk section's widgets
// or its one line. These cases render the Overview over every history and key
// state and pin what it says, so the Risk section can never show a figure over
// a history the gate holds back, and the rebuilding reason is stated once.
//
// Phase 198 plan 09 (D-01): the "rebuilding panel" of this file is now the
// missing-data section (`overview-missing-data`). D-01 names the key and the
// days, so the generic panel and its four class headings are retired; what the
// section says about a reason is pinned per reason in
// `AllocationDashboardV2.rebuilding.test.tsx` and `MissingDataMessage.test.tsx`.
// ---------------------------------------------------------------------------

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
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
// `refuse` makes the builder decline the book's returns, which is the Overview's
// warm-up branch (too little history for the factsheet panels).
const builder = vi.hoisted(() => ({ refuse: false }));
// Partial: the Risk widgets read the module's other exports (the annualization basis).
vi.mock("@/lib/factsheet/allocator-portfolio-payload", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/factsheet/allocator-portfolio-payload")
  >()),
  buildAllocatorPortfolioFactsheetPayload: () =>
    builder.refuse ? null : { stub: true },
}));

afterEach(() => {
  cleanup();
  builder.refuse = false;
});

const BASE = {
  portfolio: null,
  strategies: [],
  analytics: null,
  apiKeys: [],
  holdingsSummary: [],
  flaggedHoldings: [],
  equityDailyPoints: [],
  equityDailyReturns: [],
  activeVenues: [],
  perKeyReturnsByApiKeyId: {},
  contributingApiKeyIds: [],
  allocator_id: "alloc-1",
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  hasConnectedKeys: true,
  equityHistoryState: "rebuilding",
  equityHistoryRebuildReason: null,
  equityHistoryNotSyncingKeyIds: [],
} as const;

function payload(over: Partial<Record<string, unknown>> = {}) {
  return { ...BASE, ...over } as unknown as MyAllocationDashboardPayload;
}


// Typed by hand, never read from the component.
// 198-UAT-01 (D-10): the glance prints Sharpe and Max DD without the history (C7),
// so the line names the history the section needs and not risk figures.
const RISK_LINE = "This section needs your book's history. See the note above.";
// The six widgets in the order the Risk section lists them (planning D-06).
const RISK_WIDGET_IDS = [
  "var-expected-shortfall",
  "tail-risk",
  "risk-decomposition",
  "alpha-beta-decomposition",
  "regime-detector",
  "correlation-matrix",
];

/**
 * The Risk section's panel chunk and its widgets load lazily. An ABSENCE
 * assertion over a not-yet-mounted chunk would pass whatever the gate says, so
 * every absence check settles the dynamic imports first.
 */
async function settle() {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

function riskSection(): HTMLElement | null {
  return document.querySelector<HTMLElement>("section#risk");
}

function widgetIds(root: ParentNode): string[] {
  return [...root.querySelectorAll("[data-widget-id]")].map(
    (el) => el.getAttribute("data-widget-id") ?? "",
  );
}

/** `a` appears before `b` in the document. */
function before(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** The Overview said: connect card, ONE missing-data section with a Risk line, or neither (a ready page). */
async function readOverview(p: MyAllocationDashboardPayload) {
  const { container } = render(<AllocationDashboardV2 {...p} />);
  await settle();
  return container;
}

describe("Overview Risk section — the 2026-10-03 case (D-04, D-07, D-09)", () => {
  it("eligible key, empty book, history rebuilding: one missing-data section, never the empty card, and a Risk line with no widget", async () => {
    await readOverview(
      payload({
        hasConnectedKeys: true,
        holdingsSummary: [],
        hasSyncing: false,
        equityHistoryState: "rebuilding",
        equityHistoryRebuildReason: "awaiting_derivation",
      }),
    );

    // The empty-holdings card must not shadow the rebuilding state.
    expect(screen.queryByText("No positions to analyze yet.")).toBeNull();
    expect(screen.queryByText(/You're connected/)).toBeNull();
    const panels = screen.getAllByTestId("overview-missing-data");
    expect(panels).toHaveLength(1);
    // 198-UAT-01 (D-10): names what the history hides, never return or risk.
    expect(panels[0].textContent).toContain(
      "Your book's history is recomputed once a day from each account's returns and cash flows. The equity chart and the ratios built from it appear after the next recompute.",
    );
    const risk = riskSection();
    expect(risk).not.toBeNull();
    expect(risk!.textContent).toContain(RISK_LINE);
    expect(widgetIds(document)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The matrix. Every rebuild reason (the eight of `REBUILD_REASON_CLASS`, plus
// null) x eligible key {yes, no} x book {empty, one spot row} x syncing
// {no, yes}, with the history rebuilding. The expected answer is hand-derived
// from the decisions, NOT from `historyGate`, so a wrong gate cannot grade
// itself: the connect-a-key card shows only for an EMPTY, NOT-syncing book with
// NO eligible key (D-09), and then NO section renders at all; every other cell
// is the missing-data section once (D-04, D-01) over a Risk section holding one line.
// ---------------------------------------------------------------------------

const REASONS = [
  "duplicate_account",
  "key_not_syncing",
  "shared_account_no_working_key",
  "history_read_failed",
  "account_identity_pending",
  "awaiting_derivation",
  "derivation_rejected",
  "shared_account_history_truncated",
  null,
] as const satisfies ReadonlyArray<EquityHistoryRebuildReason | null>;

// Compile-time exhaustiveness: a ninth reason added to the union fails tsc here
// until the matrix lists it.
const ALL_REASONS_LISTED: [
  Exclude<EquityHistoryRebuildReason, (typeof REASONS)[number]>,
] extends [never]
  ? true
  : never = true;
void ALL_REASONS_LISTED;

const SPOT_ROW = {
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
};

type Cell = {
  reason: (typeof REASONS)[number];
  keys: boolean;
  empty: boolean;
  syncing: boolean;
};

const CELLS: Cell[] = REASONS.flatMap((reason) =>
  [true, false].flatMap((keys) =>
    [true, false].flatMap((empty) =>
      [false, true].map((syncing) => ({ reason, keys, empty, syncing })),
    ),
  ),
);

const cellLabel = (c: Cell) =>
  `reason=${c.reason ?? "null"} keys=${c.keys} book=${c.empty ? "empty" : "spot"} syncing=${c.syncing}`;

describe("Overview history matrix (D-04, D-07, D-09)", () => {
  it.each(CELLS.map((c) => [cellLabel(c), c] as const))(
    "%s: one answer",
    async (_label, c) => {
      const container = await readOverview(
        payload({
          hasConnectedKeys: c.keys,
          holdingsSummary: c.empty ? [] : [SPOT_ROW],
          hasSyncing: c.syncing,
          equityHistoryState: "rebuilding",
          equityHistoryRebuildReason: c.reason,
        }),
      );

      const expectConnect = !c.keys && c.empty && !c.syncing;
      if (expectConnect) {
        expect(
          screen.getByRole("link", { name: /Connect Exchange/ }),
        ).toHaveAttribute("href", "/profile?tab=exchanges");
        expect(screen.queryByTestId("overview-missing-data")).toBeNull();
        // The connect card replaces every section, Risk included, but not the
        // Mandate: it is not tied to a key (review WR-04).
        expect(container.querySelector("#risk")).toBeNull();
        expect(container.querySelector("#mandate")).not.toBeNull();
        return;
      }

      // The missing-data section renders exactly once, never inside the Risk
      // section, whose only text is its one line.
      expect(screen.getAllByTestId("overview-missing-data")).toHaveLength(1);
      const risk = riskSection();
      expect(risk, "the Risk section exists").not.toBeNull();
      expect(
        risk!.querySelector('[data-testid="overview-missing-data"]'),
      ).toBeNull();
      expect(risk!.textContent).toBe(`Risk${RISK_LINE}`);
      expect(widgetIds(risk!)).toEqual([]);
      // The reason is stated by the section above, not repeated by the Risk line.
      expect(risk!.textContent).not.toContain("recomputed once a day");
      // The Risk section comes after the section, so "See the note above." is true.
      expect(
        before(screen.getByTestId("overview-missing-data"), risk!),
      ).toBe(true);

      if (c.keys) {
        // D-07: an allocator with an eligible key never sees a connect prompt.
        expect(screen.queryByRole("link", { name: /Connect Exchange/ })).toBeNull();
        expect(screen.queryByText(/Connect a read-only exchange API key/)).toBeNull();
      }
    },
  );

  it("no eligible key and an empty book gets the connect card when the history reads ready too (D-09)", async () => {
    const container = await readOverview(
      payload({
        hasConnectedKeys: false,
        holdingsSummary: [],
        equityHistoryState: "ready",
      }),
    );
    expect(screen.getByRole("link", { name: /Connect Exchange/ })).toBeInTheDocument();
    expect(container.querySelector("#risk")).toBeNull();
    expect(container.querySelector("#mandate")).not.toBeNull();
    expect(widgetIds(document)).toEqual([]);
  });

  describe("key_not_syncing names the key", () => {
    const key = (id: string, exchange: string, label: string) => ({
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
        "one resolvable key is named",
        [key("k-bad-0001", "okx", "Main")],
        ["k-bad-0001"],
        "One of your keys, OKX — Main, is not syncing",
      ],
      [
        "two keys get the plural line",
        [key("k-a", "okx", "Main"), key("k-b", "binance", "Spare")],
        ["k-a", "k-b"],
        "Some of your keys are not syncing",
      ],
      [
        "an id missing from the key list falls back to the unnamed line",
        [key("k-a", "okx", "Main")],
        ["k-gone"],
        "One of your keys is not syncing",
      ],
    ])("%s", async (_label, apiKeys, ids, sentence) => {
      for (const empty of [true, false]) {
        await readOverview(
          payload({
            hasConnectedKeys: true,
            apiKeys,
            holdingsSummary: empty ? [] : [SPOT_ROW],
            equityHistoryState: "rebuilding",
            equityHistoryRebuildReason: "key_not_syncing",
            equityHistoryNotSyncingKeyIds: ids,
          }),
        );
        const panel = screen.getByTestId("overview-missing-data");
        expect(panel.textContent).toContain(sentence);
        // The Risk line names no key: the note above does.
        expect(riskSection()!.textContent).toBe(`Risk${RISK_LINE}`);
        cleanup();
      }
    });
  });

  // 198-09 (D-01): the four class headings of the retired panel (170.6.2 D-04 /
  // D-05) never render on the Overview now, for any reason, on an empty or a
  // populated book. Typed by hand, never read from the old component's map.
  describe("no reason prints a retired class heading (D-01)", () => {
    const RETIRED = [
      "Your equity history is waiting on a key",
      "We could not load your equity history",
      "Your equity history is being rebuilt",
      "We are holding back your equity history",
    ] as const;
    const NAMED_REASONS = REASONS.filter(
      (r): r is EquityHistoryRebuildReason => r !== null,
    );

    it.each(NAMED_REASONS)("%s: the section carries no h2 and no retired heading", async (reason) => {
      for (const empty of [true, false]) {
        await readOverview(
          payload({
            hasConnectedKeys: true,
            holdingsSummary: empty ? [] : [SPOT_ROW],
            equityHistoryState: "rebuilding",
            equityHistoryRebuildReason: reason,
          }),
        );
        const section = screen.getByTestId("overview-missing-data");
        const where = `${empty ? "empty" : "non-empty"} book`;
        expect(section.querySelector("h2"), where).toBeNull();
        for (const heading of RETIRED) {
          expect(screen.queryByText(heading), where).toBeNull();
        }
        cleanup();
      }
    });
  });
});

describe("Overview Risk section — ready (ROUTE-07, D-02, D-04)", () => {
  it("ready history, non-empty book: the curve renders and the Risk section holds the six widgets in order, after the factsheet body", async () => {
    await readOverview(
      payload({
        hasConnectedKeys: true,
        holdingsSummary: [SPOT_ROW],
        equityHistoryState: "ready",
      }),
    );
    const risk = screen.getByRole("region", { name: "Risk" });
    expect(risk).toBe(riskSection());
    await waitFor(() => expect(widgetIds(risk)).toEqual(RISK_WIDGET_IDS));
    expect(screen.queryByTestId("overview-missing-data")).toBeNull();
    expect(screen.getByTestId("overview-equity-curve")).toBeInTheDocument();
    expect(risk.textContent).not.toContain(RISK_LINE);
    expect(before(screen.getByTestId("mock-factsheet-body"), risk)).toBe(true);
  });

  // Phase 167.1.2.1.2 D-04 (2026-10-20): a ready history of an all-closed book
  // shows figures. The Overview used to say "No positions to analyze yet." over
  // the same payload; the Risk widgets already rendered for it.
  it("ready history, eligible key, all-closed book: six widgets and the curve (D-04)", async () => {
    await readOverview(
      payload({
        hasConnectedKeys: true,
        holdingsSummary: [],
        hasSyncing: false,
        equityHistoryState: "ready",
      }),
    );
    const risk = screen.getByRole("region", { name: "Risk" });
    await waitFor(() => expect(widgetIds(risk)).toEqual(RISK_WIDGET_IDS));
    expect(screen.getByTestId("overview-equity-curve")).toBeInTheDocument();
    expect(screen.queryByText("No positions to analyze yet.")).toBeNull();
    expect(screen.queryByTestId("overview-missing-data")).toBeNull();
  });

  it("ready but too little history for the factsheet panels: the Risk section follows the warm-up note", async () => {
    builder.refuse = true;
    await readOverview(
      payload({
        hasConnectedKeys: true,
        holdingsSummary: [SPOT_ROW],
        equityHistoryState: "ready",
      }),
    );
    const risk = screen.getByRole("region", { name: "Risk" });
    await waitFor(() => expect(widgetIds(risk)).toEqual(RISK_WIDGET_IDS));
    expect(
      before(screen.getByTestId("overview-factsheet-warmup"), risk),
    ).toBe(true);
  });

  it.each([
    ["a missing state", undefined],
    ["null", null],
    ["an unrecognised state", "weird"],
  ])("fail-closed: %s reads as rebuilding, so no risk widget", async (_label, state) => {
    await readOverview(
      payload({
        hasConnectedKeys: true,
        holdingsSummary: [SPOT_ROW],
        equityHistoryState: state,
      }),
    );
    // Moved here from RiskTabPanel.book-series.test.tsx: the Risk tab's own
    // fail-closed case. The gate is the Overview's now.
    expect(screen.getAllByTestId("overview-missing-data")).toHaveLength(1);
    expect(riskSection()!.textContent).toContain(RISK_LINE);
    expect(widgetIds(document)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 198 plan 06 (D-02): the retired Mandate tab is the Overview's LAST
// section. The order is the contract (UI-SPEC "Overview, top to bottom"), so a
// refactor that slides it above Risk, or leaves it behind the connect card,
// fails here.
// ---------------------------------------------------------------------------
describe("Overview Mandate section (D-02)", () => {
  it.each([
    ["ready", "ready"],
    ["rebuilding", "rebuilding"],
  ])("%s history: #mandate is the last section, after #risk, labelled by an h2 'Mandate'", async (_label, state) => {
    const container = await readOverview(
      payload({
        hasConnectedKeys: true,
        holdingsSummary: [SPOT_ROW],
        equityHistoryState: state,
      }),
    );
    const risk = riskSection()!;
    const mandate = container.querySelector<HTMLElement>("section#mandate");
    expect(mandate, "the Mandate section exists").not.toBeNull();
    expect(screen.getByRole("region", { name: "Mandate" })).toBe(mandate);
    expect(mandate!.querySelector("h2")?.textContent).toBe("Mandate");
    expect(before(risk, mandate!)).toBe(true);
    // Last: nothing follows it inside the Overview shell.
    const shell = container.querySelector("[data-ui-v2-shell]")!;
    expect(shell.lastElementChild).toBe(mandate);
    // The snapshot and the Edit mandate link render inside it.
    expect(mandate!.querySelector('[data-testid="mandate-snapshot"]')).not.toBeNull();
    expect(
      within(mandate!).getByRole("link", { name: "Edit mandate" }),
    ).toHaveAttribute("href", "/profile?tab=mandate");
  });

  it("the connect-a-key card does not replace the Mandate section (review WR-04)", async () => {
    const container = await readOverview(
      payload({
        hasConnectedKeys: false,
        holdingsSummary: [],
        equityHistoryState: "rebuilding",
      }),
    );
    expect(screen.getByRole("link", { name: /Connect Exchange/ })).toBeInTheDocument();
    expect(container.querySelector("#mandate")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Edit mandate" })).toHaveAttribute(
      "href",
      "/profile?tab=mandate",
    );
  });
});
