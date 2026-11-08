/**
 * Phase 194 plan 17 (TRUST-05; D-11 as superseded by D-15, D-14) - the Scenario composer's
 * blend rolling panel and its own-book delta.
 *
 * WHY these cases carry the weight. D-15 splits a figure's fate in two: the blend's TOTAL
 * record decides whether a rolling chart or a delta is WITHHELD; the window it covers only
 * QUALIFIES it with one muted note. The superseded D-11 reading withheld every window under
 * a year, which would blank a chart the founder decided to show ("if a client zooms in, then
 * he wants the KPIs on shorter timeframes"). So:
 *   - a 400-day blend draws the 126 and 63 windows with the short-window note;
 *   - a blend whose own record is under D-15's minimum draws nothing, whatever the window;
 *   - a record that clears but holds no full window draws nothing and says so (cause `record`),
 *     which is a different sentence from the gate's;
 *   - D-14's 365D option is a CALENDAR window (`rollingCalendarStats`), never 365 rows.
 *
 * The composer's own wiring is the unit under test; the charts are inert spies whose props
 * are read. Every expected sentence comes from `figure-gate.ts`, and every oracle value from
 * the fixture's dates (never from the composer's own derivation).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
  within,
} from "@testing-library/react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { FactsheetProvider } from "@/app/factsheet/[id]/v2/factsheet-context";
import { OwnBookDeltaPanel } from "@/app/factsheet/[id]/v2/BatchDPanels";
import { buildScenarioFactsheetPayload } from "../widgets/performance/scenario-factsheet-payload";
import type { OwnBookDeltaPayload } from "@/lib/factsheet/types";

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

vi.mock("../widgets/performance/EquityChart", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../widgets/performance/EquityChart")>();
  return { ...actual, EquityChart: vi.fn(() => <div data-testid="equity-chart-mock" />) };
});
vi.mock("../widgets/performance/DrawdownChart", () => {
  const Mock = vi.fn(() => <div data-testid="drawdown-chart-mock" />);
  return { default: Mock, deriveSnapshotDrawdowns: vi.fn(() => []) };
});
vi.mock("../widgets/performance/ScenarioFactsheetChart", () => ({
  ScenarioFactsheetChart: vi.fn(() => <div data-testid="scenario-factsheet-chart-mock" />),
}));
vi.mock("./KpiStrip", () => ({
  KpiStrip: vi.fn(() => <div data-testid="kpi-strip-mock" />),
}));
vi.mock("./ContributionWizardOverlay", () => ({
  ContributionWizardOverlay: vi.fn(() => null),
}));
vi.mock("./BridgeDrawer", () => ({ BridgeDrawer: vi.fn(() => null) }));
vi.mock("./ScenarioFooter", () => ({
  ScenarioFooter: vi.fn(() => <div data-testid="scenario-footer-mock" />),
}));
vi.mock("./ScenarioCommitDrawer", () => ({ ScenarioCommitDrawer: vi.fn(() => null) }));
vi.mock("./StrategyBrowseDrawer", () => ({ StrategyBrowseDrawer: vi.fn(() => null) }));
vi.mock("../ScenarioFlaggedHoldingsList", () => ({
  ScenarioFlaggedHoldingsList: vi.fn(() => <div data-testid="flagged-list-mock" />),
}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/components/charts/ReturnHistogram", () => ({
  ReturnHistogram: vi.fn(() => null),
}));
vi.mock("@/components/charts/ReturnQuantiles", () => ({
  ReturnQuantiles: vi.fn(() => null),
}));
vi.mock("@/components/charts/RollingMetrics", () => ({
  RollingMetrics: vi.fn(() => <div data-testid="rolling-sharpe-mock" />),
}));
vi.mock("@/components/charts/RollingVolatilityChart", () => ({
  RollingVolatilityChart: vi.fn(() => <div data-testid="rolling-vol-mock" />),
}));
vi.mock("@/components/charts/RollingSortinoChart", () => ({
  RollingSortinoChart: vi.fn(() => <div data-testid="rolling-sortino-mock" />),
}));
// The blend basis is a spy so a case can ask for the non-crypto (252) basis, which no
// per-key book reaches (every supported venue is a crypto venue).
vi.mock("@/lib/closed-sets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/closed-sets")>();
  return { ...actual, blendPeriodsPerYear: vi.fn(actual.blendPeriodsPerYear) };
});

import { ScenarioComposer } from "./ScenarioComposer";
import { KpiStrip } from "./KpiStrip";
import { captureToSentry } from "@/lib/sentry-capture";
import { ScenarioFooter, type ScenarioFooterDeltaItem } from "./ScenarioFooter";
import { ScenarioFactsheetChart } from "../widgets/performance/ScenarioFactsheetChart";
import { RollingMetrics } from "@/components/charts/RollingMetrics";
import { RollingVolatilityChart } from "@/components/charts/RollingVolatilityChart";
import { RollingSortinoChart } from "@/components/charts/RollingSortinoChart";
import { blendPeriodsPerYear } from "@/lib/closed-sets";
import {
  figureRecord,
  shorterSpan,
  coveredDays,
  widenedShortNote,
  widenedWithheldReason,
  type FigureRecord,
} from "@/lib/figure-gate";
import { rollingCalendarStats } from "@/lib/factsheet/rolling";

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  get length() {
    return lsStore.size;
  },
  key: vi.fn(() => null),
};

beforeEach(() => {
  lsStore.clear();
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", localStorageMock);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => [] })),
  );
  cleanup();
});
afterEach(async () => {
  const actual = await vi.importActual<typeof import("@/lib/closed-sets")>("@/lib/closed-sets");
  vi.mocked(blendPeriodsPerYear).mockImplementation(actual.blendPeriodsPerYear);
  vi.unstubAllGlobals();
});

// --- Fixtures -------------------------------------------------------------

const ALLOCATOR_A = "allocator-a-uuid";
const KEY = "key-crypto";

const HOLDING_BTC = {
  symbol: "BTC",
  venue: "binance",
  holding_type: "spot" as const,
  value_usd: 100_000,
  quantity: 1,
  mark_price_usd: 100_000,
  api_key_id: KEY,
  side: null as "long" | "short" | "flat" | null,
  entry_price: null as number | null,
  unrealized_pnl_usd: null as number | null,
};

type Point = { date: string; value: number };

const DAY_MS = 86_400_000;
const START = Date.UTC(2024, 0, 1);
const isoAt = (offsetDays: number): string =>
  new Date(START + offsetDays * DAY_MS).toISOString().slice(0, 10);

/** A varied daily return series (down days present, so Sharpe and Sortino are defined). */
const returnAt = (i: number): number =>
  [0.012, -0.008, 0.02, -0.006, 0.014, -0.011, 0.007][i % 7] + (i % 11) * 0.0004;

