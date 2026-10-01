import { describe, it, expect } from "vitest";
import { bootstrapCI } from "./bootstrap";
import { arithmeticUnderwater, cumEq, drawdowns } from "./compute";

/**
 * Phase 169.1 plan 07 (D-34, D-36) — `bootstrapCI`'s optional cumulative method.
 *
 * Under "arithmetic" the drawdown each resample (and the point) is scored with
 * is the running-sum underwater the arithmetic headline and chart use, so the
 * point Max DD equals the headline beside it. The method moves ONLY the
 * drawdown: Sharpe and Sortino do not depend on how returns compound. Without
 * the argument the output is the geometric one every existing caller (the
 * Scenario builder among them) relies on.
 */

const rets = Array.from({ length: 260 }, (_, i) => -0.003 + Math.sin(i * 0.23) * 0.015 + Math.cos(i * 0.05) * 0.004);
const minOf = (xs: number[]) => xs.reduce((m, x) => (x < m ? x : m), 0);
const P = 365;

describe("bootstrapCI's cumulative method (D-34)", () => {
  it("fixture is load-bearing: its arithmetic and geometric troughs differ", () => {
    expect(Math.abs(minOf(arithmeticUnderwater(rets)) - minOf(drawdowns(cumEq(rets))))).toBeGreaterThan(1e-3);
  });

  it("arithmetic: the point Max DD is the minimum of arithmeticUnderwater", () => {
    const b = bootstrapCI(rets, 2000, 5, 42, P, "arithmetic");
    expect(b.max_dd.point).toBe(minOf(arithmeticUnderwater(rets)));
  });

  it("arithmetic: Sharpe and Sortino (point, lo, hi, hist) are exactly the geometric call's; n and the sizes do not move", () => {
    const a = bootstrapCI(rets, 2000, 5, 42, P, "arithmetic");
    const g = bootstrapCI(rets, 2000, 5, 42, P);
    expect(a.sharpe).toEqual(g.sharpe);
    expect(a.sortino).toEqual(g.sortino);
    expect([a.n, a.n_resamples, a.block_len]).toEqual([g.n, g.n_resamples, g.block_len]);
    // ...and the drawdown distribution does move, so the method reached the resamples too.
    expect(a.max_dd.lo).not.toBe(g.max_dd.lo);
  });

  it("without the method the output is the geometric one (the default every existing caller gets)", () => {
    const d = bootstrapCI(rets, 2000, 5, 42, P);
    expect(d).toEqual(bootstrapCI(rets, 2000, 5, 42, P, "geometric"));
    expect(d.max_dd.point).toBe(minOf(drawdowns(cumEq(rets))));
  });

  it("zero invariance: inserting 0.0 days moves no point Max DD, under either method", () => {
    const twin: number[] = [];
    rets.forEach((r, i) => {
      twin.push(r);
      if (i % 9 === 4) twin.push(0, 0);
    });
    expect(twin.length).toBeGreaterThan(rets.length);
    for (const m of ["geometric", "arithmetic"] as const) {
      expect(bootstrapCI(twin, 2000, 5, 42, P, m).max_dd.point).toBe(bootstrapCI(rets, 2000, 5, 42, P, m).max_dd.point);
    }
  });
});
