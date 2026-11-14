/**
 * Phase 194 plan 08 (D-01, SC-2, TRUST-04): a figure means one thing everywhere.
 *
 * WHY THIS EXISTS. Before this phase one stored metric printed different numbers on
 * different pages: the factsheet recomputed "6 Month" from a row count while the
 * StrategyTable and the tearsheet printed the stored column, and VaR / CVaR came from
 * two definitions. A reader comparing two pages saw two answers for the same name.
 * This file feeds ONE stored fixture through every reader that shows a metric and
 * fails when two pages disagree about it, so the mismatch is a red test and not a
 * support ticket.
 *
 * The readers, each through its PRODUCTION entry point:
 *   - the factsheet: `fetchAndBuildPayload` over a fake admin client that HONOURS the
 *     select string (the plan-04 aliases are projected, not handed over whole, so a
 *     dropped alias really loses the column);
 *   - the StrategyTable cell (discovery list);
 *   - the tearsheet page (Phase 196 plan 13: the factsheet's PRINT VIEW, so it is checked as a
 *     CONSTRUCTION: the page hands `FactsheetView printView` the payload the factsheet's own
 *     builder makes, and that payload is compared like the factsheet's);
 *   - the Holdings tab (`toStrategyRows`);
 *   - the CompareTable Volatility cell (Phase 201 D-15/D-25: unsigned, as the StrategyTable and
 *     the tearsheet print it; closes the CompareTable half of TODOS 197-VOL-SIGN-TEARSHEET-COMPARE).
 *
 * "SAME VALUE" IS CHECKED IN THE FORM EACH SURFACE EXPOSES. A DATA surface (the payload's
 * `strategyMetrics`, the Holdings adapter output) is compared as a number within 1e-12 of
 * the stored field. A RENDERED surface (the table cell) is compared as text equal to that
 * surface's own formatter applied to the stored field, the same `formatPercent` /
 * `formatNumber` the cell imports. No rendered value is parsed back.
 *
 * DELIBERATE DIFFERENCES are labelled, not compared: a narrowed factsheet range carries
 * the "Selected range" label (Phase 193) and a Scenario blend its methodology line.
 *
 * D-15 interim (A-194-D15-02): an UNMARKED row (no `figure_defs_version`, no stored
 * observation count, non-crypto, 60 weekday returns inside 90 days) is withheld on every
 * page that shows its annualised figures, through the one interim rule. The case goes RED
 * if any page counts its own returns in place of the missing stored count.
 *
 * 194.1 plan 13 (2026-11-08): two readers join. `recordFromScalars` is the shared constructor
 * behind the 194.1 sites that read the four record scalars (the wizard, the admin queue, the
 * recommendations and intro pages, the replacement card), and `CandidateDetail` is the rendered
 * admin match-queue surface (census row B12b). Both are fed the SAME interim and CR-01 fixture
 * constants the cases below already use, never a second fixture, and must reach the verdict the
 * factsheet, Holdings, StrategyTable and tearsheet reach on them (194 D-15, D-20).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("@/components/charts/Sparkline", () => ({
  Sparkline: () => React.createElement("div", { "data-testid": "sparkline" }),
}));
vi.mock("@/components/strategy/FreshnessBadge", () => ({
  FreshnessBadge: () => React.createElement("span"),
}));
vi.mock("@/components/strategy/PercentileRankBadge", () => ({
  PercentileRankBadge: () => React.createElement("span"),
}));
vi.mock("@/components/ui/PrintButton", () => ({
  PrintButton: () => React.createElement("button", null, "Print"),
}));
vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));
vi.mock("@/lib/queries", () => ({
  getFactsheetDetail: vi.fn(),
  getPercentiles: vi.fn().mockResolvedValue(null),
  readPublicVerificationSignals: vi.fn().mockResolvedValue(new Map()),
}));
// Phase 196 plan 13: the tearsheet renders the factsheet's own component, so it is a recorder here.
// What the page hands it is the subject; the component's rendering is proven by its own tests.
const printViews = vi.hoisted(() => ({ props: [] as Array<{ payload: unknown; printView?: boolean }> }));
vi.mock("@/app/factsheet/[id]/v2/FactsheetView", () => ({
  FactsheetView: (props: { payload: unknown; printView?: boolean }) => {
    printViews.props.push(props);
    return React.createElement("div", { "data-testid": "factsheet-view" });
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUserRolesResult: vi.fn() }));

type Row = Record<string, unknown>;

/**
 * The production factsheet read goes through the service-role admin client. This fake
 * serves it from ONE seeded DB-shaped row and PROJECTS the `strategy_analytics ( ... )`
 * embed by the select string it is asked for, as PostgREST does: a plain token returns
 * that column, `alias:metrics_json->key` returns that key of the jsonb column under the
 * alias, and a token that is not asked for is not returned. The tearsheet now builds its payload
 * through the same `fetchAndBuildPayload`, so it reads this fake too.
 */
const fake = vi.hoisted(() => ({
  strategyRow: null as Row | null,
  /** BTC closes served to `benchmark_prices` (the USD view prices a native-unit series from them). */
  benchmarkRows: [] as Array<{ date: string; close_price: number }>,
}));

function projectEmbed(select: string, analytics: Row): Row {
  const open = select.indexOf("strategy_analytics (");
  const close = select.indexOf(")", open);
  const body = select.slice(open + "strategy_analytics (".length, close);
  const out: Row = {};
  for (const raw of body.split(",")) {
    const token = raw.trim();
    if (!token) continue;
    const alias = token.match(/^(\w+):metrics_json->(\w+)$/);
    if (alias) {
      const json = (analytics.metrics_json ?? {}) as Row;
      out[alias[1]] = json[alias[2]];
    } else {
      out[token] = analytics[token];
    }
  }
  return out;
}

vi.mock("@/lib/supabase/admin", () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    let select = "";
    const self = () => b;
    b.select = (s?: string) => {
      select = String(s ?? "");
      return b;
    };
    b.eq = self;
    b.or = self;
    b.order = self;
    b.limit = self;
    b.abortSignal = self;
    b.maybeSingle = async () => {
      if (table === "strategies" && select.includes("daily_returns")) {
        const row = fake.strategyRow;
        if (!row) return { data: null, error: null };
        return {
          data: { ...row, strategy_analytics: projectEmbed(select, row.strategy_analytics as Row) },
          error: null,
        };
      }
      return { data: null, error: null };
    };
    if (table === "benchmark_prices" || table === "csv_daily_returns") {
      // The keyset cursor (`lt`) marks a follow-up page, which is empty: the rows are served once.
      let followUpPage = false;
      b.gte = self;
      b.lte = self;
      b.lt = () => {
        followUpPage = true;
        return b;
      };
      b.gt = self;
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({
          data: table === "benchmark_prices" && !followUpPage ? [...fake.benchmarkRows].reverse() : [],
          error: null,
        });
    }
    return b;
  }
  return { createAdminClient: () => ({ from: (table: string) => builder(table) }) };
});

import { fetchAndBuildPayload } from "@/lib/factsheet/fetch-and-build-payload";
import { withPublishedOrOwner } from "@/lib/visibility";
import { FIGURE_DEFS_VERSION, gateAnnualized, shortTrackMarkerTitle, shortTrackNote } from "@/lib/figure-gate";
import { formatNumber, formatPercent } from "@/lib/utils";
import { StrategyTable } from "@/components/strategy/StrategyTable";
import { CompareTable } from "@/components/strategy/CompareTable";
import TearSheetPage from "@/app/factsheet/[id]/tearsheet/page";
import { toStrategyRows } from "@/app/(dashboard)/allocations/lib/strategies-row-adapter";
import { recordFromScalars, type RecordScalarRow } from "@/lib/figure-record-scalars";
import { CandidateDetail } from "@/components/admin/CandidateDetail";
import type { CandidateRow } from "@/components/admin/AllocatorMatchQueue";
import { captureToSentry } from "@/lib/sentry-capture";
import { createClient } from "@/lib/supabase/server";
import { getFactsheetDetail } from "@/lib/queries";
import { getUserRolesResult } from "@/lib/auth";
import { rowRecord } from "@/components/strategy/annualized-cell";
import { RangeEyebrow } from "@/app/factsheet/[id]/v2/MetricsColumn";
import { FactsheetProvider } from "@/app/factsheet/[id]/v2/factsheet-context";
import { methodologyLine } from "@/lib/scenario-history";
import type { FactsheetPayload } from "@/lib/factsheet/types";

