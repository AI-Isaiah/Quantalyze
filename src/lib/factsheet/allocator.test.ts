import { describe, it, expect } from "vitest";
import { alignBlend, blend, buildAllocatorMetrics, comparatorLeg } from "./allocator";
import type { DailyPrice } from "./types";

/**
 * #597 part 2 (BLEND-02) — buildAllocatorMetrics is the reference-panel math
 * behind build-payload.ts's `allocatorPortfolios`. The locked leg-decided
 * ruling: the 60/40 pure-tradfi panel stays √252 (byte-identical), the
 * BTC-legged all-weather + BTC/ETH panels ride √365. These tests pin:
 *   (1) default-identity: the trailing `periodsPerYear` param defaults to 252
 *       so the 60/40 call (which passes NO arg) is unchanged.
 *   (2) the √365 scaling of the frequency-annualized vols (ann_vol / blend_vol).
 *   (3) invariance of the basis-free metrics (cum_ret / max_dd / corr / tails).
 */
describe("blend", () => {
  it("weights multiple equal-length series pointwise", () => {
    expect(blend([0.5, 0.5], [[0.1, -0.2], [0.3, 0.4]])).toEqual([0.2, 0.1]);
  });
  it("throws on a weight/series length mismatch", () => {
    expect(() => blend([1], [[0.1], [0.2]])).toThrow();
  });
  it("is null on a day any leg is null, never reading the missing leg as 0 (D-70(2))", () => {
    expect(blend([0.5, 0.5], [[0.1, null], [0.3, 0.4]])).toEqual([0.2, null]);
  });
});

describe("buildAllocatorMetrics — asset-class annualization basis (BLEND-02)", () => {
  // A LOW-volatility fixture: daily std is small enough that the annualized
  // blend vols stay well BELOW the VOL_TARGET (0.18) at BOTH the 252 and 365
  // bases. That matters for the sleeve grid-scan: since every candidate blend
  // vol v(w) is below target at both bases and v(w) scales by the SAME √N factor
  // across all w, the grid's argmin |v(w) − target| (== argmax v here) is
  // scale-STABLE for THIS fixture — so sleeve_pct is identical and blend_vol
  // scales cleanly. This is a property of the engineered fixture, NOT a general
  // invariance claim (a near-target fixture could legitimately shift sleeve_pct).
  const N = 40;
  const rets = Array.from({ length: N }, (_, i) => 0.002 * Math.sin(i / 3) + 0.0005);
  const mm = Array.from({ length: N }, (_, i) => 0.0015 * Math.cos(i / 4) - 0.0003);

  const RATIO = Math.sqrt(365 / 252);

  it("defaults to the 252 basis (byte-identical to an explicit 252 call)", () => {
    const implicit = buildAllocatorMetrics(rets, mm);
    const explicit252 = buildAllocatorMetrics(rets, mm, 252);
    expect(implicit).toEqual(explicit252);
  });

  it("ann_vol and blend_vol scale ×√(365/252) at the crypto basis", () => {
    const at252 = buildAllocatorMetrics(rets, mm, 252);
    const at365 = buildAllocatorMetrics(rets, mm, 365);

    // Falsifiable: the two bases genuinely differ (a still-hardcoded √252 impl
    // would leave ann_vol identical and fail here).
    expect(at365.ann_vol).not.toBe(at252.ann_vol);

    expect(at365.ann_vol! / at252.ann_vol!).toBeCloseTo(RATIO, 12);
    // Sleeve grid-scan is scale-stable for this sub-target fixture (see header),
    // so the chosen blend_vol scales by the same √N factor.
    expect(at365.sleeve_pct).toBe(at252.sleeve_pct);
    expect(at365.blend_vol! / at252.blend_vol!).toBeCloseTo(RATIO, 12);
    // Both annualized vols stay under the 0.18 target at both bases (the premise
    // of the scale-stable argmax above).
    expect(at365.ann_vol).toBeLessThan(0.18);
  });

  it("cum_ret / max_dd / corr / tail_* are basis-free (identical across 252 and 365)", () => {
    const at252 = buildAllocatorMetrics(rets, mm, 252);
    const at365 = buildAllocatorMetrics(rets, mm, 365);
    expect(at365.cum_ret).toBe(at252.cum_ret);
    expect(at365.max_dd).toBe(at252.max_dd);
    expect(at365.corr).toBe(at252.corr);
    expect(at365.tail_count).toBe(at252.tail_count);
    expect(at365.tail_mm_mean).toBe(at252.tail_mm_mean);
    expect(at365.tail_mm_median).toBe(at252.tail_mm_median);
    expect(at365.tail_mm_pos).toBe(at252.tail_mm_pos);
  });
});

