import { describe, it, expect } from "vitest";
import { computePeerPercentile } from "./peer-cohort";

/**
 * Phase 164.6.6.3.3 plan 15 (D-15 extended again, T-164.6.6.3.3-38). On a Withheld api row
 * the read path redacts the seven headline scalars, so `max_dd` reaches `computePeerPercentile`
 * as NaN. `percentileRank(NaN, ...)` counts no peer as `<= NaN` and reports 0, which the panel
 * prints as a fabricated "0th" (worst in the cohort). A NaN has no rank: it must stay NaN so
 * the bar reads "—", exactly as Sharpe and Sortino already do (founder decision D7).
 */
describe("computePeerPercentile: a non-finite max_dd has no rank", () => {
  it("a NaN max_dd ranks as NaN, never the 0th percentile", () => {
    expect(computePeerPercentile(1, 1, NaN).max_dd).toBeNaN();
  });

  it("contrast: a finite max_dd keeps a finite rank, so the NaN above is the guard and not a broken cohort", () => {
    const r = computePeerPercentile(1, 1, -0.1).max_dd;
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThan(0);
  });

  it("the Sharpe and Sortino guards it mirrors are unchanged (NaN in, NaN out)", () => {
    const r = computePeerPercentile(NaN, NaN, -0.1);
    expect(r.sharpe).toBeNaN();
    expect(r.sortino).toBeNaN();
  });
});
