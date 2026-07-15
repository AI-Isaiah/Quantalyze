"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { FactsheetPayload, ComputeSummary } from "@/lib/factsheet/types";
import { sanitizeLeverage } from "@/lib/leverage";
import { compute } from "@/lib/factsheet/compute";
import { useBasis, useBasisMetrics, type Basis } from "./basis-context";

/**
 * Phase 90.5 (LEV-01, CONTEXT D2/D5) — the NARROW, EPHEMERAL leverage context.
 *
 * Kept in a NEW file rather than the FROZEN `factsheet-context.tsx` (D7): it
 * mirrors `basis-context.tsx`'s split-context template (a narrow context +
 * memoized value + a hook that throws outside its provider) WITHOUT importing
 * any frozen state internals.
 *
 * GUARD-04 (ephemeral by construction, T-90.5-07): this file contains NO
 * browser-storage, cookie, URL query, or history-API access anywhere. Leverage
 * lives in component state only, so every fresh view opens on L=1 (the real
 * track) and dialing leverage writes nothing to the URL or storage. Pinned by
 * `leverage-context.test.tsx` (Test 6 source scan).
 *
 * The metrics hook is the L===1-identity / L!==1-recompute switch: at L=1 it
 * returns the cash-basis metrics object UNTOUCHED (same reference — byte
 * identity, no recompute), and at L!==1 it re-runs the SAME `compute()` on the
 * leverage-scaled return series (NOT an analytic rescale) so path-dependent
 * KPIs — cum/CAGR/maxDD — stay honest. The multiplier is clamped at the compute
 * seam via `sanitizeLeverage` (shared contract, D5; T-90.5-06).
 */

interface LeverageContextValue {
  leverage: number;
  setLeverage: (next: number) => void;
}

const LeverageContext = createContext<LeverageContextValue | null>(null);

/**
 * Ephemeral leverage state. Renders children only (no DOM element) so wrapping
 * the FactsheetBody tree is transparent to the GUARD-02 byte-identity gate.
 * Single L — one strategy per single-key factsheet (CONTEXT open-item 3);
 * default 1 (the real, un-levered track) on every fresh view.
 */
export function LeverageProvider({ children }: { children: ReactNode }) {
  const [leverage, setLeverage] = useState<number>(1);
  const value = useMemo<LeverageContextValue>(
    () => ({ leverage, setLeverage }),
    [leverage],
  );
  return <LeverageContext.Provider value={value}>{children}</LeverageContext.Provider>;
}

/** Subscribe to the active leverage + setter. Throws outside the provider. */
export function useLeverage(): LeverageContextValue {
  const v = useContext(LeverageContext);
  if (!v) throw new Error("useLeverage must be used inside <LeverageProvider>");
  return v;
}

/**
 * Round-3 perf — the CHEAP modeled predicate, WITHOUT re-running `compute()`.
 * `modeled` is exactly the condition under which {@link useLeveragedMetrics}
 * runs a recompute (the sanitized multiplier is a real non-1 leverage AND the
 * annualization basis is present AND the active basis is not `mark_to_market`),
 * so a consumer that only needs the label/gate (the M-3 "BASE · 1× TRACK" rail
 * eyebrow) reads it here for O(1) instead of paying the O(n) KPI-slice recompute
 * a second time. `signal: false` — the interactive recompute path
 * (`useLeveragedMetrics`) owns the SFH-2 coercion signal; this predicate read
 * must not double-fire it.
 */
export function useModeledLeverage(payload: FactsheetPayload): {
  modeled: boolean;
  appliedLeverage: number;
} {
  const { leverage } = useLeverage();
  const { basis } = useBasis();
  const appliedLeverage = sanitizeLeverage(leverage, { signal: false });
  return {
    // LEV-MTM-2 (Phase 102): mirror useLeveragedMetrics' `mark_to_market`
    // short-circuit (:135-140). Under MTM the leverage recompute never runs
    // (leverage models the CASH return path only — recomputing it under an MTM
    // label would fabricate a mark-to-market line), so this CHEAP predicate must
    // also report `modeled: false`. Otherwise the rail's "BASE · 1× TRACK"
    // eyebrow would render while the KpiStrip shows unlevered MTM with no MODELED
    // eyebrow — the two surfaces disagreeing about "modeled leverage".
    modeled:
      appliedLeverage !== 1 &&
      payload.periodsPerYear != null &&
      basis !== "mark_to_market",
    appliedLeverage,
  };
}

