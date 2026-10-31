import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AllocationDashboardV2 } from "./AllocationDashboardV2";
import { RiskTabPanel } from "./RiskTabPanel";
import type {
  EquityHistoryRebuildReason,
  MyAllocationDashboardPayload,
} from "@/lib/queries";

// ---------------------------------------------------------------------------
// Phase 170.4 plan 04 (D-04, D-07, D-09) — Overview and Risk answer every
// history and key state the same way.
//
// Why this matters: on 2026-10-03 PROD, an allocator with a connected key and
// an empty book saw the rebuilding panel on Risk and "No positions to analyze
// yet" on Overview, because Overview's empty-holdings early return ran before
// its rebuilding branch. Switching tabs changed what the page said about the
// allocator's history. Both tabs now choose through `historyGate`, and this
// file renders BOTH from one payload object and compares what they say.
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
vi.mock("@/lib/factsheet/allocator-portfolio-payload", () => ({
  buildAllocatorPortfolioFactsheetPayload: () => ({ stub: true }),
}));

afterEach(cleanup);

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

/** What one tab says about the history and about keys: the rebuilding panel's text, or the connect-a-key card. */
function readTab(): { kind: "panel" | "connect" | "other"; text: string } {
  const panel = screen.queryByTestId("overview-equity-rebuilding");
  if (panel) return { kind: "panel", text: panel.textContent ?? "" };
  if (screen.queryByRole("link", { name: /Connect Exchange/ })) {
    return {
      kind: "connect",
      text: screen.getByText(/Connect a read-only exchange API key/).textContent ?? "",
    };
  }
  return { kind: "other", text: "" };
}

function overviewOf(p: MyAllocationDashboardPayload) {
  render(<AllocationDashboardV2 {...p} />);
  const out = readTab();
  cleanup();
  return out;
}

function riskOf(p: MyAllocationDashboardPayload) {
  render(<RiskTabPanel {...p} />);
  const out = readTab();
  cleanup();
  return out;
}

