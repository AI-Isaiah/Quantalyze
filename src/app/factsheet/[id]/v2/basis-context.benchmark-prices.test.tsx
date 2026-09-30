/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { BenchmarkPricesOpt, DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { buildFactsheetPayload, fixtureBenchmarkPrices } from "@/lib/factsheet/build-payload";
import { unavailableComparatorBlock } from "@/lib/factsheet/comparator-block";
import { BTC_DAILY } from "@/lib/factsheet/benchmarks";
import { BasisProvider, useBasis, useBasisSeriesView } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";
import { fetchAndBuildPayload, BENCHMARK_READ_FAILED_MESSAGE } from "@/lib/factsheet/fetch-and-build-payload";
import StrategyDetailPage from "@/app/(dashboard)/discovery/[slug]/[strategyId]/page";
import { createClient } from "@/lib/supabase/server";
import { getStrategyDetail } from "@/lib/queries";
import { captureToSentry } from "@/lib/sentry-capture";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";

/*
 * Doubles for the D-23 LOCKSTEP block at the foot of this file (the build tests
 * above use none of these modules). ONE admin double serves both builds: the
 * `strategies` read of the factsheet route, the `strategy_analytics_series` reads
 * of `readSingleKeyBasisOpts` (dispatched on `kind`), and `benchmark_prices`
 * (169.5-01's keyset-aware double: the configured rows newest-first when no `lt`
 * cursor was applied, `[]` once one was, since the reader stops only on an empty
 * page; the ascending first-stored-date probe answers a configured row). Every
 * benchmark call's filters are recorded.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
  redirect: (url: string) => {
    throw new Error(`redirect(${url}) called`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({ getStrategyDetail: vi.fn() }));

type BenchCall = { ascending: boolean; gte?: string; lte?: string; lt?: string };
const fake = vi.hoisted(() => ({
  strategyRow: null as unknown,
  seriesByKind: {} as Record<string, unknown>,
  bench: {
    rows: [] as Array<{ date: string; close_price: number | string }>,
    error: null as unknown,
    throws: false,
    probeRows: [] as Array<{ date: string }>,
    calls: [] as BenchCall[],
  },
}));

vi.mock("@/lib/supabase/admin", () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    let kind: string | undefined;
    const self = () => b;
    b.select = self;
    b.or = self;
    b.abortSignal = self;
    b.eq = (col: string, val: string) => {
      if (col === "kind") kind = val;
      return b;
    };
    b.maybeSingle = async () => {
      if (table === "strategies") return { data: fake.strategyRow, error: null };
      if (table === "strategy_analytics_series" && kind && kind in fake.seriesByKind) {
        return { data: { payload: fake.seriesByKind[kind] }, error: null };
      }
      return { data: null, error: null };
    };
    if (table === "benchmark_prices") {
      const call: BenchCall = { ascending: false };
      b.gte = (_c: string, v: string) => ((call.gte = v), b);
      b.lte = (_c: string, v: string) => ((call.lte = v), b);
      b.lt = (_c: string, v: string) => ((call.lt = v), b);
      b.order = (_c: string, o?: { ascending?: boolean }) => ((call.ascending = o?.ascending === true), b);
      b.limit = () => {
        fake.bench.calls.push(call);
        return b;
      };
      b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        if (fake.bench.throws) return Promise.reject(new Error("socket hang up")).then(resolve, reject);
        if (call.ascending) return Promise.resolve({ data: fake.bench.probeRows, error: null }).then(resolve, reject);
        if (fake.bench.error) return Promise.resolve({ data: null, error: fake.bench.error }).then(resolve, reject);
        if (call.lt !== undefined) return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        const rows = fake.bench.rows
          .filter((r) => (call.gte === undefined || r.date >= call.gte) && (call.lte === undefined || r.date <= call.lte))
          .sort((a, c) => (a.date < c.date ? 1 : -1));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      };
    } else {
      b.order = self;
      b.limit = self;
    }
    return b;
  }
  return { createAdminClient: () => ({ from: (table: string) => builder(table) }) };
});

/**
 * Phase 169.5 BENCHCOMPARE plan 02 (SC3, D-09, D-21, D-54): the payload carries the
 * bounded BTC `{ prices, through, dropped }` its comparators were computed from, and
 * the browser re-derive (`useBasisSeriesView` at a leverage other than 1) aligns BTC
 * from THOSE closes and THAT `dropped` list, so the server's and the client's BTC
 * blocks are the same object. Before this plan the re-derive read the bundled
 * fixture, so a database-fed BTC series (or one with a dropped close) gave the
 * client a different BTC block from the server's.
 *
 * The server reference is a build of the LEVERED dailies (`2 * r`); the client is
 * the hook at L = 2 over a build of the un-levered dailies. Both are handed the same
 * `benchmarkPrices` opt, whose closes deliberately differ from the fixture's so a
 * fixture fallback cannot pass.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
function days(a: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(a, i));
}
const series = (dates: string[], seed: number): DailyReturn[] =>
  dates.map((date, i) => ({ date, value: Math.sin((i + seed) * 1.3) * 0.02 + Math.cos((i + seed) * 0.7) * 0.01 }));
const lever = (rows: DailyReturn[], L: number): DailyReturn[] => rows.map((r) => ({ date: r.date, value: L * r.value }));

const STRATEGY = {
  id: "s-169-5-02",
  name: "Bench Prices Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2024-03-01T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
};

const CASH_DATES = days("2024-01-04", 50);
const MTM_DATES = days("2024-01-02", 52); // starts two days before cash
const CASH = series(CASH_DATES, 0);
const MTM = series(MTM_DATES, 3);

/** Closes over [2024-01-01, last MTM date], scaled so they differ from the fixture's. */
function dbPrices(): DailyPrice[] {
  return BTC_DAILY.filter((p) => p.date >= "2024-01-01" && p.date <= MTM_DATES[MTM_DATES.length - 1]).map(
    (p, i) => ({ date: p.date, close: p.close * (1 + 0.01 * Math.sin(i)) }),
  );
}

function opt(withDropped: boolean): BenchmarkPricesOpt {
  const all = dbPrices();
  const prices = withDropped ? all.filter((p) => p.date !== "2024-01-20") : all;
  return { prices, through: prices[prices.length - 1].date, dropped: withDropped ? ["2024-01-20"] : [] };
}

function build(cash: DailyReturn[], mtm: DailyReturn[] | null, benchmarkPrices: BenchmarkPricesOpt | undefined) {
  return buildFactsheetPayload(STRATEGY, cash, {
    ...(mtm
      ? {
          mtmSeries: { dailyReturns: mtm, gapSpans: [] },
          mtmGate: { available: true },
          metricsByBasis: {
            mark_to_market: {
              cumulative_return: 0.1,
              volatility: 0.2,
              max_drawdown: -0.05,
              cagr: 0.1,
              sharpe: 1,
              sortino: 1.5,
              calmar: 2,
            },
          },
        }
      : {}),
    ...(benchmarkPrices ? { benchmarkPrices } : {}),
  } as Parameters<typeof buildFactsheetPayload>[2])!;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <BasisProvider>
      <LeverageProvider>{children}</LeverageProvider>
    </BasisProvider>
  );
}

