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
 *   - the tearsheet page;
 *   - the Holdings tab (`toStrategyRows`).
 *
 * "SAME VALUE" IS CHECKED IN THE FORM EACH SURFACE EXPOSES. A DATA surface (the payload's
 * `strategyMetrics`, the Holdings adapter output) is compared as a number within 1e-12 of
 * the stored field. A RENDERED surface (the table cell, the tearsheet value) is compared
 * as text equal to that surface's own formatter applied to the stored field, the same
 * `formatPercent` / `formatNumber` the cell imports. No rendered value is parsed back.
 *
 * DELIBERATE DIFFERENCES are labelled, not compared: a narrowed factsheet range carries
 * the "Selected range" label (Phase 193) and a Scenario blend its methodology line.
 *
 * D-15 interim (A-194-D15-02): an UNMARKED row (no `figure_defs_version`, no stored
 * observation count, non-crypto, 60 weekday returns inside 90 days) is withheld on every
 * page that shows its annualised figures, through the one interim rule. The case goes RED
 * if any page counts its own returns in place of the missing stored count.
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
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUserRolesResult: vi.fn() }));

type Row = Record<string, unknown>;

/**
 * The production factsheet read goes through the service-role admin client. This fake
 * serves it from ONE seeded DB-shaped row and PROJECTS the `strategy_analytics ( ... )`
 * embed by the select string it is asked for, as PostgREST does: a plain token returns
 * that column, `alias:metrics_json->key` returns that key of the jsonb column under the
 * alias, and a token that is not asked for is not returned. The tearsheet's own trade-fetch
 * read hits the same client; it is told apart by its select string and answers "no row
 * facts" (the quiet path).
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
      if (table === "strategies") {
        // The tearsheet's trade-fetch facts: nothing to claim.
        return {
          data: { api_keys: null, strategy_analytics: { trades_fetched_at: null, series_provenance: null } },
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

/** The text of the first body row's cell under the header that starts with `label`. */
function tableCell(label: string): string {
  const squeeze = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, "");
  const headers = Array.from(document.querySelectorAll("thead th"));
  const idx = headers.findIndex((th) => squeeze(th.textContent).startsWith(squeeze(label)));
  if (idx < 0) throw new Error(`StrategyTable has no column named ${label}`);
  const row = document.querySelector("tbody tr") as HTMLElement;
  return row.querySelectorAll("td")[idx].textContent ?? "";
}

