import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { CVAR_MIN_OBS } from "@/lib/figure-conventions";
import { BasisProvider, useBasis, useBasisSeriesView, windowView } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";

/**
 * Phase 236 FIG-03 (review CR-01, CONTEXT Q2 "Total record only"): CVaR is null when the TOTAL
 * record has fewer than CVAR_MIN_OBS observations, on EVERY whole-record figure set: the cash
 * `strategyMetrics`, the mark-to-market and smoothed bundles, and the leverage what-if. A selected
 * window always shows CVaR. A record one day under the floor pins each arm, and a control one day
 * at the floor proves each arm CAN show a figure, so a NaN is the floor and not a degenerate series.
 */

// Mixed-sign, tail-bearing returns: every fifth day is a loss that deepens with the index, so the
// 5% tail is finite and negative at both 59 and 60 observations.
const series = (n: number, phase: number): DailyReturn[] => {
  const start = Date.UTC(2025, 2, 15);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    value: (i + phase) % 5 === 0 ? -0.02 - 0.0001 * i : 0.003,
  }));
};

const STRATEGY = {
  id: "s-236-cr01",
  name: "Cvar Floor Bundles",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2025-09-01T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  description: "fixture",
  subtypes: ["basis_trade"],
  supportedExchanges: ["deribit"],
  leverageRange: "0-3x",
  aum: 1_000_000,
  maxCapacity: 5_000_000,
  avgDailyTurnover: 250_000,
  startDate: "2025-03-15",
  benchmark: "BTC",
  ingestSource: "csv" as const,
};

// Persisted scalar caches make the MTM and smoothed bases leverage-eligible (`leverageEligibleFor`).
const SCALARS = { cumulative_return: 0.1, volatility: 0.2, max_drawdown: -0.05, cagr: 0.1, sharpe: 1, sortino: 1, calmar: 1 };

function payloadOf(n: number): FactsheetPayload {
  const built = buildFactsheetPayload(STRATEGY, series(n, 0), {
    mtmSeries: { dailyReturns: series(n, 2), gapSpans: [] },
    smoothedSeries: { dailyReturns: series(n, 3), gapSpans: [] },
  })!;
  return {
    ...built,
    metricsByBasis: { mark_to_market: SCALARS, smoothed_mtm: SCALARS },
  } as unknown as FactsheetPayload;
}

function bothWrapper({ children }: { children: ReactNode }) {
  return (
    <BasisProvider>
      <LeverageProvider>{children}</LeverageProvider>
    </BasisProvider>
  );
}

function useViewProbe(payload: FactsheetPayload) {
  const basis = useBasis();
  const lev = useLeverage();
  const view = useBasisSeriesView(payload);
  return { basis, lev, view };
}

describe("the total-record CVaR floor on every whole-record figure set (CR-01)", () => {
  it("fixture straddles exactly CVAR_MIN_OBS", () => {
    expect(CVAR_MIN_OBS).toBe(60);
  });

  it("n = 59: the cash, mark-to-market and smoothed whole-record cvar95 are all NaN", () => {
    const p = payloadOf(CVAR_MIN_OBS - 1);
    expect(Number.isNaN(p.strategyMetrics.cvar95)).toBe(true);
    expect(Number.isNaN(p.seriesByBasis!.mark_to_market!.strategyMetrics.cvar95)).toBe(true);
    expect(Number.isNaN(p.seriesByBasis!.smoothed_mtm!.strategyMetrics.cvar95)).toBe(true);
    // VaR is never floored.
    expect(Number.isFinite(p.seriesByBasis!.mark_to_market!.strategyMetrics.var95)).toBe(true);
  });

  it("n = 60: every one of the three shows a finite negative CVaR", () => {
    const p = payloadOf(CVAR_MIN_OBS);
    for (const v of [
      p.strategyMetrics.cvar95,
      p.seriesByBasis!.mark_to_market!.strategyMetrics.cvar95,
      p.seriesByBasis!.smoothed_mtm!.strategyMetrics.cvar95,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeLessThan(0);
    }
  });

  it.each(["cash_settlement", "mark_to_market", "smoothed_mtm"] as const)(
    "L = 2 on %s: the levered whole record is NaN at n = 59 and finite at n = 60",
    (basis) => {
      const run = (n: number) => {
        const payload = payloadOf(n);
        const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
        act(() => result.current.basis.setBasis(basis));
        act(() => result.current.lev.setLeverage(2));
        expect(result.current.view).not.toBe(payload);
        return result.current.view.strategyMetrics.cvar95;
      };
      expect(Number.isNaN(run(CVAR_MIN_OBS - 1))).toBe(true);
      const shown = run(CVAR_MIN_OBS);
      expect(Number.isFinite(shown)).toBe(true);
      expect(shown).toBeLessThan(0);
    },
  );

  it("a selected window always shows CVaR, even inside a record under the floor", () => {
    const p = payloadOf(CVAR_MIN_OBS - 1);
    // 30 of the 59 days, and the whole 59-day range selected explicitly: both are windows.
    for (const [s, e] of [
      [0, 29],
      [0, CVAR_MIN_OBS - 2],
    ]) {
      const w = windowView(p, s, e);
      expect(Number.isFinite(w.strategyMetrics.cvar95)).toBe(true);
      expect(w.strategyMetrics.cvar95).toBeLessThan(0);
    }
  });
});
