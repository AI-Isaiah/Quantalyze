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
 * The states matter because absence has two readings that LOOK IDENTICAL in the
 * cells and are not the same claim:
 *
 *   · `addedMetricsById[id]` UNDEFINED — the fetch has not answered. Two
 *     em-dashes ("unknown") and SILENCE. Saying "no computed metrics" here
 *     would be a claim the app has not earned, and it would flash on every
 *     single drawer add before settling — a lie with a 100% hit rate that
 *     happens to correct itself.
 *   · `addedMetricsById[id]` PRESENT with null values — the route answered and
 *     withheld (no analytics row, or a run that did not finish, which the route
 *     gates on `isRankableAnalyticsRow`). Now the note is true and earned.
 *
 * So the discriminating fixture in this file is C-A: it asserts the cells and
 * the note SEPARATELY while the fetch is still pending. A "fix" that keyed the
 * note off the null values alone passes every other test here and fails that
 * one.
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
  let release!: (body: unknown) => void;
  let reject!: (err: unknown) => void;
  const settled = new Promise<unknown>((res, rej) => {
    release = res;
    reject = rej;
  });
  const fetchMock = vi.fn(async (url: unknown) => {
    if (typeof url === "string" && url.includes("/returns")) {
      const body = await settled;
      return { ok: true, status: 200, json: async () => body };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  return {
    fetchMock,
    /** Answer the pending `/returns` call with this 200 body. */
    async answer(body: unknown) {
      await act(async () => {
        release(body);
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

  it("C-E (fetch error): settled-absent — em-dashes + the note, no zeros, no error styling", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchMock, fail } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);

    renderScen();
    add();
    openDetail();
    await fail();

    // Absence is not an error (DESIGN.md gates). The user is told what is true
    // — there are no metrics to show — and offered the factsheet.
    await waitFor(() => expect(noteCount()).toBe(1));
    expect(cagrText()).toBe("—");
    expect(sharpeText()).toBe("—");
    // No red anywhere in the metrics arm: the note is the muted note, not a
    // danger message.
    const note = within(panel()).getByText(ABSENT_NOTE);
    expect(note.className).toContain("text-text-muted");
    expect(note.className).not.toContain("danger");
    expect(note.className).not.toContain("red");
    // Never zeros, never a neighbour's figures.
    expect(panel().textContent).not.toMatch(/0\.00/);
    expect(panel().textContent).not.toMatch(/[+-]?0\.0%/);
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
