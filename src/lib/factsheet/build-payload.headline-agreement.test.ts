import { describe, it, expect, vi } from "vitest";
import { buildFactsheetPayload } from "./build-payload";
import type { BuildFactsheetOpts } from "./build-payload";
import { bootstrapCI } from "./bootstrap";
import { arithmeticUnderwater, compute, cumEq, drawdowns } from "./compute";
import type { DailyReturn, FactsheetPayload } from "./types";
import { windowView } from "@/app/factsheet/[id]/v2/basis-context";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

/**
 * Phase 169.1 plan 07 (D-34, D-27, D-36) — the Bootstrap CI's point figures are
 * the headline's figures, printed beside it.
 *
 * Until this plan `deriveSeriesBundle` resampled every present day and scored
 * each resample with a GEOMETRIC drawdown, whatever the headline ran on. So on
 * an active-day-basis strategy its point Sharpe and Sortino were diluted by the
 * zero days the headline excludes, on a gapped calendar composite they ran over
 * the present days instead of the zero-filled calendar series, and on an
 * arithmetic composite its point Max DD was the geometric trough beside an
 * arithmetic headline. D-27: every figure beside a headline agrees with it.
 *
 * Every expected value is either the payload's own `strategyMetrics` (the
 * headline the panel sits beside) or computed in this file from a series built
 * here, never from `metricsBasisSeries`, the helper the fix reuses.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const START = "2024-01-01";

const STRATEGY = {
  id: "s-169-1-07-boot",
  name: "Bootstrap Agreement Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-01T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};

/** Opens with a loss, so the arithmetic underwater (peak floored at 0) and the geometric drawdown part from day one. */
const value = (i: number) => -0.004 + 0.0012 + Math.sin(i * 0.29) * 0.013 + Math.cos(i * 0.09) * 0.006;

function build(rows: DailyReturn[], opts: Partial<BuildFactsheetOpts> = {}): FactsheetPayload {
  const p = buildFactsheetPayload(STRATEGY, rows, opts as BuildFactsheetOpts);
  if (!p) throw new Error("fixture must build a payload");
  return p;
}

function dailyRows(n: number, zeroAt: (i: number) => boolean = () => false): DailyReturn[] {
  return Array.from({ length: n }, (_, i) => ({ date: addDays(START, i), value: zeroAt(i) ? 0 : value(i) }));
}

/** 300 present days; one calendar day is ABSENT before each of the observations 40, 50, ..., 230. */
const GAP_BEFORE = new Set(Array.from({ length: 20 }, (_, k) => 40 + 10 * k));
function gappedRows(): DailyReturn[] {
  const out: DailyReturn[] = [];
  let offset = 0;
  for (let i = 0; i < 300; i++) {
    if (GAP_BEFORE.has(i)) offset += 1;
    out.push({ date: addDays(START, i + offset), value: value(i) });
  }
  return out;
}

const relClose = (a: number, b: number, tol = 1e-12) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const minOf = (xs: number[]) => xs.reduce((m, x) => (x < m ? x : m), 0);

const ARITH_COMPOSITE = {
  cumulativeMethod: "arithmetic",
  dataQuality: { composite: true },
} as Partial<BuildFactsheetOpts>;

