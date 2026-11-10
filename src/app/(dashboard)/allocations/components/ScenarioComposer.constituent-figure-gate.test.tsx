/**
 * 194.1 plan 09 (census B8, 194 D-15) — the Scenario composer's added-strategy detail row judges
 * each constituent's CAGR and Sharpe on THAT strategy's own total record, never the blend's.
 *
 * WHY: an allocator dragging a 40-day strategy into a scenario saw its stored Sharpe in the detail
 * row while that strategy's own factsheet withheld it. The row must say what the factsheet says.
 * A book leg reads the three record scalars the dashboard payload ships; a drawer-added leg reads
 * the same three names served by `GET /api/strategies/[id]/returns`.
 *
 * Oracle rule: every `title`, figure and marker string is typed by hand, never composed by the
 * helper under test (a test that imports the string it asserts cannot fail on a copy change).
 * Spans: 2026-01-01 to 2026-02-09 is 40 covered days; the helper tests count the same way.
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
const ADDED_ID = "194-1-added-leg";
const ADDED_NAME = "Constituent Figure Leg";

/** The pinned C-4 absence copy. A literal here, never imported from the
 *  component — a test that imports the string it asserts cannot fail on a copy
 *  change, which is the only thing it is guarding. U+2014 em-dash. */
const ABSENT_NOTE =
  "No computed metrics for this strategy — open the factsheet for detail.";

/** The seam-fault copy. Deliberately attributes NOTHING to the strategy — it
 *  reports only that the app could not get an answer. Literal, not imported. */
const UNAVAILABLE_NOTE =
  "We could not load metrics for this strategy right now.";

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

/** The cell span's own title-bearing descendants (the withheld reason, or the `<1y` marker). */
function titlesIn(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll("[title]")).map((e) => e.getAttribute("title") ?? "");
}
function cagrCell(id = ADDED_ID): HTMLElement {
  return within(panel(id)).getByTestId(`scenario-detail-cagr-${id}`);
}
function sharpeCell(id = ADDED_ID): HTMLElement {
  return within(panel(id)).getByTestId(`scenario-detail-sharpe-${id}`);
}

/** Add the drawer leg, open its detail row and answer its one `/returns` call. */
async function drawerLeg(body: Record<string, unknown>) {
  const { fetchMock, answer } = deferredReturnsFetch();
  vi.stubGlobal("fetch", fetchMock);
  renderScen();
  add();
  openDetail();
  await answer(returnsBody(body));
}

describe("ScenarioComposer — drawer-added leg's own record gates its CAGR and Sharpe (194.1 B8)", () => {
  it("40 days of crypto record: both cells are a muted dash carrying the withheld reason, and no absence note", async () => {
    await drawerLeg({
      cagr: 0.5,
      sharpe: 2.1,
      figure_span_days: 40,
      figure_observations: null,
      figure_crypto: true,
    });
    const reason = "Withheld until the record reaches 90 days (40 days so far).";

    await waitFor(() => expect(cagrCell().textContent).toContain("—"));
    for (const cell of [cagrCell(), sharpeCell()]) {
      expect(cell.textContent).toContain("—");
      expect(cell.textContent).not.toContain("50.0%");
      expect(cell.textContent).not.toContain("2.10");
      expect(titlesIn(cell)).toContain(reason);
      expect(cell.className).toContain("text-text-muted");
      expect(cell.className).not.toContain("text-text-primary");
    }
    // The raw stored pair is non-null, so a withheld figure is NOT "no computed metrics".
    expect(noteCount()).toBe(0);
    expect(unavailableNoteCount()).toBe(0);
  });

  // R2 WR-01: an unreadable record on a rankable run is WITHHELD, not "no computed metrics". The
  // route serves the stored pair beside `figure_unreadable: true`; nulling the pair instead made the
  // panel print the absence sentence, which is false for a strategy whose run finished.
  it("an unreadable record (figure_unreadable) is withheld with the dates reason, and never the absence note", async () => {
    await drawerLeg({
      cagr: 0.5,
      sharpe: 2.1,
      figure_span_days: null,
      figure_observations: 800,
      figure_crypto: true,
      figure_unreadable: true,
    });
    const reason = "Withheld: the record's dates could not be read.";

    await waitFor(() => expect(titlesIn(cagrCell())).toContain(reason));
    for (const cell of [cagrCell(), sharpeCell()]) {
      expect(cell.textContent).toContain("—");
      expect(cell.textContent).not.toContain("50.0%");
      expect(cell.textContent).not.toContain("2.10");
      expect(titlesIn(cell)).toContain(reason);
      expect(cell.className).toContain("text-text-muted");
    }
    expect(noteCount()).toBe(0);
    expect(unavailableNoteCount()).toBe(0);
  });

  it("200 days of crypto record: the figures plus the <1y marker and its title", async () => {
    await drawerLeg({
      cagr: 0.5,
      sharpe: 2.1,
      figure_span_days: 200,
      figure_observations: null,
      figure_crypto: true,
    });
    const reason = "Annualized from 200 days of record, under one year.";

    await waitFor(() => expect(cagrCell().textContent).toContain("+50.0%"));
    expect(sharpeCell().textContent).toContain("2.10");
    for (const cell of [cagrCell(), sharpeCell()]) {
      expect(cell.textContent).toContain("<1y");
      expect(titlesIn(cell)).toContain(reason);
      expect(cell.className).toContain("text-text-primary");
    }
    expect(noteCount()).toBe(0);
  });
});

