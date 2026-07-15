"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Phase 90.5 (LEV-01, CONTEXT D2/D5) + Phase 107 (LEV-BB) — the NARROW, EPHEMERAL
 * leverage context. SLIDER STATE ONLY.
 *
 * The two former derived-metrics hooks were DELETED in Phase 107: leverage is now
 * composed INTO the one shared `useBasisSeriesView` (basis-context.tsx) as a dailies
 * transform (r → L·r, then re-derive the whole bundle), so every consumer follows L
 * through that view with zero per-consumer wiring — nothing bypasses the backbone. This
 * file carries the ephemeral multiplier + setter, nothing else (removing the
 * basis-context import also dissolves the transient module cycle).
 *
 * Kept in a NEW file rather than the FROZEN `factsheet-context.tsx` (D7): it mirrors
 * `basis-context.tsx`'s split-context template (a narrow context + memoized value + a
 * hook that throws outside its provider) WITHOUT importing any frozen state internals.
 *
 * GUARD-04 (ephemeral by construction, T-90.5-07): this file contains NO
 * browser-storage, cookie, URL query, or history-API access anywhere. Leverage lives in
 * component state only, so every fresh view opens on L=1 (the real track) and dialing
 * leverage writes nothing to the URL or storage. Pinned by `leverage-context.test.tsx`
 * (Test 6 source scan).
 */

interface LeverageContextValue {
  leverage: number;
  setLeverage: (next: number) => void;
}

export const LeverageContext = createContext<LeverageContextValue | null>(null);

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
