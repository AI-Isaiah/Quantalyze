/**
 * Phase 162 / HONEST-05 — the drawer-added metric pair, and the five states of
 * UI-SPEC §C-4.
 *
 * WHY THIS FILE EXISTS (and why the states, not just the happy path):
 *
 * Until this phase a drawer-added leg's CAGR/Sharpe were STRUCTURALLY absent —
 * `addedStrategyMetadataLookup` sourced them from the BOOK payload
 * (`payload.strategies`, the portfolio_strategies join) and a strategy added
 * from the Browse drawer is by construction not in the book. The panel showed a
 * note saying the composer could not show metrics, which was true. Widening
 * `/api/strategies/[id]/returns` to co-serve `cagr`/`sharpe` from the SAME row
 * it already reads makes that note FALSE, so the note had to change with the
 * fix rather than be left standing beside it.
 *
 * The states matter because absence has THREE readings that LOOK IDENTICAL in
 * the cells and are not the same claim:
 *
 *   · `addedMetricsById[id]` UNDEFINED — the fetch has not answered. Two
 *     em-dashes ("unknown") and SILENCE. Saying "no computed metrics" here
 *     would be a claim the app has not earned, and it would flash on every
 *     single drawer add before settling — a lie with a 100% hit rate that
 *     happens to correct itself.
 *   · `addedMetricsById[id]` PRESENT with null values — the route answered and
 *     withheld (no analytics row, or a run that did not finish, which the route
 *     gates on `isRankableAnalyticsRow`). Now the note is true and earned.
 *   · `addedMetricsById[id]` === "unavailable" — the fetch FAILED (non-ok,
 *     network throw, malformed body). The app learned NOTHING about the
 *     strategy, so it may report only its own failure. Added by the Phase 162
 *     silent-failure audit, which found the failure path collapsed into the
 *     settled one: a wedged PostgREST made the panel tell a viewer that three
 *     other people's strategies have no computed metrics, each contradicted by
 *     its own factsheet one click away.
 *
 * So the discriminating fixtures in this file are C-A and C-E/C-E2: C-A asserts
 * the cells and the note SEPARATELY while the fetch is still pending (a "fix"
 * keyed off the null values alone passes everything else and fails it), and
 * C-E/C-E2 assert that the strategy-claim sentence has no render path from a
 * fetch failure at all.
 *
 * Oracle rule (inherited from ScenarioComposer.test.tsx): formatter outputs are
 * pinned as LITERALS ("+18.4%", "1.63", "—"), never re-derived by calling the
 * formatter — an oracle that runs the implementation's own formula cannot fail
 * when that formula drifts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { btcClosesFromReturns } from "../lib/btc-closes.test-utils";

// --- next/navigation mock -------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/allocations",
  useSearchParams: () => new URLSearchParams(),
}));

// --- Component mocks (inert spies; the composer's own wiring is the UUT) ---

vi.mock("../widgets/performance/EquityChart", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../widgets/performance/EquityChart")>();
  return {
    ...actual,
    EquityChart: vi.fn(() => <div data-testid="equity-chart-mock" />),
  };
});
vi.mock("../widgets/performance/DrawdownChart", () => {
  const Mock = vi.fn(() => <div data-testid="drawdown-chart-mock" />);
  return { default: Mock, deriveSnapshotDrawdowns: vi.fn(() => []) };
});
vi.mock("../widgets/performance/ScenarioFactsheetChart", () => ({
  ScenarioFactsheetChart: vi.fn(() => (
    <div data-testid="scenario-factsheet-chart-mock" />
  )),
}));
vi.mock("./KpiStrip", () => ({
  KpiStrip: vi.fn(() => <div data-testid="kpi-strip-mock" />),
}));
vi.mock("./ContributionWizardOverlay", () => ({
  ContributionWizardOverlay: vi.fn(() => null),
}));
vi.mock("./BridgeDrawer", () => ({ BridgeDrawer: vi.fn(() => null) }));
vi.mock("./ScenarioCommitDrawer", () => ({
  ScenarioCommitDrawer: vi.fn(() => null),
}));
vi.mock("../ScenarioFlaggedHoldingsList", () => ({
  ScenarioFlaggedHoldingsList: vi.fn(() => (
    <div data-testid="flagged-list-mock" />
  )),
}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/components/charts/ReturnHistogram", () => ({
  ReturnHistogram: vi.fn(() => null),
}));
vi.mock("@/components/charts/ReturnQuantiles", () => ({
  ReturnQuantiles: vi.fn(() => null),
}));
vi.mock("@/components/charts/RollingMetrics", () => ({
  RollingMetrics: vi.fn(() => null),
}));
vi.mock("@/components/charts/RollingVolatilityChart", () => ({
  RollingVolatilityChart: vi.fn(() => null),
}));
vi.mock("@/components/charts/RollingSortinoChart", () => ({
  RollingSortinoChart: vi.fn(() => null),
}));

// The browse drawer is replaced by a capturing spy that records `onAdd` on
// first render (even while closed), so a test injects a drawer-added leg
// without piloting the real drawer. Mirrors ScenarioComposer.test.tsx:318.
let browseOnAdd: ((s: unknown) => void) | null = null;
vi.mock("./StrategyBrowseDrawer", () => ({
  StrategyBrowseDrawer: vi.fn(({ onAdd }: { onAdd: (s: unknown) => void }) => {
    browseOnAdd = onAdd;
    return null;
  }),
}));

// --- Imports after mocks --------------------------------------------------

import { ScenarioComposer } from "./ScenarioComposer";
import { KpiStrip } from "./KpiStrip";
import { ScenarioFactsheetChart } from "../widgets/performance/ScenarioFactsheetChart";
import type { OwnBookDeltaPayload } from "@/lib/factsheet/types";
import { RollingMetrics } from "@/components/charts/RollingMetrics";
import { RollingVolatilityChart } from "@/components/charts/RollingVolatilityChart";
import { RollingSortinoChart } from "@/components/charts/RollingSortinoChart";

// --- localStorage ---------------------------------------------------------

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => {
    lsStore.clear();
  }),
  get length() {
    return lsStore.size;
  },
  key: vi.fn(() => null),
};

// --- Fixtures -------------------------------------------------------------

const ALLOCATOR_A = "allocator-a-uuid";

/** The drawer-added leg under test — deliberately ABSENT from
 *  `payload.strategies`, which is what makes it a real drawer-add rather than a
 *  book row wearing one's clothes. */
const ADDED_ID = "162-added-leg";
const ADDED_NAME = "Honest Added Leg";

/** The pinned C-4 absence copy. A literal here, never imported from the
 *  component — a test that imports the string it asserts cannot fail on a copy
 *  change, which is the only thing it is guarding. U+2014 em-dash. */
const ABSENT_NOTE =
  "No computed metrics for this strategy — open the factsheet for detail.";

/** The seam-fault copy. Deliberately attributes NOTHING to the strategy — it
 *  reports only that the app could not get an answer. Literal, not imported. */
const UNAVAILABLE_NOTE =
  "We could not load metrics for this strategy right now.";

/** The copy this phase RETIRED. It claimed the SURFACE could not show metrics;
 *  the widened route makes that false, so it must have no render path left. */
const RETIRED_NOTE_FRAGMENT = "not available in the composer";

const HOLDING_BTC = {
  symbol: "BTC",
  venue: "binance",
  holding_type: "spot" as const,
  value_usd: 60_000,
  quantity: 1,
  mark_price_usd: 60_000,
  api_key_id: "key-binance",
  side: null as "long" | "short" | "flat" | null,
  entry_price: null as number | null,
  unrealized_pnl_usd: null as number | null,
};

function makePayload(): MyAllocationDashboardPayload {
  return {
    portfolio: null,
    analytics: null,
    strategies: [],
    apiKeys: [],
    alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    outcomes: [],
    holdingsSummary: [HOLDING_BTC],
    snapshotCount: 60,
    allKeysStale: false,
    lastSyncAt: null,
    hasSyncing: false,
    equityDailyPoints: [
      { date: "2026-01-01", value: 100_000 },
      { date: "2026-01-02", value: 101_000 },
    ],
    activeVenues: ["Binance"],
    flaggedHoldings: [],
    matchDecisionsByHoldingRef: {},
    mandate: null,
    allocator_id: ALLOCATOR_A,
    liveBaselineMetrics: {
      aum: 100_000,
      ytdTwr: 0.05,
      sharpe: 1.2,
      maxDd: -0.08,
      avgRho: 0.4,
      equity: [
        { date: "2026-01-01", value: 1.0 },
        { date: "2026-01-02", value: 1.01 },
      ],
      drawdown: [
        { date: "2026-01-01", value: 0 },
        { date: "2026-01-02", value: 0 },
      ],
    },
    perKeyReturnsByApiKeyId: {},
    perKeyDailiesGateSatisfied: false,
    eligibleApiKeyIds: [],
    allocatorEligibleApiKeyIds: [],
    contributingApiKeyIds: [],
    bookEntryGateSatisfied: false,
    apiKeysCount: 1,
    mandateIsSet: false,
  } as unknown as MyAllocationDashboardPayload;
}

