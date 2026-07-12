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
 *     build-payload already overlaid the persisted cash scalars onto it (geometric
 *     or arithmetic per `returns_denominator_config` — Round-2 C-1; arithmetic
 *     only for the "simple"/allocated-capital override), so this is coherent with
 *     the persisted headline and byte-identical to today for single-key.
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
      // F2 (no-invented-data): STRICT overlay — any of the seven mapped scalars
      // absent / non-finite in the persisted MTM object renders "—" (NaN), NEVER
      // the cash fallback. The `?? {}` makes an entirely-absent MTM object render
      // all-seven "—" (the strict overlay's absent-branch keeps `base` for the
      // single-key/cash path, so MTM must force a present-empty object here).
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
 * character-exact. Server truth only — no client ledger predicate; a graceful
 * basis-agnostic default handles any un-enumerated reason (the TS union at
 * types.ts:500 is OPEN, so nothing mechanically requires enumerating a new
 * reason to render — the default degrades honestly).
 *
 * Phase 102 (MTM-01) rewrote every string to the honest current meaning
 * (DESIGN.md voice: factual, institutional, no contractions, never fabricating,
 * coverage-mask honesty). The dropped daily-mark smoothing framing that the
 * options-book reason used to carry is GONE — smoothing was permanently
 * retired in Phase 101. The default is
 * basis-agnostic ("for this strategy") because the old "for this composite" was
 * wrong for a single-key options strategy.
 */
export function mtmDisabledReasonCopy(reason?: string): string {
  switch (reason) {
    case "unsmoothed_options_book":
      // The live composite-gate return (stitch_composite.py:303) for any
      // options-member composite — the honest CURRENT meaning (the dropped
      // daily-mark smoothing explanation is retired).
      return "Mark-to-market unavailable: composites that include an options book report cash settlement only.";
    case "mtm_basis_unavailable_for_venue":
      return "Mark-to-market unavailable for this venue.";
    case "mtm_summary_coverage_incomplete":
      return "Mark-to-market unavailable: settlement history does not fully cover this book, so a mark-to-market series cannot be reconstructed.";
    case "mtm_series_uncomputable":
      return "Mark-to-market unavailable: the reconstructed mark-to-market series could not produce valid metrics.";
    case "mtm_second_pass_timeout":
      return "Mark-to-market temporarily unavailable: reconstruction exceeded its time budget and will be retried on the next data refresh.";
    case "mtm_anchor_race":
      // The reason constant ships in plan 102-02 (the vocabulary owner); the
      // "mtm_anchor_race" string literal is the cross-language contract — both
      // plans pin the same literal.
      return "Mark-to-market temporarily unavailable: the account changed during reconstruction; it will be recomputed on the next data refresh.";
    default:
      return "Mark-to-market unavailable for this strategy.";
  }
}

/**
 * DESIGN.md tone split for the MTM disabled-reason surface. `--color-warning`
 * amber is RESERVED for transient/recoverable states the system re-attempts on
 * its own — so ONLY the two reasons that self-heal on the next derive
 * (`mtm_second_pass_timeout`, `mtm_anchor_race`) are "transient". Every other
 * reason (coverage hole, uncomputable series, venue, options-composite, unknown/
 * default) is a steady-state honest-empty condition rendered in muted text; amber
 * there would falsely signal self-healing (RESEARCH Pitfall 4 + DESIGN.md Color:
 * "warning is reserved for transient recoverable states").
 */
export function mtmReasonTone(reason?: string): "transient" | "steady" {
  switch (reason) {
    case "mtm_second_pass_timeout":
    case "mtm_anchor_race":
      return "transient";
    default:
      return "steady";
  }
}
