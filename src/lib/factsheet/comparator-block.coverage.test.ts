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
