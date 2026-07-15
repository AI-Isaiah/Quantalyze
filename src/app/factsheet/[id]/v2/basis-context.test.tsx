import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FactsheetPayload, ComputeSummary } from "@/lib/factsheet/types";
import {
  BasisProvider,
  useBasis,
  useBasisMetrics,
  useBasisSeriesView,
  mtmDisabledReasonCopy,
  mtmReasonTone,
} from "./basis-context";

/**
 * Phase 91 / QA-01 (CONTEXT D5) — DIRECT test for the ephemeral basis context.
 *
 * Until now basis-context.tsx was only exercised indirectly via
 * leverage-context.test.tsx (which wraps <BasisProvider> to build the L-hook
 * tree). This mirrors that analog's renderHook + wrapper + act idiom and pins,
 * in isolation:
 *   - the cash_settlement default (basis-context.tsx:43-46),
 *   - the setBasis toggle (and restore),
 *   - useBasis throwing outside its provider (mirrors leverage Test 1),
 *   - the useBasisMetrics overlay contract (cash → strategyMetrics by reference;
 *     MTM → shallow copy overlaying ONLY the seven BASIS_KPI_MAP scalars),
 *   - the closed mtmDisabledReasonCopy set (:100-108) + unknown fallback,
 *   - GUARD-04 by construction: no storage/URL/history in the source (mirrors
 *     leverage Test 6 verbatim, retargeted).
 */

// A cash-basis strategyMetrics carrying the seven mapped tsKeys plus two
// UNMAPPED keys (alpha / information_ratio) that must survive an MTM overlay.
const CASH_METRICS = {
  cum_ret: 0.1,
  ann_vol: 0.2,
  max_dd: -0.15,
  cagr: 0.08,
  sharpe: 1.1,
  sortino: 1.5,
  calmar: 0.5,
  alpha: 0.42,
  information_ratio: 0.33,
  n: 250,
} as unknown as ComputeSummary;

// The PERSISTED mark_to_market scalars keyed by the Python serverKey names. Each
// mapped scalar differs from its cash counterpart so a swap is observable.
const MTM_SCALARS = {
  cumulative_return: 0.9,
  volatility: 0.25,
  max_drawdown: -0.18,
  cagr: 0.7,
  sharpe: 2.2,
  sortino: 2.9,
  calmar: 0.9,
};

function makePayload(): FactsheetPayload {
  return {
    strategyMetrics: CASH_METRICS,
    metricsByBasis: { mark_to_market: MTM_SCALARS },
  } as unknown as FactsheetPayload;
}

function wrapper({ children }: { children: ReactNode }) {
  return <BasisProvider>{children}</BasisProvider>;
}

function useProbe(payload: FactsheetPayload) {
  const ctx = useBasis();
  const bm = useBasisMetrics(payload);
  return { ctx, bm };
}

