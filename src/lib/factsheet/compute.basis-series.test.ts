import { describe, it, expect } from "vitest";
import { compute, metricsBasisSeries } from "./compute";

/**
 * Phase 169.1 plan 06 (D-32, D-33, D-39, D-36) — `metricsBasisSeries` is the ONE
 * place the series behind the headline risk statistics (and the rolling Sharpe,
 * and on a composite the rolling volatility and Sortino) is chosen. It mirrors
 * the engine: `stat_returns` under the active basis, and for a composite the
 * `gap_fill_daily_returns` zero-filled calendar series the stitch hands
 * `compute_all_metrics`. These cases pin every branch; the zero-filled twin is
 * built here by hand, never by the helper.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const P = 365;

// 12 present days over 16 calendar days: absent offsets 3, 7, 8 and 13.
const OFFSETS = [0, 1, 2, 4, 5, 6, 9, 10, 11, 12, 14, 15];
const RETS = [0.012, -0.004, 0.007, 0, -0.011, 0.003, 0.009, -0.006, 0.002, 0.015, -0.008, 0.004];
const DATES = OFFSETS.map((o) => addDays("2025-02-01", o));
const TWIN = Array.from({ length: 16 }, (_, o) => {
  const i = OFFSETS.indexOf(o);
  return i < 0 ? 0 : RETS[i];
});
const TWIN_DATES = Array.from({ length: 16 }, (_, o) => addDays("2025-02-01", o));
const ACTIVE = RETS.filter((r) => r !== 0);

describe("metricsBasisSeries, calendar basis with calendarDense (D-32)", () => {
  it("one entry per calendar day from the first to the last date: 0.0 on every absent day, the present return elsewhere; positions are day offsets", () => {
    const b = metricsBasisSeries(RETS, DATES, { calendarDense: true });
    expect(b.returns).toEqual(TWIN);
    expect(b.positions).toEqual(OFFSETS);
    // and through the explicit calendar basis
    expect(metricsBasisSeries(RETS, DATES, { dayBasis: "calendar", calendarDense: true })).toEqual(b);
  });

  it("a gapless series gives its own returns and the identity positions", () => {
    const b = metricsBasisSeries(TWIN, TWIN_DATES, { calendarDense: true });
    expect(b.returns).toEqual(TWIN);
    expect(b.positions).toEqual(TWIN.map((_, i) => i));
  });

  it("a duplicate or a decreasing date throws (the engine's index is sorted and unique)", () => {
    const dup = [...DATES];
    dup[5] = dup[4];
    expect(() => metricsBasisSeries(RETS, dup, { calendarDense: true })).toThrow(/strictly increasing/);
    const back = [...DATES];
    back[6] = addDays(DATES[0], 1);
    expect(() => metricsBasisSeries(RETS, back, { calendarDense: true })).toThrow(/strictly increasing/);
    expect(() => compute(RETS, back, 0, P, { calendarDense: true })).toThrow(/strictly increasing/);
  });
});

describe("metricsBasisSeries, the other branches", () => {
  it("without calendarDense, and with no conventions: rets itself with identity positions (byte-identical default)", () => {
    for (const c of [undefined, {}, { calendarDense: false }, { dayBasis: "calendar" as const }]) {
      const b = metricsBasisSeries(RETS, DATES, c);
      expect(b.returns).toBe(RETS);
      expect(b.positions).toEqual(RETS.map((_, i) => i));
    }
  });

  it("active with calendarDense is identical to active without it: the non-zero finite returns (a filled 0.0 would be excluded anyway)", () => {
    const dense = metricsBasisSeries(RETS, DATES, { dayBasis: "active", calendarDense: true });
    expect(dense).toEqual(metricsBasisSeries(RETS, DATES, { dayBasis: "active" }));
    expect(dense.returns).toEqual(ACTIVE);
    expect(dense.positions[3]).toBeNull();
  });
});

describe("compute() with calendarDense: the risk statistics over the zero-filled twin, nothing else moved (D-32, D-36 W2)", () => {
  const dense = compute(RETS, DATES, 0, P, { calendarDense: true });
  const twin = compute(TWIN, TWIN_DATES, 0, P);
  const plain = compute(RETS, DATES, 0, P);

  it("ann_vol, sharpe and sortino equal compute() of the zero-filled twin, and differ from the present-day figures", () => {
    for (const k of ["ann_vol", "sharpe", "sortino"] as const) {
      expect(dense[k], k).toBeCloseTo(twin[k], 12);
      expect(Math.abs(dense[k] - plain[k]), `${k} must move`).toBeGreaterThan(1e-6);
    }
  });

  it("skew, kurt, var95, cvar95, win_rate and profit_factor keep their no-conventions values on rets", () => {
    for (const k of ["skew", "kurt", "var95", "cvar95", "win_rate", "profit_factor"] as const) {
      expect(dense[k], k).toBe(plain[k]);
    }
  });
});