/** `n` returns on consecutive calendar days, spanning `n - 1` days. */
function denseSeries(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ date: isoAt(i), value: returnAt(i) }));
}

/** `n` returns spread over `spanDays` calendar days, gaps of one or two days. */
function spreadSeries(n: number, span: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({
    date: isoAt(Math.floor((i * span) / (n - 1))),
    value: returnAt(i),
  }));
}

function makePayload(
  series: Point[],
  extra: Partial<MyAllocationDashboardPayload> = {},
): MyAllocationDashboardPayload {
  return {
    portfolio: null,
    analytics: null,
    strategies: [],
    apiKeys: [
      {
        id: KEY,
        exchange: "binance",
        label: "Desk",
        is_active: true,
        sync_status: null,
        last_sync_at: null,
        account_balance_usdt: null,
        created_at: "2026-01-01T00:00:00Z",
        sync_error: null,
        last_429_at: null,
        disconnected_at: null,
      },
    ],
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
    equityCurveSource: "legacy",
    derivedCurveComputedAt: null,
    equityHistoryState: "rebuilding",
    equityDailyReturns: [],
    equityHistoryRebuildReason: null,
    activeVenues: ["Binance"],
    hasConnectedKeys: true,
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
    perKeyReturnsByApiKeyId: { [KEY]: series },
    perKeyDailiesGateSatisfied: true,
    eligibleApiKeyIds: [KEY],
    allocatorEligibleApiKeyIds: [KEY],
    contributingApiKeyIds: [KEY],
    bookEntryGateSatisfied: true,
    apiKeysCount: 1,
    mandateIsSet: false,
    ...extra,
  } as unknown as MyAllocationDashboardPayload;
}