function clientView(payload: FactsheetPayload, basis: "cash_settlement" | "mark_to_market", L: number) {
  const { result } = renderHook(
    () => ({ basis: useBasis(), lev: useLeverage(), view: useBasisSeriesView(payload) }),
    { wrapper },
  );
  act(() => result.current.basis.setBasis(basis));
  act(() => result.current.lev.setLeverage(L));
  expect(result.current.view).not.toBe(payload); // the re-derive actually ran
  return result.current.view;
}

describe("169.5-02 SC3 / D-09: the browser re-derive aligns BTC from the payload's own series", () => {
  for (const withDropped of [true, false]) {
    const label = withDropped ? "with a dropped close inside the range" : "with no dropped close";
    it(`cash, L = 2, ${label}: the client BTC block deep-equals the server's`, () => {
      const bp = opt(withDropped);
      const server = build(lever(CASH, 2), null, bp).comparators.btc;
      const client = clientView(build(CASH, null, bp), "cash_settlement", 2).comparators.btc;
      expect(client).toEqual(server);
      // Non-vacuous: the fixture's closes give a different BTC block.
      const fromFixture = build(lever(CASH, 2), null, undefined).comparators.btc;
      expect(fromFixture.dailyReturns).not.toEqual(server.dailyReturns);
    });
  }

  it("mark_to_market, L = 2, with a dropped close and an MTM axis starting before cash: deep-equal", () => {
    const bp = opt(true);
    const server = build(CASH, lever(MTM, 2), bp).seriesByBasis!.mark_to_market!.comparators.btc;
    const client = clientView(build(CASH, MTM, bp), "mark_to_market", 2).comparators.btc;
    expect(client).toEqual(server);
    // Day one of the MTM axis comes from the carried close dated the day before it.
    expect(server.dailyReturns![0]).not.toBe(0);
  });

  it("the payload carries the opt verbatim; with no opt it carries the fixture bounded over every axis", () => {
    const bp = opt(true);
    expect(build(CASH, MTM, bp).benchmarkPrices).toEqual(bp);

    const carried = build(CASH, MTM, undefined).benchmarkPrices;
    if (!carried || "unavailable" in carried) throw new Error("expected fixture prices");
    expect(carried.prices[0].date).toBe("2024-01-01"); // earliest (MTM) date minus one day
    expect(carried.prices[carried.prices.length - 1].date).toBe(MTM_DATES[MTM_DATES.length - 1]);
    expect(carried.through).toBe(MTM_DATES[MTM_DATES.length - 1]);
    expect(carried.dropped).toEqual([]);
    expect(carried).toEqual(fixtureBenchmarkPrices([CASH, MTM]));
  });

  it("D-21: a payload WITHOUT the field re-derives BTC as the unavailable form, never the fixture", () => {
    const payload = build(CASH, null, undefined);
    delete (payload as { benchmarkPrices?: unknown }).benchmarkPrices;
    const btc = clientView(payload, "cash_settlement", 2).comparators.btc;
    expect(btc).toEqual(unavailableComparatorBlock("BTC-USD", "BTC"));
    expect(btc.summary).toBeNull();
    expect(btc.through).toBeNull();
  });
});

