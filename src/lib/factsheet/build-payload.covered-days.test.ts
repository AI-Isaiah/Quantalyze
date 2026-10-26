import { describe, it, expect } from "vitest";
import { deriveSeriesBundle } from "./build-payload";
import { compute } from "./compute";
import { rollingVol } from "./rolling";

/**
 * 167.2.1.1.1 round-1 WR-01 (D-15). The bundle the browser re-derives for a
 * zoom range, and the one the server builds for the rolling charts, must hand the
 * persisted gap spans to the calendar-dense series: a covered day (inside a mark's
 * single return) is dropped, a gap day is a flat 0.0. Offsets 10 and 11 are covered
 * days, 25 and 26 are the gap span; the server's scalar input is built by hand.
 */
const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const P = 365;
const START = "2025-03-01";
const ABSENT = new Set([10, 11, 25, 26]);
const OFFSETS = Array.from({ length: 44 }, (_, o) => o).filter((o) => !ABSENT.has(o));
const RETS = OFFSETS.map((o) => 0.002 * Math.sin(o * 1.7) + 0.003 * ((o % 5) - 2) / 2);
const clipped = OFFSETS.map((o, i) => ({ date: addDays(START, o), value: RETS[i] }));
const GAPS = [{ start: addDays(START, 25), end: addDays(START, 26), kind: "gap" as const, days: 2 }];
const SERVER_INPUT = Array.from({ length: 44 }, (_, o) => o)
  .filter((o) => o !== 10 && o !== 11)
  .map((o) => {
    const i = OFFSETS.indexOf(o);
    return i < 0 ? 0 : RETS[i];
  });

describe("deriveSeriesBundle on a composite with a covered day (D-15, WR-01)", () => {
  const bundle = deriveSeriesBundle(clipped, {
    periodsPerYear: P,
    isArithmetic: true,
    calendarDense: true,
    markets: [],
    strategyName: "composite",
    missingSegments: GAPS,
    benchmarkPrices: { unavailable: true },
  });
  const want = compute(SERVER_INPUT, SERVER_INPUT.map((_, i) => addDays(START, i)), 0, P);

  it("ann_vol, Sharpe and Sortino are the server's scalar input's", () => {
    for (const k of ["ann_vol", "sharpe", "sortino"] as const) {
      expect(bundle.strategyMetrics[k], k).toBeCloseTo(want[k], 12);
    }
  });

  it("the rolling volatility chart runs over the server's series, on every present day", () => {
    const rolled = rollingVol(SERVER_INPUT, bundle.rollingWindow.window, P);
    // a present day's index in the server's series: the two covered days are not in it
    const serverIndex = (o: number) => (o > 11 ? o - 2 : o);
    expect(bundle.strategyRollingVol).toEqual(OFFSETS.map((o) => rolled[serverIndex(o)]));
    expect(bundle.strategyRollingVol.some((v) => v !== null)).toBe(true);
  });
});