function renderBlend(
  series: Point[],
  opts: { basis?: 252; extra?: Partial<MyAllocationDashboardPayload> } = {},
) {
  if (opts.basis === 252) vi.mocked(blendPeriodsPerYear).mockReturnValue(252);
  render(
    <ScenarioComposer
      payload={makePayload(series, opts.extra)}
      allocatorId={ALLOCATOR_A}
      allocatorMandate={null}
    />,
  );
}

/** The record the composer should judge the blend on: the fixture's own dates and count. */
function recordOf(series: Point[], periodsPerYear: 252 | 365): FigureRecord {
  return figureRecord({
    seriesStart: series[0].date,
    seriesEnd: series[series.length - 1].date,
    observations: series.length,
    periodsPerYear,
  });
}

const panel = (): HTMLElement =>
  document.querySelector('[data-panel="blend-rolling"]') as HTMLElement;
const chartsDrawn = (): boolean => screen.queryByTestId("rolling-sharpe-mock") !== null;
const note = (): string | null =>
  screen.queryByTestId("blend-rolling-annualization-note")?.textContent ?? null;

function pickWindow(label: string) {
  const button = within(panel()).getByRole("button", { name: label });
  act(() => {
    fireEvent.click(button);
  });
}

// --- Task 2: the rolling panel ---------------------------------------------