describe("Overview / Risk history parity — the 2026-10-03 case (D-04, D-07, D-09)", () => {
  it("eligible key, empty book, history rebuilding: Overview renders the same panel text as Risk, never its empty card", () => {
    const p = payload({
      hasConnectedKeys: true,
      holdingsSummary: [],
      hasSyncing: false,
      equityHistoryState: "rebuilding",
      equityHistoryRebuildReason: "awaiting_derivation",
    });

    render(<AllocationDashboardV2 {...p} />);
    const overviewPanel = screen.getByTestId("overview-equity-rebuilding");
    const overviewText = overviewPanel.textContent;
    // The empty-holdings card must not shadow the rebuilding state.
    expect(screen.queryByText("No positions to analyze yet.")).toBeNull();
    expect(screen.queryByText(/You're connected/)).toBeNull();
    cleanup();

    render(<RiskTabPanel {...p} />);
    const riskText = screen.getByTestId("overview-equity-rebuilding").textContent;

    expect(overviewText).toContain(
      "Your history is recomputed from each account's returns and cash flows once a day.",
    );
    expect(overviewText).toBe(riskText);
  });
});

// ---------------------------------------------------------------------------
// The matrix. Every rebuild reason (the eight of `REBUILD_REASON_CLASS`, plus
// null) x eligible key {yes, no} x book {empty, one spot row} x syncing
// {no, yes}, with the history rebuilding. The expected answer is hand-derived
// from the decisions, NOT from `historyGate`, so a wrong gate cannot grade
// itself: the connect-a-key card shows only for an EMPTY, NOT-syncing book with
// NO eligible key (D-09); every other cell is the rebuilding panel (D-04).
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

describe("Overview / Risk history parity matrix (D-04, D-07, D-09)", () => {
  it.each(CELLS.map((c) => [cellLabel(c), c] as const))(
    "%s: both tabs say the same thing",
    (_label, c) => {
      const p = payload({
        hasConnectedKeys: c.keys,
        holdingsSummary: c.empty ? [] : [SPOT_ROW],
        hasSyncing: c.syncing,
        equityHistoryState: "rebuilding",
        equityHistoryRebuildReason: c.reason,
      });
      const overview = overviewOf(p);
      const risk = riskOf(p);

      const expectConnect = !c.keys && c.empty && !c.syncing;
      expect(overview.kind).toBe(expectConnect ? "connect" : "panel");
      expect(risk).toEqual(overview);

      if (c.keys) {
        // D-07: an allocator with an eligible key never sees a connect prompt.
        render(<AllocationDashboardV2 {...p} />);
        expect(screen.queryByRole("link", { name: /Connect Exchange/ })).toBeNull();
        expect(screen.queryByText(/Connect a read-only exchange API key/)).toBeNull();
        cleanup();
        render(<RiskTabPanel {...p} />);
        expect(screen.queryByRole("link", { name: /Connect Exchange/ })).toBeNull();
        expect(screen.queryByText(/Connect a read-only exchange API key/)).toBeNull();
        cleanup();
      }
      if (expectConnect) {
        render(<RiskTabPanel {...p} />);
        expect(
          screen.getByRole("link", { name: /Connect Exchange/ }),
        ).toHaveAttribute("href", "/profile?tab=exchanges");
        cleanup();
      }
    },
  );

  it("the connect card keeps Risk's data-tab-panel wrapper (D-09)", () => {
    const { container } = render(
      <RiskTabPanel
        {...payload({
          hasConnectedKeys: false,
          holdingsSummary: [],
          equityHistoryState: "rebuilding",
        })}
      />,
    );
    expect(container.querySelector('[data-tab-panel="risk"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: /Connect Exchange/ })).toBeInTheDocument();
  });

  it("no eligible key and an empty book still gets the connect card on Risk when the history reads ready (D-09)", () => {
    const p = payload({
      hasConnectedKeys: false,
      holdingsSummary: [],
      equityHistoryState: "ready",
    });
    expect(riskOf(p).kind).toBe("connect");
    expect(overviewOf(p).kind).toBe("connect");
  });

  describe("key_not_syncing names the same key on both tabs", () => {
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
    ])("%s", (_label, apiKeys, ids, sentence) => {
      for (const empty of [true, false]) {
        const p = payload({
          hasConnectedKeys: true,
          apiKeys,
          holdingsSummary: empty ? [] : [SPOT_ROW],
          equityHistoryState: "rebuilding",
          equityHistoryRebuildReason: "key_not_syncing",
          equityHistoryNotSyncingKeyIds: ids,
        });
        const overview = overviewOf(p);
        expect(overview.kind).toBe("panel");
        expect(overview.text).toContain(sentence);
        expect(riskOf(p)).toEqual(overview);
      }
    });
  });

  // 170.6.2 D-04 / D-05: both tabs render the same heading for the same
  // reason, and it is the heading of that reason's class. The expected heading
  // is typed by hand per reason; it is never read from the component's map.
  describe("the panel heading is the same on both tabs for every reason (D-05)", () => {
    const HEADINGS = [
      ["duplicate_account", "Your equity history is waiting on a key"],
      ["key_not_syncing", "Your equity history is waiting on a key"],
      ["shared_account_no_working_key", "Your equity history is waiting on a key"],
      ["history_read_failed", "We could not load your equity history"],
      ["account_identity_pending", "Your equity history is being rebuilt"],
      ["awaiting_derivation", "Your equity history is being rebuilt"],
      ["derivation_rejected", "We are holding back your equity history"],
      ["shared_account_history_truncated", "We are holding back your equity history"],
    ] as const satisfies ReadonlyArray<
      readonly [EquityHistoryRebuildReason, string]
    >;

    // Compile-time exhaustiveness: a ninth reason fails tsc until a heading is typed for it.
    const ALL_HEADINGS_LISTED: [
      Exclude<EquityHistoryRebuildReason, (typeof HEADINGS)[number][0]>,
    ] extends [never]
      ? true
      : never = true;
    void ALL_HEADINGS_LISTED;

    function h2Of(p: MyAllocationDashboardPayload, tab: "overview" | "risk") {
      render(tab === "overview" ? <AllocationDashboardV2 {...p} /> : <RiskTabPanel {...p} />);
      const h2 = screen
        .getByTestId("overview-equity-rebuilding")
        .querySelector("h2");
      const text = h2?.textContent ?? null;
      cleanup();
      return text;
    }

    it.each(HEADINGS)("%s: Overview and Risk both read '%s'", (reason, heading) => {
      for (const empty of [true, false]) {
        const p = payload({
          hasConnectedKeys: true,
          holdingsSummary: empty ? [] : [SPOT_ROW],
          equityHistoryState: "rebuilding",
          equityHistoryRebuildReason: reason,
        });
        const overview = h2Of(p, "overview");
        const risk = h2Of(p, "risk");
        expect(overview, `Overview, ${empty ? "empty" : "non-empty"} book`).toBe(heading);
        expect(risk, `Risk, ${empty ? "empty" : "non-empty"} book`).toBe(heading);
        expect(risk).toBe(overview);
      }
    });
  });

  it("ready history: Risk still renders its six widgets for a non-empty book, Overview its curve", () => {
    const p = payload({
      hasConnectedKeys: true,
      holdingsSummary: [SPOT_ROW],
      equityHistoryState: "ready",
    });
    const { container } = render(<RiskTabPanel {...p} />);
    expect(container.querySelectorAll("[data-widget-id]")).toHaveLength(6);
    expect(screen.queryByTestId("overview-equity-rebuilding")).toBeNull();
    cleanup();
    render(<AllocationDashboardV2 {...p} />);
    expect(screen.getByTestId("overview-equity-curve")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-equity-rebuilding")).toBeNull();
  });

  // Phase 167.1.2.1.2 D-04 (2026-10-20): a ready history of an all-closed book.
  // Risk already rendered its widgets for it; the Overview said "No positions
  // to analyze yet." over the same payload. Both tabs now show figures.
  it("ready history, eligible key, all-closed book: Risk renders its six widgets and Overview its curve (D-04)", () => {
    const p = payload({
      hasConnectedKeys: true,
      holdingsSummary: [],
      hasSyncing: false,
      equityHistoryState: "ready",
    });
    const { container } = render(<RiskTabPanel {...p} />);
    expect(container.querySelectorAll("[data-widget-id]")).toHaveLength(6);
    expect(screen.queryByTestId("overview-equity-rebuilding")).toBeNull();
    cleanup();
    render(<AllocationDashboardV2 {...p} />);
    expect(screen.getByTestId("overview-equity-curve")).toBeInTheDocument();
    expect(screen.queryByText("No positions to analyze yet.")).toBeNull();
    expect(screen.queryByTestId("overview-equity-rebuilding")).toBeNull();
  });

  it.each([
    ["a missing state", undefined],
    ["null", null],
    ["an unrecognised state", "weird"],
  ])("fail-closed on both tabs: %s reads as rebuilding", (_label, state) => {
    const p = payload({
      hasConnectedKeys: true,
      holdingsSummary: [SPOT_ROW],
      equityHistoryState: state,
    });
    expect(overviewOf(p).kind).toBe("panel");
    expect(riskOf(p).kind).toBe("panel");
  });
});