/* ------------------------------------------------------------------------------
 * D-23 LOCKSTEP (Phase 169.5 plan 02 Task 2; SC3, D-09, D-54, D-64(4) as amended
 * 2026-09-30). The discovery detail page keeps its own builder assembly until
 * Phase 169.1 plan 169.1-01 consolidates it onto `fetchAndBuildPayload` and
 * deletes this case by name. Until then this case fails the day the page and the
 * factsheet route pass different `benchmarkPrices` for the same strategy.
 *
 * The fixture: a single-key crypto row whose persisted MTM series starts TWO days
 * before its cash series (so the all-axis read bound differs from a cash-only one),
 * database closes starting AFTER the strategy's first date (so the fixture merge
 * prepends rows the trim must cut), the first-stored-date probe answering the
 * reader's first row, and one corrupt stored close (a `dropped` date) inside the
 * range.
 * --------------------------------------------------------------------------- */

const LOCK_ID = "00000000-0000-4000-8000-0000000169b2";
const LOCK_SLUG = DISCOVERY_CATEGORIES[0]!.slug;
const LOCK_CASH_DATES = days("2024-01-04", 30);
const LOCK_MTM_DATES = days("2024-01-02", 32);
const LOCK_LAST = LOCK_MTM_DATES[LOCK_MTM_DATES.length - 1];
const FULL = (cum: number) => ({
  cumulative_return: cum,
  volatility: 0.2,
  max_drawdown: -0.1,
  cagr: 0.4,
  sharpe: 1.5,
  sortino: 2.0,
  calmar: 1.1,
});

function lockAnalytics() {
  return {
    daily_returns: series(LOCK_CASH_DATES, 1),
    returns_series: null,
    computed_at: "2024-02-05T00:00:00Z",
    data_quality_flags: {},
    metrics_json_by_basis: { cash_settlement: FULL(0.05), mark_to_market: FULL(0.04) },
    computation_status: "complete",
    ...FULL(0.05),
  };
}

function lockStrategy() {
  return {
    id: LOCK_ID,
    name: "Lockstep Fixture",
    codename: null,
    disclosure_tier: "exploratory",
    status: "published",
    markets: ["BTC"],
    strategy_types: ["options"],
    description: null,
    subtypes: [],
    supported_exchanges: ["deribit"],
    leverage_range: null,
    aum: null,
    max_capacity: null,
    avg_daily_turnover: null,
    start_date: null,
    benchmark: null,
    asset_class: "crypto",
    trust_tier: "api_verified",
    returns_denominator_config: null,
  };
}