// ---------------------------------------------------------------------------
// The stored fixture
// ---------------------------------------------------------------------------

// Synthetic, UUID-shaped ids: `withPublishedOrOwner` fails closed on a non-UUID.
const OWNER_ID = "00000000-0000-4000-8000-0000000000a1";
const STRATEGY_ID = "00000000-0000-4000-8000-0000000000b2";
const ownerVisibility = <Q,>(q: Q): Q => withPublishedOrOwner(q, OWNER_ID);

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const FIRST_DAY = Date.parse("2024-01-02T00:00:00Z");

/** Return `i` of the fixture: varied and signed, so every derived metric is non-degenerate. */
const returnAt = (i: number) => ((i % 7) - 3) / 1000 + (i % 5 === 0 ? 0.004 : 0);

/** `n` consecutive calendar days from 2024-01-02 (a crypto record). */
function calendarSeries(n: number): { date: string; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({ date: isoDay(FIRST_DAY + i * DAY), value: returnAt(i) }));
}

/** `n` weekdays from 2024-01-02 (a traditional record). */
function weekdaySeries(n: number): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  for (let ms = FIRST_DAY; out.length < n; ms += DAY) {
    const dow = new Date(ms).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push({ date: isoDay(ms), value: returnAt(out.length) });
  }
  return out;
}

const spanOfSeries = (series: { date: string }[]) =>
  Math.round((Date.parse(series[series.length - 1].date) - Date.parse(series[0].date)) / DAY) + 1; // D-20: both ends

/**
 * The stored values. Each is deliberately UNLIKE what `compute()` derives from the
 * series (six_month_return above all: today's mismatch was the factsheet deriving it from
 * a row count), so a page that recomputes cannot agree by accident.
 */
const STORED = {
  cumulative_return: 0.43217,
  cagr: 0.34561,
  volatility: 0.23459,
  sharpe: 1.23457,
  sortino: 1.87653,
  calmar: 2.34567,
  max_drawdown: -0.12346,
  six_month_return: 0.07771,
};
const STORED_JSON = {
  three_month: 0.03331,
  var_1d_95: -0.02221,
  cvar: -0.03337,
};

type Fixture = {
  name: string;
  /** The stored scalar columns (cumulative_return varies by case). */
  stored: typeof STORED;
};

/** D-05: a 13-digit cumulative return is shown like any finite value, on every page. */
const THIRTEEN_DIGIT = 1_234_567_890_123;
const FIXTURES: Fixture[] = [
  { name: "typical stored row", stored: STORED },
  { name: "13-digit cumulative return", stored: { ...STORED, cumulative_return: THIRTEEN_DIGIT } },
];

const MARKED_SERIES = calendarSeries(400);
/** The stored observation count: deliberately not the series length, so a page that counts its own returns is caught. */
const MARKED_OBSERVATIONS = 1234;

/** The marker-2 crypto row, as the database holds it. */
function markedAnalytics(stored: typeof STORED): Row {
  return {
    daily_returns: MARKED_SERIES,
    returns_series: null,
    computed_at: "2024-03-01T00:00:00Z",
    data_quality_flags: null,
    metrics_json_by_basis: null,
    computation_status: "complete",
    trades_fetched_at: null,
    series_provenance: null,
    ...stored,
    metrics_json: {
      figure_defs_version: FIGURE_DEFS_VERSION,
      ...STORED_JSON,
      record_observations: MARKED_OBSERVATIONS,
      best_day: 0.04,
      worst_day: -0.02,
    },
  };
}

const UNMARKED_SERIES = weekdaySeries(60);

/** The unmarked traditional row: no marker, no stored count, 60 weekday returns inside 90 days. */
function unmarkedAnalytics(): Row {
  return {
    daily_returns: UNMARKED_SERIES,
    returns_series: null,
    computed_at: "2024-03-01T00:00:00Z",
    data_quality_flags: null,
    metrics_json_by_basis: null,
    computation_status: "complete",
    trades_fetched_at: null,
    series_provenance: null,
    ...STORED,
    metrics_json: {},
  };
}

function strategyRowFor(assetClass: "crypto" | "traditional", analytics: Row): Row {
  return {
    id: STRATEGY_ID,
    name: "Parity Fixture",
    codename: null,
    disclosure_tier: null,
    status: "published",
    markets: [],
    strategy_types: [],
    description: null,
    subtypes: [],
    supported_exchanges: [],
    leverage_range: null,
    aum: null,
    max_capacity: null,
    avg_daily_turnover: null,
    start_date: null,
    benchmark: null,
    asset_class: assetClass,
    returns_denominator_config: null,
    source: null,
    api_keys: null,
    strategy_analytics: analytics,
  };
}

// ---------------------------------------------------------------------------
// The readers
// ---------------------------------------------------------------------------

/** Factsheet: the payload the production fetch path builds from the stored row. */
async function factsheetPayload(assetClass: "crypto" | "traditional", analytics: Row): Promise<FactsheetPayload> {
  fake.strategyRow = strategyRowFor(assetClass, analytics);
  const payload = await fetchAndBuildPayload(STRATEGY_ID, ownerVisibility);
  if (!payload) throw new Error("the fixture must build a payload");
  return payload;
}

/** StrategyTable: the one row, with the record scalars the ranked-list read projects. */
function renderTable(assetClass: "crypto" | "traditional", analytics: Row, series: { date: string }[], observations: number | null) {
  const strategy = {
    id: STRATEGY_ID,
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    name: "Parity Fixture",
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    asset_class: assetClass,
    analytics: {
      id: "an-1",
      strategy_id: STRATEGY_ID,
      computed_at: "2024-03-01T00:00:00Z",
      computation_status: "complete",
      cumulative_return: analytics.cumulative_return,
      cagr: analytics.cagr,
      volatility: analytics.volatility,
      sharpe: analytics.sharpe,
      sortino: analytics.sortino,
      calmar: analytics.calmar,
      max_drawdown: analytics.max_drawdown,
      six_month_return: analytics.six_month_return,
      sparkline_returns: [0, 1, 2, 3, 4],
      sparkline_drawdown: [0, -0.1, -0.2, -0.05, 0],
      series_start: series[0].date,
      series_end: series[series.length - 1].date,
      headline_since: null,
      record_observations: observations,
    },
  };
  return render(
    <StrategyTable strategies={[strategy] as unknown as React.ComponentProps<typeof StrategyTable>["strategies"]} categorySlug="crypto-sma" />,
  );
}

/**
 * Phase 197 D-05: a table header is now a label line plus a qualifier line ("Returnfull record
 * not ann." once whitespace is squeezed), so a metric is found by its label-line prefix. The two
 * Return columns are told apart by the qualifier: the full-record one is the first header that
 * starts with "Return" (Track precedes it), the 6-month one starts "Returnlast6months".
 */
const TABLE_HEADER_PREFIX: Record<string, string> = {
  "Return %": "Return",
  "6 Month": "Returnlast6months",
};

/** The text of the first body row's cell under the header that starts with `label`. */
function tableCell(label: string): string {
  const squeeze = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, "");
  const headers = Array.from(document.querySelectorAll("thead th"));
  const prefix = squeeze(TABLE_HEADER_PREFIX[label] ?? label);
  const idx = headers.findIndex((th) => squeeze(th.textContent).startsWith(prefix));
  if (idx < 0) throw new Error(`StrategyTable has no column named ${label}`);
  const row = document.querySelector("tbody tr") as HTMLElement;
  return row.querySelectorAll("td")[idx].textContent ?? "";
}

/**
 * CompareTable: one strategy column over the stored row. The `figureRecord` is built from the
 * same record scalars the other readers use, so the total-record gate shows the value.
 */
function renderCompareTable(analytics: Row, series: { date: string }[]) {
  const item = {
    kind: "strategy" as const,
    strategy: { id: STRATEGY_ID, name: "Parity Fixture" },
    analytics,
    figureRecord: recordFromScalars(recordScalars(analytics, series), "crypto"),
  };
  return render(<CompareTable items={[item] as unknown as React.ComponentProps<typeof CompareTable>["items"]} />);
}

/**
 * The figure text of the CompareTable cell in the row labelled `label` (first strategy column).
 * The cell also holds a qualitative chip ("Moderate"), so the figure is read from the
 * `font-metric` span that carries the number, not from the whole cell.
 */