describe("the Bootstrap CI's point figures equal the headline beside them (D-34, D-27)", () => {
  it("arithmetic composite: the point Max DD is the headline's arithmetic Max DD, not the geometric trough", () => {
    const p = build(dailyRows(300), ARITH_COMPOSITE);
    // The fixture is load-bearing: its arithmetic and geometric troughs differ.
    const geo = minOf(drawdowns(cumEq(p.strategyReturns)));
    const arith = minOf(arithmeticUnderwater(p.strategyReturns));
    expect(Math.abs(geo - arith)).toBeGreaterThan(1e-3);
    expect(p.strategyMetrics.max_dd).toBe(arith);
    expect(p.bootstrapCI.max_dd.point).toBe(p.strategyMetrics.max_dd);
  });

  it("active basis: the point Sharpe and Sortino are the headline's, and n is the count of non-zero days", () => {
    const ZERO = (i: number) => i % 3 === 1 && i <= 240;
    const p = build(dailyRows(300, ZERO), { dayBasis: "active" } as Partial<BuildFactsheetOpts>);
    const nonZero = p.strategyReturns.filter((r) => r !== 0).length;
    expect(nonZero).toBe(300 - 80);
    expect(relClose(p.bootstrapCI.sharpe.point, p.strategyMetrics.sharpe)).toBe(true);
    expect(relClose(p.bootstrapCI.sortino.point, p.strategyMetrics.sortino)).toBe(true);
    expect(p.bootstrapCI.n).toBe(nonZero);
    expect(p.bootstrapCI.max_dd.point).toBe(p.strategyMetrics.max_dd);
  });

  it("gapped calendar composite: the point Sharpe and Sortino are the headline's zero-filled values, and n is the calendar-day count", () => {
    const p = build(gappedRows(), { dataQuality: { composite: true } } as Partial<BuildFactsheetOpts>);
    const calendarDays = Math.round((Date.parse(p.dates[p.dates.length - 1]) - Date.parse(p.dates[0])) / DAY) + 1;
    expect(calendarDays).toBe(320);
    expect(p.dates.length).toBe(300);
    expect(relClose(p.bootstrapCI.sharpe.point, p.strategyMetrics.sharpe)).toBe(true);
    expect(relClose(p.bootstrapCI.sortino.point, p.strategyMetrics.sortino)).toBe(true);
    expect(p.bootstrapCI.n).toBe(calendarDays);
    expect(p.bootstrapCI.max_dd.point).toBe(p.strategyMetrics.max_dd);
  });

  it("gapped ARITHMETIC composite: Sharpe, Sortino and Max DD points all equal the headline", () => {
    const p = build(gappedRows(), ARITH_COMPOSITE);
    expect(relClose(p.bootstrapCI.sharpe.point, p.strategyMetrics.sharpe)).toBe(true);
    expect(relClose(p.bootstrapCI.sortino.point, p.strategyMetrics.sortino)).toBe(true);
    expect(p.bootstrapCI.max_dd.point).toBe(p.strategyMetrics.max_dd);
  });

  it("a selected range of the arithmetic composite: the window's point Max DD equals the window's headline Max DD", () => {
    const p = build(dailyRows(300), ARITH_COMPOSITE);
    const w = windowView(p, 60, 219);
    expect(w.withheld).toBeUndefined();
    expect(w.dates.length).toBe(160);
    const slice = p.strategyReturns.slice(60, 220);
    expect(w.strategyMetrics.max_dd).toBe(minOf(arithmeticUnderwater(slice)));
    expect(w.bootstrapCI.max_dd.point).toBe(w.strategyMetrics.max_dd);
  });

  it("a selected range of an active-basis payload: the window's point Sharpe and Sortino equal the window's headline", () => {
    const ZERO = (i: number) => i % 3 === 1 && i <= 240;
    const p = build(dailyRows(300, ZERO), { dayBasis: "active" } as Partial<BuildFactsheetOpts>);
    const w = windowView(p, 50, 249);
    expect(w.withheld).toBeUndefined();
    expect(relClose(w.bootstrapCI.sharpe.point, w.strategyMetrics.sharpe)).toBe(true);
    expect(relClose(w.bootstrapCI.sortino.point, w.strategyMetrics.sortino)).toBe(true);
    expect(w.bootstrapCI.n).toBe(p.strategyReturns.slice(50, 250).filter((r) => r !== 0).length);
  });

  it("without conventions the bootstrap is byte-identical to resampling the returns as before", () => {
    const p = build(dailyRows(300, (i) => i % 7 === 3));
    expect(p.periodsPerYear).toBe(365);
    expect(p.bootstrapCI).toEqual(bootstrapCI(p.strategyReturns, 2000, 5, 42, 365));
    // And the headline agrees there too, which it always did.
    const c = compute(p.strategyReturns, p.dates, 0, 365);
    expect(p.bootstrapCI.max_dd.point).toBe(c.max_dd);
  });
});
