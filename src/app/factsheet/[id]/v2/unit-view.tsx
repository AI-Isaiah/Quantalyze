"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { FactsheetPayload } from "@/lib/factsheet/types";

/**
 * Phase 164.6.6.2.1 (D-01, D-18, UI-SPEC rules 1 + 2) — the EPHEMERAL unit-view
 * state of a native-unit factsheet: `native` (the strategy's own unit) or `usd`
 * (the server-built `usdView.payload`).
 *
 * Kept in a NEW file beside the frozen `factsheet-context.tsx`, exactly as
 * `basis-context.tsx` is: the frozen context is never edited, and this one takes
 * a payload and hands one back, so the provider below it is oblivious to units.
 *
 * ⛔ The browser only SELECTS between two payloads the server built (T-33). There
 * is no conversion, no price and no arithmetic in this file.
 *
 * ⛔ Ephemeral by construction (UI-SPEC rule 2, T-35): the view is `useState`
 * and nothing else. This file touches no browser storage, no cookie, no URL and
 * no history API, so every fresh mount opens on `native` (SSR included) and a
 * switch writes nothing anywhere. Pinned by `FactsheetView.usd-toggle.test.tsx`.
 *
 * The hook answers `null` outside a provider on purpose. `FactsheetBody` is also
 * mounted by `/strategy/[id]/v2` and by the composer, which are native-only
 * (D-18) and carry no provider; a consumer there simply sees no unit view.
 */
export type UnitView = "native" | "usd";

export interface UnitViewValue {
  view: UnitView;
  setView: (next: UnitView) => void;
  /** The payload the server built in the strategy's own unit. Masthead source. */
  nativePayload: FactsheetPayload;
  /** What the view-following surfaces render: native, or `usdView.payload` in the USD view. */
  selectedPayload: FactsheetPayload;
  /** `usdView` is present, so the USD segment is enabled. */
  usdAvailable: boolean;
  /** Why a native strategy has no USD view; `null` when it has one (or is not native). */
  unavailableReason: "price_read_failed" | "no_priced_day" | null;
}

const UnitViewContext = createContext<UnitViewValue | null>(null);

export function UnitViewProvider({
  payload,
  children,
}: {
  /** The NATIVE payload, as the server rendered it. */
  payload: FactsheetPayload;
  children: ReactNode;
}) {
  const [view, setViewRaw] = useState<UnitView>("native");
  const usdView = payload.usdView;
  const usdAvailable = usdView != null;
  const unavailableReason = usdAvailable ? null : (payload.usdViewUnavailable ?? null);

  const value = useMemo<UnitViewValue>(
    () => ({
      // A USD view that does not exist can never be the active one.
      view: usdAvailable ? view : "native",
      setView: (next) => {
        if (next === "usd" && !usdAvailable) return;
        setViewRaw(next);
      },
      nativePayload: payload,
      selectedPayload: view === "usd" && usdView ? usdView.payload : payload,
      usdAvailable,
      unavailableReason,
    }),
    [view, payload, usdView, usdAvailable, unavailableReason],
  );

  return <UnitViewContext.Provider value={value}>{children}</UnitViewContext.Provider>;
}

/** The unit view, or `null` outside a {@link UnitViewProvider} (native-only mounts, D-18). */
export function useUnitView(): UnitViewValue | null {
  return useContext(UnitViewContext);
}
