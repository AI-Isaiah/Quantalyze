import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 169.5 BENCHCOMPARE plan 01 Task 2 (SC3, D-09, D-52, D-54, D-64 with its
 * Decision (4) as amended 2026-09-30): the factsheet route reads BTC from
 * `benchmark_prices` through 169.2's reader, bounded over every comparator axis,
 * merges the bundled fixture only before the DB's TRUE first stored date (one
 * single-row probe), trims, and answers the unavailable form on any read error.
 *
 * The admin double is the hoisted-state builder of `fetch-and-build-payload.test.ts`
 * with a `benchmark_prices` branch. `readBenchmarkPrices` is a keyset loop that
 * stops only on an EMPTY page, so the branch answers the configured rows
 * newest-first when no `lt` was applied and `[]` once it was; it answers the
 * first-stored-date probe (recognised by its ASCENDING order) with a configured
 * row. Every call's filters are recorded.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
// SFH-M-01: a passthrough over the real aligner with one switch that makes it
// throw, so a bug in the pure merge / align code can be simulated. Off, it is
// the real function, so every other case here runs unchanged.
vi.mock("./align", async (importOriginal) => {
  const real = await importOriginal<typeof import("./align")>();
  return {
    ...real,
    alignCoveredReturns: (...args: Parameters<typeof real.alignCoveredReturns>) => {
      if (fake.alignThrows) throw new TypeError("simulated align bug");
      return real.alignCoveredReturns(...args);
    },
  };
});

type Row = Record<string, unknown>;
type BenchCall = { ascending: boolean; gte?: string; lte?: string; lt?: string };

const fake = vi.hoisted(() => ({
  alignThrows: false,
  strategyResult: { data: null as unknown, error: null as unknown },
  bench: {
    rows: [] as Array<{ date: string; close_price: number | string }>,
    error: null as unknown,
    throws: false,
    ignoreBounds: false,
    probeRows: [] as Array<{ date: string }>,
    probeError: null as unknown,
    calls: [] as Array<{ ascending: boolean; gte?: string; lte?: string; lt?: string }>,
  },
}));

vi.mock("@/lib/supabase/admin", () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = self;
    b.eq = self;
    b.or = self;
    b.abortSignal = self;
    b.order = self;
    b.limit = self;
    b.maybeSingle = async () => (table === "strategies" ? fake.strategyResult : { data: null, error: null });
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
        if (call.ascending) {
          return Promise.resolve(
            fake.bench.probeError
              ? { data: null, error: fake.bench.probeError }
              : { data: fake.bench.probeRows, error: null },
          ).then(resolve, reject);
        }
        if (fake.bench.error) return Promise.resolve({ data: null, error: fake.bench.error }).then(resolve, reject);
        if (call.lt !== undefined) return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        const rows = fake.bench.rows
          .filter(
            (r) =>
              fake.bench.ignoreBounds ||
              ((call.gte === undefined || r.date >= call.gte) && (call.lte === undefined || r.date <= call.lte)),
          )
          .sort((a, c) => (a.date < c.date ? 1 : -1));
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      };
    }
    return b;
  }
  return { createAdminClient: () => ({ from: (table: string) => builder(table) }) };
});

import {
  fetchAndBuildPayload,
  readFactsheetBenchmark,
  BENCHMARK_READ_FAILED_MESSAGE,
} from "./fetch-and-build-payload";
import { buildFactsheetPayload } from "./build-payload";
import { alignCoveredReturns } from "./align";
import { compute } from "./compute";
import { BTC_DAILY } from "./benchmarks";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureToSentry } from "@/lib/sentry-capture";
import type { DailyReturn } from "./types";

const STRATEGY_ID = "00000000-0000-4000-8000-0000000000c3";
const publicVisibility = <Q,>(q: Q): Q => q;

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
function days(a: string, b: string): string[] {
  const o: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) o.push(d);
  return o;
}
const series = (dates: string[]): DailyReturn[] =>
  dates.map((date, i) => ({ date, value: ((i % 5) - 2) / 100 }));

/** BTC closes 2024-01-01 .. 2024-01-11 (literal day one: 102 / 100 - 1 = 0.02). */
const CLOSES: Array<{ date: string; close_price: number }> = [
  100, 102, 101, 103, 104, 102, 105, 106, 104, 107, 108,
].map((c, i) => ({ date: addDays("2024-01-01", i), close_price: c }));

function seedStrategy(dates: string[]) {
  fake.strategyResult = {
    data: {
      id: STRATEGY_ID,
      name: "Bench Route Fixture",
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
      asset_class: "crypto",
      returns_denominator_config: null,
      strategy_analytics: {
        daily_returns: series(dates),
        returns_series: null,
        computed_at: "2024-01-12T00:00:00Z",
        data_quality_flags: null,
        metrics_json_by_basis: null,
        computation_status: "complete",
      } as Row,
    },
    error: null,
  };
}

const reads = () => fake.bench.calls.filter((c) => !c.ascending);
const probes = () => fake.bench.calls.filter((c) => c.ascending);

