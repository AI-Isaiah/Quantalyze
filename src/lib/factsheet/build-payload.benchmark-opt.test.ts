import { describe, it, expect, vi } from "vitest";

/**
 * Phase 169.5 BENCHCOMPARE plan 01 (SC3, D-09, D-54, D-58, D-59, D-64): the
 * `benchmarkPrices` build opt and the ONE coverage-aware comparator alignment.
 *
 * The pairing rule these cases pin is the Python engine's: Phase 166.4 BENCHALIGN
 * founder decision D-A, with its ratified D-04 (both endpoints are closes), D-05
 * (day one pairs with the benchmark's own return for that date) and D-07 (the base
 * close), and the engine's interior-gap fix d1d1fc077 (166.4 review WR-01). Phase
 * 169.5 is its TypeScript application (169.5-CONTEXT D-63 and D-64; founder ruling
 * 2026-09-27 "Engine's rule; 169.5 follows").
 *
 * Every literal below was computed outside the project code, from the price ratios
 * and the population sd directly, and typed in. Dates are synthetic: 2026-03-01 is
 * a Sunday, 2026-03-02 a Monday.
 */

const gen = vi.hoisted(() => {
  const DAY = 86_400_000;
  const addDays = (d: string, n: number) =>
    new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
  const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
  /** Deterministic closes from `start` to `end`, weekdays only when asked. */
  function closes(start: string, end: string, weekdaysOnly: boolean, seed: number) {
    const out: Array<{ date: string; close: number }> = [];
    let x = seed >>> 0;
    let c = 100;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (weekdaysOnly && (dow(d) === 0 || dow(d) === 6)) continue;
      x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
      const r = Math.round((x / 0x7fffffff - 0.5) * 0.06 * 1e6) / 1e6;
      c = Math.round(c * (1 + r) * 1e6) / 1e6;
      out.push({ date: d, close: c });
    }
    return out;
  }
  return { addDays, dow, closes, SYN_SPX: closes("2025-11-03", "2026-06-05", true, 777) };
});

// The ONE seam for the synthetic SPX shape (weekday closes only): SPX_DAILY is
// replaced, BTC_DAILY / ETH_DAILY / GLD_DAILY / IEF_DAILY stay the real fixtures.
vi.mock("@/lib/factsheet/benchmarks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/factsheet/benchmarks")>()),
  SPX_DAILY: gen.SYN_SPX,
}));

import { buildFactsheetPayload } from "./build-payload";
import type { BenchmarkPricesOpt } from "./build-payload";
import { alignCoveredReturns, CALENDAR_7D, CALENDAR_WEEKDAY } from "./align";
import { compute } from "./compute";
import { jointMetrics } from "./joint";
import { BTC_DAILY } from "./benchmarks";
import type { DailyPrice, DailyReturn } from "./types";

const { addDays, dow, closes, SYN_SPX } = gen;

function days(a: string, b: string): string[] {
  const o: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) o.push(d);
  return o;
}
const weekdays = (a: string, b: string) => days(a, b).filter((d) => dow(d) !== 0 && dow(d) !== 6);

/** Deterministic strategy returns on the given dates. */
function strategyRows(dates: string[], seed = 12345): DailyReturn[] {
  let x = seed >>> 0;
  return dates.map((date) => {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    return { date, value: Math.round((x / 0x7fffffff - 0.5) * 0.1 * 1e6) / 1e6 };
  });
}