/** Tearsheet: the page, with its detail read and record-span read answered from the stored row. */
async function renderTearsheet(
  assetClass: "crypto" | "traditional",
  analytics: Row,
  series: { date: string }[],
  observations: number | null,
) {
  vi.mocked(getFactsheetDetail).mockResolvedValueOnce({
    strategy: {
      id: STRATEGY_ID,
      name: "Parity Fixture",
      codename: "STRAT-001",
      status: "published",
      disclosure_tier: "exploratory",
      user_id: "u-1",
      strategy_types: ["Momentum"],
      markets: ["BTC"],
      start_date: "2024-01-01",
      leverage_range: "1x-2x",
      benchmark: "BTC",
      aum: 100_000,
      asset_class: assetClass,
      discovery_categories: { slug: "momentum" },
    },
    analytics: {
      cagr: analytics.cagr,
      sharpe: analytics.sharpe,
      sortino: analytics.sortino,
      max_drawdown: analytics.max_drawdown,
      volatility: analytics.volatility,
      calmar: analytics.calmar,
      six_month_return: analytics.six_month_return,
      cumulative_return: analytics.cumulative_return,
      computed_at: "2024-06-01T00:00:00Z",
      computation_status: "complete",
      sparkline_returns: [0.01, 0.02, -0.01, 0.03],
      monthly_returns: { "2024": { Jan: 0.05, Feb: 0.03 } },
      metrics_json: analytics.metrics_json,
    },
    manager: null,
    disclosureTier: "exploratory",
  } as unknown as Awaited<ReturnType<typeof getFactsheetDetail>>);
  vi.mocked(getUserRolesResult).mockResolvedValue({ roles: [] } as unknown as Awaited<ReturnType<typeof getUserRolesResult>>);
  const from = vi.fn(() => {
    let isSpan = false;
    const builder = {
      select: (cols: string) => {
        isSpan = cols.includes("record_observations");
        return builder;
      },
      eq: () => builder,
      maybeSingle: async () =>
        isSpan
          ? {
              data: {
                strategy_analytics: {
                  series_start: series[0].date,
                  series_end: series[series.length - 1].date,
                  headline_since: null,
                  record_observations: observations,
                },
              },
              error: null,
            }
          : { data: { strategy_analytics: { data_quality_flags: {} } }, error: null },
    };
    return builder;
  });
  vi.mocked(createClient).mockResolvedValueOnce({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    from,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  const page = await TearSheetPage({ params: Promise.resolve({ id: STRATEGY_ID }) });
  return render(page as React.ReactElement);
}

/** The value under the tearsheet metric labelled `label` (a label `<p>` and its next-sibling value `<p>`). */
function tearsheetValue(container: HTMLElement, label: string): string {
  const hit = Array.from(container.querySelectorAll("p")).find(
    (p) => p.textContent === label && p.nextElementSibling?.tagName === "P",
  );
  if (!hit) throw new Error(`the tearsheet has no metric labelled ${label}`);
  return hit.nextElementSibling!.textContent ?? "";
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
    expect(tableCell("Volatility"), "Volatility").toBe(formatPercent(stored.volatility));
    expect(tableCell("6 Month"), "6 Month").toBe(formatPercent(stored.six_month_return));
  });

  it("tearsheet: each hero and detail value reads the page's own formatter applied to the stored field", async () => {
    const { container } = await renderTearsheet("crypto", analytics(), MARKED_SERIES, MARKED_OBSERVATIONS);
    expect(tearsheetValue(container, "CAGR"), "CAGR").toBe(formatPercent(stored.cagr));
    expect(tearsheetValue(container, "Sharpe"), "Sharpe").toBe(formatNumber(stored.sharpe));
    expect(tearsheetValue(container, "Sortino"), "Sortino").toBe(formatNumber(stored.sortino));
    expect(tearsheetValue(container, "Max DD"), "Max DD").toBe(formatPercent(stored.max_drawdown));
    expect(tearsheetValue(container, "Volatility"), "Volatility").toBe(formatPercent(stored.volatility));
    expect(tearsheetValue(container, "Calmar"), "Calmar").toBe(formatNumber(stored.calmar));
    expect(tearsheetValue(container, "6 Month"), "6 Month").toBe(formatPercent(stored.six_month_return));
    expect(tearsheetValue(container, "Cumulative"), "Cumulative").toBe(formatPercent(stored.cumulative_return));
    expect(tearsheetValue(container, "VaR 95%"), "VaR 95%").toBe(formatPercent(STORED_JSON.var_1d_95));
    expect(tearsheetValue(container, "CVaR 95%"), "CVaR 95%").toBe(formatPercent(STORED_JSON.cvar));
  });

  it("the StrategyTable and the tearsheet print the SAME text for every metric they share", async () => {
    renderTable("crypto", analytics(), MARKED_SERIES, MARKED_OBSERVATIONS);
    const table = {
      "Return %": tableCell("Return %"),
      CAGR: tableCell("CAGR"),
      Sharpe: tableCell("Sharpe"),
      "Max DD": tableCell("Max DD"),
      Volatility: tableCell("Volatility"),
      "6 Month": tableCell("6 Month"),
    };
    cleanup();
    const { container } = await renderTearsheet("crypto", analytics(), MARKED_SERIES, MARKED_OBSERVATIONS);
    const tearsheet = {
      "Return %": tearsheetValue(container, "Cumulative"),
      CAGR: tearsheetValue(container, "CAGR"),
      Sharpe: tearsheetValue(container, "Sharpe"),
      "Max DD": tearsheetValue(container, "Max DD"),
      Volatility: tearsheetValue(container, "Volatility"),
      "6 Month": tearsheetValue(container, "6 Month"),
    };
    expect(table).toEqual(tearsheet);
  });

  it("D-05: the stored cumulative return is shown whatever its size, on the table and the tearsheet", async () => {
    renderTable("crypto", analytics(), MARKED_SERIES, MARKED_OBSERVATIONS);
    const cell = tableCell("Return %");
    expect(cell).toBe(formatPercent(stored.cumulative_return));
    expect(cell).not.toBe("—");
    cleanup();
    const { container } = await renderTearsheet("crypto", analytics(), MARKED_SERIES, MARKED_OBSERVATIONS);
    expect(tearsheetValue(container, "Cumulative")).toBe(cell);
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

  it("tearsheet: the Sharpe value prints the dash", async () => {
    const { container } = await renderTearsheet("traditional", unmarkedAnalytics(), UNMARKED_SERIES, null);
    expect(tearsheetValue(container, "Sharpe")).toBe("—");
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
    const { container } = await renderTearsheet("traditional", analytics, SHORT_COUNTED_SERIES, SHORT_COUNTED_OBSERVATIONS);
    expect(tearsheetValue(container, "Sharpe")).toBe(formatNumber(STORED.sharpe));
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
