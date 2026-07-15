import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import { BasisProvider, useBasis, useBasisSeriesView } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";

/**
 * Phase 107 (LEV-BB) — hook-level tests for the leverage layer composed INTO
 * `useBasisSeriesView`. The one shared view hook re-derives the whole bundle from
 * `r → L·r` active-basis dailies at L≠1 (SC-1) and is a by-reference no-op at L=1
 * (SC-4). β→L·β / α→L·α fall out honestly from the un-levered benchmark leg (SC-2
 * wiring). Four guards (L===1, composite, periodsPerYear absent, MTM-bundle-absent)
 * each return the base view BY REFERENCE — no fabricated basis.
 *
 * The fixture is a single-key GEOMETRIC payload with ≥40 days so rolling / quantiles
 * are non-degenerate and the levered re-derive exercises real sub-derivations.
 */

const N = 48;

// A deterministic, mixed-sign daily series (non-degenerate — real drawdowns, wins
// and losses so rolling/quantiles/streaks all populate). Small magnitudes keep the
// geometric equity honest.
function makeReturns(seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    // Deterministic pseudo-noise in roughly [-0.03, +0.03].
    out.push(Math.sin((i + seed) * 1.3) * 0.02 + Math.cos((i + seed) * 0.7) * 0.01);
  }
  return out;
}