describe("ScenarioComposer blend rolling panel - the D-15 verdict and D-14's 365D window", () => {
  it("a 400-day crypto blend draws the 126 window with the short-window note for its 126-day span", () => {
    renderBlend(denseSeries(400));
    expect(chartsDrawn()).toBe(true);
    expect(note()).toBe(widenedShortNote("rolling", 126));
  });

  it("the same blend draws the 63 window too (D-15: a short window is drawn), noted for 63 days", () => {
    renderBlend(denseSeries(400));
    pickWindow("3M");
    expect(chartsDrawn()).toBe(true);
    expect(note()).toBe(widenedShortNote("rolling", 63));
  });

  it("the 365D option draws the three charts with no note, and the plotted series are the CALENDAR window's, point for point", () => {
    const series = denseSeries(400);
    renderBlend(series);
    pickWindow("365D");
    expect(chartsDrawn()).toBe(true);
    expect(screen.getByTestId("rolling-vol-mock")).toBeTruthy();
    expect(screen.getByTestId("rolling-sortino-mock")).toBeTruthy();
    expect(note()).toBeNull();

    // The oracle is plan 23's engine on the fixture's own dates (D-21): the calendar window
    // draws from the first date whose span covers 365 days (index 364, 36 points on 400 rows,
    // 365 returns being 365 days); the engine, not the row count, is the oracle.
    const dates = series.map((p) => p.date);
    const stats = rollingCalendarStats(
      series.map((p) => p.value),
      dates,
      365,
      365,
    );
    const expectSeries = (vals: Array<number | null>): Point[] =>
      vals.flatMap((v, i) => (v === null ? [] : [{ date: dates[i], value: v }]));
    const sharpeProps = vi.mocked(RollingMetrics).mock.calls.at(-1)![0] as unknown as {
      data: { sharpe_365d: Point[] };
    };
    const volProps = vi.mocked(RollingVolatilityChart).mock.calls.at(-1)![0] as unknown as {
      data: Point[];
    };
    const sortinoProps = vi.mocked(RollingSortinoChart).mock.calls.at(-1)![0] as unknown as {
      data: Point[];
    };
    expect(sharpeProps.data.sharpe_365d.length).toBeGreaterThan(0);
    expect(sharpeProps.data.sharpe_365d).toEqual(expectSeries(stats.sharpe));
    expect(volProps.data).toEqual(expectSeries(stats.vol));
    expect(sortinoProps.data).toEqual(expectSeries(stats.sortino));
    // The first point is the 365th return's date (D-21: 365 daily returns cover 365 days).
    expect(sharpeProps.data.sharpe_365d[0].date).toBe(isoAt(364));
  });

  it("D-21: 365 daily returns fill the 365D window and draw one point, the last day; 364 draw none", () => {
    const full = denseSeries(365);
    renderBlend(full);
    pickWindow("365D");
    expect(chartsDrawn()).toBe(true);
    expect(note()).toBeNull();
    const sharpeProps = vi.mocked(RollingMetrics).mock.calls.at(-1)![0] as unknown as {
      data: { sharpe_365d: Point[] };
    };
    expect(sharpeProps.data.sharpe_365d.map((p) => p.date)).toEqual([isoAt(364)]);
  });

  it("D-21: 364 daily returns hold no full 365D window: no chart", () => {
    renderBlend(denseSeries(364));
    pickWindow("365D");
    expect(chartsDrawn()).toBe(false);
  });

  it("a 100-day blend with the 126 window: no chart, the body is the rolling-record reason; the 365D option says the same", () => {
    const series = denseSeries(100);
    renderBlend(series);
    const reason = widenedWithheldReason("rolling-record", recordOf(series, 365));
    expect(chartsDrawn()).toBe(false);
    expect(within(panel()).getByText(reason)).toBeTruthy();
    pickWindow("365D");
    expect(chartsDrawn()).toBe(false);
    expect(within(panel()).getByText(reason)).toBeTruthy();
  });

  it("a crypto blend covering 60 days: no chart under any window, the body is the gate's rolling reason", () => {
    const series = denseSeries(60);
    expect(coveredDays(series[0].date, series[59].date)).toBe(60);
    renderBlend(series);
    const reason = widenedWithheldReason("rolling", recordOf(series, 365));
    expect(chartsDrawn()).toBe(false);
    expect(within(panel()).getByText(reason)).toBeTruthy();
    pickWindow("365D");
    expect(chartsDrawn()).toBe(false);
    expect(within(panel()).getByText(reason)).toBeTruthy();
    // The two reasons are different sentences: the gate never reads as "no full window".
    expect(reason).not.toBe(widenedWithheldReason("rolling-record", recordOf(series, 365)));
  });

  it("a two-traditional blend of 60 observations over 84 days: no full window, cause record - never the gate (60 observations clear the non-crypto minimum)", () => {
    const series = spreadSeries(60, 84);
    expect(coveredDays(series[0].date, series[59].date)).toBe(85);
    renderBlend(series, { basis: 252 });
    const record = recordOf(series, 252);
    expect(chartsDrawn()).toBe(false);
    expect(within(panel()).getByText(widenedWithheldReason("rolling-record", record))).toBeTruthy();
    expect(within(panel()).queryByText(widenedWithheldReason("rolling", record))).toBeNull();
  });

  it("a two-traditional blend of 70 observations: the 63 window is drawn (60 observations clear D-15), noted for its own span", () => {
    const series = spreadSeries(70, 98);
    renderBlend(series, { basis: 252 });
    pickWindow("3M");
    expect(chartsDrawn()).toBe(true);
    // The shortest 63-row stretch of the fixture's own dates.
    let shortest = Infinity;
    for (let i = 62; i < series.length; i++) {
      shortest = Math.min(shortest, coveredDays(series[i - 62].date, series[i].date));
    }
    expect(note()).toBe(widenedShortNote("rolling", shortest));
  });

  it("the three existing options keep their labels and disabled states, and 365D is added after them", () => {
    renderBlend(denseSeries(100));
    const buttons = within(panel()).getAllByRole("button");
    const labels = buttons.map((b) => b.textContent);
    expect(labels).toEqual(["3M", "6M", "12M", "365D"]);
    // 100 usable returns: 63 is available, 126 and 252 are not; the added option is never disabled.
    expect(buttons.map((b) => b.getAttribute("aria-disabled") === "true")).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});

// --- Task 3: the own-book delta ---------------------------------------------

/** What the composer handed the factsheet chart as `scenarioOwnBookDelta`. */
function handedDelta(): OwnBookDeltaPayload | undefined {
  const props = vi.mocked(ScenarioFactsheetChart).mock.calls.at(-1)![0] as unknown as {
    scenarioOwnBookDelta?: OwnBookDeltaPayload;
  };
  return props.scenarioOwnBookDelta;
}

/** The rail's own panel, mounted on the payload the composer built, so the note it prints is read. */
function railNote(delta: OwnBookDeltaPayload): string | null {
  const payload = buildScenarioFactsheetPayload({
    portfolioDaily: denseSeries(300),
    benchmark: null,
    scenarioOwnBookDelta: delta,
  });
  const view = render(
    <FactsheetProvider payload={payload} persist={false}>
      <OwnBookDeltaPanel />
    </FactsheetProvider>,
  );
  const text = view.queryByTestId("own-book-delta-note")?.textContent ?? null;
  view.unmount();
  return text;
}

describe("ScenarioComposer own-book delta - the shorter span and both records (D-15)", () => {
  /** A live book of `n` returns on consecutive days ending where the blend ends (or `endOffset`). */
  function bookReturns(n: number, startOffset: number): Point[] {
    return Array.from({ length: n }, (_, i) => ({
      date: isoAt(startOffset + i),
      value: [0.006, -0.004, 0.009, -0.003, 0.005][i % 5],
    }));
  }
  const ready = (book: Point[]): Partial<MyAllocationDashboardPayload> => ({
    equityHistoryState: "ready",
    equityDailyReturns: book,
  });

  it("a crypto blend overlap of 60 days against a 400-day book: span_days is 60, the blend record fails, the rail's note is the delta withheld reason", () => {
    const blend = denseSeries(60);
    renderBlend(blend, { extra: ready(bookReturns(400, 0)) });
    const delta = handedDelta()!;
    expect(delta).toBeDefined();
    expect(delta.span_days).toBe(60);
    // What the rail prints is the behaviour: an absent `records` is the null state, no note.
    expect(railNote(delta)).toBe(widenedWithheldReason("delta", recordOf(blend, 365)));
    expect(delta.records?.blend).toEqual(recordOf(blend, 365));
  });

  it("a 300-day blend against a 200-day book: span_days is the book's 200, the deltas show with the delta short note", () => {
    const blend = denseSeries(300);
    const book = bookReturns(200, 100);
    renderBlend(blend, { extra: ready(book) });
    const delta = handedDelta()!;
    expect(delta.span_days).toBe(200);
    expect(delta.span_days).toBe(
      shorterSpan(coveredDays(blend[0].date, blend[299].date), coveredDays(book[0].date, book[199].date)),
    );
    expect(delta.records!.book).toEqual(recordOf(book, 365));
    expect(railNote(delta)).toBe(widenedShortNote("delta", 200));
  });

  it("a two-traditional blend of 60 observations over 84 days against a 400-day book: the deltas show with the short note (neither record fails)", () => {
    const blend = spreadSeries(60, 84);
    renderBlend(blend, { basis: 252, extra: ready(bookReturns(400, 0)) });
    const delta = handedDelta()!;
    expect(delta.span_days).toBe(85);
    expect(delta.records!.blend).toEqual(recordOf(blend, 252));
    expect(delta.records!.book.crypto).toBe(false);
    expect(railNote(delta)).toBe(widenedShortNote("delta", 85));
  });

  it("no book: the delta is absent", () => {
    renderBlend(denseSeries(300));
    expect(handedDelta()).toBeUndefined();
  });
});

// The KPI strip is mounted once per render; read it so the file fails loudly if the harness
// stops mounting the composer's real surface.
describe("ScenarioComposer d11 harness", () => {
  it("mounts the composer's blend surface", () => {
    renderBlend(denseSeries(120));
    expect(vi.mocked(KpiStrip).mock.calls.length).toBeGreaterThan(0);
    expect(panel()).not.toBeNull();
  });
});

// --- 194 review CR-01: the footer's delta summary ---------------------------

/** What the composer handed the footer as `deltaSummary`. */
function footerDeltas(): ScenarioFooterDeltaItem[] {
  const props = vi.mocked(ScenarioFooter).mock.calls.at(-1)![0] as unknown as {
    deltaSummary: ScenarioFooterDeltaItem[];
  };
  return props.deltaSummary;
}

describe("ScenarioComposer footer delta summary - the Sharpe chip follows the blend's total record (D-15)", () => {
  it("a crypto blend of 60 observations spanning 59 days (under D-15's minimum): the footer carries no Sharpe delta", () => {
    renderBlend(denseSeries(60));
    // The payload's live book Sharpe is 1.2 and the blend's raw Sharpe differs from it by
    // far more than the 0.01 noise floor, so only the gate can keep this chip out.
    expect(footerDeltas().map((d) => d.label)).not.toContain("Sharpe");
  });

  it("a 400-day blend (clears the minimum): the footer still carries the Sharpe delta", () => {
    renderBlend(denseSeries(400));
    expect(footerDeltas().map((d) => d.label)).toContain("Sharpe");
  });

  it("a withheld LIVE BOOK record also drops the Sharpe delta, while the unannualised Max DD delta stays", () => {
    // A 60-day book beside a 400-day blend: the book record fails D-15.
    const book = Array.from({ length: 60 }, (_, i) => ({
      date: isoAt(i),
      value: [0.006, -0.004, 0.009, -0.003, 0.005][i % 5],
    }));
    renderBlend(denseSeries(400), {
      extra: { equityHistoryState: "ready", equityDailyReturns: book },
    });
    const labels = footerDeltas().map((d) => d.label);
    expect(labels).not.toContain("Sharpe");
    expect(labels).toContain("Max DD");
  });
});

// --- 194 R3 WR-01 / SFH-M2: ONE delta verdict feeds the strip and the footer ---

/** The props the composer handed the "Scenario blend" KpiStrip on its last render. */
function stripProps(): {
  scenarioMetrics: { sharpe: number | null; max_drawdown: number | null };
  liveMetrics: { sharpe: number | null; max_drawdown: number | null };
} {
  return vi.mocked(KpiStrip).mock.calls.at(-1)![0] as never;
}

const bookOf = (n: number): Point[] =>
  Array.from({ length: n }, (_, i) => ({
    date: isoAt(i),
    value: [0.006, -0.004, 0.009, -0.003, 0.005][i % 5],
  }));

describe("ScenarioComposer Sharpe delta - the strip and the footer share one verdict (R3 WR-01)", () => {
  it("a 60-day book beside a 400-day blend: the strip's book Sharpe is withheld too, and Max DD stays", () => {
    renderBlend(denseSeries(400), {
      extra: { equityHistoryState: "ready", equityDailyReturns: bookOf(60) },
    });
    // The strip derives its pill and its "Current book" tooltip from liveMetrics.sharpe, so a
    // null here means neither can print an annualised 60-day Sharpe.
    expect(stripProps().liveMetrics.sharpe).toBeNull();
    expect(stripProps().scenarioMetrics.sharpe).not.toBeNull();
    expect(stripProps().liveMetrics.max_drawdown).not.toBeNull();
    expect(footerDeltas().map((d) => d.label)).not.toContain("Sharpe");
  });

  it("a 400-day book beside a 400-day blend: both surfaces keep the Sharpe delta", () => {
    renderBlend(denseSeries(400), {
      extra: { equityHistoryState: "ready", equityDailyReturns: bookOf(400) },
    });
    expect(stripProps().liveMetrics.sharpe).toBe(1.2);
    expect(footerDeltas().map((d) => d.label)).toContain("Sharpe");
  });
});

describe("ScenarioComposer Sharpe delta - an unreadable own-book series fails closed (R3 SFH-M2)", () => {
  const unreadableBook = (): Point[] => {
    const b = bookOf(400);
    b[10] = { date: b[10].date, value: Number.NaN };
    return b;
  };

  it("withholds the Sharpe delta on both surfaces, keeps Max DD, and reports once per value", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const book = unreadableBook();
    const payload = makePayload(denseSeries(400), {
      equityHistoryState: "ready",
      equityDailyReturns: book,
    });
    const ui = (
      <ScenarioComposer payload={payload} allocatorId={ALLOCATOR_A} allocatorMandate={null} />
    );
    const { rerender } = render(ui);
    expect(stripProps().liveMetrics.sharpe).toBeNull();
    expect(footerDeltas().map((d) => d.label)).not.toContain("Sharpe");
    expect(footerDeltas().map((d) => d.label)).toContain("Max DD");
    const reports = () =>
      vi
        .mocked(captureToSentry)
        .mock.calls.filter(
          ([, ctx]) => (ctx?.tags as Record<string, string> | undefined)?.reason === "own-book-return-unreadable",
        );
    expect(reports()).toHaveLength(1);
    rerender(ui);
    expect(reports()).toHaveLength(1);
    errors.mockRestore();
  });

  // R4 WR-02 + R5 WR-01: a malformed own-book DATE makes the book record `unreadable`, which
  // withholds the annualised Sharpe and Sortino on every surface. It must NOT take the "vs Your
  // Book" panel with it: Max DD needs no date, and a missing panel names no reason. Only a
  // non-finite RETURN (above) omits the whole comparison.
  it.each([
    ["first", 0],
    ["last", 399],
  ] as const)("a malformed %s own-book date withholds the Sharpe delta and the strip's book Sharpe but KEEPS the panel's Max DD and says why", (_name, idx) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const book = bookOf(400);
    book[idx] = { date: "2026-13-99", value: book[idx].value };
    renderBlend(denseSeries(400), {
      extra: { equityHistoryState: "ready", equityDailyReturns: book },
    });
    expect(stripProps().liveMetrics.sharpe).toBeNull();
    expect(footerDeltas().map((d) => d.label)).not.toContain("Sharpe");
    expect(footerDeltas().map((d) => d.label)).toContain("Max DD");
    // The panel itself, mounted on the delta the composer handed the chart.
    const delta = handedDelta();
    expect(delta).toBeDefined();
    expect(delta!.max_dd).not.toBeNull();
    const payload = buildScenarioFactsheetPayload({
      portfolioDaily: denseSeries(300),
      benchmark: null,
      scenarioOwnBookDelta: delta,
    });
    const view = render(
      <FactsheetProvider payload={payload} persist={false}>
        <OwnBookDeltaPanel />
      </FactsheetProvider>,
    );
    const row = (label: string) => view.getByText(label).closest("tr")!.textContent ?? "";
    expect(row("Max DD (blend vs book)")).toMatch(/\d/);
    expect(row("Sharpe")).toContain("\u2014");
    expect(row("Sortino")).toContain("\u2014");
    expect(view.getByTestId("own-book-delta-note").textContent).toContain("could not be read");
    view.unmount();
    // A date fault is not a non-finite return: nothing is reported under that reason.
    expect(
      vi
        .mocked(captureToSentry)
        .mock.calls.filter(
          ([, ctx]) => (ctx?.tags as Record<string, string> | undefined)?.reason === "own-book-return-unreadable",
        ),
    ).toHaveLength(0);
    errors.mockRestore();
  });

  it("an absent book (fewer than 2 returns) is NOT an unreadable one: the footer keeps the Sharpe delta and nothing is reported", () => {
    renderBlend(denseSeries(400), {
      extra: { equityHistoryState: "ready", equityDailyReturns: bookOf(1) },
    });
    expect(footerDeltas().map((d) => d.label)).toContain("Sharpe");
    expect(vi.mocked(captureToSentry)).not.toHaveBeenCalled();
  });
});

// --- 194 review WR-03: the rolling-panel caption names the blend's own basis --

describe("ScenarioComposer blend rolling panel caption - the annualisation basis is the blend's, not a constant", () => {
  const caption = (): string =>
    screen.getByText(/-day rolling window/).textContent ?? "";

  it("a crypto blend (basis 365) reads '365-day annualized', never 252", () => {
    renderBlend(denseSeries(400));
    expect(caption()).toContain("365-day annualized");
    expect(caption()).not.toContain("252-day annualized");
  });

  it("a non-crypto blend (basis 252) reads '252-day annualized'", () => {
    renderBlend(spreadSeries(300, 400), { basis: 252 });
    expect(caption()).toContain("252-day annualized");
  });
});
