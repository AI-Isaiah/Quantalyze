import { describe, it, expect } from "vitest";
import { drawdowns, findDrawdownPeriods, worstDrawdowns, cumEq } from "./compute";

describe("findDrawdownPeriods", () => {
  it("returns one period for a single drawdown that recovers", () => {
    const dd = drawdowns(cumEq([0.1, -0.5, 0.6, 0.1]));
    const periods = findDrawdownPeriods(dd);
    expect(periods.length).toBe(1);
    expect(periods[0].depth).toBeCloseTo(-0.5, 6);
  });

  it("captures an open drawdown that never recovers", () => {
    const dd = drawdowns(cumEq([0.1, -0.3, -0.1]));
    const periods = findDrawdownPeriods(dd);
    expect(periods.length).toBe(1);
    expect(periods[0].recover).toBe(dd.length - 1);
  });

  it("worstDrawdowns returns the deepest N, sorted by depth", () => {
    // 3 distinct dd periods with recoveries to new peaks between them.
    const dd = drawdowns(cumEq([0.1, -0.05, 0.06, -0.1, 0.2, -0.3, 0.4, 0.5]));
    const worst = worstDrawdowns(dd, 2);
    expect(worst.length).toBe(2);
    expect(worst[0].depth).toBeLessThanOrEqual(worst[1].depth);
    expect(worst[0].depth).toBeLessThan(-0.2);
  });
});