function makeDates(): string[] {
  // 48 consecutive weekdays-ish (calendar days are fine for this hook).
  const out: string[] = [];
  const start = Date.UTC(2023, 0, 2);
  for (let i = 0; i < N; i++) {
    const d = new Date(start + i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const STRAT = makeReturns(0);
const DATES = makeDates();

// The scalar strategyMetrics shape is irrelevant to the leverage layer (the levered
// bundle recomputes its own), so a minimal object suffices.
const BASE_METRICS = { cum_ret: 0.1, ann_vol: 0.2, sharpe: 1.0, n: N } as unknown as Record<
  string,
  number
>;

interface PayloadOverrides {
  composite?: boolean;
  periodsPerYear?: number | null;
  withMtmBundle?: boolean;
  mtmReturns?: number[];
  missingSegments?: { start: string; end: string; kind: "gap"; days: number }[];
}

function makePayload(o: PayloadOverrides = {}): FactsheetPayload {
  const {
    composite = false,
    periodsPerYear = 252,
    withMtmBundle = false,
    mtmReturns,
    missingSegments,
  } = o;
  const mtmRets = mtmReturns ?? makeReturns(5);
  const p: Record<string, unknown> = {
    ingestSource: "csv",
    strategyName: "Test Strategy",
    markets: ["BTC"],
    strategyMetrics: BASE_METRICS,
    strategyReturns: STRAT,
    dates: DATES,
    periodsPerYear: periodsPerYear ?? undefined,
    missingSegments,
    dataQuality: composite ? { composite: true } : undefined,
  };
  if (periodsPerYear == null) delete p.periodsPerYear;
  if (withMtmBundle) {
    p.seriesByBasis = {
      mark_to_market: deriveSeriesBundle(
        mtmRets.map((r, i) => ({ date: DATES[i], value: r })),
        {
          periodsPerYear: 252,
          isArithmetic: false,
          markets: ["BTC"],
          strategyName: "Test Strategy",
          missingSegments,
        },
      ),
    };
  }
  return p as unknown as FactsheetPayload;
}

// A wrapper carrying BOTH providers so a test can drive basis AND leverage.
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

describe("useBasisSeriesView — leverage layer (Phase 107 LEV-BB)", () => {
  it("Test A (SC-4) — L=1 returns base BY REFERENCE, incl. after a 2→1 round-trip", () => {
    const payload = makePayload();
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    // Fresh view at L=1, cash basis → the ORIGINAL payload reference.
    expect(result.current.view).toBe(payload);
    // Round-trip: 2 (re-derive) → back to 1 (reference identity restores).
    act(() => result.current.lev.setLeverage(2));
    expect(result.current.view).not.toBe(payload);
    act(() => result.current.lev.setLeverage(1));
    expect(result.current.view).toBe(payload);
  });

  it("Test B (SC-1 cash) — at L=2 strategyReturns scale ×2 and the bundle re-derives", () => {
    const payload = makePayload();
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    // Base bundle at L=1-equivalent (an explicit deriveSeriesBundle on the un-levered
    // dailies) to compare ann_vol against.
    const baseBundle = deriveSeriesBundle(
      STRAT.map((r, i) => ({ date: DATES[i], value: r })),
      { periodsPerYear: 252, isArithmetic: false, markets: ["BTC"], strategyName: "Test Strategy" },
    );
    act(() => result.current.lev.setLeverage(2));
    const v = result.current.view;
    for (let i = 0; i < N; i++) {
      expect(v.strategyReturns[i]).toBeCloseTo(2 * payload.strategyReturns[i], 12);
    }
    // Equity is re-derived from the levered path (not a rescale of the base curve).
    expect(v.strategyEquity).not.toBe(payload.strategyEquity);
    // ann_vol scales linearly ×2 (vol is homogeneous of degree 1 in the series).
    expect(v.strategyMetrics.ann_vol).toBeCloseTo(2 * baseBundle.strategyMetrics.ann_vol, 10);
    // Date axis is untouched by leverage.
    expect(v.dates).toEqual(payload.dates);
  });

  it("Test C (SC-2 wiring) — at L=2 comparator β/α scale ×2, corr invariant (bench NOT levered)", () => {
    const payload = makePayload();
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    const baseBundle = deriveSeriesBundle(
      STRAT.map((r, i) => ({ date: DATES[i], value: r })),
      { periodsPerYear: 252, isArithmetic: false, markets: ["BTC"], strategyName: "Test Strategy" },
    );
    const baseJoint = baseBundle.comparators.btc.joint;
    act(() => result.current.lev.setLeverage(2));
    const levJoint = result.current.view.comparators.btc.joint;
    expect(baseJoint).not.toBeNull();
    expect(levJoint).not.toBeNull();
    expect(levJoint!.beta).toBeCloseTo(2 * baseJoint!.beta, 8);
    expect(levJoint!.alpha).toBeCloseTo(2 * baseJoint!.alpha, 8);
    expect(levJoint!.corr).toBeCloseTo(baseJoint!.corr, 8);
  });

  it("Test D1 (guard: composite) — at L=2 a composite payload returns base BY REFERENCE", () => {
    const payload = makePayload({ composite: true });
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.lev.setLeverage(2));
    expect(result.current.view).toBe(payload);
  });

  it("Test D2 (guard: periodsPerYear absent) — at L=2 returns base BY REFERENCE", () => {
    const payload = makePayload({ periodsPerYear: null });
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.lev.setLeverage(2));
    expect(result.current.view).toBe(payload);
  });

  it("Test D3 (guard: MTM-bundle-absent, no fabrication) — at L=2 under MTM w/o a bundle returns base BY REFERENCE", () => {
    // MTM basis selected but NO seriesByBasis.mark_to_market → levering the cash
    // fallback under an MTM label is the exact old failure mode; guard returns base.
    const payload = makePayload({ withMtmBundle: false });
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.basis.setBasis("mark_to_market"));
    act(() => result.current.lev.setLeverage(2));
    // MTM w/o bundle already returns payload by reference from the basis merge; the
    // leverage guard must ALSO keep that reference identity (no re-derive).
    expect(result.current.view).toBe(payload);
  });

  it("Test E (MTM levered) — at L=2 under MTM WITH a bundle levers the ACTIVE (MTM) dailies", () => {
    const mtmReturns = makeReturns(5);
    const payload = makePayload({ withMtmBundle: true, mtmReturns });
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.basis.setBasis("mark_to_market"));
    const mtmBundleReturns = payload.seriesByBasis!.mark_to_market!.strategyReturns;
    act(() => result.current.lev.setLeverage(2));
    const v = result.current.view;
    for (let i = 0; i < mtmBundleReturns.length; i++) {
      expect(v.strategyReturns[i]).toBeCloseTo(2 * mtmBundleReturns[i], 12);
    }
    // It levers the MTM series, NOT the cash series.
    expect(v.strategyReturns[0]).not.toBeCloseTo(2 * STRAT[0], 6);
  });

  it("Test F (mask preserved) — a levered view keeps the base missingSegments", () => {
    const missingSegments = [
      { start: "2023-01-10", end: "2023-01-12", kind: "gap" as const, days: 2 },
    ];
    const payload = makePayload({ missingSegments });
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    // Base (L=1) mask.
    const baseMask = result.current.view.missingSegments;
    act(() => result.current.lev.setLeverage(2));
    expect(result.current.view.missingSegments).toEqual(baseMask);
    expect(result.current.view.missingSegments).toEqual(missingSegments);
  });

  it("Test G (graceful degrade) — WITHOUT a LeverageProvider the hook returns base by reference", () => {
    const payload = makePayload();
    function basisOnly({ children }: { children: ReactNode }) {
      return <BasisProvider>{children}</BasisProvider>;
    }
    const { result } = renderHook(() => useBasisSeriesView(payload), { wrapper: basisOnly });
    // No leverage context ⇒ L defaults to 1 ⇒ base by reference, no throw.
    expect(result.current).toBe(payload);
  });
});