describe("basis-context", () => {
  it("Test 1 — useBasis default is cash_settlement", () => {
    const { result } = renderHook(() => useBasis(), { wrapper });
    expect(result.current.basis).toBe("cash_settlement");
  });

  it("Test 2 — setBasis flips to mark_to_market and back", () => {
    const { result } = renderHook(() => useBasis(), { wrapper });
    expect(result.current.basis).toBe("cash_settlement");

    act(() => result.current.setBasis("mark_to_market"));
    expect(result.current.basis).toBe("mark_to_market");

    act(() => result.current.setBasis("cash_settlement"));
    expect(result.current.basis).toBe("cash_settlement");
  });

  it("Test 3 — useBasis throws outside its provider", () => {
    expect(() => renderHook(() => useBasis())).toThrow(/BasisProvider/);
  });

  it("Test 4 — cash_settlement returns strategyMetrics UNTOUCHED (same reference)", () => {
    const payload = makePayload();
    const { result } = renderHook(() => useProbe(payload), { wrapper });
    // Default is cash → the hook returns payload.strategyMetrics directly
    // (basis-context.tsx:91), same object reference, no copy.
    expect(result.current.bm.basis).toBe("cash_settlement");
    expect(result.current.bm.m).toBe(payload.strategyMetrics);
    expect(result.current.bm.m.cum_ret).toBe(0.1);
  });

  it("Test 5 — mark_to_market overlays ONLY the mapped keys; unmapped keys survive", () => {
    const payload = makePayload();
    const { result } = renderHook(() => useProbe(payload), { wrapper });

    act(() => result.current.ctx.setBasis("mark_to_market"));
    const m = result.current.bm.m as unknown as Record<string, number>;

    // Shallow COPY, not the cash object.
    expect(result.current.bm.m).not.toBe(payload.strategyMetrics);

    // Mapped scalars swap to the persisted MTM values (serverKey → tsKey).
    // ALL SEVEN BASIS_KPI_MAP keys asserted so a regression on any mapped key
    // (incl. cagr/sortino) can't slip through the overlay-coverage test.
    expect(m.cum_ret).toBe(0.9); // cumulative_return
    expect(m.ann_vol).toBe(0.25); // volatility
    expect(m.max_dd).toBe(-0.18); // max_drawdown
    expect(m.cagr).toBe(0.7);
    expect(m.sharpe).toBe(2.2);
    expect(m.sortino).toBe(2.9);
    expect(m.calmar).toBe(0.9);

    // UNMAPPED keys keep their cash value — never displayed under an MTM label.
    expect(m.alpha).toBe(0.42);
    expect(m.information_ratio).toBe(0.33);
    expect(m.n).toBe(250);
  });

  it("Test 6 — mtmDisabledReasonCopy is a closed set with an honest, basis-agnostic default", () => {
    // Phase 102 (MTM-01) honest reason copy — character-exact pins (DESIGN.md
    // voice: factual, institutional, no contractions, never fabricating).
    // The dropped daily-mark smoothing framing on the options-book reason is GONE.
    expect(mtmDisabledReasonCopy("unsmoothed_options_book")).toBe(
      "Mark-to-market unavailable: composites that include an options book report cash settlement only.",
    );
    // Unchanged — the venue reason keeps its byte-identical copy.
    expect(mtmDisabledReasonCopy("mtm_basis_unavailable_for_venue")).toBe(
      "Mark-to-market unavailable for this venue.",
    );
    expect(mtmDisabledReasonCopy("mtm_summary_coverage_incomplete")).toBe(
      "Mark-to-market unavailable: settlement history does not fully cover this book, so a mark-to-market series cannot be reconstructed.",
    );
    expect(mtmDisabledReasonCopy("mtm_series_uncomputable")).toBe(
      "Mark-to-market unavailable: the reconstructed mark-to-market series could not produce valid metrics.",
    );
    expect(mtmDisabledReasonCopy("mtm_second_pass_timeout")).toBe(
      "Mark-to-market temporarily unavailable: reconstruction exceeded its time budget and will be retried on the next data refresh.",
    );
    expect(mtmDisabledReasonCopy("mtm_anchor_race")).toBe(
      "Mark-to-market temporarily unavailable: the account changed during reconstruction; it will be recomputed on the next data refresh.",
    );
    // Fallback: unknown reason AND undefined both hit the basis-agnostic default
    // (the old "for this composite" default was wrong for single-key — RESEARCH A4).
    const fallback = "Mark-to-market unavailable for this strategy.";
    expect(mtmDisabledReasonCopy("some_unrecognized_reason")).toBe(fallback);
    expect(mtmDisabledReasonCopy(undefined)).toBe(fallback);
    expect(mtmDisabledReasonCopy()).toBe(fallback);
  });

  it("Test 6b — mtmReasonTone: amber ONLY for transient/recoverable reasons (DESIGN.md)", () => {
    // DESIGN.md: warning-amber is reserved for transient/recoverable states the
    // system re-attempts on its own. Only the timeout + anchor-race reasons
    // self-heal on the next derive; every steady-state honest-empty reason is muted.
    expect(mtmReasonTone("mtm_second_pass_timeout")).toBe("transient");
    expect(mtmReasonTone("mtm_anchor_race")).toBe("transient");
    // Steady-state honest-empty — muted, not amber (amber would falsely signal
    // self-healing; RESEARCH Pitfall 4).
    expect(mtmReasonTone("mtm_summary_coverage_incomplete")).toBe("steady");
    expect(mtmReasonTone("mtm_series_uncomputable")).toBe("steady");
    expect(mtmReasonTone("mtm_basis_unavailable_for_venue")).toBe("steady");
    expect(mtmReasonTone("unsmoothed_options_book")).toBe("steady");
    // Unknown + undefined default to steady.
    expect(mtmReasonTone("some_unrecognized_reason")).toBe("steady");
    expect(mtmReasonTone(undefined)).toBe("steady");
    expect(mtmReasonTone()).toBe("steady");
  });

  // ---- Phase 103 (MTM-04): useBasisSeriesView — the per-basis series merge ----

  // A payload carrying a DISTINGUISHABLE MTM series bundle. The bundle's dailies-
  // derivable fields differ from the cash top-level so a swap is observable. This
  // minimal bundle omits correlations, so those EXTERNAL fields pass through as cash.
  // Phase 103 (F3): strategyMetrics is NO LONGER a pass-through — the merge overlays
  // the SEVEN persisted headline scalars (`metricsByBasis.mark_to_market`) onto it so
  // the rail's §I headline matches the KpiStrip by construction.
  const CASH_DATES = ["2023-01-01", "2023-01-02", "2023-01-03"];
  const MTM_DATES = ["2023-01-02", "2023-01-03"]; // shorter MTM span (distinct axis)
  const CASH_QUANTILES = { p05: -0.05, p25: -0.01, p50: 0.0, p75: 0.01, p95: 0.05, min: -0.1, max: 0.1, mean: 0.0 };
  const MTM_QUANTILES = { p05: -0.09, p25: -0.02, p50: 0.01, p75: 0.03, p95: 0.08, min: -0.2, max: 0.2, mean: 0.01 };
  const CASH_CORRELATIONS = [{ name: "BTC", rho: 0.42 }];

  function makeSeriesPayload(withBundle: boolean): FactsheetPayload {
    const bundle = {
      dates: MTM_DATES,
      quantiles: MTM_QUANTILES,
      calmarByYear: [{ year: "2023", ret: 0.2, max_dd: -0.05, calmar: 4, days: 250 }],
    };
    return {
      ingestSource: "csv",
      strategyMetrics: CASH_METRICS,
      metricsByBasis: { mark_to_market: MTM_SCALARS },
      dates: CASH_DATES,
      quantiles: CASH_QUANTILES,
      correlations: CASH_CORRELATIONS,
      calmarByYear: [{ year: "2023", ret: 0.1, max_dd: -0.02, calmar: 5, days: 250 }],
      ...(withBundle ? { seriesByBasis: { mark_to_market: bundle } } : {}),
    } as unknown as FactsheetPayload;
  }

  function useViewProbe(payload: FactsheetPayload) {
    const ctx = useBasis();
    const view = useBasisSeriesView(payload);
    return { ctx, view };
  }

  it("Test 8 — cash returns the ORIGINAL payload by reference (GUARD-02 identity)", () => {
    const payload = makeSeriesPayload(true);
    const { result } = renderHook(() => useViewProbe(payload), { wrapper });
    expect(result.current.ctx.basis).toBe("cash_settlement");
    expect(result.current.view).toBe(payload);
  });

  it("Test 9 — MTM WITH bundle merges dailies-derivable fields but passes external fields through as cash", () => {
    const payload = makeSeriesPayload(true);
    const { result } = renderHook(() => useViewProbe(payload), { wrapper });
    act(() => result.current.ctx.setBasis("mark_to_market"));
    const v = result.current.view;
    // NOT the original object — a merged view.
    expect(v).not.toBe(payload);
    // Dailies-derivable fields come from the BUNDLE (MTM axis + MTM stats).
    expect(v.dates).toEqual(MTM_DATES);
    expect(v.quantiles).toEqual(MTM_QUANTILES);
    expect(v.calmarByYear[0].ret).toBe(0.2);
    // EXTERNAL correlations pass through as CASH (this minimal bundle omits them).
    expect(v.correlations).toBe(payload.correlations);
    // F3: strategyMetrics is a NEW object with the seven mapped scalars overlaid from
    // the persisted MTM object (0.9 / 0.25 / …), NOT the cash reference. The two
    // UNMAPPED keys (alpha / information_ratio) survive from cash.
    expect(v.strategyMetrics).not.toBe(payload.strategyMetrics);
    expect(v.strategyMetrics.cum_ret).toBe(MTM_SCALARS.cumulative_return);
    expect(v.strategyMetrics.sharpe).toBe(MTM_SCALARS.sharpe);
    expect(v.strategyMetrics.calmar).toBe(MTM_SCALARS.calmar);
    expect((v.strategyMetrics as unknown as { alpha: number }).alpha).toBe(0.42);
  });

  it("Test 10 — MTM WITHOUT a bundle falls back to the ORIGINAL payload by reference", () => {
    const payload = makeSeriesPayload(false);
    const { result } = renderHook(() => useViewProbe(payload), { wrapper });
    act(() => result.current.ctx.setBasis("mark_to_market"));
    expect(result.current.view).toBe(payload);
  });

  it("Test 11 — the merged view is memo-stable across re-renders and identity restores on toggle back", () => {
    const payload = makeSeriesPayload(true);
    const { result, rerender } = renderHook(() => useViewProbe(payload), { wrapper });
    act(() => result.current.ctx.setBasis("mark_to_market"));
    const merged = result.current.view;
    rerender();
    // Same object reference across a re-render (useMemo stability).
    expect(result.current.view).toBe(merged);
    // Toggling back to cash restores the original payload reference.
    act(() => result.current.ctx.setBasis("cash_settlement"));
    expect(result.current.view).toBe(payload);
  });

  it("Test 7 — GUARD-04: source has no storage/URL/cookie/history access", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/factsheet/[id]/v2/basis-context.tsx"),
      "utf8",
    );
    // Strip comment lines so header prose can't self-invalidate the grep.
    const code = src
      .split("\n")
      .filter(line => {
        const t = line.trim();
        return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
      })
      .join("\n");
    expect(
      /localStorage|sessionStorage|document\.cookie|history\.(push|replace)|location\.|URLSearchParams/.test(
        code,
      ),
    ).toBe(false);
  });
});
