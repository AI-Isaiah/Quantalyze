"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FactsheetPayload, ComputeSummary } from "@/lib/factsheet/types";
import { overlayBasisScalars } from "@/lib/factsheet/basis-metrics";

/**
 * Phase 90 (FS-03, CONTEXT D5/D7) — the NARROW, EPHEMERAL basis context.
 *
 * Kept in a NEW file rather than the FROZEN `factsheet-context.tsx` (D7): it
 * mirrors that file's split-context template (`RegimesContext` — a narrow
 * context + memoized value + a hook that throws outside its provider) WITHOUT
 * importing any of its state internals.
 *
 * GUARD-04 (ephemeral by construction): this file contains NO browser-storage,
 * cookie, URL query, or history-API access anywhere — the cross-tab persistence
 * block (`factsheet-context.tsx:253-350`) is the anti-pattern deliberately NOT
 * copied. Basis lives in component state only, so every fresh view opens on cash
 * and toggling writes nothing to the URL or storage. Pinned by
 * `FactsheetBody.guard04-no-bleed.test.tsx` (no factsheet-keyspace write) and
 * `FactsheetBody.basis.test.tsx` (no-persistence-on-toggle).
 */
export type Basis = "cash_settlement" | "mark_to_market";

interface BasisContextValue {
  basis: Basis;
  setBasis: (next: Basis) => void;
}

const BasisContext = createContext<BasisContextValue | null>(null);

/**
 * Ephemeral basis state. Renders children only (no DOM element) so wrapping the
 * FactsheetBody tree is transparent to the GUARD-02 byte-identity gate. Default
 * `cash_settlement` (D5).
 */
export function BasisProvider({ children }: { children: ReactNode }) {
  const [basis, setBasis] = useState<Basis>("cash_settlement");
  const value = useMemo<BasisContextValue>(() => ({ basis, setBasis }), [basis]);
  return <BasisContext.Provider value={value}>{children}</BasisContext.Provider>;
}

/** Subscribe to the active basis + setter. Throws outside the provider. */
export function useBasis(): BasisContextValue {
  const v = useContext(BasisContext);
  if (!v) throw new Error("useBasis must be used inside <BasisProvider>");
  return v;
}

/**
 * The display-side basis mapping hook. Takes the payload as an argument
 * (deliberate deviation from the PATTERNS colocation in `basis-metrics.ts`: the
 * hook needs React context, but `basis-metrics.ts` must stay React-free for the
 * server-side D3 overlay — payload-as-arg avoids coupling to the frozen
 * FactsheetProvider).
 *
 *   - `cash_settlement` → `payload.strategyMetrics` UNTOUCHED. For composites,
 *     90-03 already overlaid the persisted arithmetic cash scalars onto it, so
 *     this is coherent with D3 and byte-identical to today for single-key.
 *   - `mark_to_market` → a shallow copy overlaying ONLY the seven mapped
 *     {@link overlayBasisScalars} scalars from the PERSISTED
 *     `metrics_json_by_basis.mark_to_market`. α/IR and every unmapped key keep
 *     their cash value — they are never displayed under an MTM label (the seven
 *     relabeled KpiStrip cells are exactly the mapped ones; D5, no-invented-data).
 */
export function useBasisMetrics(payload: FactsheetPayload): {
  basis: Basis;
  m: ComputeSummary;
} {
  const { basis } = useBasis();
  const m = useMemo<ComputeSummary>(() => {
    if (basis === "mark_to_market") {
      return overlayBasisScalars(
        payload.strategyMetrics,
        payload.metricsByBasis?.mark_to_market ?? {},
      );
    }
    return payload.strategyMetrics;
  }, [basis, payload]);
  return { basis, m };
}

/**
 * Closed-set MTM disabled-reason copy (CONTEXT D1 / UI-SPEC Copywriting),
 * character-exact. Server truth only — no client ledger predicate.
 */
export function mtmDisabledReasonCopy(reason?: string): string {
  switch (reason) {
    case "unsmoothed_options_book":
      return "Mark-to-market disabled: un-smoothed options book (Phase-83 daily-mark smoothing not applied)";
    case "mtm_basis_unavailable_for_venue":
      return "Mark-to-market unavailable for this venue.";
    default:
      return "Mark-to-market unavailable for this composite.";
  }
}
