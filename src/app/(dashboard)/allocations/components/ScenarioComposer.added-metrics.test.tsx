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
    equitySnapshots: [],
    holdingsSummary: [HOLDING_BTC],
    snapshotCount: 60,
    allKeysStale: false,
    lastSyncAt: null,
    hasSyncing: false,
    equityDailyPoints: [
      { date: "2026-01-01", value: 100_000 },
      { date: "2026-01-02", value: 101_000 },
    ],
    minHistoryDepthMonths: 12,
    equityBaselineUnknown: false,
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
    ).toHaveAttribute("href", `/factsheet/${ADDED_ID}`);
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
    ).toHaveAttribute("href", `/factsheet/${ADDED_ID}`);
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