describe("ScenarioComposer — constituent figure states beyond the 40 / 200 day drawer cases (194.1 B8)", () => {
  it("400 days of crypto record: the figures as today, no marker and no title", async () => {
    await drawerLeg({
      cagr: 0.5,
      sharpe: 2.1,
      figure_span_days: 400,
      figure_observations: null,
      figure_crypto: true,
    });
    await waitFor(() => expect(cagrCell().textContent).toBe("+50.0%"));
    expect(sharpeCell().textContent).toBe("2.10");
    expect(titlesIn(cagrCell())).toEqual([]);
    expect(titlesIn(sharpeCell())).toEqual([]);
  });

  it("a non-crypto leg with 59 observations is withheld on the 60 trading-day bar", async () => {
    await drawerLeg({
      cagr: 0.5,
      sharpe: 2.1,
      figure_span_days: 120,
      figure_observations: 59,
      figure_crypto: false,
    });
    const reason = "Withheld until the record reaches 60 trading days (59 so far).";
    await waitFor(() => expect(titlesIn(cagrCell())).toContain(reason));
    expect(titlesIn(sharpeCell())).toContain(reason);
    expect(cagrCell().textContent).not.toContain("50.0%");
    expect(noteCount()).toBe(0);
  });

  it("a stale deploy that omits all three scalars: the figures as today, no marker, no title", async () => {
    await drawerLeg({ cagr: 0.5, sharpe: 2.1 });
    await waitFor(() => expect(cagrCell().textContent).toBe("+50.0%"));
    expect(sharpeCell().textContent).toBe("2.10");
    expect(titlesIn(cagrCell())).toEqual([]);
    expect(titlesIn(sharpeCell())).toEqual([]);
  });

  it("malformed scalars (strings, NaN) read as an unknown record, never a verdict", async () => {
    await drawerLeg({
      cagr: 0.5,
      sharpe: 2.1,
      figure_span_days: "40",
      figure_observations: Number.NaN,
      figure_crypto: "true",
    });
    await waitFor(() => expect(cagrCell().textContent).toBe("+50.0%"));
    expect(titlesIn(cagrCell())).toEqual([]);
  });

  it("a pending fetch shows today's dashes and no note (HONEST-05 unchanged)", async () => {
    const { fetchMock, answer } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderScen();
    add();
    openDetail();
    expect(cagrCell().textContent).toBe("—");
    expect(sharpeCell().textContent).toBe("—");
    expect(titlesIn(cagrCell())).toEqual([]);
    expect(noteCount()).toBe(0);
    expect(unavailableNoteCount()).toBe(0);
    await answer(returnsBody({ cagr: 0.5, sharpe: 2.1 }));
  });

  it("a failed fetch shows today's dashes and the could-not-load note, with no record title", async () => {
    const { fetchMock, failWithStatus } = deferredReturnsFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderScen();
    add();
    openDetail();
    await failWithStatus(500);
    await waitFor(() => expect(unavailableNoteCount()).toBe(1));
    expect(cagrCell().textContent).toBe("—");
    expect(sharpeCell().textContent).toBe("—");
    expect(titlesIn(cagrCell())).toEqual([]);
    expect(noteCount()).toBe(0);
  });

  it("a settled lazy leg whose route withheld both figures still earns the absence note (raw pair, not gated)", async () => {
    await drawerLeg({
      cagr: null,
      sharpe: null,
      figure_span_days: null,
      figure_observations: null,
      figure_crypto: false,
    });
    await waitFor(() => expect(noteCount()).toBe(1));
  });
});

