import { describe, it, expect } from "vitest";

/**
 * Phase 169.4 ALLOCTRUTH plan 05 (169.5 D-65, routed here; 169.4 D-70(1)): the api
 * arm's event signatures read the null-honest BTC alignment, so a missing BTC day
 * (a dropped close, a day past BTC's last close, day one without a prior close) is
 * a skipped event or a dropped trace, never a 0% day in SignaturePanels or
 * CrossSignaturePanels.
 *
 * The expected figures are computed here from `computeEventSignatures` on the
 * alignment `alignCoveredReturns` gives, and the 0-filled figures beside them prove
 * the case can tell the two apart (SC9: re-introducing the 0-fill turns it RED).
 */

import { buildFactsheetPayload } from "./build-payload";
import type { BenchmarkPricesOpt } from "./build-payload";
import { alignCoveredReturns, COMPARATOR_CALENDARS } from "./align";
import { computeEventSignatures } from "./event-signatures";
import { cumEq } from "./compute";
import type { AllocatorPortfolioPayload, DailyPrice, DailyReturn, EventSignaturesPayload } from "./types";
import { GLD_DAILY, IEF_DAILY, SPX_DAILY } from "./benchmarks";

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const START = "2026-03-01";
const N = 80;
const DATES = Array.from({ length: N }, (_, i) => addDays(START, i));
const DROPPED = DATES[40];

/** Deterministic non-zero strategy returns, so every day is a win or a loss event. */
function strategyRows(): DailyReturn[] {
  let x = 20260930;
  return DATES.map((date) => {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    const v = Math.round((x / 0x7fffffff - 0.5) * 0.08 * 1e6) / 1e6;
    return { date, value: v === 0 ? 0.001 : v };
  });
}

/** Deterministic BTC closes from the day before the first date to the last date. */
function btcCloses(): DailyPrice[] {
  let x = 4242;
  let c = 60000;
  const out: DailyPrice[] = [];
  for (let i = -1; i < N; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    c = Math.round(c * (1 + (x / 0x7fffffff - 0.5) * 0.06) * 100) / 100;
    out.push({ date: addDays(START, i), close: c });
  }
  return out;
}

const STRATEGY = {
  id: "s-169-4-05",
  name: "Null Honest Signatures",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

const total = (s: EventSignaturesPayload | null | undefined) => {
  if (!s) throw new Error("signatures must be present on the api arm");
  return { h1: s.h1.winCount + s.h1.lossCount, h7: s.h7.winCount + s.h7.lossCount };
};

describe("169.4-05: the api arm's event signatures skip a missing BTC day (D-65, D-70(1))", () => {
  it("one dropped BTC close mid-series: payload counts equal the null-honest computation and are strictly below the 0-filled one", () => {
    const rows = strategyRows();
    const all = btcCloses();
    const prices = all.filter((p) => p.date !== DROPPED);
    const opt: BenchmarkPricesOpt = { prices, through: prices[prices.length - 1].date, dropped: [DROPPED] };
    const payload = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: opt });
    if (!payload || payload.ingestSource !== "api") throw new Error("fixture must build on the api arm");

    const strat = rows.map((r) => r.value);
    const al = alignCoveredReturns(prices, [DROPPED], DATES, COMPARATOR_CALENDARS.btc);
    // The dropped close nulls both intervals touching it, and nothing else.
    expect(al.returns.map((r, i) => (r === null ? i : -1)).filter((i) => i >= 0)).toEqual([40, 41]);
    const filled = al.returns.map((r) => r ?? 0);

    const honestStrat = computeEventSignatures(strat, al.returns, cumEq(strat));
    const zeroStrat = computeEventSignatures(strat, filled, cumEq(strat));
    const honestBench = computeEventSignatures(al.returns, al.returns, cumEq(filled));
    const zeroBench = computeEventSignatures(filled, filled, cumEq(filled));

    // Window-eligible events 14..65 (52); traces reading index 40 or 41 are 26..54 (29).
    expect(total(honestStrat).h1).toBe(52 - 29);
    expect(total(zeroStrat).h1).toBe(52);

    // SignaturePanels (strategy events, BTC traces).
    expect(total(payload.eventSignatures)).toEqual(total(honestStrat));
    expect(total(payload.eventSignatures).h1).toBeLessThan(total(zeroStrat).h1);
    expect(payload.eventSignatures!.h1.winOfBenchmark).toEqual(honestStrat.h1.winOfBenchmark);

    // CrossSignaturePanels (BTC's own events).
    expect(total(payload.benchEventSignatures)).toEqual(total(honestBench));
    expect(payload.benchEventSignatures!.h1.eligibleWinCount + payload.benchEventSignatures!.h1.eligibleLossCount).toBe(
      honestBench.h1.eligibleWinCount + honestBench.h1.eligibleLossCount,
    );
    expect(payload.benchEventSignatures!.h7.eligibleWinCount + payload.benchEventSignatures!.h7.eligibleLossCount).toBeLessThan(
      zeroBench.h7.eligibleWinCount + zeroBench.h7.eligibleLossCount,
    );
    expect(payload.benchEventSignatures!.h1.winOfEquity).toEqual(honestBench.h1.winOfEquity);
    expect(payload.benchEventSignatures!.h1.winOfEquity).not.toEqual(zeroBench.h1.winOfEquity);
  });
});