const SERIES = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-05-${String(i + 1).padStart(2, "0")}`,
  value: [0.01, -0.008, 0.012][i % 3],
}));

/** A `/returns` 200 body. Omitting `cagr`/`sharpe` models BOTH the row the
 *  route withheld (failed run → explicit null) and a stale deploy predating the
 *  widening — the composer collapses either to null. */
function returnsBody(extra: Record<string, unknown> = {}) {
  return { daily_returns: SERIES, series_state: "available", ...extra };
}

// --- Harness --------------------------------------------------------------

/** A fetch stub whose ONE `/returns` call is resolved by hand, so a test can
 *  observe the render BETWEEN the add and the answer — the in-flight state that
 *  is otherwise unobservable. Any other request (e.g. the benign benchmark GET
 *  the composer fires on mount) resolves immediately and inertly. */
function deferredReturnsFetch() {
  type Resolution = { ok: boolean; status: number; body: unknown };
  let release!: (r: Resolution) => void;
  let reject!: (err: unknown) => void;
  const settled = new Promise<Resolution>((res, rej) => {
    release = res;
    reject = rej;
  });
  const fetchMock = vi.fn(async (url: unknown) => {
    if (typeof url === "string" && url.includes("/returns")) {
      const r = await settled;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  return {
    fetchMock,
    /** Answer the pending `/returns` call with this 200 body. */
    async answer(body: unknown) {
      await act(async () => {
        release({ ok: true, status: 200, body });
        await Promise.resolve();
      });
    },
    /**
     * Answer the pending `/returns` call with a NON-OK response — the seam
     * fault the composer cannot see past. 500 is not a hypothetical status
     * here: `/api/strategies/[id]/returns` returns exactly this from its own
     * select-error arm (route.ts:289-300), which is what a wedged PostgREST
     * produces for every leg at once.
     */
    async failWithStatus(status: number) {
      await act(async () => {
        release({ ok: false, status, body: { error: "internal" } });
        await Promise.resolve();
      });
    },
    /** Fail the pending `/returns` call (network throw). */
    async fail() {
      await act(async () => {
        reject(new Error("network down"));
        await Promise.resolve();
      });
    },
  };
}

function renderScen() {
  render(
    <ScenarioComposer
      payload={makePayload()}
      allocatorId={ALLOCATOR_A}
      allocatorMandate={null}
    />,
  );
}

function add(id = ADDED_ID, name = ADDED_NAME) {
  expect(browseOnAdd).not.toBeNull();
  act(() => {
    browseOnAdd!({ id, name, markets: ["binance"], strategy_types: ["momentum"] });
  });
}

function addedRow(id = ADDED_ID): HTMLElement {
  const el = document.querySelector(`[data-scope-ref="${id}"]`);
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

function openDetail(id = ADDED_ID, name = ADDED_NAME) {
  fireEvent.click(within(addedRow(id)).getByRole("button", { name }));
}

function panel(id = ADDED_ID): HTMLElement {
  const p = screen.queryByTestId(`scenario-detail-${id}`);
  expect(p, "the detail panel did not open").not.toBeNull();
  return p as HTMLElement;
}

function cagrText(id = ADDED_ID): string | null {
  return within(panel(id)).getByTestId(`scenario-detail-cagr-${id}`).textContent;
}
function sharpeText(id = ADDED_ID): string | null {
  return within(panel(id)).getByTestId(`scenario-detail-sharpe-${id}`)
    .textContent;
}
function noteCount(id = ADDED_ID): number {
  return within(panel(id)).queryAllByText(ABSENT_NOTE).length;
}
function unavailableNoteCount(id = ADDED_ID): number {
  return within(panel(id)).queryAllByText(UNAVAILABLE_NOTE).length;
}

beforeEach(() => {
  browseOnAdd = null;
  lsStore.clear();
  vi.stubGlobal("localStorage", localStorageMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ScenarioComposer — drawer-added metrics (Phase 162 / HONEST-05, UI-SPEC C-4)", () => {
  it("C-A (in flight): em-dash cells and NO absence note — undefined is not a settled claim", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);

    renderScen();
    add();
    openDetail();

    // Non-vacuity: the panel really opened and really has in-memory content
    // (markets ride the added row itself, so they render with no fetch at all).
    expect(
      within(panel()).getByTestId(`scenario-detail-markets-${ADDED_ID}`)
        .textContent,
    ).toBe("binance");
    // The fetch is genuinely OUTSTANDING — otherwise this test would be
    // observing the settled state and quietly proving nothing.
    expect(
      fetchMock.mock.calls.some(
        ([u]) => typeof u === "string" && u.includes("/returns"),
      ),
      "no /returns fetch was issued — the in-flight state is not being observed",
    ).toBe(true);

    // The CELLS say "unknown" — which is true.
    expect(cagrText()).toBe("—");
    expect(sharpeText()).toBe("—");
    // The NOTE says "this strategy has no computed metrics" — which is NOT yet
    // known, so it must not be on screen. This is the assertion that separates
    // a real fix from one keyed on the null values alone.
    expect(noteCount()).toBe(0);
    // ...and the seam-fault note is not a consolation prize for silence either:
    // nothing has failed, so nothing is reported.
    expect(unavailableNoteCount()).toBe(0);
    // ...and nothing invented a zero to fill the gap.
    expect(panel().textContent).not.toMatch(/0\.00/);
    expect(panel().textContent).not.toMatch(/[+-]?0\.0%/);

    // Settle so the pending promise does not leak into the next test.
    await answer(returnsBody({ cagr: 0.1842, sharpe: 1.63 }));
  });

  it("C-B (settled, present): the drawer-added leg renders REAL figures, exactly like a book row", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);

    renderScen();
    add();
    openDetail();
    await answer(returnsBody({ cagr: 0.1842, sharpe: 1.63 }));

    // This is the whole point of HONEST-05: a leg that is NOT in the book now
    // shows its metrics. Literal oracles: formatPercent(v, 1) is signed 1dp,
    // formatNumber(v, 2) is 2dp.
    await waitFor(() => expect(cagrText()).toBe("+18.4%"));
    expect(sharpeText()).toBe("1.63");
    // A metrics-bearing row must NOT carry the absence note.
    expect(noteCount()).toBe(0);
  });

  it("C-C (settled, BOTH null): em-dashes plus the REVISED note; the retired copy has no render path", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);

    renderScen();
    add();
    openDetail();
    // The route withheld both — a row with no analytics, or a run that did not
    // finish (isRankableAnalyticsRow). Explicit nulls, not omitted keys, so
    // this fixture is the ROUTE's answer rather than a stale-deploy shape.
    await answer(returnsBody({ cagr: null, sharpe: null }));

    await waitFor(() => expect(noteCount()).toBe(1));
    expect(cagrText()).toBe("—");
    expect(sharpeText()).toBe("—");
    // Single-note discipline: the panel says it once.
    expect(noteCount()).toBe(1);
    // Mutual exclusion with the seam-fault note. The route ANSWERED here, so
    // "we could not load them" would be false — and two notes in one slot would
    // leave the reader to guess which is the state.
    expect(unavailableNoteCount()).toBe(0);
    // The copy that became false this phase is gone from the surface.
    expect(panel().textContent).not.toContain(RETIRED_NOTE_FRAGMENT);
    expect(panel().textContent).not.toContain("not available in this view");
    // The remedy is still reachable and is still the panel's only action.
    expect(
      within(panel()).getByRole("link", { name: /view factsheet/i }),
    ).toHaveAttribute("href", `/factsheet/${ADDED_ID}?from=allocations`);
    // Falsifier for a `?? 0` "fix": a zero-shaped figure means a fabricated
    // metric. A note-only assertion would not catch it.
    expect(panel().textContent).not.toMatch(/0\.00/);
    expect(panel().textContent).not.toMatch(/[+-]?0\.0%/);
  });

  it("C-D (settled, exactly ONE null): an em-dash beside its live sibling, and NO note", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);

    renderScen();
    add();
    openDetail();
    await answer(returnsBody({ cagr: null, sharpe: 1.63 }));

    // The Phase-152 rule, preserved: the note is earned only by a TOTAL
    // absence. A half-known row has something to say, so it says it.
    await waitFor(() => expect(sharpeText()).toBe("1.63"));
    expect(cagrText()).toBe("—");
    expect(noteCount()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // C-E — THE SEAM FAULT. A failure to know is not knowledge of an absence.
  //
  // ⛔ REGRESSION PIN. These two cases used to assert the OPPOSITE: the `.catch`
  // wrote `{cagr: null, sharpe: null}`, the panel read that as settled, and the
  // row printed "No computed metrics for this strategy". Nothing in that path
  // ever observed the strategy. Three different things land in the catch — a
  // non-ok response (INCLUDING our own route's 500 select-error arm), a network
  // throw, and a malformed body — and none of them is evidence.
  //
  // The failure this guards is measured, not hypothetical. PostgREST wedges on
  // this stack (a documented recurring mode); every in-flight `/returns` 500s
  // at once; an allocator who drags in three strategies is told all three have
  // no computed metrics, clicks a factsheet, and finds full CAGR and Sharpe. A
  // false statement about someone else's track record, on a money surface,
  // minted out of our own outage.
  //
  // The discriminating assertion in both cases is `noteCount() === 0` — the
  // strategy-claim sentence must have NO render path from a fetch failure. A
  // "fix" that merely reworded the note, or that showed both notes, fails here.
  // -------------------------------------------------------------------------

  it("C-E (network throw): the strategy-claim note is ABSENT — em-dashes + a note that attributes nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchMock, fail } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);

    renderScen();
    add();
    openDetail();
    await fail();

    // What the app may say: it could not load them. What it may NOT say: that
    // this strategy has none.
    await waitFor(() => expect(unavailableNoteCount()).toBe(1));
    expect(
      noteCount(),
      'a fetch failure rendered "No computed metrics for this strategy" — a claim about a strategy the request never reached',
    ).toBe(0);
    expect(panel().textContent).not.toContain(ABSENT_NOTE);

    // The cells still say "unknown", which is true in every one of the states.
    expect(cagrText()).toBe("—");
    expect(sharpeText()).toBe("—");

    // Single-note discipline survives: exactly one sentence, not two.
    expect(within(panel()).queryAllByText(/could not load|No computed/).length).toBe(1);

    // No red anywhere in the metrics arm — a failure to load is still absence,
    // and absence is not an error (DESIGN.md gates).
    const note = within(panel()).getByText(UNAVAILABLE_NOTE);
    expect(note.className).toContain("text-text-muted");
    expect(note.className).not.toContain("danger");
    expect(note.className).not.toContain("red");

    // Never zeros, never a neighbour's figures.
    expect(panel().textContent).not.toMatch(/0\.00/);
    expect(panel().textContent).not.toMatch(/[+-]?0\.0%/);

    // The remedy is still reachable — the factsheet is where the real answer
    // lives, and in this state it is very likely to HAVE one.
    expect(
      within(panel()).getByRole("link", { name: /view factsheet/i }),
    ).toHaveAttribute("href", `/factsheet/${ADDED_ID}?from=allocations`);
    warn.mockRestore();
  });

  it("C-E2 (our own route's 500): a non-ok response is a seam fault too — the metrics half agrees with the series half", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchMock, failWithStatus } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);

    renderScen();
    add();
    openDetail();
    // Exactly what /api/strategies/[id]/returns emits when its select errors —
    // the shape a wedged PostgREST produces for every leg simultaneously.
    await failWithStatus(500);

    await waitFor(() => expect(unavailableNoteCount()).toBe(1));
    expect(
      noteCount(),
      "a 500 from our OWN route rendered a claim about the strategy's analytics",
    ).toBe(0);
    expect(cagrText()).toBe("—");
    expect(sharpeText()).toBe("—");
    expect(panel().textContent).not.toMatch(/0\.00/);
    expect(panel().textContent).not.toMatch(/[+-]?0\.0%/);

    // The two halves of ONE response must not disagree about it. The series
    // half already treats a non-ok as a retryable FAILURE, not a genuine empty
    // (WR-01: `addedReturnsById[id]` stays undefined). Proof that the metrics
    // half now reads it the same way: the row is NOT chipped "no-series"
    // either — a failed fetch settles neither question.
    expect(addedRow().getAttribute("data-series-state")).toBe("available");
    warn.mockRestore();
  });

  it("C-E3 (retry after a seam fault): remove + re-add re-asks, and a real answer replaces the note", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = deferredReturnsFetch();
    vi.stubGlobal("fetch", first.fetchMock);

    renderScen();
    add();
    openDetail();
    await first.failWithStatus(500);
    await waitFor(() => expect(unavailableNoteCount()).toBe(1));

    // WR-01 — the retry path must survive the new state. "Right now" in the
    // copy is a promise that a retry exists; if the failed entry poisoned the
    // map, that promise would be false.
    fireEvent.click(
      within(addedRow()).getByRole("button", { name: "Remove from scenario" }),
    );
    expect(document.querySelector(`[data-scope-ref="${ADDED_ID}"]`)).toBeNull();

    const second = deferredReturnsFetch();
    vi.stubGlobal("fetch", second.fetchMock);
    add();
    openDetail();
    // Re-added, fetch outstanding: no stale "unavailable", and still no claim.
    expect(unavailableNoteCount()).toBe(0);
    expect(noteCount()).toBe(0);

    await second.answer(returnsBody({ cagr: 0.1842, sharpe: 1.63 }));
    await waitFor(() => expect(cagrText()).toBe("+18.4%"));
    expect(sharpeText()).toBe("1.63");
    expect(unavailableNoteCount()).toBe(0);
    expect(noteCount()).toBe(0);
    warn.mockRestore();
  });

  it("C-F (purge on remove): a re-add starts clean — no stale settled entry, so the note does not precede the answer", async () => {
    const first = deferredReturnsFetch();
    vi.stubGlobal("fetch", first.fetchMock);

    renderScen();
    add();
    openDetail();
    await first.answer(returnsBody({ cagr: null, sharpe: null }));
    await waitFor(() => expect(noteCount()).toBe(1));

    // Remove the leg via its own × button.
    fireEvent.click(
      within(addedRow()).getByRole("button", { name: "Remove from scenario" }),
    );
    expect(document.querySelector(`[data-scope-ref="${ADDED_ID}"]`)).toBeNull();

    // Re-add with a fetch that has NOT answered. If the settled {null, null}
    // survived the removal, the note would render immediately against a leg
    // whose retry is still outstanding — a settled claim made about an
    // unsettled row, and the exact stranded-state class the sibling purges
    // (addedProvenanceById, addedSeriesStateById) already guard.
    const second = deferredReturnsFetch();
    vi.stubGlobal("fetch", second.fetchMock);
    add();
    openDetail();

    expect(cagrText()).toBe("—");
    expect(sharpeText()).toBe("—");
    expect(noteCount()).toBe(0);

    // And the retry's real answer lands — the purge did not break the settle.
    await second.answer(returnsBody({ cagr: 0.1842, sharpe: 1.63 }));
    await waitFor(() => expect(cagrText()).toBe("+18.4%"));
    expect(noteCount()).toBe(0);
  });

  it("C-G (non-finite guard): a NaN/Infinity/string that reached the payload is ABSENCE, never a rendered value", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);

    renderScen();
    add();
    openDetail();
    // `Number.NaN` does not survive JSON, but a hand-rolled body, a proxy, or a
    // future non-JSON transport can deliver it — and `typeof NaN === "number"`,
    // so a `typeof` check alone would hand it to the formatter.
    await answer(returnsBody({ cagr: Number.NaN, sharpe: "1.63" }));

    await waitFor(() => expect(noteCount()).toBe(1));
    expect(cagrText()).toBe("—");
    expect(sharpeText()).toBe("—");
    expect(panel().textContent).not.toContain("NaN");
  });
});

// ---------------------------------------------------------------------------
// Phase 164.6.6.2 plan 11 (D-12, D-18; UI-SPEC E1, E2, E4, E5, E6) — a BTC row
// states its unit and how it is blended. A USD row is untouched.
//
// Literal oracle rule, as above: every label is pinned as the string the
// allocator reads, never composed by calling the helper under test.
// ---------------------------------------------------------------------------
describe("ScenarioComposer — BTC-unit rows (164.6.6.2 plan 11, UI-SPEC E1-E6)", () => {
  const BLEND_LINE = "Blended in USD at the daily BTC price.";
  const BOOK_ID = "164-btc-book-leg";
  const BOOK_NAME = "Native Book Leg";

  const USD_BOOK_ROW = (id: string, name: string, unit: string | null) => ({
    strategy: {
      id,
      name,
      disclosure_tier: "verified",
      returns_unit: unit,
      trust_tier: "api_verified",
      strategy_analytics: {
        cagr: 0.2,
        sharpe: 1.1,
        daily_returns: SERIES,
      },
    },
  });

  function renderBook(unit: string | null) {
    const payload = {
      ...makePayload(),
      strategies: [USD_BOOK_ROW(BOOK_ID, BOOK_NAME, unit)],
    } as unknown as MyAllocationDashboardPayload;
    render(
      <ScenarioComposer
        payload={payload}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    add(BOOK_ID, BOOK_NAME);
    openDetail(BOOK_ID, BOOK_NAME);
  }

  function eyebrows(id: string): string[] {
    return Array.from(
      panel(id).querySelectorAll("span.font-mono.uppercase"),
    ).map((e) => e.textContent ?? "");
  }

  it("E1/E2/E5 (lazy BTC leg): one chip after the trust label and before the yours chip, eyebrow `CAGR IN BTC`, and the blend line", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ScenarioComposer
        payload={makePayload()}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    act(() => {
      browseOnAdd!({
        id: ADDED_ID,
        name: ADDED_NAME,
        markets: ["binance"],
        strategy_types: ["momentum"],
        isOwn: true,
      });
    });
    openDetail();
    // Before the answer the unit is unknown, so nothing is claimed.
    expect(addedRow().querySelectorAll('[data-returns-unit]').length).toBe(0);
    await answer(
      returnsBody({
        cagr: 0.1842,
        sharpe: 1.63,
        trust_tier: "api_verified",
        returns_unit: "BTC",
        daily_returns_usd: SERIES,
      }),
    );

    await waitFor(() =>
      expect(addedRow().querySelectorAll('[data-returns-unit="BTC"]').length).toBe(1),
    );
    const row = addedRow();
    const chip = row.querySelector('[data-returns-unit="BTC"]') as HTMLElement;
    expect(chip.textContent).toBe("Returns in BTC");
    expect(chip.className).toContain("shrink-0");
    const trust = row.querySelector("[data-trust-tier]") as HTMLElement;
    const yours = within(row).getByTestId(`scenario-yours-${ADDED_ID}`);
    expect(trust, "the trust label must be present for the order check").not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING (4): the chip FOLLOWS the trust label...
    expect(trust.compareDocumentPosition(chip) & 4).toBe(4);
    // ...and PRECEDES the yours chip (identity facts first, derived state last).
    expect(chip.compareDocumentPosition(yours) & 4).toBe(4);

    expect(eyebrows(ADDED_ID)).toContain("CAGR IN BTC");
    expect(eyebrows(ADDED_ID)).not.toContain("CAGR");
    const line = within(panel()).getByTestId(`scenario-detail-usd-blend-${ADDED_ID}`);
    expect(line.textContent).toBe(BLEND_LINE);
    expect(line.className).toContain("text-text-muted");
    expect(line.className).not.toMatch(/amber|warning/);
    // SHARPE is unitless and unchanged (E3).
    expect(eyebrows(ADDED_ID)).toContain("SHARPE");
    // The stored CAGR is shown in its own unit, as delivered.
    expect(cagrText()).toBe("+18.4%");
  });

  it("E1/E2/E5 (book BTC leg): the payload's returns_unit drives the chip, the eyebrow and the blend line", () => {
    renderBook("BTC");
    const row = addedRow(BOOK_ID);
    expect(row.querySelectorAll('[data-returns-unit="BTC"]').length).toBe(1);
    expect(eyebrows(BOOK_ID)).toContain("CAGR IN BTC");
    expect(
      within(panel(BOOK_ID)).getByTestId(`scenario-detail-usd-blend-${BOOK_ID}`)
        .textContent,
    ).toBe(BLEND_LINE);
  });

  it("E1/E2/E5 (USD book leg): no chip, eyebrow `CAGR`, no blend line", () => {
    renderBook(null);
    const row = addedRow(BOOK_ID);
    expect(row.querySelectorAll("[data-returns-unit]").length).toBe(0);
    expect(eyebrows(BOOK_ID)).toContain("CAGR");
    expect(eyebrows(BOOK_ID).some((t) => t.includes(" IN "))).toBe(false);
    expect(
      screen.queryByTestId(`scenario-detail-usd-blend-${BOOK_ID}`),
    ).toBeNull();
  });

  it("E1/E2/E5 (USD lazy leg): a returns body with returns_unit null changes nothing", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderScen();
    add();
    openDetail();
    await answer(
      returnsBody({
        cagr: 0.1842,
        sharpe: 1.63,
        returns_unit: null,
        daily_returns_usd: null,
      }),
    );
    await waitFor(() => expect(cagrText()).toBe("+18.4%"));
    expect(addedRow().querySelectorAll("[data-returns-unit]").length).toBe(0);
    expect(eyebrows(ADDED_ID)).toContain("CAGR");
    expect(
      screen.queryByTestId(`scenario-detail-usd-blend-${ADDED_ID}`),
    ).toBeNull();
  });

  it("E1 (malformed unit): a lowercase returns_unit renders no chip and no blend line (T-164.6.6.2-34)", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderScen();
    add();
    openDetail();
    await answer(
      returnsBody({ cagr: 0.1842, sharpe: 1.63, returns_unit: "btc" }),
    );
    await waitFor(() => expect(cagrText()).toBe("+18.4%"));
    expect(addedRow().querySelectorAll("[data-returns-unit]").length).toBe(0);
    expect(
      screen.queryByTestId(`scenario-detail-usd-blend-${ADDED_ID}`),
    ).toBeNull();
  });

  // SFH-1 (164.6.6.2 review). A native leg whose BTC price could not be read
  // blends as [] and the warm-up gate excludes it, so the line "Blended in USD at
  // the daily BTC price." would be a claim the blend contradicts. The server says
  // `native_unpriced: true`; the row then states the omission instead.
  describe("SFH-1: an unpriced native leg is said to be left out, never shown as blended", () => {
    const UNPRICED_NOTE =
      "No BTC price available, so this strategy is left out of the USD blend.";
    const noteId = (id: string) => `scenario-detail-usd-unpriced-${id}`;

    it("lazy BTC leg, native_unpriced true: the muted note replaces the blend line", async () => {
      const { fetchMock, answer } = deferredReturnsFetch();
      vi.stubGlobal("fetch", fetchMock);
      renderScen();
      add();
      openDetail();
      await answer(
        returnsBody({
          cagr: 0.1842,
          sharpe: 1.63,
          returns_unit: "BTC",
          daily_returns_usd: [],
          native_unpriced: true,
        }),
      );
      await waitFor(() =>
        expect(within(panel()).queryByTestId(noteId(ADDED_ID))).not.toBeNull(),
      );
      const note = within(panel()).getByTestId(noteId(ADDED_ID));
      expect(note.textContent).toBe(UNPRICED_NOTE);
      expect(note.className).toContain("text-text-muted");
      expect(note.className).not.toMatch(/amber|warning|red/);
      expect(
        screen.queryByTestId(`scenario-detail-usd-blend-${ADDED_ID}`),
      ).toBeNull();
      expect(panel().textContent).not.toContain(BLEND_LINE);
      // The unit chip still says what the account is denominated in.
      expect(addedRow().querySelectorAll('[data-returns-unit="BTC"]').length).toBe(1);
    });

    it("lazy BTC leg, priced (native_unpriced false or absent): the blend line, no note", async () => {
      for (const extra of [{ native_unpriced: false }, {}]) {
        cleanup();
        const { fetchMock, answer } = deferredReturnsFetch();
        vi.stubGlobal("fetch", fetchMock);
        renderScen();
        add();
        openDetail();
        await answer(
          returnsBody({
            cagr: 0.1842,
            sharpe: 1.63,
            returns_unit: "BTC",
            daily_returns_usd: SERIES,
            ...extra,
          }),
        );
        await waitFor(() =>
          expect(
            within(panel()).queryByTestId(`scenario-detail-usd-blend-${ADDED_ID}`),
          ).not.toBeNull(),
        );
        expect(screen.queryByTestId(noteId(ADDED_ID))).toBeNull();
      }
    });

    it("a malformed native_unpriced (a string) is not a claim: the blend line stays", async () => {
      const { fetchMock, answer } = deferredReturnsFetch();
      vi.stubGlobal("fetch", fetchMock);
      renderScen();
      add();
      openDetail();
      await answer(
        returnsBody({
          returns_unit: "BTC",
          daily_returns_usd: SERIES,
          native_unpriced: "true",
        }),
      );
      await waitFor(() =>
        expect(
          within(panel()).queryByTestId(`scenario-detail-usd-blend-${ADDED_ID}`),
        ).not.toBeNull(),
      );
      expect(screen.queryByTestId(noteId(ADDED_ID))).toBeNull();
    });

    it("lazy USD leg: neither the blend line nor the note, even with a stray native_unpriced", async () => {
      const { fetchMock, answer } = deferredReturnsFetch();
      vi.stubGlobal("fetch", fetchMock);
      renderScen();
      add();
      openDetail();
      await answer(
        returnsBody({
          cagr: 0.1842,
          sharpe: 1.63,
          returns_unit: null,
          daily_returns_usd: null,
          native_unpriced: true,
        }),
      );
      await waitFor(() => expect(cagrText()).toBe("+18.4%"));
      expect(screen.queryByTestId(noteId(ADDED_ID))).toBeNull();
      expect(
        screen.queryByTestId(`scenario-detail-usd-blend-${ADDED_ID}`),
      ).toBeNull();
    });

    it("book BTC leg, native_unpriced true: the note, no blend line", () => {
      const payload = {
        ...makePayload(),
        strategies: [
          {
            strategy: {
              id: BOOK_ID,
              name: BOOK_NAME,
              disclosure_tier: "verified",
              returns_unit: "BTC",
              native_unpriced: true,
              series_state: "available",
              trust_tier: "api_verified",
              strategy_analytics: { cagr: 0.2, sharpe: 1.1, daily_returns: [] },
            },
          },
        ],
      } as unknown as MyAllocationDashboardPayload;
      render(
        <ScenarioComposer
          payload={payload}
          allocatorId={ALLOCATOR_A}
          allocatorMandate={null}
        />,
      );
      add(BOOK_ID, BOOK_NAME);
      openDetail(BOOK_ID, BOOK_NAME);
      expect(
        within(panel(BOOK_ID)).getByTestId(noteId(BOOK_ID)).textContent,
      ).toBe(UNPRICED_NOTE);
      expect(
        screen.queryByTestId(`scenario-detail-usd-blend-${BOOK_ID}`),
      ).toBeNull();
    });

    it("book BTC leg, priced: the blend line, no note", () => {
      renderBook("BTC");
      expect(
        within(panel(BOOK_ID)).getByTestId(`scenario-detail-usd-blend-${BOOK_ID}`)
          .textContent,
      ).toBe(BLEND_LINE);
      expect(screen.queryByTestId(noteId(BOOK_ID))).toBeNull();
    });

    it("remove + re-add purges the flag: while the retry is in flight no stale note shows", async () => {
      const first = deferredReturnsFetch();
      vi.stubGlobal("fetch", first.fetchMock);
      renderScen();
      add();
      openDetail();
      await first.answer(
        returnsBody({
          returns_unit: "BTC",
          daily_returns_usd: [],
          native_unpriced: true,
        }),
      );
      await waitFor(() =>
        expect(screen.queryByTestId(noteId(ADDED_ID))).not.toBeNull(),
      );
      fireEvent.click(
        within(addedRow()).getByRole("button", { name: /Remove from scenario/i }),
      );
      // The retry never answers while we look.
      const retry = vi.fn((url: unknown) =>
        String(url).includes("/returns")
          ? new Promise(() => {})
          : Promise.resolve({ ok: true, status: 200, json: async () => ({}) }),
      );
      vi.stubGlobal("fetch", retry);
      add();
      openDetail();
      await waitFor(() =>
        expect(
          retry.mock.calls.some((c) => String(c[0]).includes("/returns")),
        ).toBe(true),
      );
      expect(screen.queryByTestId(noteId(ADDED_ID))).toBeNull();
    });
  });

  it("E4: a BTC row's weight input is enabled and takes part in the blend like a USD row", () => {
    renderBook("BTC");
    const input = within(addedRow(BOOK_ID)).getByLabelText(
      `${BOOK_NAME} weight`,
    ) as HTMLInputElement;
    expect(input.disabled).toBe(false);
    // The toggle switch is on: the row is in the blend, not held out.
    expect(
      within(addedRow(BOOK_ID)).getByRole("switch", {
        name: `Toggle ${BOOK_NAME} on/off in scenario`,
      }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("E6: nothing outside the BTC row says `in BTC` (the blend is a USD series)", () => {
    renderBook("BTC");
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone
      .querySelector(`[data-scope-ref="${BOOK_ID}"]`)
      ?.remove();
    expect(clone.textContent ?? "").not.toMatch(/in BTC/i);
  });
});

// ---------------------------------------------------------------------------
// Phase 213 decision (d) / F5 (SC-4, SC-6) - the strip holds its basis-dependent
// figure while any leg's asset-class probe is open.
//
// WHY THIS DESCRIBE EXISTS. 159-04 (RANK-06) made an unanswered probe derive the
// conservative 365 clock, and the strip used to render a Sharpe on it at once.
// A traditional drawer leg then answered `traditional`, the blend flipped to the
// 252 clock, and the Sharpe the user was reading changed under their eyes. That
// "render on the interim basis" behaviour is SUPERSEDED by Phase 213 decision
// (d): the strip's Sharpe cell (the only basis-dependent cell the strip paints;
// its cells are YTD TWR, Sharpe, Max DD 12m and Avg |rho|) reads the silent
// em-dash until every leg's probe settles, then shows one number on the final
// basis.
//
// A REAL flip needs a TRADITIONAL book leg plus a drawer leg answered
// traditional. A crypto drawer leg derives 365 before and after its answer and
// exercises no flip, so the fixture is pinned to the one shape that can fail.
// The strip is the REAL KpiStrip here (delegated to in each test below), so the
// cell text is what the user reads, not a prop a mock was handed.
// ---------------------------------------------------------------------------
describe("ScenarioComposer - Phase 213 decision (d): a leg with an open probe holds the strip's Sharpe", () => {
  const BOOK_ID = "213-book-traditional-leg";
  const BOOK_NAME = "Traditional Book Leg";
  const DAY_MS = 86_400_000;
  const START = Date.UTC(2024, 0, 1);
  const isoAt = (i: number) =>
    new Date(START + i * DAY_MS).toISOString().slice(0, 10);
  // 400 consecutive days each: clears the D-15 record bound on BOTH clocks, so a
  // number is genuinely on offer and the held em-dash is not the figure gate's.
  const bookSeries = Array.from({ length: 400 }, (_, i) => ({
    date: isoAt(i),
    value: [0.012, -0.008, 0.02, -0.006, 0.014, -0.011, 0.007][i % 7] + (i % 11) * 0.0004,
  }));
  const drawerSeries = Array.from({ length: 400 }, (_, i) => ({
    date: isoAt(i),
    value: [0.009, -0.012, 0.015, -0.004, 0.011, -0.007, 0.006][i % 7] + (i % 13) * 0.0003,
  }));

  /** The literals the harness produced, measured once and written here. */
  const BOOK_ALONE_SHARPE = "8.36";
  const INTERIM_365_SHARPE = "9.57";
  const FINAL_252_SHARPE = "7.96";

  function bookPayload(series = bookSeries): MyAllocationDashboardPayload {
    return {
      ...makePayload(),
      strategies: [
        {
          strategy: {
            id: BOOK_ID,
            name: BOOK_NAME,
            disclosure_tier: "verified",
            asset_class: "traditional",
            trust_tier: "api_verified",
            strategy_analytics: { cagr: 0.2, sharpe: 1.1, daily_returns: series },
          },
        },
      ],
    } as unknown as MyAllocationDashboardPayload;
  }

  /** The real strip's Sharpe cell, the text the user reads. */
  function sharpeCell(): string {
    const group = screen.getByRole("group", { name: "Allocation KPIs" });
    const label = within(group).getByText("Sharpe").closest("div");
    return label?.nextElementSibling?.textContent ?? "";
  }

  /** What the composer handed the strip on every render so far. */
  function stripSharpes(): Array<number | null> {
    return vi
      .mocked(KpiStrip)
      .mock.calls.map(
        (c) =>
          (c[0] as { scenarioMetrics?: { sharpe: number | null } | null })
            .scenarioMetrics?.sharpe ?? null,
      );
  }

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("./KpiStrip")>("./KpiStrip");
    vi.mocked(KpiStrip).mockClear();
    vi.mocked(KpiStrip).mockImplementation(actual.KpiStrip as never);
  });
  afterEach(() => {
    vi.mocked(KpiStrip).mockImplementation((() => (
      <div data-testid="kpi-strip-mock" />
    )) as never);
  });

  function mountWithBookLeg(series = bookSeries) {
    render(
      <ScenarioComposer
        payload={bookPayload(series)}
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    // The render count just before the book leg joins the scenario: before it the
    // blend is empty, and an empty blend's null Sharpe is not a held figure.
    const rendersBeforeBookAdd = vi.mocked(KpiStrip).mock.calls.length;
    add(BOOK_ID, BOOK_NAME);
    return rendersBeforeBookAdd;
  }

  const drawerAnswer = (assetClass: string | null) =>
    returnsBody({
      daily_returns: drawerSeries,
      asset_class: assetClass,
      cagr: 0.15,
      sharpe: 0.9,
    });

  it("decision (d): a traditional drawer leg whose probe is held open reads the em-dash, then ONE number on the 252 clock", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);
    mountWithBookLeg();

    // Non-vacuity: with only the book leg (always resolved) the strip DOES show a
    // number, so the em-dash below is the hold and not an empty fixture.
    expect(sharpeCell()).toBe(BOOK_ALONE_SHARPE);

    const rendersBeforeAdd = vi.mocked(KpiStrip).mock.calls.length;
    add();
    expect(
      fetchMock.mock.calls.some(
        ([u]) => typeof u === "string" && u.includes("/returns"),
      ),
      "no /returns fetch was issued - the held state is not being observed",
    ).toBe(true);
    // HELD: the interim (nullish => 365) basis is live, and no number is shown.
    expect(sharpeCell()).toBe("—");
    const heldRenders = stripSharpes().slice(rendersBeforeAdd);
    expect(heldRenders.length).toBeGreaterThan(0);
    expect(
      heldRenders.every((v) => v === null),
      "a render between the add and the answer handed the strip a number",
    ).toBe(true);

    const rendersAtAnswer = vi.mocked(KpiStrip).mock.calls.length;
    await answer(drawerAnswer("traditional"));
    await waitFor(() => expect(sharpeCell()).toBe(FINAL_252_SHARPE));
    // ONCE: every number the strip was ever handed after the answer is the same
    // one, so it never showed a number first and changed it afterwards.
    const afterAnswer = stripSharpes().slice(rendersAtAnswer);
    const numbers = new Set(afterAnswer.filter((v): v is number => v !== null));
    expect(numbers.size).toBe(1);
  });

  it("decision (d) control: the interim 365 clock and the final 252 clock give DIFFERENT Sharpe literals, so the case above proves a real flip", async () => {
    // A drawer leg answered with a NULL class settles on the 365 rule (the
    // interim basis, kept as final), so its Sharpe is the number the hold withholds.
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);
    mountWithBookLeg();
    add();
    expect(sharpeCell()).toBe("—");
    await answer(drawerAnswer(null));
    await waitFor(() => expect(sharpeCell()).toBe(INTERIM_365_SHARPE));
    expect(INTERIM_365_SHARPE).not.toBe(FINAL_252_SHARPE);
  });

  // -------------------------------------------------------------------------
  // Plan 213-11, decision (d), UI-SPEC 4.3: the two strip-adjacent consumers of
  // the blend basis that plan 05's strip hold did not reach.
  // -------------------------------------------------------------------------

  // 200 consecutive days, under one year: the blend record is `short`, so on a
  // settled render the gate caption under the strip IS shown. The 400-day fixtures
  // above clear the one-year bound and render no caption at all, so they cannot
  // exercise this surface.
  const bookSeriesShort = bookSeries.slice(0, 200);
  const drawerSeriesShort = drawerSeries.slice(0, 200);
  const GATE_NOTE = "scenario-figure-gate-note";

  it("decision (d): the gate caption is silent while a drawer leg's probe is open, then returns once on the final basis", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);
    mountWithBookLeg(bookSeriesShort);

    // Non-vacuity: with only the book leg (never pending) the 200-day record is
    // short, so the caption IS on screen. The absence below is the hold.
    const settledNote = screen.getByTestId(GATE_NOTE).textContent;
    expect(settledNote).toMatch(/\S/);

    add();
    expect(
      fetchMock.mock.calls.some(
        ([u]) => typeof u === "string" && u.includes("/returns"),
      ),
      "no /returns fetch was issued - the held state is not being observed",
    ).toBe(true);
    // HELD: the caption's verdict is read off a record built at the interim basis.
    expect(screen.queryByTestId(GATE_NOTE)).toBeNull();

    await answer(
      returnsBody({
        daily_returns: drawerSeriesShort,
        asset_class: "traditional",
        cagr: 0.15,
        sharpe: 0.9,
      }),
    );
    await waitFor(() => expect(screen.queryByTestId(GATE_NOTE)).not.toBeNull());
    expect(screen.getAllByTestId(GATE_NOTE)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Plan 213-10 Task 1, decision (d), UI-SPEC 4.2/4.3: the "vs BTC" benchmark
  // section is a child consumer of `blendBasis`. While a leg's probe is open its
  // Tracking Error, Information Ratio and Alpha read the dash INSIDE the
  // populated layout, no annualization note and no "{N}-day annualized" sentence
  // is printed, Beta keeps its number, and the section never falls to its
  // "Benchmark comparison unavailable" empty state because of pending.
  // -------------------------------------------------------------------------
  it("decision (d): the benchmark section blanks TE, IR and Alpha, names no basis and never shows its empty state while a leg's probe is open, then shows numbers once on the 252 clock", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    const btcCloses = btcClosesFromReturns(
      bookSeries.map((p, i) => ({
        date: p.date,
        value: [0.02, -0.01, 0.005, -0.015, 0.012, 0.0, -0.006][i % 7],
      })),
    );
    // The BTC closes route answers at once; only `/returns` stays held open.
    const wrapped = vi.fn(async (url: unknown) => {
      if (typeof url === "string" && url.includes("/api/benchmark/btc/prices")) {
        return { ok: true, status: 200, json: async () => btcCloses };
      }
      return fetchMock(url);
    });
    vi.stubGlobal("fetch", wrapped);
    mountWithBookLeg();

    const val = (m: string) => screen.getByTestId(`benchmark-value-${m}`).textContent;
    // Non-vacuity: with only the book leg (never pending) the section is populated
    // with real numbers on its 252-day basis, so the dashes below are the hold.
    await waitFor(() => expect(val("tracking-error")).not.toBe("—"));
    expect(val("information-ratio")).not.toBe("—");
    expect(val("alpha")).not.toBe("—");
    expect(screen.getByTestId("benchmark-row-beta")).toBeTruthy();
    const betaSettled = val("beta");
    expect(betaSettled).not.toBe("—");
    expect(document.body.textContent).toContain("252-day annualized active returns");

    add();
    expect(
      wrapped.mock.calls.some(([u]) => typeof u === "string" && u.includes("/returns")),
      "no /returns fetch was issued - the held state is not being observed",
    ).toBe(true);
    // HELD: populated layout, dashes in the three basis-built slots, no basis text.
    expect(val("tracking-error")).toBe("—");
    expect(val("information-ratio")).toBe("—");
    expect(val("alpha")).toBe("—");
    expect(val("beta")).not.toBe("—");
    expect(screen.queryByTestId("scenario-benchmark-annualization-note")).toBeNull();
    expect(document.body.textContent).not.toMatch(/-day annualized active returns/);
    expect(screen.queryByText("Benchmark comparison unavailable")).toBeNull();

    await answer(drawerAnswer("traditional"));
    await waitFor(() => expect(val("tracking-error")).not.toBe("—"));
    expect(val("information-ratio")).not.toBe("—");
    expect(val("alpha")).not.toBe("—");
    expect(document.body.textContent).toContain("252-day annualized active returns");
    expect(document.body.textContent).not.toContain("365-day annualized active returns");
  });

  // -------------------------------------------------------------------------
  // Plan 213-10 Task 2, decision (d): the factsheet preview receives the hold. The
  // chart is a mock here, so the case pins the wire (the composer hands it
  // `basisPending` from `legsPending`); what the real body then renders is pinned by
  // scenario-factsheet-payload.pending.test.tsx.
  // -------------------------------------------------------------------------
  it("decision (d): the factsheet preview is handed basisPending while a leg's probe is open, and not before or after", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(ScenarioFactsheetChart).mockClear();
    mountWithBookLeg();
    const pendingFlags = () =>
      vi
        .mocked(ScenarioFactsheetChart)
        .mock.calls.map((c) => (c[0] as { basisPending?: boolean }).basisPending);

    // Non-vacuity: with the book leg alone (never pending) the chart rendered, and was
    // never told to hold.
    expect(pendingFlags().length).toBeGreaterThan(0);
    expect(pendingFlags().every((v) => v === false)).toBe(true);

    const before = pendingFlags().length;
    add();
    const held = pendingFlags().slice(before);
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((v) => v === true), "a render between the add and the answer was not held").toBe(true);

    const atAnswer = pendingFlags().length;
    await answer(drawerAnswer("traditional"));
    await waitFor(() => expect(pendingFlags().slice(atAnswer).at(-1)).toBe(false));
  });

  // -------------------------------------------------------------------------
  // Plan 213-09 Task 1, decision (d), UI-SPEC 4.2/4.3: the rolling panels are fed
  // by `deriveBlendPanels(..., blendBasis)`, so Rolling Sharpe, Rolling volatility
  // and Rolling Sortino are all annualized on the interim clock while a leg's
  // probe is open. The three charts are mocked in this file, so the assertion is
  // on the `data` the composer hands each one: the REAL RollingMetrics returns
  // null for exactly an empty object (an object holding an empty array still
  // draws), and the real volatility and Sortino charts return null for [].
  // -------------------------------------------------------------------------
  const lastData = (m: unknown) => {
    const calls = vi.mocked(m as never as (p: { data: unknown }) => null).mock.calls;
    return calls[calls.length - 1]?.[0].data;
  };
  const ROLLING_CAPTION = /-day rolling window ·/;

  it("decision (d): the rolling Sharpe, volatility and Sortino panels draw nothing, name no basis and state no cause while a leg's probe is open, then draw once on the final basis", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);
    mountWithBookLeg();
    const rollCard = () =>
      document.querySelector('[data-panel="blend-rolling"]') as HTMLElement;

    // Non-vacuity: with only the always-resolved book leg the three panels DO
    // draw and the caption IS on screen, so the silence below is the hold.
    expect(Object.keys(lastData(RollingMetrics) as object).length).toBeGreaterThan(0);
    expect((lastData(RollingVolatilityChart) as unknown[]).length).toBeGreaterThan(0);
    expect((lastData(RollingSortinoChart) as unknown[]).length).toBeGreaterThan(0);
    expect(rollCard().textContent).toMatch(ROLLING_CAPTION);

    vi.mocked(RollingMetrics).mockClear();
    vi.mocked(RollingVolatilityChart).mockClear();
    vi.mocked(RollingSortinoChart).mockClear();
    add();
    expect(
      fetchMock.mock.calls.some(
        ([u]) => typeof u === "string" && u.includes("/returns"),
      ),
      "no /returns fetch was issued - the held state is not being observed",
    ).toBe(true);

    // HELD. Every render between the add and the answer handed the charts nothing.
    expect(vi.mocked(RollingMetrics).mock.calls.length).toBeGreaterThan(0);
    for (const c of vi.mocked(RollingMetrics).mock.calls) {
      expect(c[0].data, "RollingMetrics was handed a series while held").toEqual({});
    }
    for (const c of vi.mocked(RollingVolatilityChart).mock.calls) {
      expect(c[0].data, "the volatility chart was handed a series while held").toEqual([]);
    }
    for (const c of vi.mocked(RollingSortinoChart).mock.calls) {
      expect(c[0].data, "the Sortino chart was handed a series while held").toEqual([]);
    }
    expect(within(rollCard()).getByText("Rolling Sharpe")).toBeInTheDocument();
    expect(within(rollCard()).getByText("Rolling volatility")).toBeInTheDocument();
    expect(within(rollCard()).getByText("Rolling Sortino")).toBeInTheDocument();
    expect(rollCard().textContent).not.toMatch(/-day annualized/);
    expect(rollCard().textContent).not.toMatch(ROLLING_CAPTION);
    expect(within(rollCard()).queryByTestId("blend-rolling-annualization-note")).toBeNull();
    expect(within(rollCard()).queryByText("Awaiting more data")).toBeNull();

    await answer(drawerAnswer("traditional"));
    await waitFor(() =>
      expect(Object.keys(lastData(RollingMetrics) as object).length).toBeGreaterThan(0),
    );
    expect((lastData(RollingVolatilityChart) as unknown[]).length).toBeGreaterThan(0);
    expect((lastData(RollingSortinoChart) as unknown[]).length).toBeGreaterThan(0);
    // The caption carries the FINAL basis, once.
    expect(rollCard().textContent).toMatch(/126-day rolling window · 252-day annualized/);
    expect(rollCard().textContent).not.toMatch(/365-day annualized/);
    expect(within(rollCard()).getAllByText(/-day annualized/)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Plan 213-09 Task 2, decision (d), UI-SPEC 4.3: the Sharpe delta against the
  // live book (footer item, the strip's pill and its "Current allocation"
  // tooltip) and the own-book delta slots are all built on the blend's interim
  // Sharpe / basis, so they are held while a leg's probe is open.
  // -------------------------------------------------------------------------
  const ownBookReturns = Array.from({ length: 300 }, (_, i) => ({
    date: isoAt(i),
    value: [0.006, -0.004, 0.009, -0.003, 0.005][i % 5],
  }));
  /** The traditional book leg PLUS a live book series, so the own-book delta exists. */
  function mountWithBookLegAndOwnBook() {
    render(
      <ScenarioComposer
        payload={
          {
            ...bookPayload(),
            equityHistoryState: "ready",
            equityDailyReturns: ownBookReturns,
            bookEntryGateSatisfied: true,
            hasConnectedKeys: true,
            // A live baseline whose own record clears the gate (400 days), so the
            // book Sharpe in the tooltip is a number to hold, not an already-gated dash.
            liveBaselineMetrics: {
              ...makePayload().liveBaselineMetrics,
              equity: bookSeries.map((p, i) => ({ date: p.date, value: 1 + i * 0.001 })),
              drawdown: bookSeries.map((p) => ({ date: p.date, value: 0 })),
            },
          } as unknown as MyAllocationDashboardPayload
        }
        allocatorId={ALLOCATOR_A}
        allocatorMandate={null}
      />,
    );
    add(BOOK_ID, BOOK_NAME);
  }
  const footer = () =>
    screen.getByRole("region", { name: "Scenario draft summary and actions" });
  const sharpePill = () =>
    screen
      .getByRole("group", { name: "Allocation KPIs" })
      .querySelector('[aria-label^="Sharpe delta vs current allocation"]');
  const lastOwnBookDelta = () => {
    const calls = vi.mocked(ScenarioFactsheetChart).mock.calls;
    return (calls[calls.length - 1][0] as { scenarioOwnBookDelta?: OwnBookDeltaPayload })
      .scenarioOwnBookDelta;
  };

  it("decision (d): the footer Sharpe delta, the strip's Sharpe pill and the book Sharpe in its tooltip are held while a leg's probe is open, then return once", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);
    mountWithBookLegAndOwnBook();

    // Non-vacuity: the book leg alone is never pending, so all three are live.
    expect(footer().textContent).toContain("Sharpe");
    expect(sharpePill()).not.toBeNull();
    // ... and the tooltip's book Sharpe is a real number (1.2, the fixture's).
    expect(
      (vi.mocked(KpiStrip).mock.calls.at(-1)![0] as {
        liveMetrics?: { sharpe: number | null } | null;
      }).liveMetrics?.sharpe,
    ).toBe(1.2);
    const pillsSettled = screen
      .getByRole("group", { name: "Allocation KPIs" })
      .querySelectorAll('[aria-label*="delta vs current allocation"]').length;
    expect(pillsSettled).toBeGreaterThan(1);

    vi.mocked(KpiStrip).mockClear();
    add();
    expect(
      fetchMock.mock.calls.some(
        ([u]) => typeof u === "string" && u.includes("/returns"),
      ),
      "no /returns fetch was issued - the held state is not being observed",
    ).toBe(true);

    // HELD. Footer item and pill are not rendered; the tooltip's book Sharpe is
    // the dash (the strip's `liveMetrics.sharpe` is null on every held render).
    expect(footer().textContent).not.toContain("Sharpe");
    expect(sharpePill(), "the Sharpe delta pill was rendered while held").toBeNull();
    for (const c of vi.mocked(KpiStrip).mock.calls) {
      expect(
        (c[0] as { liveMetrics?: { sharpe: number | null } | null }).liveMetrics?.sharpe,
      ).toBeNull();
    }
    // Basis-invariant deltas keep rendering: the other cells' pills are untouched.
    expect(
      screen
        .getByRole("group", { name: "Allocation KPIs" })
        .querySelectorAll('[aria-label*="delta vs current allocation"]').length,
    ).toBe(pillsSettled - 1);

    await answer(drawerAnswer("traditional"));
    await waitFor(() => expect(sharpePill()).not.toBeNull());
    expect(footer().textContent).toContain("Sharpe");
    expect(
      (vi.mocked(KpiStrip).mock.calls.at(-1)![0] as {
        liveMetrics?: { sharpe: number | null } | null;
      }).liveMetrics?.sharpe,
    ).toBe(1.2);
  });

  it("decision (d): the own-book delta's basis-dependent slots and basis-built records are held while a leg's probe is open; max drawdown still renders", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);
    mountWithBookLegAndOwnBook();

    // Non-vacuity: with the book leg alone every slot is on offer.
    const settled = lastOwnBookDelta()!;
    expect(settled.sharpe).not.toBeNull();
    expect(settled.sortino).not.toBeNull();
    expect(settled.max_dd).not.toBeNull();
    expect(settled.records).toBeDefined();

    vi.mocked(ScenarioFactsheetChart).mockClear();
    add();
    expect(
      fetchMock.mock.calls.some(
        ([u]) => typeof u === "string" && u.includes("/returns"),
      ),
      "no /returns fetch was issued - the held state is not being observed",
    ).toBe(true);
    const calls = vi.mocked(ScenarioFactsheetChart).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      const d = (c[0] as { scenarioOwnBookDelta?: OwnBookDeltaPayload }).scenarioOwnBookDelta!;
      expect(d.sharpe, "the Sharpe delta slot carried a number while held").toBeNull();
      expect(d.sortino, "the Sortino delta slot carried a number while held").toBeNull();
      // The records are built at the interim basis; a verdict read off them would
      // print a withheld cause, so they are not handed over while held.
      expect(d.records).toBeUndefined();
      expect(d.max_dd, "max drawdown is basis-invariant and keeps rendering").not.toBeNull();
    }

    await answer(drawerAnswer("traditional"));
    await waitFor(() => expect(lastOwnBookDelta()!.sharpe).not.toBeNull());
    const final = lastOwnBookDelta()!;
    expect(final.sortino).not.toBeNull();
    expect(final.records).toBeDefined();
    // FINAL 252 clock: the blend Sharpe the strip shows, minus the book's.
    expect(sharpeCell()).toBe(FINAL_252_SHARPE);
  });

  // The two verdict branches of the rolling panel that name a cause or a basis:
  // a 200-day record is `short` (the muted annualization note), a 100-day record
  // is below the 126-day window (the withheld "Awaiting more data" body). Each is
  // on screen with the book leg alone and must be absent while a leg is pending.
  for (const [label, days, probe] of [
    [
      "the annualization note",
      200,
      (card: HTMLElement) =>
        within(card).queryByTestId("blend-rolling-annualization-note"),
    ],
    [
      "the withheld reason",
      100,
      (card: HTMLElement) => within(card).queryByText("Awaiting more data"),
    ],
  ] as const) {
    it(`decision (d): ${label} of the rolling panel is silent while a leg's probe is open, and the populated headings stay`, async () => {
      const { fetchMock, answer } = deferredReturnsFetch();
      vi.stubGlobal("fetch", fetchMock);
      mountWithBookLeg(bookSeries.slice(0, days));
      const card = () =>
        document.querySelector('[data-panel="blend-rolling"]') as HTMLElement;
      // Non-vacuity: with the book leg alone this surface IS on screen.
      expect(probe(card())).not.toBeNull();

      add();
      expect(
        fetchMock.mock.calls.some(
          ([u]) => typeof u === "string" && u.includes("/returns"),
        ),
        "no /returns fetch was issued - the held state is not being observed",
      ).toBe(true);
      expect(probe(card()), `${label} was shown while held`).toBeNull();
      expect(within(card()).getByText("Rolling Sharpe")).toBeInTheDocument();
      expect(within(card()).getByText("Rolling volatility")).toBeInTheDocument();
      expect(within(card()).getByText("Rolling Sortino")).toBeInTheDocument();

      await answer(
        returnsBody({
          daily_returns: drawerSeries.slice(0, days),
          asset_class: "traditional",
          cagr: 0.15,
          sharpe: 0.9,
        }),
      );
      await waitFor(() => expect(probe(card())).not.toBeNull());
    });
  }

  describe("peer rank (decision (d), UI-SPEC 4.3: no interim-basis rank is requested)", () => {
    const peerCalls = (fetchMock: ReturnType<typeof deferredReturnsFetch>["fetchMock"]) =>
      (fetchMock.mock.calls as unknown as Array<[unknown, { body: string }]>).filter(
        ([u]) => typeof u === "string" && u.includes("/api/scenario/peer-rank"),
      );
    // Past the composer's 350 ms peer-rank debounce, so a request that WOULD be
    // sent has been sent by the time the count is read.
    const pastDebounce = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 500));
      });

    it("decision (d): no peer-rank request is made while a leg is pending; exactly one follows the settle, carrying the raw final Sharpe", async () => {
      const { fetchMock, answer } = deferredReturnsFetch();
      vi.stubGlobal("fetch", fetchMock);
      mountWithBookLeg();

      // Non-vacuity: the book leg alone is never pending, so the blend IS ranked.
      await pastDebounce();
      expect(peerCalls(fetchMock)).toHaveLength(1);

      add();
      await pastDebounce();
      expect(
        peerCalls(fetchMock),
        "a peer-rank request went out while the drawer leg's probe was open",
      ).toHaveLength(1);

      await answer(drawerAnswer("traditional"));
      await waitFor(() => expect(peerCalls(fetchMock)).toHaveLength(2));
      await pastDebounce();
      expect(peerCalls(fetchMock)).toHaveLength(2);

      // BLEND-01 fence: the request carries the engine's RAW Sharpe on the final
      // basis, with no basis factor. It is the very figure the strip shows.
      const body = JSON.parse(
        peerCalls(fetchMock)[1][1].body,
      );
      expect(body.sharpe.toFixed(2)).toBe(FINAL_252_SHARPE);
      expect(sharpeCell()).toBe(FINAL_252_SHARPE);
    });
  });

  // -------------------------------------------------------------------------
  // F5 - a FAILED probe is terminal for the hydration effect.
  //
  // Traced in 213-RESEARCH F5: a failure writes only `addedMetricsById[id] =
  // "unavailable"` and leaves `addedReturnsById[id]` undefined (so remove + re-add
  // retries). The hydration effect read that undefined as "not resolved" and
  // re-fetched the failed leg whenever ANY dependency changed (another leg added or
  // settled). A figure could therefore render on the nullish => 365 rule, blank
  // when the silent retry put the leg back in flight, and return on a different
  // basis once the retry succeeded. Failure is now terminal for the effect; the
  // user's remove + re-add (WR-01) is the retry.
  // -------------------------------------------------------------------------
  const LEG_A = "213-leg-a-fails";
  const LEG_B = "213-leg-b-settles";
  /** Final Sharpe for book + B(traditional) beside a FAILED leg A: A is a null
   *  class, so the blend stays on the 365 rule. Measured once, a literal. */
  const BOOK_PLUS_B_BESIDE_FAILED_A_SHARPE = "9.57";

  type Step = { fail: true } | { hold: true } | { body: unknown };
  /** A /returns stub scripted PER LEG: each request for an id consumes that
   *  id's next step (a failure, a held-open answer, or a ready body), and every
   *  request is counted so a silent re-fetch is observable. */
  function scriptedReturns(script: Record<string, Step[]>) {
    const requests: string[] = [];
    const holds = new Map<string, (body: unknown) => void>();
    const fetchMock = vi.fn(async (url: unknown) => {
      const m =
        typeof url === "string" ? /\/api\/strategies\/([^/]+)\/returns/.exec(url) : null;
      if (!m) return { ok: true, status: 200, json: async () => ({}) };
      const id = decodeURIComponent(m[1]);
      requests.push(id);
      const step: Step = script[id]?.shift() ?? { fail: true };
      if ("fail" in step) throw new Error("network down");
      if ("hold" in step) {
        const body = await new Promise<unknown>((res) => holds.set(id, res));
        return { ok: true, status: 200, json: async () => body };
      }
      return { ok: true, status: 200, json: async () => step.body };
    });
    return {
      fetchMock,
      requestsFor: (id: string) => requests.filter((r) => r === id).length,
      async release(id: string, body: unknown) {
        await act(async () => {
          holds.get(id)!(body);
          await Promise.resolve();
        });
      },
    };
  }

  it("F5 / decision (d): a leg whose probe FAILED ends pending, and the figure stays on the 365 rule", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const script = scriptedReturns({ [LEG_A]: [{ fail: true }] });
    vi.stubGlobal("fetch", script.fetchMock);
    mountWithBookLeg();
    add(LEG_A, "Leg A");
    // Pending ENDS: a failed probe is settled, so the strip shows a number again
    // (book leg alone on the nullish => 365 clock, the same literal the interim
    // blend carried).
    await waitFor(() => expect(sharpeCell()).toBe("10.07"));
    // ...and stays ended: no silent re-fetch puts the leg back in flight.
    await act(async () => {
      await Promise.resolve();
    });
    expect(sharpeCell()).toBe("10.07");
    expect(script.requestsFor(LEG_A)).toBe(1);
    warn.mockRestore();
  });

  it("F5 / decision (d): leg A failed, then leg B is added and settles - A is NOT re-fetched and no held figure blanks again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The retry WOULD succeed (traditional), which is what made the old
    // number -> blank -> number sequence possible.
    const script = scriptedReturns({
      [LEG_A]: [{ fail: true }, { body: drawerAnswer("traditional") }],
      [LEG_B]: [{ hold: true }],
    });
    vi.stubGlobal("fetch", script.fetchMock);
    mountWithBookLeg();
    add(LEG_A, "Leg A");
    await waitFor(() => expect(sharpeCell()).toBe("10.07"));

    add(LEG_B, "Leg B");
    // B is genuinely pending, so the strip holds; A is NOT in flight again.
    expect(sharpeCell()).toBe("—");
    expect(
      script.requestsFor(LEG_A),
      "adding leg B re-fetched the failed leg A behind the user's back",
    ).toBe(1);

    const rendersAtAnswer = vi.mocked(KpiStrip).mock.calls.length;
    await script.release(LEG_B, drawerAnswer("traditional"));
    await waitFor(() =>
      expect(sharpeCell()).toBe(BOOK_PLUS_B_BESIDE_FAILED_A_SHARPE),
    );
    // Once B settled the figure never blanks again: every render handed to the
    // strip from the answer on carries a number, and it is the same one.
    const after = stripSharpes().slice(rendersAtAnswer);
    expect(after.length).toBeGreaterThan(0);
    expect(
      after.every((v) => v !== null),
      "the figure blanked after leg B settled (a failed leg was re-fetched)",
    ).toBe(true);
    expect(new Set(after).size).toBe(1);
    expect(script.requestsFor(LEG_A)).toBe(1);
    warn.mockRestore();
  });

  it("F5 / decision (d): remove + re-add is the retry - a failed leg re-asks exactly once, and its answer settles the hold", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const script = scriptedReturns({
      [LEG_A]: [{ fail: true }, { hold: true }],
    });
    vi.stubGlobal("fetch", script.fetchMock);
    mountWithBookLeg();
    add(LEG_A, "Leg A");
    await waitFor(() => expect(sharpeCell()).toBe("10.07"));
    expect(script.requestsFor(LEG_A)).toBe(1);

    fireEvent.click(
      within(addedRow(LEG_A)).getByRole("button", { name: "Remove from scenario" }),
    );
    add(LEG_A, "Leg A");
    // The explicit retry went out, and the leg is pending again, so the strip holds.
    expect(script.requestsFor(LEG_A)).toBe(2);
    expect(sharpeCell()).toBe("—");

    await script.release(LEG_A, drawerAnswer("traditional"));
    await waitFor(() => expect(sharpeCell()).toBe(FINAL_252_SHARPE));
    warn.mockRestore();
  });

  it("decision (d): a book-only scenario is never held - every leg arrives resolved from the payload", () => {
    const script = scriptedReturns({});
    vi.stubGlobal("fetch", script.fetchMock);
    const rendersBeforeBookAdd = mountWithBookLeg();
    // The strip shows the book leg's number at once and no /returns probe exists.
    expect(sharpeCell()).toBe(BOOK_ALONE_SHARPE);
    const sinceBookAdd = stripSharpes().slice(rendersBeforeBookAdd);
    expect(sinceBookAdd.length).toBeGreaterThan(0);
    expect(
      sinceBookAdd.every((v) => v !== null),
      "a book-only render handed the strip a held (null) Sharpe",
    ).toBe(true);
    expect(script.requestsFor(BOOK_ID)).toBe(0);
  });
});
