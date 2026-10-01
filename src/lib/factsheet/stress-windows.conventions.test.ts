import { describe, it, expect } from "vitest";
import { computeStressWindows } from "./stress-windows";
import { arithmeticUnderwater } from "./compute";
import { buildFactsheetPayload } from "./build-payload";
import type { BuildFactsheetOpts } from "./build-payload";
import type { DailyReturn } from "./types";

/**
 * Phase 169.1 plan 07 (D-34, D-36) — a stress window follows the headline's
 * cumulative method.
 *
 * On an arithmetic composite the headline and the equity chart are running sums,
 * but each stress window compounded the strategy's returns, so a window's return
 * was not the rise the chart draws across it and its drawdown was the geometric
 * one. Under "arithmetic" the strategy's window return is the SUM of the window's
 * returns and its drawdown the minimum of the running-sum underwater; the
 * benchmark stays geometric (its own headline is). The day basis and density move
 * no stress figure: an inserted 0.0 day changes neither a sum nor a product.
 *
 * Expected values are computed here from the window's own returns.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** 2025-03-20 .. 2025-04-30, every calendar day: spans "Apr 2025 tariffs" (2025-04-02 .. 2025-04-09). */
const N = 42;
const dates = Array.from({ length: N }, (_, i) => addDays("2025-03-20", i));
const strat = Array.from({ length: N }, (_, i) => 0.004 + Math.sin(i * 0.9) * 0.03);
const bench: Array<number | null> = Array.from({ length: N }, (_, i) => -0.002 + Math.cos(i * 0.7) * 0.025);
const TARIFFS = "Apr 2025 tariffs";

const inWindow = (ds: string[]) => ds.map((d, i) => [d, i] as const).filter(([d]) => d >= "2025-04-02" && d <= "2025-04-09").map(([, i]) => i);
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const minOf = (xs: number[]) => xs.reduce((m, x) => (x < m ? x : m), 0);
const relClose = (a: number, b: number, tol = 1e-12) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const tariffs = (out: ReturnType<typeof computeStressWindows>) => {
  const w = out.windows.find((x) => x.name === TARIFFS);
  if (!w) throw new Error("the fixture must keep the tariffs window");
  return w;
};

describe("computeStressWindows' cumulative method (D-34)", () => {
  it("arithmetic: the strategy's window return is the sum and its drawdown the running-sum trough; the benchmark stays geometric", () => {
    const idx = inWindow(dates);
    expect(idx.length).toBe(8);
    const slice = idx.map((i) => strat[i]);
    const a = tariffs(computeStressWindows(dates, strat, bench, "BTC", ["BTC"], "arithmetic"));
    const g = tariffs(computeStressWindows(dates, strat, bench, "BTC", ["BTC"]));
    // Load-bearing fixture: compounding and summing disagree on this window.
    expect(Math.abs(g.stratReturn - sum(slice))).toBeGreaterThan(1e-4);
    expect(relClose(a.stratReturn, sum(slice))).toBe(true);
    expect(a.stratMaxDD).toBe(minOf(arithmeticUnderwater(slice)));
    expect(a.stratMaxDD).not.toBe(g.stratMaxDD);
    expect(a.benchReturn).toBe(g.benchReturn);
    expect(a.benchMaxDD).toBe(g.benchMaxDD);
    expect([a.days, a.expectedCalendarDays, a.coverage]).toEqual([g.days, g.expectedCalendarDays, g.coverage]);
  });

  it("zero-insertion twin: extra 0.0 days inside the window move no strategy figure, under either method", () => {
    // Base: the window's weekend (2025-04-05, 2025-04-06) is absent. Twin: present with 0.0.
    const keep = dates.map((d) => d !== "2025-04-05" && d !== "2025-04-06");
    const bDates = dates.filter((_, i) => keep[i]);
    const bStrat = strat.filter((_, i) => keep[i]);
    const bBench = bench.filter((_, i) => keep[i]);
    const tStrat = strat.map((r, i) => (keep[i] ? r : 0));
    const tBench = bench.map((r, i) => (keep[i] ? r : 0));
    for (const m of ["geometric", "arithmetic"] as const) {
      const base = tariffs(computeStressWindows(bDates, bStrat, bBench, "BTC", ["BTC"], m));
      const twin = tariffs(computeStressWindows(dates, tStrat, tBench, "BTC", ["BTC"], m));
      expect(twin.stratReturn).toBe(base.stratReturn);
      expect(twin.stratMaxDD).toBe(base.stratMaxDD);
      // days / coverage follow the observed days, as they always did.
      expect(base.days).toBe(6);
      expect(twin.days).toBe(8);
    }
  });

  it("without the method the output deep-equals the geometric call, and is the compounded window", () => {
    const d = computeStressWindows(dates, strat, bench, "BTC", ["BTC"]);
    expect(d).toEqual(computeStressWindows(dates, strat, bench, "BTC", ["BTC"], "geometric"));
    const slice = inWindow(dates).map((i) => strat[i]);
    expect(relClose(tariffs(d).stratReturn, slice.reduce((c, r) => c * (1 + r), 1) - 1)).toBe(true);
  });

  it("a null benchmark day in the window: the strategy is summed, the bench fields are null exactly as without the method", () => {
    const holed = bench.map((b, i) => (dates[i] === "2025-04-04" ? null : b));
    const a = tariffs(computeStressWindows(dates, strat, holed, "BTC", ["BTC"], "arithmetic"));
    const g = tariffs(computeStressWindows(dates, strat, holed, "BTC", ["BTC"]));
    const slice = inWindow(dates).map((i) => strat[i]);
    expect(relClose(a.stratReturn, sum(slice))).toBe(true);
    expect(a.stratMaxDD).toBe(minOf(arithmeticUnderwater(slice)));
    expect(a.benchReturn).toBeNull();
    expect(a.benchMaxDD).toBeNull();
    expect(g.benchReturn).toBeNull();
    expect(g.benchMaxDD).toBeNull();
  });

  it("payload level: an arithmetic payload's in-span stress window reports the summed strategy return", () => {
    const rows: DailyReturn[] = dates.map((date, i) => ({ date, value: strat[i] }));
    const p = buildFactsheetPayload(
      {
        id: "s-169-1-07-stress",
        name: "Stress Method Fixture",
        types: ["quant"],
        markets: ["BTC"],
        computedAt: "2026-10-01T00:00:00Z",
        trustTier: null,
        assetClass: "crypto",
        ingestSource: "csv" as const,
      },
      rows,
      { cumulativeMethod: "arithmetic" } as BuildFactsheetOpts,
    );
    if (!p) throw new Error("fixture must build a payload");
    const w = p.stressWindows.windows.find((x) => x.name === TARIFFS);
    expect(w).toBeDefined();
    const slice = inWindow(p.dates).map((i) => p.strategyReturns[i]);
    expect(relClose(w!.stratReturn, sum(slice))).toBe(true);
    expect(w!.stratMaxDD).toBe(minOf(arithmeticUnderwater(slice)));
  });
});