/**
 * Phase 169.4 ALLOCTRUTH plan 06 (169.5 D-65, routed here; 169.4 D-70(2)-(4), SC9):
 * the api arm's allocator portfolios blend on their legs' common calendar. The
 * strategy below runs 2026-04-01 .. 2026-05-30, past the SPX, GLD and IEF
 * fixtures' last close (2026-05-08), every day of the week. BTC is handed in for
 * the whole range, so every null here is a weekday leg's own.
 *
 * The expected multi_asset figures are computed here from `alignCoveredReturns`
 * per leg on the weekday dates (not through `alignBlend`), and the 0-filled figure
 * beside them (every leg on the 7-day dates, nulls as 0, the old path) proves the
 * case tells the two apart: re-introducing the 0-fill turns it RED.
 */
describe("169.4-06: the api arm's allocator blends skip every missing leg day (D-65, D-70(2)-(4))", () => {
  const A_START = "2026-04-01";
  const A_N = 60;
  const A_DATES = Array.from({ length: A_N }, (_, i) => addDays(A_START, i));
  const weekdayOf = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`)).getUTCDay();

  function aRows(): DailyReturn[] {
    let x = 16906;
    return A_DATES.map((date) => {
      x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
      return { date, value: Math.round((x / 0x7fffffff - 0.5) * 0.04 * 1e6) / 1e6 };
    });
  }
  function aBtc(): DailyPrice[] {
    let x = 777;
    let c = 80000;
    const out: DailyPrice[] = [];
    for (let i = -1; i < A_N; i++) {
      x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
      c = Math.round(c * (1 + (x / 0x7fffffff - 0.5) * 0.05) * 100) / 100;
      out.push({ date: addDays(A_START, i), close: c });
    }
    return out;
  }
  const portfolio = (p: ReturnType<typeof buildFactsheetPayload>, key: string): AllocatorPortfolioPayload => {
    if (!p || p.ingestSource !== "api" || !p.allocatorPortfolios) throw new Error("fixture must build on the api arm");
    const hit = p.allocatorPortfolios.find((x) => x.key === key);
    if (!hit) throw new Error(`no ${key} portfolio`);
    return hit;
  };
  const popSd = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  };

  it("multi_asset: cum_ret and ann_vol are over the covered weekdays only on 252, and differ from the 0-filled series", () => {
    const rows = aRows();
    const btc = aBtc();
    const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
    const payload = buildFactsheetPayload({ ...STRATEGY, id: "s-169-4-06" }, rows, { benchmarkPrices: opt });
    const got = portfolio(payload, "multi_asset");

    // Honest: every leg on the weekday dates through the one alignment; a blend day
    // counts only when all four legs are non-null.
    const wk = A_DATES.filter((d) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5);
    const legs = [
      alignCoveredReturns(SPX_DAILY, [], wk, COMPARATOR_CALENDARS.spx).returns,
      alignCoveredReturns(GLD_DAILY, [], wk, COMPARATOR_CALENDARS.gld).returns,
      alignCoveredReturns(IEF_DAILY, [], wk, COMPARATOR_CALENDARS.ief).returns,
      alignCoveredReturns(btc, [], wk, COMPARATOR_CALENDARS.btc).returns,
    ];
    const covered: number[] = [];
    wk.forEach((_, i) => {
      if (legs.every((l) => l[i] !== null)) covered.push(legs.reduce((a, l) => a + 0.25 * (l[i] as number), 0));
    });
    // The fixtures end 2026-05-08: the covered days stop there, well short of wk.
    expect(covered.length).toBeGreaterThan(20);
    expect(covered.length).toBeLessThan(wk.length - 10);
    const honestCum = covered.reduce((a, r) => a * (1 + r), 1) - 1;

    // The old path: every leg on the 7-day dates, a null entered as 0.
    const zero = (prices: DailyPrice[], cal: typeof COMPARATOR_CALENDARS.spx) =>
      alignCoveredReturns(prices, [], A_DATES, cal).returns.map((r) => r ?? 0);
    const zLegs = [zero(SPX_DAILY, COMPARATOR_CALENDARS.spx), zero(GLD_DAILY, COMPARATOR_CALENDARS.gld), zero(IEF_DAILY, COMPARATOR_CALENDARS.ief), zero(btc, COMPARATOR_CALENDARS.btc)];
    const zeroBlend = A_DATES.map((_, i) => zLegs.reduce((a, l) => a + 0.25 * l[i], 0));
    const zeroCum = zeroBlend.reduce((a, r) => a * (1 + r), 1) - 1;

    expect(got.cum_ret).toBeCloseTo(honestCum, 12);
    expect(Math.abs(honestCum - zeroCum)).toBeGreaterThan(1e-4);
    expect(got.cum_ret).not.toBeCloseTo(zeroCum, 6);
    // D-70(3): 252 (founder ruling 2026-09-30), not BLEND-02's 365.
    expect(got.ann_vol).toBeCloseTo(popSd(covered) * Math.sqrt(252), 12);
    expect(got.through).toBe("2026-05-08");
  });

  it("a strategy wholly past the fixtures: 60/40 and crypto_book carry null figures and a dated through, never a 0% blend", () => {
    const dates = Array.from({ length: 30 }, (_, i) => addDays("2026-06-01", i));
    const rows = dates.map((date, i) => ({ date, value: ((i % 5) - 2) / 1000 }));
    const btc: DailyPrice[] = Array.from({ length: 31 }, (_, i) => ({ date: addDays("2026-05-31", i), close: 90000 + ((i * 37) % 11) * 250 }));
    const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
    const payload = buildFactsheetPayload({ ...STRATEGY, id: "s-169-4-06-b" }, rows, { benchmarkPrices: opt });
    const sf = portfolio(payload, "sixty_forty");
    for (const k of ["ann_vol", "cum_ret", "max_dd", "corr", "sleeve_pct", "blend_vol", "tail_count", "tail_mm_mean", "tail_mm_median", "tail_mm_pos"] as const) {
      expect(sf[k], k).toBeNull();
    }
    expect(sf.through).toBe("2026-05-08");
    // ETH's fixture ends 2026-05-11: crypto_book is unmeasurable too, and says so.
    const cb = portfolio(payload, "crypto_book");
    expect(cb.cum_ret).toBeNull();
    expect(cb.through).toBe("2026-05-11");
  });
});