beforeEach(() => {
  fake.alignThrows = false;
  fake.strategyResult = { data: null, error: null };
  fake.bench.rows = [];
  fake.bench.error = null;
  fake.bench.throws = false;
  fake.bench.ignoreBounds = false;
  fake.bench.probeRows = [];
  fake.bench.probeError = null;
  fake.bench.calls = [];
  vi.mocked(captureToSentry).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // A second spyOn returns the SAME spy with its calls kept; clear them so a
  // "not called" assertion reads this test's calls only.
  vi.mocked(console.warn).mockClear();
  vi.mocked(console.error).mockClear();
});

describe("169.5-01 SC3: the route reads BTC from the database", () => {
  it("one bounded read sequence and one first-date probe; the BTC block is dated through the last close", async () => {
    const dates = days("2024-01-02", "2024-01-11");
    seedStrategy(dates);
    fake.bench.rows = CLOSES;
    fake.bench.probeRows = [{ date: "2023-01-01" }];
    const payload = await fetchAndBuildPayload(STRATEGY_ID, publicVisibility);
    expect(reads()).toHaveLength(2); // a page, then the empty page the keyset loop stops on
    for (const c of reads()) {
      expect(c.gte).toBe("2024-01-01");
      expect(c.lte).toBe("2024-01-11");
    }
    expect(probes()).toHaveLength(1);
    expect(payload!.comparators.btc.through).toBe("2024-01-11");
  });

  it("D-64: the read's lower bound supplies day one: index 0 is BTC's own return for the first date, counted in the summary", async () => {
    const dates = days("2024-01-02", "2024-01-11");
    seedStrategy(dates);
    fake.bench.rows = CLOSES;
    fake.bench.probeRows = [{ date: "2023-01-01" }];
    const btc = (await fetchAndBuildPayload(STRATEGY_ID, publicVisibility))!.comparators.btc;
    expect(btc.dailyReturns![0]).toBeCloseTo(0.02, 12);
    const rets = dates.map((d, i) => CLOSES[i + 1].close_price / CLOSES[i].close_price - 1);
    expect(btc.summary!.win_rate).toBe(compute(rets, dates, 0, 365).win_rate);
  });

  it("D-64(4) Amendment A: the bound spans every axis (an MTM series starting two days earlier and ending one day later)", async () => {
    const cash = series(days("2024-01-04", "2024-01-10")).reverse(); // unsorted on purpose
    const mtm = series(days("2024-01-02", "2024-01-11"));
    fake.bench.rows = CLOSES;
    fake.bench.probeRows = [{ date: "2023-01-01" }];
    const buildOpts = { mtmSeries: { dailyReturns: mtm, gapSpans: [] } };
    const opt = await readFactsheetBenchmark(createAdminClient(), cash, buildOpts);
    for (const c of reads()) {
      expect(c.gte).toBe("2024-01-01");
      expect(c.lte).toBe("2024-01-11");
    }
    const payload = buildFactsheetPayload(
      { id: "s", name: "n", types: [], markets: [], computedAt: "x", trustTier: null, assetClass: "crypto" },
      cash,
      { ...buildOpts, benchmarkPrices: opt },
    )!;
    const mtmBtc = payload.seriesByBasis!.mark_to_market!.comparators.btc;
    expect(mtmBtc.dailyReturns![0]).toBeCloseTo(0.02, 12);
    expect(mtmBtc.through).toBe("2024-01-11");
  });

  it("a strategy starting before the DB's first date: fixture rows fill only the pre-DB dates, bounded; the same with no DB history", async () => {
    const cash = series(days("2024-01-02", "2024-01-11"));
    fake.bench.rows = CLOSES.filter((r) => r.date >= "2024-01-06");
    fake.bench.probeRows = [{ date: "2024-01-06" }];
    const opt = await readFactsheetBenchmark(createAdminClient(), cash, undefined);
    if ("unavailable" in opt) throw new Error("expected prices");
    expect(opt.prices.map((p) => p.date)).toEqual(days("2024-01-01", "2024-01-11"));
    const fixture = new Map(BTC_DAILY.map((p) => [p.date, p.close]));
    for (const p of opt.prices.filter((q) => q.date < "2024-01-06")) expect(p.close).toBe(fixture.get(p.date));
    expect(opt.prices.find((p) => p.date === "2024-01-06")!.close).toBe(102);
    expect(opt.through).toBe("2024-01-11");

    fake.bench.rows = [];
    fake.bench.probeRows = [];
    const none = await readFactsheetBenchmark(createAdminClient(), cash, undefined);
    if ("unavailable" in none) throw new Error("expected fixture prices");
    expect(none.prices[0].date).toBe("2024-01-01");
    expect(none.through).toBe("2024-01-11");
  });

  it("D-64(4) Amendment B: a DB hole at the window's first day is never filled from the fixture", async () => {
    const cash = series(days("2024-01-02", "2024-01-11"));
    fake.bench.rows = CLOSES.filter((r) => r.date !== "2024-01-01");
    fake.bench.probeRows = [{ date: "2023-01-01" }];
    expect(BTC_DAILY.some((p) => p.date === "2024-01-01")).toBe(true);
    const opt = await readFactsheetBenchmark(createAdminClient(), cash, undefined);
    if ("unavailable" in opt) throw new Error("expected prices");
    expect(opt.prices.some((p) => p.date === "2024-01-01")).toBe(false);
    const a = alignCoveredReturns(opt.prices, opt.dropped, cash.map((r) => r.date));
    expect(a.returns[0]).toBeNull();
    expect(a.paired[0]).toBe(false);
  });

  it("D-64(4) Amendment B: a stale DB (history, but no row in the window) is the unavailable form, never the fixture", async () => {
    const cash = series(days("2024-01-02", "2024-01-11"));
    fake.bench.probeRows = [{ date: "2023-01-01" }];
    const opt = await readFactsheetBenchmark(createAdminClient(), cash, undefined);
    expect(opt).toEqual({ unavailable: true });
  });

  it("every date axis empty: the unavailable marker, and NO benchmark_prices query at all", async () => {
    const opt = await readFactsheetBenchmark(createAdminClient(), [], undefined);
    expect(opt).toEqual({ unavailable: true });
    expect(fake.bench.calls).toHaveLength(0);
  });

  it("no DB rows and a fixture ending the day before the strategy: an empty covered span is the unavailable form", async () => {
    const last = BTC_DAILY[BTC_DAILY.length - 1].date;
    const cash = series(days(addDays(last, 1), addDays(last, 8)));
    const opt = await readFactsheetBenchmark(createAdminClient(), cash, undefined);
    expect(opt).toEqual({ unavailable: true });
  });

  it("merged `dropped` dates inside the bound are carried; one outside it is not", async () => {
    const cash = series(days("2024-01-02", "2024-01-11"));
    fake.bench.ignoreBounds = true;
    fake.bench.rows = [
      ...CLOSES.filter((r) => r.date !== "2024-01-05"),
      { date: "2024-01-05", close_price: "not-a-number" },
      { date: "2023-12-20", close_price: 0 },
    ];
    fake.bench.probeRows = [{ date: "2023-12-20" }];
    const opt = await readFactsheetBenchmark(createAdminClient(), cash, undefined);
    if ("unavailable" in opt) throw new Error("expected prices");
    expect(opt.dropped).toEqual(["2024-01-05"]);
    expect(opt.prices[0].date).toBe("2024-01-01");
  });
});