const STRATEGY = {
  id: "s-169-5-01",
  name: "Bench Opt Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-21T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};
const WEEKDAY_STRATEGY = { ...STRATEGY, assetClass: "traditional" };

function build(strategy: typeof STRATEGY, dates: string[], benchmarkPrices?: BenchmarkPricesOpt) {
  const p = buildFactsheetPayload(strategy, strategyRows(dates), benchmarkPrices ? { benchmarkPrices } : undefined);
  if (!p) throw new Error("fixture must build");
  return p;
}
const opt = (prices: DailyPrice[], dropped: string[] = []): BenchmarkPricesOpt => ({
  prices,
  through: prices.length ? prices[prices.length - 1].date : null,
  dropped,
});
const close = (ser: DailyPrice[], d: string) => {
  const p = ser.find((q) => q.date === d);
  if (!p) throw new Error(`no close ${d}`);
  return p.close;
};

describe("169.5-01 SC3: BTC coverage, `through` and null windows", () => {
  it("prices through 2026-09-10 on a strategy to 2026-09-20: through, null MTD / 3M, covered-day summary, A7 pin", () => {
    const dates = days("2026-01-01", "2026-09-20");
    const btc = closes("2025-12-31", "2026-09-10", false, 99);
    const block = build(STRATEGY, dates, opt(btc)).comparators.btc;
    expect(block.through).toBe("2026-09-10");
    expect(block.summary!.mtd).toBeNull();
    expect(block.summary!.p3m).toBeNull();
    const covDates = dates.filter((d) => d <= "2026-09-10");
    const covRets = covDates.map((d) => close(btc, d) / close(btc, addDays(d, -1)) - 1);
    const oracle = compute(covRets, covDates, 0, 365);
    expect(block.summary!.win_rate).toBe(oracle.win_rate);
    expect(block.summary!.ann_vol).toBeCloseTo(oracle.ann_vol, 12);
    // RESEARCH A7: cumulative return and annualised volatility are different numbers.
    expect(block.summary!.cum_ret).not.toBeCloseTo(block.summary!.ann_vol, 6);
  });

  it("dense parity (D-54 as amended by D-64): k >= 1 equals the price ratio, index 0 is BTC's own day-one return, paired", () => {
    const prices: DailyPrice[] = [
      { date: "2026-02-28", close: 100 },
      { date: "2026-03-01", close: 102 },
      { date: "2026-03-02", close: 99.96 },
      { date: "2026-03-03", close: 101 },
      { date: "2026-03-04", close: 100 },
      { date: "2026-03-05", close: 105 },
      { date: "2026-03-06", close: 104 },
    ];
    const a = alignCoveredReturns(prices, [], days("2026-03-01", "2026-03-06"), CALENDAR_7D);
    const expected = [0.02, -0.02, 0.010404161664665956, -0.00990099009900991, 0.05, -0.00952380952380949];
    expected.forEach((v, i) => expect(a.returns[i], `index ${i}`).toBeCloseTo(v, 12));
    expect(a.paired).toEqual([true, true, true, true, true, true]);
    expect(a.through).toBe("2026-03-06");
  });

  it("dense, long: every window numeric and every per-day return is the price ratio (index 0 included)", () => {
    const dates = days("2025-01-01", "2026-09-20");
    const btc = closes("2024-12-31", "2026-09-20", false, 7);
    const block = build(STRATEGY, dates, opt(btc)).comparators.btc;
    for (const w of ["mtd", "ytd", "p3m", "p6m", "p1y"] as const) expect(block.summary![w], w).not.toBeNull();
    dates.forEach((d, i) =>
      expect(block.dailyReturns![i], d).toBeCloseTo(close(btc, d) / close(btc, addDays(d, -1)) - 1, 12),
    );
    expect(block.dailyReturns![0]).not.toBe(0);
  });
});

describe("169.5-01 D-54 / D-64: interval pairing by the engine's rule", () => {
  const btc = closes("2026-02-20", "2026-04-10", false, 4242);

  it("weekday strategy vs contiguous 7-day BTC: Monday pairs with the Friday-to-Monday move (166.4 D-A)", () => {
    const dates = weekdays("2026-03-02", "2026-03-13");
    const a = alignCoveredReturns(btc, [], dates, CALENDAR_7D);
    const mon = dates.indexOf("2026-03-09");
    expect(a.returns[mon]).toBeCloseTo(-0.026243567571196724, 12);
    expect(a.returns[mon]).not.toBeCloseTo(-0.022917000036408064, 6); // never Sunday-to-Monday
    expect(a.paired[mon]).toBe(true);
  });

  it("D-64 interior gap: a Saturday missing inside (Fri, Mon] keeps the series value and is NOT paired; joint excludes it", () => {
    const gapped = btc.filter((p) => p.date !== "2026-03-07");
    const dates = weekdays("2026-03-02", "2026-03-20");
    const a = alignCoveredReturns(gapped, [], dates, CALENDAR_7D);
    const gapMon = dates.indexOf("2026-03-09");
    expect(a.returns[gapMon]).toBeCloseTo(-0.026243567571196724, 12);
    expect(a.paired[gapMon]).toBe(false);
    expect(a.paired[dates.indexOf("2026-03-02")]).toBe(true);
    expect(a.paired[dates.indexOf("2026-03-16")]).toBe(true);
    expect(a.paired.filter((p) => !p)).toHaveLength(1);

    const payload = build(WEEKDAY_STRATEGY, dates, opt(gapped));
    const strat = strategyRows(dates).map((r) => r.value);
    const keep = dates.map((_, i) => i).filter((i) => i !== gapMon);
    const want = jointMetrics(keep.map((i) => strat[i]), keep.map((i) => a.returns[i] as number), 0, 252);
    expect(payload.comparators.btc.joint!.beta).toBeCloseTo(want.beta, 12);
    const withGap = jointMetrics(strat, a.returns as number[], 0, 252);
    expect(payload.comparators.btc.joint!.beta).not.toBeCloseTo(withGap.beta, 9);
  });

  it("D-64 own calendar: a weekday strategy vs a Monday-to-Friday benchmark pairs every Monday", () => {
    const dates = weekdays("2026-03-02", "2026-03-27");
    const a = alignCoveredReturns(SYN_SPX, [], dates, CALENDAR_WEEKDAY);
    const mondays = dates.map((d, i) => [d, i] as const).filter(([d]) => dow(d) === 1);
    expect(mondays.length).toBe(4);
    for (const [d, i] of mondays) expect(a.paired[i], d).toBe(true);
  });

  it("D-64 base close (166.4 D-07): strategy dates before the first close are null; the first close pairs the next interval", () => {
    const prices: DailyPrice[] = [
      { date: "2026-03-03", close: 100 },
      { date: "2026-03-04", close: 103 },
      { date: "2026-03-05", close: 101 },
    ];
    const a = alignCoveredReturns(prices, [], days("2026-03-01", "2026-03-05"), CALENDAR_7D);
    expect(a.returns.slice(0, 3)).toEqual([null, null, null]);
    expect(a.paired.slice(0, 3)).toEqual([false, false, false]);
    expect(a.returns[3]).toBeCloseTo(0.030000000000000027, 12);
    expect(a.paired[3]).toBe(true);
    expect(a.returns[4]).toBeCloseTo(-0.01941747572815533, 12);
    expect(a.returns).not.toContain(0);
  });

  it("a dropped close is never bridged: both intervals touching it are null and out of the summary", () => {
    const dates = days("2026-03-01", "2026-03-06");
    const prices = btc.filter((p) => p.date !== "2026-03-03");
    const a = alignCoveredReturns(prices, ["2026-03-03"], dates, CALENDAR_7D);
    expect(a.returns[2]).toBeNull();
    expect(a.returns[3]).toBeNull();
    const block = build(STRATEGY, dates, opt(prices, ["2026-03-03"])).comparators.btc;
    const cov = [0, 1, 4, 5];
    const covRets = cov.map((i) => close(btc, dates[i]) / close(btc, addDays(dates[i], -1)) - 1);
    const covDates = cov.map((i) => dates[i]);
    const oracle = compute(covRets, covDates, 0, 365);
    expect(block.summary!.win_rate).toBe(oracle.win_rate);
    expect(block.summary!.ann_vol).toBeCloseTo(oracle.ann_vol, 12);
  });

  it("D-58 missing BTC day at k: k null, k+1 bridged in the series but unpaired, summary and joint exclude them", () => {
    // 14 dates, 12 paired: at or above `MIN_PAIRED_OBSERVATIONS` (169.4 review
    // SFH MEDIUM-4), so the block carries a joint for this case to check. The
    // window was 10 dates (8 paired) before that floor existed.
    const dates = days("2026-03-01", "2026-03-14");
    const k = dates.indexOf("2026-03-04");
    const prices = btc.filter((p) => p.date !== "2026-03-04");
    const a = alignCoveredReturns(prices, [], dates, CALENDAR_7D);
    expect(a.returns[k]).toBeNull();
    const k1 = close(btc, "2026-03-05") / close(btc, "2026-03-03") - 1;
    expect(a.returns[k + 1]).toBeCloseTo(k1, 12);
    expect(a.returns[k + 1]).not.toBe(0);
    expect(a.paired[k + 1]).toBe(false);

    const payload = build(STRATEGY, dates, opt(prices));
    const block = payload.comparators.btc;
    const cov = dates.map((_, i) => i).filter((i) => i !== k);
    const covRets = cov.map((i) => a.returns[i] as number);
    const covDates = cov.map((i) => dates[i]);
    const oracle = compute(covRets, covDates, 0, 365);
    expect(block.summary!.win_rate).toBe(oracle.win_rate);
    expect(block.summary!.ann_vol).toBeCloseTo(oracle.ann_vol, 12);
    const strat = strategyRows(dates).map((r) => r.value);
    const pairedIdx = dates.map((_, i) => i).filter((i) => i !== k && i !== k + 1);
    const want = jointMetrics(pairedIdx.map((i) => strat[i]), pairedIdx.map((i) => a.returns[i] as number), 0, 365);
    expect(block.joint!.beta).toBeCloseTo(want.beta, 12);
  });

  it("D-58 weekday comparator vs a 7-day strategy: weekend null, Monday the Friday-to-Monday move, unpaired", () => {
    const dates = days("2026-03-05", "2026-03-10");
    const a = alignCoveredReturns(SYN_SPX, [], dates, CALENDAR_WEEKDAY);
    expect(a.returns[dates.indexOf("2026-03-07")]).toBeNull();
    expect(a.returns[dates.indexOf("2026-03-08")]).toBeNull();
    const mon = dates.indexOf("2026-03-09");
    expect(a.returns[mon]).toBeCloseTo(0.01466199566836357, 12);
    expect(a.paired[mon]).toBe(false);
    expect(a.paired[dates.indexOf("2026-03-10")]).toBe(true);
  });
});

describe("169.5-01 SC3 / D-09: the opt's three states", () => {
  it("the unavailable marker: BTC is the unavailable form, nothing from BTC_DAILY", () => {
    const dates = days("2026-03-01", "2026-04-30");
    const payload = build(STRATEGY, dates, { unavailable: true });
    const block = payload.comparators.btc;
    expect(block.name).toBe("BTC-USD");
    expect(block.summary).toBeNull();
    expect(block.through).toBeNull();
    expect(block.joint).toBeNull();
    expect(block.cumulative).toBeNull();
    expect(Number.isNaN(payload.correlations.find((c) => c.name === "BTC")!.rho)).toBe(true);
  });

  it("the opt absent: BTC from BTC_DAILY, through clamped to its last close, windows past it null; SPX carries its own through", () => {
    const dates = days("2026-04-01", "2026-06-30");
    const payload = build(STRATEGY, dates);
    const fixtureLast = BTC_DAILY[BTC_DAILY.length - 1].date;
    expect(payload.comparators.btc.through).toBe(fixtureLast);
    expect(payload.comparators.btc.summary!.mtd).toBeNull();
    expect(payload.comparators.spx.through).toBe(SYN_SPX[SYN_SPX.length - 1].date);
    expect(payload.comparators.spx.summary!.p3m).toBeNull();
    const inside = build(STRATEGY, days("2026-03-01", "2026-04-30"));
    expect(inside.comparators.btc.through).toBe("2026-04-30");
    expect(inside.comparators.btc.summary!.mtd).not.toBeNull();
  });
});

describe("169.5-01 D-59: a comparator's summary annualizes on the smaller of the two bases", () => {
  it("7-day strategy vs the weekday SPX shape: SPX ann_vol and sharpe on 252, joint on 365", () => {
    const dates = days("2026-03-02", "2026-03-31");
    const block = build(STRATEGY, dates).comparators.spx;
    expect(block.summary!.ann_vol).toBeCloseTo(0.23196458527486924, 12);
    expect(block.summary!.sharpe).toBeCloseTo(0.4445740025160893, 12);
  });

  it("weekday strategy vs 7-day BTC (amendment): BTC ann_vol and sharpe on 252, never BTC's own 365", () => {
    const dates = weekdays("2026-03-02", "2026-03-31");
    const btc = closes("2026-02-20", "2026-04-10", false, 4242);
    const block = build(WEEKDAY_STRATEGY, dates, opt(btc)).comparators.btc;
    expect(block.summary!.ann_vol).toBeCloseTo(0.3295726382836115, 12);
    expect(block.summary!.sharpe).toBeCloseTo(-3.2996046778540213, 12);
  });

  it("index 0 (D-64, 166.4 D-05): Saturday start null; Tuesday and Monday start the comparator's own return; BTC with no prior close null", () => {
    const sat = alignCoveredReturns(SYN_SPX, [], days("2026-03-07", "2026-03-12"), CALENDAR_WEEKDAY);
    expect(sat.returns[0]).toBeNull();
    expect(sat.paired[0]).toBe(false);
    const tue = alignCoveredReturns(SYN_SPX, [], days("2026-03-03", "2026-03-08"), CALENDAR_WEEKDAY);
    expect(tue.returns[0]).toBeCloseTo(0.020319004939995722, 12);
    expect(tue.paired[0]).toBe(true);
    const mon = alignCoveredReturns(SYN_SPX, [], days("2026-03-02", "2026-03-08"), CALENDAR_WEEKDAY);
    expect(mon.returns[0]).toBeCloseTo(0.004702994841308872, 12);
    expect(mon.paired[0]).toBe(true);
    const firstClose = alignCoveredReturns(
      [
        { date: "2026-03-01", close: 100 },
        { date: "2026-03-02", close: 104 },
      ],
      [],
      ["2026-03-01", "2026-03-02"],
      CALENDAR_7D,
    );
    expect(firstClose.returns[0]).toBeNull();
    expect(firstClose.paired[0]).toBe(false);
    expect(firstClose.returns[1]).toBeCloseTo(0.040000000000000036, 12);
  });
});
