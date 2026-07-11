"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { FactsheetPayload, ComputeSummary } from "@/lib/factsheet/types";
import { sanitizeLeverage } from "@/lib/leverage";
import { compute } from "@/lib/factsheet/compute";
import { useBasisMetrics, type Basis } from "./basis-context";

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
 * The display-side leverage mapping hook. Composes {@link useBasisMetrics}
 * (payload-as-arg, same convention) and applies the leverage switch on top of
 * the resolved basis metrics.
 *
 *   - `leverage === 1` (or `periodsPerYear` absent — fail-closed when the
 *     annualization basis wasn't emitted, e.g. a stale v4 cache entry) → the
 *     basis metrics object UNTOUCHED (same reference; byte-identity, no clone).
 *   - `leverage !== 1` → a light KPI-slice recompute: `compute()` on
 *     `strategyReturns.map(r => L*r)` with rf=0 and the payload's
 *     `periodsPerYear`. Standalone compute() only — NO full payload rebuild, NO
 *     bootstrapCI (nothing to debounce). Sharpe/Sortino are leverage-invariant;
 *     vol scales ×L; cum/CAGR/maxDD come from the scaled path, not a rescale.
 */
export function useLeveragedMetrics(payload: FactsheetPayload): {
  basis: Basis;
  m: ComputeSummary;
  leverage: number;
} {
  const { basis, m } = useBasisMetrics(payload);
  const { leverage } = useLeverage();
  const levered = useMemo<ComputeSummary>(() => {
    if (leverage === 1 || payload.periodsPerYear == null) return m;
    const Ls = sanitizeLeverage(leverage);
    if (Ls === 1) return m;
    const { eq: _eq, dd: _dd, ...summary } = compute(
      payload.strategyReturns.map(r => Ls * r),
      payload.dates,
      0,
      payload.periodsPerYear,
    );
    return summary;
  }, [leverage, payload, m]);
  return { basis, m: levered, leverage };
}