/**
 * The display-side leverage mapping hook. Composes {@link useBasisMetrics}
 * (payload-as-arg, same convention) and applies the leverage switch on top of
 * the resolved basis metrics.
 *
 *   - `leverage === 1` (or `periodsPerYear` absent — fail-closed when the
 *     annualization basis wasn't emitted, e.g. a stale v4 cache entry — or the
 *     active basis is `mark_to_market`, where leverage would fabricate an MTM line
 *     off the cash series; Phase 102 LEV-MTM-1) → the basis metrics object
 *     UNTOUCHED (same reference; byte-identity, no clone).
 *   - `leverage !== 1` → a light KPI-slice recompute: `compute()` on
 *     `strategyReturns.map(r => L*r)` with rf=0 and the payload's
 *     `periodsPerYear`. Standalone compute() only — NO full payload rebuild, NO
 *     bootstrapCI (nothing to debounce). Sharpe/Sortino are leverage-invariant;
 *     vol scales ×L; cum/CAGR/maxDD come from the scaled path, not a rescale.
 */
export function useLeveragedMetrics(payload: FactsheetPayload): {
  basis: Basis;
  m: ComputeSummary;
  /**
   * TRUE iff a leverage recompute actually ran — i.e. the sanitized multiplier
   * is a real (non-1) leverage AND the annualization basis is present. SFH-3 /
   * IN-01: the eyebrow gate is driven off THIS, not the raw `leverage !== 1`, so
   * the "MODELED" label can never decouple from the numbers (an out-of-range or
   * basis-absent state that silently short-circuits to the un-levered `m` shows
   * NO modeled label).
   */
  modeled: boolean;
  /** The sanitized leverage actually applied to the recompute (clamped to the
   *  valid band). The eyebrow prints THIS so display == compute always. */
  appliedLeverage: number;
} {
  const { basis, m } = useBasisMetrics(payload);
  const { leverage } = useLeverage();
  const result = useMemo<{
    m: ComputeSummary;
    modeled: boolean;
    appliedLeverage: number;
  }>(() => {
    const appliedLeverage = sanitizeLeverage(leverage);
    // Fail-closed / identity short-circuit: no recompute when the applied
    // multiplier is 1 (covers both L=1 and a bad value sanitized to 1), the
    // annualization basis is absent (stale v4 cache), OR the active basis is
    // mark_to_market. Same object reference → byte-identity; `modeled` false so no
    // label ever shows.
    //
    // LEV-MTM-1 (Phase 102, no-invented-data): leverage models the CASH return
    // path — `payload.strategyReturns` IS the cash series — so recomputing it under
    // an MTM label would FABRICATE a mark-to-market line that was never persisted.
    // Under MTM we return the basis-overlaid `m` (the persisted MTM scalars) with
    // `modeled: false`, so the MODELED eyebrow can never decouple from the numbers
    // (the same SFH-3 / IN-01 principle guarding the fail-closed branches above).
    // The ControlBar additionally hides the leverage input while MTM is displayed.
    if (
      appliedLeverage === 1 ||
      payload.periodsPerYear == null ||
      basis === "mark_to_market"
    ) {
      return { m, modeled: false, appliedLeverage };
    }
    const { eq: _eq, dd: _dd, ...summary } = compute(
      payload.strategyReturns.map(r => appliedLeverage * r),
      payload.dates,
      0,
      payload.periodsPerYear,
    );
    return { m: summary as ComputeSummary, modeled: true, appliedLeverage };
  }, [leverage, payload, m, basis]);
  return {
    basis,
    m: result.m,
    modeled: result.modeled,
    appliedLeverage: result.appliedLeverage,
  };
}
