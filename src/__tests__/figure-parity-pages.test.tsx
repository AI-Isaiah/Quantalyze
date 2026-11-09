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
 *   - the Holdings tab (`toStrategyRows`).
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
import { FIGURE_DEFS_VERSION, gateAnnualized } from "@/lib/figure-gate";
import { formatNumber, formatPercent } from "@/lib/utils";
import { StrategyTable } from "@/components/strategy/StrategyTable";
import TearSheetPage from "@/app/factsheet/[id]/tearsheet/page";
import { toStrategyRows } from "@/app/(dashboard)/allocations/lib/strategies-row-adapter";
import { recordFromScalars, type RecordScalarRow } from "@/lib/figure-record-scalars";
import { CandidateDetail } from "@/components/admin/CandidateDetail";
import type { CandidateRow } from "@/components/admin/AllocatorMatchQueue";
import { createClient } from "@/lib/supabase/server";
import { getFactsheetDetail } from "@/lib/queries";
import { getUserRolesResult } from "@/lib/auth";
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
        figure_span_days: spanOfSeries(series),
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