function compareCell(label: string): string {
  const row = Array.from(document.querySelectorAll("tbody tr")).find(
    (tr) => tr.querySelector("td")?.textContent === label,
  );
  if (!row) throw new Error(`CompareTable has no row named ${label}`);
  return row.querySelectorAll("td")[1].querySelector("span.font-metric")?.textContent ?? "";
}

/**
 * Tearsheet: the page, run over the same stored row the factsheet's fetch path reads. Returns what
 * the page handed `FactsheetView` (its payload and `printView`), which is all the page decides.
 * The detail read only identifies the strategy for the identity panel and the ranks' category.
 */
async function renderTearsheet(
  assetClass: "crypto" | "traditional",
  analytics: Row,
) {
  fake.strategyRow = strategyRowFor(assetClass, analytics);
  printViews.props.length = 0;
  vi.mocked(getFactsheetDetail).mockResolvedValueOnce({
    strategy: {
      id: STRATEGY_ID,
      name: "Parity Fixture",
      codename: "STRAT-001",
      status: "published",
      disclosure_tier: "exploratory",
      user_id: "u-1",
      asset_class: assetClass,
      discovery_categories: { slug: "momentum" },
    },
    analytics: { computation_status: "complete" },
    manager: null,
    disclosureTier: "exploratory",
  } as unknown as Awaited<ReturnType<typeof getFactsheetDetail>>);
  vi.mocked(getUserRolesResult).mockResolvedValue({ roles: [] } as unknown as Awaited<ReturnType<typeof getUserRolesResult>>);
  vi.mocked(createClient).mockResolvedValueOnce({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    from: vi.fn(),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  const page = await TearSheetPage({ params: Promise.resolve({ id: STRATEGY_ID }) });
  render(page as React.ReactElement);
  expect(printViews.props, "the tearsheet must mount the factsheet view exactly once").toHaveLength(1);
  const view = printViews.props[0];
  return { printView: view.printView, payload: view.payload as FactsheetPayload };
}

/** Holdings: the marked-strategy half of the union, as the Holdings tab feeds it. */
function holdingsRow(
  assetClass: "crypto" | "traditional",
  analytics: Row,
  series: { date: string }[],
  observations: number | null,
  /** The span the PRODUCER emitted, when the case ran it; otherwise the fixture series' own span. */
  spanDays: number | null = spanOfSeries(series),
) {
  const [row] = toStrategyRows({
    strategies: [
      {
        id: STRATEGY_ID,
        name: "Parity Fixture",
        codename: null,
        disclosure_tier: "exploratory",
        status: "private",
        capital_ownership: "own_capital",
        mtd: null,
        figure_span_days: spanDays,
        figure_observations: observations,
        figure_crypto: assetClass === "crypto",
        strategy_analytics: { cagr: null, sharpe: analytics.sharpe, volatility: null, max_drawdown: analytics.max_drawdown },
      },
    ] as unknown as Parameters<typeof toStrategyRows>[0]["strategies"],
    positions: [],
    now: new Date("2026-01-01T00:00:00Z"),
  });
  return row;
}

/**
 * 194.1: the four record scalars a `strategy_analytics` row yields for the aliases in
 * `RECORD_SCALAR_ALIASES`, derived from the fixture's own series and stored `metrics_json`, so
 * the constructor and the admin surface judge exactly the record the other readers judge.
 */
function recordScalars(analytics: Row, series: { date: string }[]): RecordScalarRow {
  return {
    series_start: series[0].date,
    series_end: series[series.length - 1].date,
    headline_since: null,
    record_observations: (analytics.metrics_json as Row).record_observations,
  };
}

/** CandidateDetail (admin match queue, B12b) rendered on the fixture's scalars and stored Sharpe. */
function renderCandidateDetail(assetClass: "crypto" | "traditional", analytics: Row, series: { date: string }[]) {
  const candidate = {
    id: "cand-1",
    strategy_id: STRATEGY_ID,
    score: 70,
    score_breakdown: {},
    reasons: [],
    rank: 1,
    exclusion_reason: null,
    exclusion_provenance: null,
    strategies: {
      id: STRATEGY_ID,
      name: "Parity Fixture",
      codename: null,
      disclosure_tier: "exploratory",
      strategy_types: [],
      supported_exchanges: [],
      aum: null,
      max_capacity: null,
      user_id: "u-1",
      asset_class: assetClass,
    },
    analytics: {
      sharpe: analytics.sharpe,
      sortino: analytics.sortino,
      max_drawdown: analytics.max_drawdown,
      cagr: analytics.cagr,
      volatility: analytics.volatility,
      six_month_return: analytics.six_month_return,
      cumulative_return: analytics.cumulative_return,
      sparkline_returns: null,
      ...recordScalars(analytics, series),
    },
  } as unknown as CandidateRow;
  return render(
    <CandidateDetail
      candidate={candidate}
      alreadySent={false}
      isKept={false}
      isSkipped={false}
      isReadOnly
      onSendIntro={() => {}}
      onKeep={() => {}}
      onSkip={() => {}}
    />,
  );
}

/** The text of the CandidateDetail metric labelled `label` (a label `<p>` and its next-sibling value `<p>`). */
function candidateMetric(container: HTMLElement, label: string): string {
  const hit = Array.from(container.querySelectorAll("p")).find(
    (p) => p.textContent === label && p.nextElementSibling?.tagName === "P",
  );
  if (!hit) throw new Error(`CandidateDetail has no metric labelled ${label}`);
  return hit.nextElementSibling!.textContent ?? "";
}

beforeEach(() => {
  cleanup();
  fake.strategyRow = null;
  fake.benchmarkRows = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/**
 * A DATA surface's number is the stored field within 1e-12. Every disagreement is collected, so
 * a failure names EVERY metric a page got wrong in one run (6 Month and VaR together, say).
 */
const disagreements = (pairs: Array<[label: string, actual: number | null | undefined, expected: number]>): string[] =>
  pairs.flatMap(([label, actual, expected]) =>
    typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-12
      ? []
      : [`${label}: page has ${String(actual)}, stored is ${expected}`],
  );

// ---------------------------------------------------------------------------
// The parity cases
// ---------------------------------------------------------------------------

describe.each(FIXTURES)("one stored row, every page ($name)", ({ stored }) => {
  const analytics = () => markedAnalytics(stored);

  it("factsheet (production fetch path): every shared metric is the stored field to within 1e-12", async () => {
    const payload = await factsheetPayload("crypto", analytics());
    const m = payload.strategyMetrics;
    expect(
      disagreements([
        ["Return %", m.cum_ret, stored.cumulative_return],
        ["CAGR", m.cagr, stored.cagr],
        ["Sharpe", m.sharpe, stored.sharpe],
        ["Sortino", m.sortino, stored.sortino],
        ["Calmar", m.calmar, stored.calmar],
        ["Volatility", m.ann_vol, stored.volatility],
        ["Max DD", m.max_dd, stored.max_drawdown],
        ["6 Month", m.p6m, stored.six_month_return],
        ["3 Month", m.p3m, STORED_JSON.three_month],
        ["VaR 95%", m.var95, STORED_JSON.var_1d_95],
        ["CVaR 95%", m.cvar95, STORED_JSON.cvar],
      ]),
    ).toEqual([]);
    // The record is the stored count and the series' own span, never the series' own count.
    expect(payload.figureRecord?.observations).toBe(MARKED_OBSERVATIONS);
    expect(payload.figureRecord?.spanDays).toBe(spanOfSeries(MARKED_SERIES));
    expect(payload.figureRecord?.crypto).toBe(true);
  });

  it("Holdings (toStrategyRows): Sharpe and Max DD are the stored fields", () => {
    const row = holdingsRow("crypto", analytics(), MARKED_SERIES, MARKED_OBSERVATIONS);
    expect(
      disagreements([
        ["Holdings Sharpe", row.sharpe, stored.sharpe],
        ["Holdings Max DD", row.maxDd, stored.max_drawdown],
      ]),
    ).toEqual([]);
    expect(row.sharpeState).toBe("full");
  });

  it("StrategyTable: each cell reads the cell's own formatter applied to the stored field", () => {
    renderTable("crypto", analytics(), MARKED_SERIES, MARKED_OBSERVATIONS);
    expect(tableCell("Return %"), "Return %").toBe(formatPercent(stored.cumulative_return));
    expect(tableCell("CAGR"), "CAGR").toBe(formatPercent(stored.cagr));
    expect(tableCell("Sharpe"), "Sharpe").toBe(formatNumber(stored.sharpe));
    expect(tableCell("Max DD"), "Max DD").toBe(formatPercent(stored.max_drawdown));
    // Phase 197 D-05: volatility can never be negative, so the table prints it unsigned.
    expect(tableCell("Volatility"), "Volatility").toBe(formatPercent(stored.volatility, 2, { signed: false }));
    expect(tableCell("6 Month"), "6 Month").toBe(formatPercent(stored.six_month_return));
  });

  it("CompareTable: the Volatility cell is the stored field printed unsigned, as exact text (D-15, D-25)", () => {
    renderCompareTable(analytics(), MARKED_SERIES);
    // Exact text: volatility can never be negative, so no plus sign, the same as the
    // StrategyTable cell above. Another row keeps its sign rule, so the arm is not
    // satisfied by unsigning the whole table.
    expect(compareCell("Volatility"), "Volatility").toBe(formatPercent(stored.volatility, 2, { signed: false }));
    expect(compareCell("Volatility"), "Volatility has no plus").not.toContain("+");
    expect(compareCell("Cumulative Return"), "Cumulative Return").toBe(formatPercent(stored.cumulative_return));
  });

  it("tearsheet: renders the factsheet's own view in printView, on a payload whose every shared metric is the stored field to within 1e-12", async () => {
    const { printView, payload } = await renderTearsheet("crypto", analytics());
    expect(printView).toBe(true);
    const m = payload.strategyMetrics;
    expect(
      disagreements([
        ["Return %", m.cum_ret, stored.cumulative_return],
        ["CAGR", m.cagr, stored.cagr],
        ["Sharpe", m.sharpe, stored.sharpe],
        ["Sortino", m.sortino, stored.sortino],
        ["Calmar", m.calmar, stored.calmar],
        ["Volatility", m.ann_vol, stored.volatility],
        ["Max DD", m.max_dd, stored.max_drawdown],
        ["6 Month", m.p6m, stored.six_month_return],
        ["VaR 95%", m.var95, STORED_JSON.var_1d_95],
        ["CVaR 95%", m.cvar95, STORED_JSON.cvar],
      ]),
    ).toEqual([]);
  });

  it("the tearsheet and the factsheet reach the same figures BY CONSTRUCTION: the print view's payload is the factsheet fetch path's, metrics and record included", async () => {
    // Phase 196 D-03: the tearsheet no longer derives its own figures, so parity is that the page
    // hands the factsheet component what the factsheet's own builder makes from the same row.
    const factsheet = await factsheetPayload("crypto", analytics());
    const { printView, payload } = await renderTearsheet("crypto", analytics());
    expect(printView).toBe(true);
    expect(payload.strategyMetrics).toEqual(factsheet.strategyMetrics);
    expect(payload.figureRecord).toEqual(factsheet.figureRecord);
  });

  it("D-05: the stored cumulative return is shown whatever its size, on the table and the tearsheet payload", async () => {
    renderTable("crypto", analytics(), MARKED_SERIES, MARKED_OBSERVATIONS);
    const cell = tableCell("Return %");
    expect(cell).toBe(formatPercent(stored.cumulative_return));
    expect(cell).not.toBe("—");
    cleanup();
    // The print view carries the same stored cumulative return, unrounded and unwithheld.
    const { payload } = await renderTearsheet("crypto", analytics());
    expect(disagreements([["Return %", payload.strategyMetrics.cum_ret, stored.cumulative_return]])).toEqual([]);
  });
});

describe("the 13-digit fixture is a 13-digit value", () => {
  it("is not an accidental small number", () => {
    expect(String(THIRTEEN_DIGIT)).toHaveLength(13);
  });
});

// ---------------------------------------------------------------------------
// D-15 interim: the unmarked row is withheld by the one rule on every page
// ---------------------------------------------------------------------------

describe("D-15 interim parity: an unmarked non-crypto row of 60 weekday returns inside 90 days is withheld everywhere (A-194-D15-02)", () => {
  it("the fixture spans under 90 calendar days with exactly 60 returns", () => {
    expect(UNMARKED_SERIES).toHaveLength(60);
    expect(spanOfSeries(UNMARKED_SERIES)).toBeLessThan(90);
  });

  it("factsheet fetch path: the record carries no count and the gate withholds", async () => {
    const payload = await factsheetPayload("traditional", unmarkedAnalytics());
    expect(payload.figureRecord?.observations).toBeNull();
    expect(payload.figureRecord?.crypto).toBe(false);
    expect(payload.figureRecord?.spanDays).toBe(spanOfSeries(UNMARKED_SERIES));
    expect(gateAnnualized(payload.figureRecord!)).toBe("withheld");
  });

  it("Holdings: the Sharpe is withheld", () => {
    const row = holdingsRow("traditional", unmarkedAnalytics(), UNMARKED_SERIES, null);
    expect(row.sharpeState).toBe("withheld");
    expect(row.sharpe).toBeNull();
  });

  it("StrategyTable: the Sharpe cell prints the dash", () => {
    renderTable("traditional", unmarkedAnalytics(), UNMARKED_SERIES, null);
    const cell = tableCell("Sharpe");
    expect(cell.startsWith("—")).toBe(true);
    expect(cell).not.toContain(formatNumber(STORED.sharpe));
  });

  it("tearsheet: the print view's payload carries the withheld record, so the figures dash and the ranks drop", async () => {
    const { payload } = await renderTearsheet("traditional", unmarkedAnalytics());
    expect(payload.figureRecord?.observations).toBeNull();
    expect(gateAnnualized(payload.figureRecord!)).toBe("withheld");
  });

  it("194.1 recordFromScalars: the four alias scalars carry no count and the gate withholds", () => {
    const record = recordFromScalars(recordScalars(unmarkedAnalytics(), UNMARKED_SERIES), "traditional");
    expect(record.observations).toBeNull();
    expect(record.crypto).toBe(false);
    expect(record.spanDays).toBe(spanOfSeries(UNMARKED_SERIES));
    expect(gateAnnualized(record)).toBe("withheld");
  });

  it("194.1 CandidateDetail (B12b): the Sharpe prints the dash, as the factsheet verdict says", () => {
    const { container } = renderCandidateDetail("traditional", unmarkedAnalytics(), UNMARKED_SERIES);
    const cell = candidateMetric(container, "Sharpe");
    expect(cell.startsWith("—")).toBe(true);
    expect(cell).not.toContain(STORED.sharpe.toFixed(2));
  });
});

// ---------------------------------------------------------------------------
// CR-01: the stored count reaches the factsheet whether or not a cash headline is admitted
// ---------------------------------------------------------------------------

/** 62 weekday returns span about 86 calendar days: over D-15's 60 observations, under 90 days. */
const SHORT_COUNTED_SERIES = weekdaySeries(62);
const SHORT_COUNTED_OBSERVATIONS = 62;

/** A traditional row with a stored count and NO admitted cash headline (`metrics_json_by_basis` null). */
function shortCountedAnalytics(over: Row = {}): Row {
  return {
    ...unmarkedAnalytics(),
    daily_returns: SHORT_COUNTED_SERIES,
    metrics_json: { record_observations: SHORT_COUNTED_OBSERVATIONS },
    ...over,
  };
}

describe("CR-01 parity: a non-crypto record of 62 observations over under 90 days clears on every page, with no cash headline admitted", () => {
  it("the fixture is over 60 observations and under 90 days", () => {
    expect(SHORT_COUNTED_SERIES.length).toBeGreaterThanOrEqual(60);
    expect(spanOfSeries(SHORT_COUNTED_SERIES)).toBeLessThan(90);
  });

  it("factsheet fetch path (native): the record carries the stored count and the gate does not withhold", async () => {
    const payload = await factsheetPayload("traditional", shortCountedAnalytics());
    expect(payload.figureRecord?.observations).toBe(SHORT_COUNTED_OBSERVATIONS);
    expect(gateAnnualized(payload.figureRecord!)).not.toBe("withheld");
  });

  it("factsheet USD view: the record carries the same stored count and the gate does not withhold", async () => {
    // BTC closes on every calendar day of the series, so the conversion prices every return.
    fake.benchmarkRows = Array.from({ length: 100 }, (_, i) => ({
      date: isoDay(FIRST_DAY + i * DAY),
      close_price: 40_000 + i * 10,
    }));
    const payload = await factsheetPayload(
      "traditional",
      shortCountedAnalytics({ data_quality_flags: { native_unit: "BTC" } }),
    );
    expect(payload.usdViewUnavailable).toBeUndefined();
    const usd = payload.usdView?.payload;
    expect(usd?.figureRecord?.observations).toBe(SHORT_COUNTED_OBSERVATIONS);
    expect(gateAnnualized(usd!.figureRecord!)).not.toBe("withheld");
  });

  it("Holdings, StrategyTable and the tearsheet reach the same verdict: the Sharpe shows", async () => {
    const analytics = shortCountedAnalytics();
    expect(holdingsRow("traditional", analytics, SHORT_COUNTED_SERIES, SHORT_COUNTED_OBSERVATIONS).sharpeState).not.toBe("withheld");
    renderTable("traditional", analytics, SHORT_COUNTED_SERIES, SHORT_COUNTED_OBSERVATIONS);
    expect(tableCell("Sharpe")).toContain(formatNumber(STORED.sharpe));
    cleanup();
    const { payload } = await renderTearsheet("traditional", analytics);
    expect(payload.figureRecord?.observations).toBe(SHORT_COUNTED_OBSERVATIONS);
    expect(gateAnnualized(payload.figureRecord!)).not.toBe("withheld");
  });

  it("194.1 recordFromScalars and CandidateDetail (B12b) reach the same verdict: the Sharpe shows", () => {
    const analytics = shortCountedAnalytics();
    const record = recordFromScalars(recordScalars(analytics, SHORT_COUNTED_SERIES), "traditional");
    expect(record.observations).toBe(SHORT_COUNTED_OBSERVATIONS);
    expect(gateAnnualized(record)).not.toBe("withheld");
    const { container } = renderCandidateDetail("traditional", analytics, SHORT_COUNTED_SERIES);
    // The admin surface formats with its own two-decimal formatter, then appends the <1y marker.
    expect(candidateMetric(container, "Sharpe")).toContain(STORED.sharpe.toFixed(2));
    expect(candidateMetric(container, "Sharpe").startsWith("—")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Deliberate differences are labelled, never compared
// ---------------------------------------------------------------------------

describe("deliberate differences carry their label (not compared to the stored value)", () => {
  it("a narrowed factsheet range carries the 'Selected range' label", async () => {
    const payload = await factsheetPayload("crypto", markedAnalytics(STORED));
    const { getByTestId } = render(
      <FactsheetProvider payload={payload} persist={false}>
        <RangeEyebrow
          scope={{ kind: "selected", start: "2024-03-01", end: "2024-04-01", n: 32, startIdx: 59, endIdx: 90 }}
          surface="strip"
        />
      </FactsheetProvider>,
    );
    expect(getByTestId("range-eyebrow-strip").textContent).toMatch(/^Selected range: /);
  });

  it("a Scenario blend carries its methodology line", () => {
    expect(methodologyLine(120)).toBe("Historical realized · 120 overlapping days · not a forecast.");
  });
});

// ---------------------------------------------------------------------------
// 194.2 D-01 (194-MALFORMED-DATES-ABSENT): one malformed date, one verdict, on every producer
// ---------------------------------------------------------------------------

/**
 * WHY THIS EXISTS. The list producers used to read a date through a prefix pattern (`2026-02-28x`
 * read as `2026-02-28`) or skip a malformed one in an earliest-valid scan, so a strategy the
 * factsheet withheld printed its annualised figures in a list. The record is now judged on the
 * date AS STORED. A malformed date must give the same `withheld` verdict through the factsheet
 * (`fetchAndBuildPayload`), the list shaping (`shapeRowAnalytics` then `rowRecord`, both the
 * owner's wildcard arm and the anon alias arm) and the percentile read (`getPercentiles`).
 *
 * WHAT IS COMPARED, EXACTLY. SQL (`get_verified_cohort_rank`) and the lists judge the FIRST date,
 * the LAST date and `headline_since`. The factsheet judges those AND every interior date
 * (addendum disposition 3), so a malformed interior date is a factsheet-only verdict and is NOT
 * in this table. The factsheet's headline is read from the composite path, which already reads a
 * malformed `headline_since` as withheld by its own rule (composite-read-path.headline-basis
 * (d)), so the malformed-headline row is compared on the two list producers and the percentile read.
 * A malformed FIRST date never reaches the factsheet's gate: `readFactsheetBenchmark`
 * (`isoMinusOneDay`, benchmark-read.ts) throws a RangeError on it first. That is recorded in the
 * 194.2-02 SUMMARY as a deferred item and is not asserted here.
 */
describe("194.2 parity: a malformed first, last or headline date is withheld on every producer", () => {
  const LONG = calendarSeries(400);
  const withDate = (index: number, date: string) =>
    LONG.map((p, i) => (i === index ? { ...p, date } : p));

  /** The dates a case malforms, one field each; a field a case leaves alone is readable. */
  const CASES = [
    { name: "malformed first date", first: "2023-02-28x" },
    { name: "malformed last date", last: "2026-02-28x" },
    { name: "malformed headline_since", headline: "garbage" },
  ] as Array<{ name: string; first?: string; last?: string; headline?: string }>;

  const realQueries = () => vi.importActual<typeof import("@/lib/queries")>("@/lib/queries");

  /** The owner's wildcard row: the series and the flags travel whole, no alias is projected. */
  const ownerAnalytics = (c: (typeof CASES)[number]) => {
    const series = LONG.map((p) => ({ date: p.date, value: p.value }));
    if (c.first) series[0] = { ...series[0], date: c.first };
    if (c.last) series[series.length - 1] = { ...series[series.length - 1], date: c.last };
    return {
      computation_status: "complete",
      returns_series: series,
      data_quality_flags: c.headline ? { headline_since: c.headline } : null,
      metrics_json: { record_observations: 400 },
    };
  };

  /** The anon ranked read: the three aliases carry the stored text verbatim. */
  const aliasAnalytics = (c: (typeof CASES)[number]) => ({
    computation_status: "complete",
    series_start: c.first ?? LONG[0].date,
    series_end: c.last ?? LONG[LONG.length - 1].date,
    headline_since: c.headline ?? null,
    record_observations: 400,
  });

  it("the fixture's readable record is NOT withheld by any producer (control)", async () => {
    const { shapeRowAnalytics } = await realQueries();
    const readable = { name: "readable" };
    for (const a of [ownerAnalytics(readable), aliasAnalytics(readable)]) {
      const shaped = shapeRowAnalytics(a as never, STRATEGY_ID);
      expect(gateAnnualized(rowRecord({ asset_class: "crypto", analytics: shaped }))).not.toBe("withheld");
    }
    const payload = await factsheetPayload("crypto", markedAnalytics(STORED));
    expect(gateAnnualized(payload.figureRecord!)).not.toBe("withheld");
  });

  it.each(CASES)("list shaping, owner wildcard arm ($name): withheld", async (c) => {
    const { shapeRowAnalytics } = await realQueries();
    const shaped = shapeRowAnalytics(ownerAnalytics(c) as never, STRATEGY_ID);
    const record = rowRecord({ asset_class: "crypto", analytics: shaped });
    expect(record.unreadable).toBe(true);
    expect(gateAnnualized(record)).toBe("withheld");
  });

  it.each(CASES)("list shaping, anon alias arm ($name): withheld", async (c) => {
    const { shapeRowAnalytics } = await realQueries();
    const shaped = shapeRowAnalytics(aliasAnalytics(c) as never, STRATEGY_ID);
    expect(gateAnnualized(rowRecord({ asset_class: "crypto", analytics: shaped }))).toBe("withheld");
  });

  it.each(CASES)("percentile read ($name): the row's annualised ranks are withheld", async (c) => {
    const { getPercentiles: realGetPercentiles } = await realQueries();
    const kpis = (n: number) => ({
      computation_status: "complete",
      sharpe: n,
      cagr: n / 10,
      sortino: n,
      calmar: n,
      volatility: 0.1 * n,
      max_drawdown: -0.1,
      cumulative_return: 0.1,
    });
    const rows = ["A", "B", "C", "D", "E"].map((id, i) => ({
      id,
      asset_class: "crypto",
      strategy_analytics: { ...kpis(i + 1), ...(id === "E" ? aliasAnalytics(c) : aliasAnalytics({ name: "ok" })) },
    }));
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.neq = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
    vi.mocked(createClient).mockResolvedValueOnce({ from: () => chain } as unknown as Awaited<ReturnType<typeof createClient>>);
    const map = (await realGetPercentiles())!;
    expect(map.A.sharpe).toBeDefined();
    expect(map.E.sharpe).toBeUndefined();
  });

  it.each(CASES.filter((c) => c.last !== undefined))("factsheet ($name): withheld", async (c) => {
    const series = withDate(LONG.length - 1, c.last!);
    const analytics = { ...markedAnalytics(STORED), daily_returns: series };
    const payload = await factsheetPayload("crypto", analytics);
    expect(payload.figureRecord?.unreadable).toBe(true);
    expect(gateAnnualized(payload.figureRecord!)).toBe("withheld");
  });

  it("a prefix-shaped date is judged as stored: `2026-02-28x` is unreadable, not `2026-02-28`", async () => {
    const { shapeRowAnalytics } = await realQueries();
    const shaped = shapeRowAnalytics({ ...aliasAnalytics({ name: "x" }), series_start: "2026-02-28x" } as never, STRATEGY_ID);
    expect(shaped.series_start).toBe("2026-02-28x");
    expect(rowRecord({ asset_class: "crypto", analytics: shaped }).unreadable).toBe(true);
  });

  it("the owner arm keeps a readable series' own series_end byte-for-byte (recency untouched)", async () => {
    const { shapeRowAnalytics } = await realQueries();
    const shaped = shapeRowAnalytics(ownerAnalytics({ name: "readable" }) as never, STRATEGY_ID);
    expect(shaped.series_end).toBe(LONG[LONG.length - 1].date);
    expect(shaped.series_start).toBe(LONG[0].date);
  });
});


// ---------------------------------------------------------------------------
// 194.2 D-02 (item 8): one curve-derived strategy prints ONE record length on every page
// ---------------------------------------------------------------------------

/**
 * WHY THIS EXISTS. UAT 2026-11-09 saw one strategy read 193 days of record on one page and 192 on
 * another (PROD re-measure 2026-11-10: 194 and 193). The cause was NOT `spanDays` against
 * `coveredDays`: an analytics-service-ingested strategy has `daily_returns` null and its series
 * lives in `returns_series`, a cumulative curve of N points for N returns. The factsheet inverts
 * that curve into returns, and the inversion never emits day 0, so the factsheet's record started
 * at the SECOND curve date and read one day short of every list, percentile and SQL reader, which
 * take `returns_series->0->>date`. The factsheet now starts the record at the stored curve's first
 * point (`recordSeriesStart`), and this block feeds ONE curve through each reader.
 *
 * THE EXPECTED N IS TYPED BY HAND (194), never derived from the fixture by the code under test:
 * 2026-04-30 to 2026-11-09 inclusive is 1 (Apr 30) + 31 + 30 + 31 + 31 + 30 + 31 (May to Oct) + 9
 * (Nov 1 to 9) = 194. A test that computed its own expectation with `coveredDays` over the same
 * two dates would pass for any consistent off-by-one.
 *
 * READERS THAT CANNOT BE REACHED FROM HERE, and why: `percentileRecord` is module-private in
 * `queries.ts` and returns no span (it only gates the percentile sets). It builds its record with
 * `figureRecord` from the same three alias scalars `recordFromScalars` reads, so the alias-arm case
 * below stands for it. The Holdings span IS reached: the Holdings case runs the real producer,
 * `getOwnCapitalStrategies` (which calls the private `figureRecordScalars`, as does
 * `getMyAllocationDashboard`, pinned in `queries.my-allocation.test.ts`), over the stored curve,
 * and feeds the span it emitted to `toStrategyRows`. The producer reads the INVERTED series, whose
 * first date is the second curve date, so it must start the record at the stored curve's first
 * point (`curveRecordStart`) like the factsheet does; it read 193 here before that.
 */
describe("194.2 D-02 parity: a curve-derived strategy reads one record length on every page", () => {
  const CURVE_DAYS = 194;
  const CURVE_FIRST = "2026-04-30";
  const CURVE_LAST = "2026-11-09";
  /** The printed sentence for 194 days, spelled out so no formatter derives its own expectation. */
  const PRINTED_NOTE = "CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 194 days of record, under one year.";
  const PRINTED_MARKER_TITLE = "Annualized from 194 days of record, under one year.";

  /** The stored curve: one point per return, base 1, a level for every calendar day. */
  const CURVE_START_MS = Date.parse(`${CURVE_FIRST}T00:00:00Z`);
  const buildCurve = () => {
    let level = 1;
    return Array.from({ length: CURVE_DAYS }, (_, i) => {
      level *= 1 + returnAt(i) / 10;
      return { date: isoDay(CURVE_START_MS + i * DAY), value: level };
    });
  };
  const CURVE = buildCurve();

  /** A crypto row ingested by the analytics service: no `daily_returns`, the series is the curve. */
  const curveAnalytics = (over: Row = {}): Row => ({
    ...markedAnalytics(STORED),
    daily_returns: null,
    returns_series: CURVE,
    metrics_json: { figure_defs_version: FIGURE_DEFS_VERSION, ...STORED_JSON, record_observations: CURVE_DAYS },
    ...over,
  });

  it("the fixture is the PROD shape: 194 points, 2026-04-30 to 2026-11-09, daily_returns null", () => {
    expect(CURVE).toHaveLength(194);
    expect(CURVE[0].date).toBe("2026-04-30");
    expect(CURVE[CURVE.length - 1].date).toBe("2026-11-09");
    expect(spanOfSeries(CURVE)).toBe(194);
  });

  it("factsheet (production fetch path): the record is 194 days, and the equity series still starts at the second curve date", async () => {
    const payload = await factsheetPayload("crypto", curveAnalytics());
    expect(payload.figureRecord?.spanDays).toBe(194);
    expect(payload.figureRecord?.unreadable).toBeFalsy();
    // The series itself is untouched: the day-0 return is unrecoverable from a curve.
    expect(payload.dates[0]).toBe("2026-05-01");
    expect(payload.dates).toHaveLength(193);
    expect(shortTrackNote("record", payload.figureRecord!.spanDays!)).toBe(PRINTED_NOTE);
  });

  it("tearsheet (print view construction): the payload it hands the factsheet view carries 194", async () => {
    const { payload } = await renderTearsheet("crypto", curveAnalytics());
    expect(payload.figureRecord?.spanDays).toBe(194);
    expect(shortTrackNote("record", payload.figureRecord!.spanDays!)).toBe(PRINTED_NOTE);
  });

  it("discovery list, owner wildcard arm (shapeRowAnalytics -> rowRecord): 194", async () => {
    const { shapeRowAnalytics } = await vi.importActual<typeof import("@/lib/queries")>("@/lib/queries");
    const shaped = shapeRowAnalytics(
      {
        computation_status: "complete",
        returns_series: CURVE,
        data_quality_flags: null,
        metrics_json: { record_observations: CURVE_DAYS },
      } as never,
      STRATEGY_ID,
    );
    const record = rowRecord({ asset_class: "crypto", analytics: shaped });
    expect(record.spanDays).toBe(194);
    expect(shortTrackNote("record", record.spanDays!)).toBe(PRINTED_NOTE);
  });

  it("discovery list, anon alias arm, recordFromScalars and the percentile read's alias scalars: 194", async () => {
    const { shapeRowAnalytics } = await vi.importActual<typeof import("@/lib/queries")>("@/lib/queries");
    const aliases = {
      computation_status: "complete",
      series_start: CURVE_FIRST,
      series_end: CURVE_LAST,
      headline_since: null,
      record_observations: CURVE_DAYS,
    };
    const shaped = shapeRowAnalytics(aliases as never, STRATEGY_ID);
    expect(rowRecord({ asset_class: "crypto", analytics: shaped }).spanDays).toBe(194);
    const record = recordFromScalars(recordScalars(curveAnalytics(), CURVE), "crypto");
    expect(record.spanDays).toBe(194);
    expect(shortTrackNote("record", record.spanDays!)).toBe(PRINTED_NOTE);
  });

  it("discovery StrategyTable: the `<1y` marker under the Sharpe reads 194 days of record", () => {
    renderTable("crypto", curveAnalytics(), CURVE, CURVE_DAYS);
    const titles = Array.from(document.querySelectorAll("tbody tr [title]")).map((el) => el.getAttribute("title"));
    expect(titles).toContain(PRINTED_MARKER_TITLE);
    expect(shortTrackMarkerTitle(194)).toBe(PRINTED_MARKER_TITLE);
  });

  it("Holdings (the real producer, then toStrategyRows): the stored curve's record is 194 days and reaches the row without withholding", async () => {
    const { getOwnCapitalStrategies } = await vi.importActual<typeof import("@/lib/queries")>("@/lib/queries");
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.neq = () => chain;
    const analytics = curveAnalytics();
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: [
          {
            id: STRATEGY_ID,
            name: "Parity Fixture",
            codename: null,
            disclosure_tier: "exploratory",
            status: "private",
            capital_ownership: "own_capital",
            asset_class: "crypto",
            strategy_analytics: {
              daily_returns: analytics.daily_returns,
              returns_series: analytics.returns_series,
              data_quality_flags: analytics.data_quality_flags ?? null,
              record_observations: CURVE_DAYS,
              cagr: null,
              sharpe: analytics.sharpe,
              volatility: null,
              max_drawdown: analytics.max_drawdown,
            },
          },
        ],
        error: null,
      }).then(resolve);
    vi.mocked(createClient).mockResolvedValueOnce({ from: () => chain } as never);
    const produced = await getOwnCapitalStrategies(OWNER_ID);
    expect(produced).toHaveLength(1);
    // Hand-typed: the curve's first date to its last, inclusive. Not read back from the fixture.
    expect(produced![0].figure_span_days).toBe(194);
    const row = holdingsRow("crypto", analytics, CURVE, CURVE_DAYS, produced![0].figure_span_days);
    expect(row.sharpeState).not.toBe("withheld");
  });

  it("the factsheet USD view (native-unit strategy) carries the same 194: the record is not its unit", async () => {
    // A BTC close for the day before the curve and every curve day, so every return is priced.
    fake.benchmarkRows = Array.from({ length: CURVE_DAYS + 2 }, (_, i) => ({
      date: isoDay(CURVE_START_MS + (i - 1) * DAY),
      close_price: 40_000 + i * 10,
    }));
    const payload = await factsheetPayload("crypto", curveAnalytics({ data_quality_flags: { native_unit: "BTC" } }));
    expect(payload.usdViewUnavailable).toBeUndefined();
    expect(payload.figureRecord?.spanDays).toBe(194);
    expect(payload.usdView?.payload.figureRecord?.spanDays).toBe(194);
  });

  it.each([
    ["an interior", 60, "2026-06-31"],
    ["the last", CURVE_DAYS - 1, "2026-13-01"],
  ])(
    "194.2 R2 WR-01: a malformed date at %s curve point is unreadable on the native AND the USD view (the conversion drops it, the record keeps it)",
    async (_where, index, badDate) => {
      // A BTC close for every curve day, so the conversion prices every readable return and the
      // malformed point is stripped only because it never pairs with a close. The bad dates sit
      // inside the curve's own year-month range: a 2024 date would sort to index 0 and be read as
      // the curve's base point, which the inversion never emits.
      fake.benchmarkRows = Array.from({ length: CURVE_DAYS + 2 }, (_, i) => ({
        date: isoDay(CURVE_START_MS + (i - 1) * DAY),
        close_price: 40_000 + i * 10,
      }));
      const curve = CURVE.map((p, i) => (i === index ? { ...p, date: badDate } : p));
      const payload = await factsheetPayload(
        "crypto",
        curveAnalytics({ returns_series: curve, data_quality_flags: { native_unit: "BTC" } }),
      );
      expect(payload.usdViewUnavailable).toBeUndefined();
      expect(payload.figureRecord?.unreadable).toBe(true);
      expect(gateAnnualized(payload.figureRecord!)).toBe("withheld");
      const usd = payload.usdView?.payload;
      expect(usd?.figureRecord?.unreadable).toBe(true);
      expect(gateAnnualized(usd!.figureRecord!)).toBe("withheld");
    },
  );

  it("a CSV-derived strategy (daily_returns present) is unchanged: its record is its own series span", async () => {
    const series = calendarSeries(194);
    const payload = await factsheetPayload(
      "crypto",
      curveAnalytics({ daily_returns: series }),
    );
    // daily_returns wins, so the stored curve's first date is NOT the record start: the record is
    // the series' own first and last dates (2024-01-02 + 193 days), 194 days.
    expect(payload.dates[0]).toBe(series[0].date);
    expect(payload.figureRecord?.spanDays).toBe(spanOfSeries(series));
    expect(payload.figureRecord?.spanDays).toBe(194);
  });

  it.each(["2023-13-01", "2023-02-32", "", "2023-1-5"])(
    "194.2 WR-01: an earliest stored date of %s builds a payload with the figures WITHHELD, not an error-boundary throw",
    async (badDate) => {
      // CSV-derived (`daily_returns` present): the malformed key sorts FIRST, so it is the minimum
      // date the benchmark read would have bounded on and `isoMinusOneDay` would have thrown on.
      const series = [{ date: badDate, value: 0.001 }, ...calendarSeries(194)];
      const payload = await factsheetPayload("crypto", curveAnalytics({ daily_returns: series }));
      expect(payload.figureRecord?.unreadable).toBe(true);
      expect(gateAnnualized(payload.figureRecord!)).toBe("withheld");
      expect(payload.stressWindows.windows).toEqual([]);
    },
  );

  it("194.2 WR-02: a PRESENT non-string first curve date is unreadable on the factsheet too (as the SQL arm reads it), not absent", async () => {
    const curve = CURVE.map((p, i) => (i === 0 ? { ...p, date: 20260430 } : p));
    const payload = await factsheetPayload("crypto", curveAnalytics({ returns_series: curve }));
    expect(payload.figureRecord?.unreadable).toBe(true);
    expect(gateAnnualized(payload.figureRecord!)).toBe("withheld");
  });

  it("a malformed FIRST curve point is judged: the record is unreadable and withheld, the verbatim date reached the record", async () => {
    const curve = CURVE.map((p, i) => (i === 0 ? { ...p, date: "2026-04-30x" } : p));
    vi.mocked(captureToSentry).mockClear();
    const payload = await factsheetPayload("crypto", curveAnalytics({ returns_series: curve }));
    expect(payload.figureRecord?.unreadable).toBe(true);
    expect(gateAnnualized(payload.figureRecord!)).toBe("withheld");
    // The inversion drops that date from the series, so the report must name it from the record's
    // own first date (the `record_start` axis), not leave the cause blank.
    const reports = vi.mocked(captureToSentry).mock.calls.filter(
      ([, ctx]) => (ctx as { tags?: { op?: string } } | undefined)?.tags?.op === "buildFactsheetPayload",
    );
    expect(reports.length).toBeGreaterThan(0);
    expect((reports[0][1] as { extra: Record<string, unknown> }).extra).toMatchObject({
      firstBadAxis: "record_start",
      firstBadDate: "2026-04-30x",
      seriesStart: "2026-04-30x",
    });
  });
});

// 205: shared by the D-01 and D-02 parity describes (2024 curve, its BTC closes, a BTC-native row).
const CURVE_N = 400;
const CURVE_START = "2024-01-02";
const CURVE_START_MS_2024 = Date.parse(`${CURVE_START}T00:00:00Z`);

/** `n` consecutive calendar days from `startIso`, one stored point per return, geometric levels. */
const curve2024 = (startIso: string, n: number): { date: string; value: number | null }[] => {
  const startMs = Date.parse(`${startIso}T00:00:00Z`);
  let level = 1;
  return Array.from({ length: n }, (_, i) => {
    level *= 1 + returnAt(i) / 10;
    return { date: isoDay(startMs + i * DAY), value: level as number | null };
  });
};

/** A BTC close for the day before the curve and for every day through two days past its end. */
const closes2024 = (startMs: number, n: number) =>
  Array.from({ length: n + 2 }, (_, i) => ({ date: isoDay(startMs + (i - 1) * DAY), close_price: 40_000 + i * 10 }));

/** A BTC-native crypto row ingested by the analytics service: no `daily_returns`, the series is the curve. */
const btcNativeAnalytics = (
  curve: { date: string; value: number | null }[],
  dataQualityFlags: Row["data_quality_flags"] = { native_unit: "BTC" },
): Row => ({
  ...markedAnalytics(STORED),
  daily_returns: null,
  returns_series: curve,
  data_quality_flags: dataQualityFlags,
  metrics_json: { figure_defs_version: FIGURE_DEFS_VERSION, ...STORED_JSON, record_observations: CURVE_N },
});

/**
 * 205 D-01 (194.2-REVIEW-R3 WR-01): the USD view's record verdict is the NATIVE build's, threaded in
 * and OR'd into the USD record, never a second scan of a second date list. 194.2 R2 scanned the
 * native series read with its absent days KEPT, so a bad date on a day the native build drops (an
 * absent day: a `null` curve value) withheld the USD view while the native view read fine, and a
 * viewer who toggled BTC to USD watched figures disappear. One record, one verdict.
 *
 * The curve here starts in 2024 and the bad date is a 2024 date inside the curve's own range: a bad
 * date from another year sorts to index 0 and is read as the curve's base point (Pitfall 4).
 */
describe("205 D-01 parity: a bad date on an absent day does not flip the USD view's record verdict", () => {
  it.each([["2024-07-3"], ["2024-07-31x"]])(
    "an interior absent-day curve point dated %s reads readable on the native AND the USD view",
    async (bad) => {
      fake.benchmarkRows = closes2024(CURVE_START_MS_2024, CURVE_N);
      const curve = curve2024(CURVE_START, CURVE_N).map((p, i) => (i === 200 ? { date: bad, value: null } : p));
      const payload = await factsheetPayload("crypto", btcNativeAnalytics(curve));
      expect(payload.usdViewUnavailable).toBeUndefined();
      expect(payload.ingestSource).toBe("api");
      expect(payload.figureRecord?.unreadable).toBeFalsy();
      // At HEAD the USD view re-scanned the kept-absent native dates and read this true.
      expect(payload.usdView?.payload.figureRecord?.unreadable).toBeFalsy();
    },
  );

  // One record, one report: the native build judges a bad date and reports it; the USD view only
  // INHERITS that verdict, so it sends no second event. Both arms are pinned: an interior bad date,
  // and a bad FIRST curve point, which reaches the USD build verbatim through `recordSeriesStart`
  // (the native record's first date, not a date the USD build converted), so it is the inherited
  // verdict too (205 WR-01).
  it.each([
    ["an interior bad date", 60, "2026-06-31", "cash", "2026-06-31"],
    // "2026-04-3" sorts before the real first day "2026-04-30", so it stays the curve's first point.
    ["a bad first curve point", 0, "2026-04-3", "record_start", "2026-04-3"],
  ])("%s is reported to Sentry exactly once, by the native build; the USD view stays unreadable", async (_label, at, bad, axis, badDate) => {
    const days = 194;
    const startMs = Date.parse("2026-04-30T00:00:00Z");
    let level = 1;
    const curve = Array.from({ length: days }, (_, i) => {
      level *= 1 + returnAt(i) / 10;
      return { date: i === at ? bad : isoDay(startMs + i * DAY), value: level as number | null };
    });
    fake.benchmarkRows = closes2024(startMs, days);
    vi.mocked(captureToSentry).mockClear();
    const payload = await factsheetPayload("crypto", {
      ...btcNativeAnalytics(curve),
      metrics_json: { figure_defs_version: FIGURE_DEFS_VERSION, ...STORED_JSON, record_observations: days },
    });
    expect(payload.usdViewUnavailable).toBeUndefined();
    expect(payload.figureRecord?.unreadable).toBe(true);
    expect(payload.usdView?.payload.figureRecord?.unreadable).toBe(true);
    const reports = vi
      .mocked(captureToSentry)
      .mock.calls.filter(([, ctx]) => (ctx as { tags?: { reason?: string } } | undefined)?.tags?.reason === "figure-record-unreadable");
    expect(reports).toHaveLength(1);
    expect((reports[0][1] as { extra: Record<string, unknown> }).extra).toMatchObject({
      firstBadAxis: axis,
      firstBadDate: badDate,
    });
  });
});

/**
 * 205 D-02 (194.2-REVIEW-R3 WR-02): the native and USD views carry the SAME stress block for an
 * unreadable record. The converter never emits the native series' day 0, so the USD build cannot see
 * the native first date, and at HEAD its own `dates[0]` test read a readable date and printed a
 * window under a withheld native view. Only the record's verdict can make the two views agree, for a
 * bad date near the start and for one in the interior alike.
 */
describe("205 D-02 parity: native and USD views agree on the withheld stress form", () => {
  const N = 300;
  const START = "2024-02-28";
  const startMs = Date.parse(`${START}T00:00:00Z`);

  it.each([
    // 2024-02-29 is element 1; 2024-02-30 sorts just after it, so the date is bad and the order holds.
    ["a bad second curve date", 1, "2024-02-30"],
    // 2024-06-30 is element 123; 2024-06-31 sorts between it and 2024-07-01.
    ["a bad interior curve date", 123, "2024-06-31"],
  ])("%s withholds the stress windows on the native AND the USD view", async (_label, at, bad) => {
    fake.benchmarkRows = closes2024(startMs, N);
    const curve = curve2024(START, N).map((p, i) => (i === at ? { ...p, date: bad } : p));
    const payload = await factsheetPayload("crypto", {
      ...btcNativeAnalytics(curve),
      metrics_json: { figure_defs_version: FIGURE_DEFS_VERSION, ...STORED_JSON, record_observations: N },
    });
    expect(payload.usdViewUnavailable).toBeUndefined();
    expect(payload.ingestSource).toBe("api");
    expect(payload.figureRecord?.unreadable).toBe(true);
    expect(payload.stressWindows.unreadable).toBe(true);
    expect(payload.stressWindows.windows).toEqual([]);
    expect(payload.usdView?.payload.figureRecord?.unreadable).toBe(true);
    expect(payload.usdView?.payload.stressWindows.unreadable).toBe(true);
    expect(payload.usdView?.payload.stressWindows.windows).toEqual([]);
  });
});

/**
 * 205 D-03 (194.2-REVIEW-R3 WR-03): on the api arm, every PROD strategy, an unparseable date in the
 * second sorted curve position used to throw out of `alignBlend` and render the route error page for
 * every visitor, with and without a BTC native unit. The record verdict withholds every figure instead,
 * so the fetch path resolves a withheld payload. Phase 210 removed the blend alignment that threw, so
 * the api payload no longer carries a blend field at all.
 *
 * `"2024-01-1"` sorts between `2024-01-09` and `2024-01-10`, so it is the second curve point and the
 * native series' first date once the inversion drops day 0.
 */
describe("205 D-03 parity: an unreadable api-arm curve returns a withheld payload, not an error page", () => {
  const N = 300;
  const START = "2024-01-09";
  const startMs = Date.parse(`${START}T00:00:00Z`);

  it.each([
    ["no native unit", null],
    ["a BTC native unit", { native_unit: "BTC" }],
  ])("a curve whose second date is \"2024-01-1\" resolves withheld with %s", async (_label, flags) => {
    fake.benchmarkRows = closes2024(startMs, N);
    const curve = curve2024(START, N).map((p, i) => (i === 1 ? { ...p, date: "2024-01-1" } : p));
    expect(curve[1].date).toBe("2024-01-1");
    const payload = await factsheetPayload("crypto", {
      ...btcNativeAnalytics(curve, flags),
      metrics_json: { figure_defs_version: FIGURE_DEFS_VERSION, ...STORED_JSON, record_observations: N },
    });
    expect(payload.ingestSource).toBe("api");
    if (payload.ingestSource !== "api") throw new Error("expected the api arm");
    expect(payload.figureRecord?.unreadable).toBe(true);
    expect("allocatorPortfolios" in payload).toBe(false);
    expect(payload.stressWindows.unreadable).toBe(true);
    if (flags) {
      expect(payload.usdViewUnavailable).toBeUndefined();
      const usd = payload.usdView?.payload;
      expect(usd?.figureRecord?.unreadable).toBe(true);
      if (usd?.ingestSource !== "api") throw new Error("expected the USD view on the api arm");
      expect("allocatorPortfolios" in usd).toBe(false);
    }
  });
});
