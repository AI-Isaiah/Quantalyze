import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import { BasisProvider, useBasis, useBasisSeriesView, leverageEligibleFor } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";

/**
 * Phase 107 (LEV-BB) — hook-level tests for the leverage layer composed INTO
 * `useBasisSeriesView`. The one shared view hook re-derives the whole bundle from
 * `r → L·r` active-basis dailies at L≠1 (SC-1) and is a by-reference no-op at L=1
 * (SC-4). β→L·β / α→L·α fall out honestly from the un-levered benchmark leg (SC-2
 * wiring). Four guards (L===1, composite, periodsPerYear absent, and an UNRESOLVED MTM
 * basis — either no series bundle OR no persisted scalar cache) each return the base view
 * BY REFERENCE — no fabricated basis.
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
    // A RESOLVED MTM basis carries BOTH the series bundle AND a persisted scalar cache.
    // `leverageEligibleFor` requires both (MEDIUM-honesty fix): without the cache the L=1
    // KPIs are the strict-overlay "—", so a levered re-derive would fabricate them. The
    // exact scalar values are irrelevant to the dailies-transform assertions — a present,
    // finite object is what unlocks MTM leverage eligibility.
    p.metricsByBasis = {
      mark_to_market: {
        cumulative_return: 0.12,
        volatility: 0.22,
        max_drawdown: -0.05,
        cagr: 0.1,
        sharpe: 1.1,
        sortino: 1.6,
        calmar: 2.0,
      },
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

  it("Test H (perf debounce, 107-03) — the DERIVE reads a DEFERRED leverage; the input is never blocked", () => {
    // The re-derive was measured at a ~235ms median at 3000d (≥100ms → debounce).
    // The fix defers the leverage READ (useDeferredValue) so a rapid drag never
    // blocks the input on deriveSeriesBundle. Two falsifiable pins:
    //   (1) source-scan: the hook wires useDeferredValue on the leverage read (a
    //       future removal — reverting to a synchronous read that blocks input on
    //       the expensive derive — turns this red). Comment-stripped so the doc
    //       block above it can't self-satisfy the grep.
    const src = readFileSync(
      join(process.cwd(), "src/app/factsheet/[id]/v2/basis-context.tsx"),
      "utf8",
    );
    const code = src
      .split("\n")
      .filter(line => {
        const t = line.trim();
        return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
      })
      .join("\n");
    expect(/useDeferredValue\(\s*rawLeverage\s*\)/.test(code)).toBe(true);

    //   (2) behavioral: the INPUT value (leverage context state) updates immediately
    //       to the set value — it is decoupled from and never gated behind the
    //       derive — and the deferred derive still lands on the correct levered
    //       bundle (the debounce delays, never drops, the input).
    const payload = makePayload();
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.lev.setLeverage(3));
    // Input is immediate (never blocked by the derive).
    expect(result.current.lev.leverage).toBe(3);
    // The derive honors the input (act flushes the deferred re-render): x3 levered.
    for (let i = 0; i < N; i++) {
      expect(result.current.view.strategyReturns[i]).toBeCloseTo(3 * payload.strategyReturns[i], 12);
    }
  });
});

/**
 * Phase 133 (SMTM-01) — the smoothed-basis leverage sibling: the :325 persisted-scalar
 * re-pin and the :417-427 eligibility clause, exact structural mirrors of the MTM ones.
 */
describe("SMTM-01 useBasisSeriesView + leverageEligibleFor — smoothed leverage arm", () => {
  const SMOOTHED_SCALARS = {
    cumulative_return: 0.31,
    volatility: 0.19,
    max_drawdown: -0.07,
    cagr: 0.28,
    sharpe: 1.44, // the re-pin target (leverage-invariant)
    sortino: 1.88, // the re-pin target (leverage-invariant)
    calmar: 3.1,
  };

  function makeSmoothedPayload(o: { withBundle?: boolean } = {}): FactsheetPayload {
    const { withBundle = true } = o;
    const smRets = makeReturns(9);
    const p: Record<string, unknown> = {
      ingestSource: "csv",
      strategyName: "Test Strategy",
      markets: ["BTC"],
      strategyMetrics: BASE_METRICS,
      strategyReturns: STRAT,
      dates: DATES,
      periodsPerYear: 252,
    };
    if (withBundle) {
      p.seriesByBasis = {
        smoothed_mtm: deriveSeriesBundle(
          smRets.map((r, i) => ({ date: DATES[i], value: r })),
          { periodsPerYear: 252, isArithmetic: false, markets: ["BTC"], strategyName: "Test Strategy" },
        ),
      };
      p.metricsByBasis = { smoothed_mtm: SMOOTHED_SCALARS };
    }
    return p as unknown as FactsheetPayload;
  }

  it("leverageEligibleFor: smoothed eligible ⇔ BOTH the smoothed bundle AND smoothed scalars present", () => {
    // Both present → eligible.
    expect(leverageEligibleFor(makeSmoothedPayload({ withBundle: true }), "smoothed_mtm")).toBe(true);
    // Bundle absent → INeligible (never re-pin against a missing series).
    const noBundle = {
      dataQuality: undefined,
      periodsPerYear: 252,
      metricsByBasis: { smoothed_mtm: SMOOTHED_SCALARS }, // scalars but no series
    } as unknown as FactsheetPayload;
    expect(leverageEligibleFor(noBundle, "smoothed_mtm")).toBe(false);
    // Scalars absent → INeligible (would fabricate the withheld headline).
    const noScalars = {
      dataQuality: undefined,
      periodsPerYear: 252,
      seriesByBasis: {
        smoothed_mtm: deriveSeriesBundle(
          makeReturns(9).map((r, i) => ({ date: DATES[i], value: r })),
          { periodsPerYear: 252, isArithmetic: false, markets: ["BTC"], strategyName: "Test Strategy" },
        ),
      },
    } as unknown as FactsheetPayload;
    expect(leverageEligibleFor(noScalars, "smoothed_mtm")).toBe(false);
  });

  it("levered smoothed re-pins the persisted Sharpe/Sortino (no L=1↔L≠1 jump)", () => {
    const payload = makeSmoothedPayload({ withBundle: true });
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.basis.setBasis("smoothed_mtm"));
    act(() => result.current.lev.setLeverage(2));
    const v = result.current.view;
    // Sharpe/Sortino are leverage-invariant at rf=0 → re-pinned to the PERSISTED
    // smoothed values (continuous across the L=1 boundary), NOT the client recompute.
    expect(v.strategyMetrics.sharpe).toBe(SMOOTHED_SCALARS.sharpe);
    expect(v.strategyMetrics.sortino).toBe(SMOOTHED_SCALARS.sortino);
  });

  it("L=0 under smoothed yields honest derived zeros (persisted non-zero NOT pinned)", () => {
    const payload = makeSmoothedPayload({ withBundle: true });
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.basis.setBasis("smoothed_mtm"));
    act(() => result.current.lev.setLeverage(0));
    const v = result.current.view;
    // At L=0 the returns are all-zeros → honest derived Sharpe/Sortino 0, never the
    // persisted 1.44/1.88 next to flat charts (the B-1 carve-out).
    expect(v.strategyMetrics.sharpe).toBe(0);
    expect(v.strategyMetrics.sortino).toBe(0);
  });

  it("smoothed WITHOUT a bundle at L=2 returns base BY REFERENCE (no fabrication)", () => {
    const payload = makeSmoothedPayload({ withBundle: false });
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.basis.setBasis("smoothed_mtm"));
    act(() => result.current.lev.setLeverage(2));
    expect(result.current.view).toBe(payload);
  });
});