/**
 * Phase 169.4 ALLOCTRUTH plan 06 (169.5 D-65, routed here; 169.4 D-70(2)-(4)): a
 * blend is built on its legs' COMMON calendar through the one alignment, and its
 * figures skip every null. Before, every leg was 0-filled onto the strategy's own
 * 7-day dates, so a weekday leg's weekend and every day past a fixture's last close
 * read as a 0% day.
 */
describe("alignBlend: the legs' common calendar (D-70(2), D-70(3))", () => {
  // Fri 2026-01-02 .. Mon 2026-01-12, a 7-day book.
  const DATES = [
    "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06", "2026-01-07",
    "2026-01-08", "2026-01-09", "2026-01-10", "2026-01-11", "2026-01-12",
  ];
  const STRAT = [0.01, -0.005, 0.002, 0.003, -0.01, 0.004, 0.006, -0.002, 0.001, 0.003, -0.004];
  const BTC_CLOSES = [100, 101, 103, 102, 104, 107, 105, 106, 108, 110, 109, 111];
  const BTC: DailyPrice[] = BTC_CLOSES.map((close, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, close }));
  // Weekday closes only: Thu 1, Fri 2, Mon 5 .. Fri 9, Mon 12.
  const SPX: DailyPrice[] = [
    { date: "2026-01-01", close: 200 },
    { date: "2026-01-02", close: 202 },
    { date: "2026-01-05", close: 199 },
    { date: "2026-01-06", close: 201 },
    { date: "2026-01-07", close: 204 },
    { date: "2026-01-08", close: 203 },
    { date: "2026-01-09", close: 206 },
    { date: "2026-01-12", close: 205 },
  ];
  const WEEKDAYS = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12"];

  it("multi_asset on a 7-day book: weekday blend dates, a Monday reads BTC over Friday-to-Monday, the book compounded over the same interval, basis 252", () => {
    // SPX at weight 0 fixes the calendar; the blend then IS the BTC leg.
    const a = alignBlend(DATES, STRAT, [comparatorLeg("spx", 0, SPX, []), comparatorLeg("btc", 1, BTC, [])]);
    expect(a.dates).toEqual(WEEKDAYS);
    expect(a.returns[0]).toBeCloseTo(101 / 100 - 1, 14); // BTC's own return dated the first date
    expect(a.returns[1]).toBeCloseTo(104 / 101 - 1, 14); // Mon 5 over Fri 2, not Sun 4
    expect(a.book[1]).toBeCloseTo((1 - 0.005) * (1 + 0.002) * (1 + 0.003) - 1, 12);
    expect(a.book[0]).toBeCloseTo(0.01, 12);
    expect(a.paired).toEqual([true, true, true, true, true, true, true]);
    expect(a.periodsPerYear).toBe(252);

    const four = alignBlend(DATES, STRAT, [
      comparatorLeg("spx", 0.25, SPX, []),
      comparatorLeg("gld", 0.25, SPX, []),
      comparatorLeg("ief", 0.25, SPX, []),
      comparatorLeg("btc", 0.25, BTC, []),
    ]);
    // Founder ruling 2026-09-30 ("Allow 252 here"): multi_asset is 252, not BLEND-02's 365.
    expect(four.periodsPerYear).toBe(252);
    expect(four.returns[1]).toBeCloseTo(0.75 * (199 / 202 - 1) + 0.25 * (104 / 101 - 1), 14);
  });

  it("crypto_book keeps every book date on 365; 60/40 is 252", () => {
    const crypto = alignBlend(DATES, STRAT, [comparatorLeg("btc", 0.7, BTC, []), comparatorLeg("eth", 0.3, BTC, [])]);
    expect(crypto.dates).toEqual(DATES);
    expect(crypto.periodsPerYear).toBe(365);
    expect(crypto.returns[2]).toBeCloseTo(102 / 103 - 1, 14);
    const sixtyForty = alignBlend(DATES, STRAT, [comparatorLeg("spx", 0.6, SPX, []), comparatorLeg("ief", 0.4, SPX, [])]);
    expect(sixtyForty.dates).toEqual(WEEKDAYS);
    expect(sixtyForty.periodsPerYear).toBe(252);
  });

  it("a leg past its last close ends the blend dates there, and `through` is the last date every leg covers", () => {
    // Review SFH HIGH-1: a blend date is a date every leg priced, so the days past
    // SPX's last close are not blend dates (before the fix they were null ones).
    const short = SPX.filter(p => p.date <= "2026-01-08");
    const a = alignBlend(DATES, STRAT, [comparatorLeg("spx", 0.5, short, []), comparatorLeg("btc", 0.5, BTC, [])]);
    expect(a.dates).toEqual(WEEKDAYS.filter(d => d <= "2026-01-08"));
    expect(a.returns.every(r => r !== null)).toBe(true);
    expect(a.through).toBe("2026-01-08");
    expect(a.book.every(b => b !== null)).toBe(true);
  });

  it("a weekday market holiday is not a blend date: the next date carries BTC's move across it (review SFH HIGH-1)", () => {
    // Mon 2026-01-05 is an SPX holiday: BTC has a close, SPX has none. BTC moves
    // 101 -> 104 Fri-to-Mon, then 104 -> 107 Mon-to-Tue.
    const holidaySpx = SPX.filter(p => p.date !== "2026-01-05");
    const a = alignBlend(DATES, STRAT, [comparatorLeg("spx", 0.5, holidaySpx, []), comparatorLeg("btc", 0.5, BTC, [])]);
    expect(a.dates).not.toContain("2026-01-05");
    const tue = a.dates.indexOf("2026-01-06");
    expect(a.dates[tue - 1]).toBe("2026-01-02");
    // Tuesday reads both legs Friday-to-Tuesday: BTC's holiday move is carried, not lost.
    expect(a.returns[tue]).toBeCloseTo(0.5 * (201 / 202 - 1) + 0.5 * (107 / 101 - 1), 14);
    expect(a.book[tue]).toBeCloseTo((1 - 0.005) * (1 + 0.002) * (1 + 0.003) * (1 - 0.01) - 1, 12);
    // No null left for the own-series figures to skip.
    expect(a.returns.every(r => r !== null)).toBe(true);
    // The known cost, pinned on purpose: SPX bridges ONE point over an interval its
    // weekday calendar expects TWO in, so Tuesday is unpaired and the correlation and
    // the sleeve scan skip it. The blend value itself is correct.
    expect(a.paired[tue]).toBe(false);
    // Crypto-only blends are unchanged: both legs price every day.
    const crypto = alignBlend(DATES, STRAT, [comparatorLeg("btc", 0.7, BTC, []), comparatorLeg("eth", 0.3, BTC, [])]);
    expect(crypto.dates).toEqual(DATES);
  });

  it("fewer than 2 usable days: every figure is null and `through` is still dated", () => {
    const one = SPX.filter(p => p.date <= "2026-01-02");
    const a = alignBlend(DATES, STRAT, [comparatorLeg("spx", 1, one, [])]);
    expect(a.returns.filter(r => r !== null)).toHaveLength(1);
    expect(a.through).toBe("2026-01-02");
    const m = buildAllocatorMetrics(a.returns, a.book, a.periodsPerYear, a.paired);
    for (const k of ["ann_vol", "cum_ret", "max_dd", "corr", "sleeve_pct", "blend_vol", "tail_count", "tail_windows", "tail_mm_mean", "tail_mm_median", "tail_mm_pos"] as const) {
      expect(m[k], k).toBeNull();
    }
  });
});