describe("169.5-01 SC3 / D-09 / D-52 / D-54: a read error or throw is the unavailable form", () => {
  const cases: Array<[string, () => void, string]> = [
    ["the reader answers ok:false", () => (fake.bench.error = { code: "PGRST000", message: "boom" }), "boom"],
    ["the client throws", () => (fake.bench.throws = true), "socket hang up"],
    [
      "the first-date probe answers an error",
      () => (fake.bench.probeError = { code: "57014", message: "timeout" }),
      "timeout",
    ],
  ];
  for (const [name, arm, message] of cases) {
    it(`${name}: unavailable, never BTC_DAILY, logged, not captured`, async () => {
      const dates = days("2024-01-02", "2024-01-11");
      seedStrategy(dates);
      fake.bench.rows = CLOSES;
      fake.bench.probeRows = [{ date: "2023-01-01" }];
      // Control: the same build with a healthy read. The fixture row draws
      // unrelated captures (Phase 169's headline-source gate); the error arm must
      // add none of its own.
      await fetchAndBuildPayload(STRATEGY_ID, publicVisibility);
      const controlCaptures = vi.mocked(captureToSentry).mock.calls.length;
      vi.mocked(captureToSentry).mockClear();
      vi.mocked(console.error).mockClear();
      arm();
      const btc = (await fetchAndBuildPayload(STRATEGY_ID, publicVisibility))!.comparators.btc;
      expect(btc.summary).toBeNull(); // D-52: no window reads 0
      expect(btc.through).toBeNull();
      expect(btc.dailyReturns).toBeNull();
      // SFH-M-01: the line carries the error's message and the build's context
      // (strategy id and read range), threaded from the route; D-54 rules out a
      // Sentry event, so this line is the only trace.
      expect(vi.mocked(console.error)).toHaveBeenCalledWith(BENCHMARK_READ_FAILED_MESSAGE, {
        id: STRATEGY_ID,
        from: "2024-01-01",
        to: "2024-01-11",
        code: expect.any(String),
        message: message,
      });
      expect(vi.mocked(captureToSentry).mock.calls.length).toBe(controlCaptures);
    });
  }
});

describe("SFH-M-01: a bug in the pure merge / align code is not reported as a DB failure", () => {
  it("an align throw propagates as a build error and is never logged as the benchmark read failure", async () => {
    const cash = series(days("2024-01-02", "2024-01-11"));
    fake.bench.rows = CLOSES;
    fake.bench.probeRows = [{ date: "2023-01-01" }];
    fake.alignThrows = true;
    await expect(readFactsheetBenchmark(createAdminClient(), cash, undefined, STRATEGY_ID)).rejects.toThrow(
      "simulated align bug",
    );
    expect(vi.mocked(console.error)).not.toHaveBeenCalledWith(BENCHMARK_READ_FAILED_MESSAGE, expect.anything());
  });
});
