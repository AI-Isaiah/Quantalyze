import { describe, it, expect } from "vitest";
import { buildComparatorBlock } from "./comparator-block";
import { alignCoveredReturns } from "./align";
import { compute, cumEq } from "./compute";
import type { DailyPrice } from "./types";

/**
 * Phase 169.5 plan 01 (SC3, D-09, D-54): a comparator block is measured only over
 * the span its prices cover, carries `through` (its last close on or before the
 * strategy's last date), and shows no window past `through`.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const days = (a: string, n: number) => Array.from({ length: n }, (_, i) => addDays(a, i));

/** Closes on `n` consecutive days from `start`, alternating up and down moves. */
function prices(start: string, n: number): DailyPrice[] {
  let c = 100;
  return days(start, n).map((date, i) => {
    c = c * (1 + (i % 3 === 0 ? 0.02 : i % 3 === 1 ? -0.015 : 0.005));
    return { date, close: c };
  });
}

const DATES = days("2026-01-01", 200); // to 2026-07-19
const STRAT = DATES.map((_, i) => ((i % 7) - 3) / 200);

function block(p: DailyPrice[]) {
  const a = alignCoveredReturns(p, [], DATES);
  return { a, b: buildComparatorBlock("BTC-USD", "BTC", a, STRAT, cumEq(STRAT), DATES, 0.2, 30, 60, 365, 365) };
}

describe("169.5-01 comparator coverage: span edges and `through`", () => {
  it("prices fully covering the strategy: through is the strategy's last date, windows numeric", () => {
    const { b } = block(prices("2025-12-31", 202));
    expect(b.through).toBe(DATES[DATES.length - 1]);
    expect(b.summary!.mtd).not.toBeNull();
    expect(b.summary!.p3m).not.toBeNull();
  });

  it("prices ending before the strategy: through is their last close, windows null, the summary over covered days only", () => {
    const p = prices("2025-12-31", 150); // last close 2026-05-29
    const { a, b } = block(p);
    expect(b.through).toBe("2026-05-29");
    expect(b.through! <= DATES[DATES.length - 1]).toBe(true);
    for (const w of ["mtd", "ytd", "p3m", "p6m", "p1y"] as const) expect(b.summary![w], w).toBeNull();
    const covIdx = DATES.map((_, i) => i).filter((i) => DATES[i] <= "2026-05-29");
    const covRets = covIdx.map((i) => a.returns[i] as number);
    const covDates = covIdx.map((i) => DATES[i]);
    expect(b.summary!.win_rate).toBe(compute(covRets, covDates, 0, 365).win_rate);
  });

  it("prices starting after the strategy: the early dates are uncovered, not 0% days", () => {
    const p = prices("2026-03-01", 200);
    const { a, b } = block(p);
    const firstCovered = a.returns.findIndex((r) => r !== null);
    expect(DATES[firstCovered]).toBe("2026-03-02");
    const covIdx = DATES.map((_, i) => i).filter((i) => a.returns[i] !== null);
    const covRets = covIdx.map((i) => a.returns[i] as number);
    const covDates = covIdx.map((i) => DATES[i]);
    expect(b.summary!.ann_vol).toBeCloseTo(compute(covRets, covDates, 0, 365).ann_vol, 12);
    expect(b.through).toBe(DATES[DATES.length - 1]);
  });

  it("RESEARCH A7: cumulative return and annualised volatility are different numbers", () => {
    const { b } = block(prices("2025-12-31", 202));
    expect(Number.isFinite(b.summary!.cum_ret)).toBe(true);
    expect(b.summary!.cum_ret).not.toBeCloseTo(b.summary!.ann_vol, 6);
  });

  it("no close at all on or before the strategy's last date: summary and joint null, through null", () => {
    const { b } = block(prices("2027-01-01", 10));
    expect(b.summary).toBeNull();
    expect(b.joint).toBeNull();
    expect(b.through).toBeNull();
  });
});

/**
 * Phase 169.5 review WR-01: "past coverage" is read on the comparator's OWN calendar.
 * A 7-day strategy ending on Sunday 2025-03-16, against the real SPX fixture (weekday
 * closes, well inside its coverage): SPX's last close is Friday 2025-03-14, and no
 * SPX trading day lies in (Fri, Sun], so every window is a number. The genuine gap
 * (the same strategy extended to Tuesday 2025-03-18, SPX cut at the Friday) still
 * nulls the windows, so the rule is not a blanket "covered".
 */
describe("169.5 review WR-01: past coverage on the comparator's own calendar", () => {
  // 2024-03-01 .. 2025-03-16 (a Sunday): over a year, so every window has history.
  const WEEKS = days("2024-03-01", 381);
  const W_STRAT = WEEKS.map((_, i) => ((i % 5) - 2) / 300);
  const WINDOWS = ["mtd", "ytd", "p3m", "p6m", "p1y"] as const;

  function spxBlock(spx: DailyPrice[], dates: string[], strat: number[]) {
    const a = alignCoveredReturns(spx, [], dates);
    return { a, b: buildComparatorBlock("S&P 500", "SPX", a, strat, cumEq(strat), dates, 0.2, 30, 60, 365, 252) };
  }

  it("SPX through Friday covers a 7-day strategy ending that Sunday: windows numeric", async () => {
    const { SPX_DAILY } = await import("./benchmarks");
    expect(WEEKS[WEEKS.length - 1]).toBe("2025-03-16");
    const { a, b } = spxBlock(SPX_DAILY, WEEKS, W_STRAT);
    expect(b.through).toBe("2025-03-14");
    expect(a.coveredToEnd).toBe(true);
    for (const w of WINDOWS) expect(b.summary![w], w).not.toBeNull();
  });

  it("a real gap (SPX cut at Friday, strategy ends the next Tuesday) still nulls every window", async () => {
    const { SPX_DAILY } = await import("./benchmarks");
    const dates = days("2024-03-01", 383); // to Tuesday 2025-03-18
    const strat = dates.map((_, i) => ((i % 5) - 2) / 300);
    const { a, b } = spxBlock(SPX_DAILY.filter((p) => p.date <= "2025-03-14"), dates, strat);
    expect(b.through).toBe("2025-03-14");
    expect(a.coveredToEnd).toBe(false);
    for (const w of WINDOWS) expect(b.summary![w], w).toBeNull();
  });
});