describe("buildAllocatorMetrics: each figure over its own index set (D-70(2))", () => {
  // Index 1 is null (a leg missing); index 4 is non-null but unpaired.
  const RETS = [0.01, null, 0.02, -0.01, 0.05];
  const MM = [-0.02, 0.0, -0.04, 0.02, -0.05];
  const PAIRED = [true, false, true, true, false];

  it("vol, cumulative return and drawdown use the non-null days only", () => {
    const m = buildAllocatorMetrics(RETS, MM, 252, PAIRED);
    expect(m.cum_ret).toBeCloseTo(1.01 * 1.02 * 0.99 * 1.05 - 1, 14);
    // Population variance of [0.01, 0.02, -0.01, 0.05] is 4.6875e-4.
    expect(m.ann_vol).toBeCloseTo(Math.sqrt(4.6875e-4 * 252), 12);
    expect(m.max_dd).toBeCloseTo(-0.01, 12);
  });

  it("the correlation and the sleeve scan use the paired days only", () => {
    const m = buildAllocatorMetrics(RETS, MM, 252, PAIRED);
    // Paired days 0, 2, 3: MM = -2 x RETS exactly.
    expect(m.corr).toBeCloseTo(-1, 12);
    // Blend vol at w is pVol * |1 - 3w| with pVol from [0.01, 0.02, -0.01]; the
    // closest to 0.18 on the 1% grid is w = 0.03.
    const mean = 0.02 / 3;
    const pVol = Math.sqrt((((0.01 - mean) ** 2 + (0.02 - mean) ** 2 + (-0.01 - mean) ** 2) / 3) * 252);
    expect(m.sleeve_pct).toBe(0.03);
    expect(m.blend_vol).toBeCloseTo(pVol * 0.91, 12);
  });

  it("a 21-day tail window holding a null is dropped", () => {
    const n = 30;
    const rets: Array<number | null> = new Array(n).fill(-0.003);
    rets[25] = null;
    const mm = new Array(n).fill(0.001);
    const m = buildAllocatorMetrics(rets, mm, 252);
    // Windows end at 21..29; the five ending at 25..29 hold index 25.
    expect(m.tail_count).toBe(4);
    // Review SFH HIGH-2: the examined count excludes the five dropped windows.
    expect(m.tail_windows).toBe(4);
    expect(m.tail_mm_mean).toBeCloseTo(1.001 ** 21 - 1, 14);
    expect(m.tail_mm_pos).toBe(1);
  });

  it("no stress window: mean, median and positive share are null, never 0, and the examined count is kept (review WR-02, SFH HIGH-2)", () => {
    // 30 days of +0.1%: every one of the 9 windows is examined, none draws 5%.
    const calm = buildAllocatorMetrics(new Array(30).fill(0.001), new Array(30).fill(-0.002), 252);
    expect(calm.tail_count).toBe(0);
    expect(calm.tail_windows).toBe(9);
    expect(calm.tail_mm_mean).toBeNull();
    expect(calm.tail_mm_median).toBeNull();
    expect(calm.tail_mm_pos).toBeNull();
    // Every window holds a null: nothing examined, and nothing is claimed about it.
    const gappy: Array<number | null> = Array.from({ length: 30 }, (_, i) => (i % 10 === 5 ? null : -0.01));
    const g = buildAllocatorMetrics(gappy, new Array(30).fill(0.001), 252);
    expect(g.tail_windows).toBe(0);
    // Review round 2 WR-01: zero windows examined is not a measured zero count.
    expect(g.tail_count).toBeNull();
    expect(g.tail_mm_mean).toBeNull();
  });
});