function seedLockstep() {
  fake.strategyRow = { ...lockStrategy(), strategy_analytics: lockAnalytics() };
  fake.seriesByKind = {
    mtm_daily_returns: {
      schema: 1,
      basis: "mark_to_market",
      rows: series(LOCK_MTM_DATES, 4).map((r) => ({ date: r.date, return: r.value })),
      gap_spans: [],
      conventions: { periods_per_year: 365, cumulative_method: "geometric", day_basis: "calendar" },
    },
  };
  // Database closes from 2024-01-06 (after the strategy's first date), scaled away
  // from the fixture's, with a corrupt stored close on 2024-01-15.
  fake.bench.rows = BTC_DAILY.filter((p) => p.date >= "2024-01-06" && p.date <= LOCK_LAST).map((p, i) =>
    p.date === "2024-01-15"
      ? { date: p.date, close_price: "not-a-number" }
      : { date: p.date, close_price: p.close * (1 + 0.01 * Math.cos(i)) },
  );
  fake.bench.probeRows = [{ date: "2024-01-06" }];
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }) },
  } as never);
  vi.mocked(getStrategyDetail).mockResolvedValue({
    strategy: lockStrategy(),
    analytics: lockAnalytics(),
    disclosureTier: "exploratory",
  } as never);
}

/** Depth-first search of an RSC element tree for the FactsheetView payload prop. */
function findPayload(node: unknown): FactsheetPayload | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findPayload(child);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as { props?: { payload?: unknown; children?: unknown } };
  if (el.props?.payload != null) return el.props.payload as FactsheetPayload;
  return findPayload(el.props?.children ?? null);
}

async function discoveryPayload(): Promise<FactsheetPayload> {
  const jsx = await StrategyDetailPage({
    params: Promise.resolve({ slug: LOCK_SLUG, strategyId: LOCK_ID }),
  });
  const payload = findPayload(jsx);
  if (!payload) throw new Error("the discovery page built no payload");
  return payload;
}

const publicVisibility = <Q,>(q: Q): Q => q;

describe("169.5-02 D-23: the discovery detail page reads BTC exactly as the factsheet route does", () => {
  beforeEach(() => {
    fake.bench.rows = [];
    fake.bench.error = null;
    fake.bench.throws = false;
    fake.bench.probeRows = [];
    fake.bench.calls = [];
    vi.mocked(captureToSentry).mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    seedLockstep();
  });

  it("LOCKSTEP: the same strategy through fetchAndBuildPayload and through the discovery page carries deep-equal benchmarkPrices from the same reader call bounds", async () => {
    const route = await fetchAndBuildPayload(LOCK_ID, publicVisibility);
    const routeCalls = fake.bench.calls;
    fake.bench.calls = [];
    const page = await discoveryPayload();
    const pageCalls = fake.bench.calls;

    // The MTM axis was really threaded on both surfaces, so the bound is all-axis.
    expect(route!.seriesByBasis?.mark_to_market).toBeDefined();
    expect(page.seriesByBasis?.mark_to_market).toBeDefined();
    const reads = routeCalls.filter((c) => !c.ascending);
    expect(reads.length).toBeGreaterThan(0);
    for (const c of reads) {
      expect(c.gte).toBe("2024-01-01"); // the MTM axis's first date minus one day
      expect(c.lte).toBe(LOCK_LAST);
    }
    expect(pageCalls).toEqual(routeCalls);

    const bp = route!.benchmarkPrices;
    if (!bp || "unavailable" in bp) throw new Error("expected route prices");
    // The fixture filled only the dates before the DB's first stored date, trimmed.
    expect(bp.prices[0].date).toBe("2024-01-01");
    expect(bp.prices.some((p) => p.date < "2024-01-01")).toBe(false);
    expect(bp.dropped).toEqual(["2024-01-15"]);
    expect(page.benchmarkPrices).toEqual(bp);
    expect(page.comparators.btc).toEqual(route!.comparators.btc);
  });

  const errorArms: Array<[string, () => void]> = [
    ["the reader answers ok:false", () => (fake.bench.error = { code: "PGRST000", message: "boom" })],
    ["the client throws", () => (fake.bench.throws = true)],
  ];
  for (const [name, arm] of errorArms) {
    it(`discovery page, ${name}: BTC is the unavailable form, logged, never the fixture, never captured`, async () => {
      // Control: the same page with a healthy read (unrelated captures, if any).
      await discoveryPayload();
      const controlCaptures = vi.mocked(captureToSentry).mock.calls.length;
      vi.mocked(captureToSentry).mockClear();
      vi.mocked(console.error).mockClear();
      arm();
      const page = await discoveryPayload();
      expect(page.benchmarkPrices).toEqual({ unavailable: true });
      expect(page.comparators.btc).toEqual(unavailableComparatorBlock("BTC-USD", "BTC"));
      expect(vi.mocked(console.error)).toHaveBeenCalledWith(
        BENCHMARK_READ_FAILED_MESSAGE,
        expect.objectContaining({ code: expect.any(String) }),
      );
      expect(vi.mocked(captureToSentry).mock.calls.length).toBe(controlCaptures);
    });
  }
});