// A BOOK leg reads the three scalars off the dashboard payload's strategy. Every composer fetch
// seam is guarded by `!strategyById.has(id)`, so a book leg never has a lazy entry in the UI;
// "book wins over a lazy record" is therefore pinned at the helper (constituent-figure.test.ts).
describe("ScenarioComposer — book legs read the payload's record scalars (194.1 B8)", () => {
  const BOOK_ID = "194-1-book-leg";
  const BOOK_NAME = "Constituent Book Leg";

  function renderBook(scalars: Record<string, unknown>) {
    const payload = {
      ...makePayload(),
      strategies: [
        {
          strategy: {
            id: BOOK_ID,
            name: BOOK_NAME,
            disclosure_tier: "verified",
            returns_unit: null,
            trust_tier: "api_verified",
            ...scalars,
            strategy_analytics: { cagr: 0.5, sharpe: 2.1, daily_returns: SERIES },
          },
        },
      ],
    } as unknown as MyAllocationDashboardPayload;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    );
    render(
      <ScenarioComposer payload={payload} allocatorId={ALLOCATOR_A} allocatorMandate={null} />,
    );
    add(BOOK_ID, BOOK_NAME);
    openDetail(BOOK_ID, BOOK_NAME);
  }

  it("a 40-day crypto book leg is withheld with the 40-day reason", () => {
    renderBook({ figure_span_days: 40, figure_observations: null, figure_crypto: true });
    const reason = "Withheld until the record reaches 90 days (40 days so far).";
    expect(titlesIn(cagrCell(BOOK_ID))).toContain(reason);
    expect(titlesIn(sharpeCell(BOOK_ID))).toContain(reason);
    expect(cagrCell(BOOK_ID).textContent).not.toContain("50.0%");
    expect(sharpeCell(BOOK_ID).textContent).not.toContain("2.10");
    expect(cagrCell(BOOK_ID).className).toContain("text-text-muted");
    expect(noteCount(BOOK_ID)).toBe(0);
  });

  it("a 400-day crypto book leg shows the figures as today, no marker", () => {
    renderBook({ figure_span_days: 400, figure_observations: null, figure_crypto: true });
    expect(cagrCell(BOOK_ID).textContent).toBe("+50.0%");
    expect(sharpeCell(BOOK_ID).textContent).toBe("2.10");
    expect(titlesIn(cagrCell(BOOK_ID))).toEqual([]);
  });

  it("an unreadable book leg is withheld with the dates reason, exactly as a drawer-added leg (194.2 D-01)", () => {
    // The span and count would CLEAR the gate (400 days of crypto); only the flag withholds.
    renderBook({
      figure_span_days: 400,
      figure_observations: null,
      figure_crypto: true,
      figure_unreadable: true,
    });
    const reason = "Withheld: the record's dates could not be read.";
    for (const cell of [cagrCell(BOOK_ID), sharpeCell(BOOK_ID)]) {
      expect(cell.textContent).toContain("—");
      expect(cell.textContent).not.toContain("50.0%");
      expect(cell.textContent).not.toContain("2.10");
      expect(titlesIn(cell)).toContain(reason);
      expect(cell.className).toContain("text-text-muted");
    }
    expect(noteCount(BOOK_ID)).toBe(0);
  });

  it("a book strategy with no figure scalars (a hand-built payload) shows the figures as today", () => {
    renderBook({});
    expect(cagrCell(BOOK_ID).textContent).toBe("+50.0%");
    expect(titlesIn(cagrCell(BOOK_ID))).toEqual([]);
  });
});
