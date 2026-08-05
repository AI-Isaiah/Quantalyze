import { cn } from "@/lib/utils";

/**
 * CoverageStateChip (COVERAGE-02) — the reusable per-row legibility chip for a
 * scenario constituent. It answers exactly ONE question: is this row in the
 * blend, and if not, why? The axis spans blend membership (coverage window +
 * user intent) AND series availability (147-05 / SCEN-01).
 *
 * Presentation-only. The chip receives its `state` as a prop; membership
 * derivation lives in ScenarioComposer (from `selected` + `coverageEligible`,
 * the single engine-reconciled axis) and series availability is derived
 * SERVER-side. This component NEVER imports the window helpers, never
 * re-derives membership, and never reads the analytics computation status —
 * that would risk disagreeing with the blend divisor (Pitfall 1, divisor
 * desync).
 *
 * LOCKED state → label → token mapping (58-UI-SPEC + 147-UI-SPEC §1, DESIGN.md-grounded):
 *   in-blend           → "In blend"       accent      (verified member)
 *   manually-excluded  → "Excluded"       muted-neutral (deliberate + sticky)
 *   auto-excluded      → "Outside window" warning-amber (transient-recoverable)
 *   syncing            → "Syncing"        warning-amber (transient-recoverable)
 *   no-series          → "No data"        muted-neutral (steady-state absence)
 *
 * The text label always carries the meaning — color is never the sole signal
 * (WCAG-AA). Amber is the DESIGN.md reservation for transient recoverable
 * states: narrowing the window brings an auto-excluded strategy back, and the
 * server finishes computing a syncing one on its own. Absence (`no-series`) is
 * muted because it is an honest steady-state fact. NEITHER is ever
 * negative/red — red would signal permanent failure, and DESIGN.md reserves it
 * for "permanent/negative only… never for absence, never for a zero". Reuses
 * the exact HoldingsTable revoked-key chip tokens (warning / warning-bg /
 * warning-border) for the amber pair; the tones repeat because the semantics
 * repeat, and the differing labels do the disambiguating.
 */
export type CoverageState =
  | "in-blend"
  | "manually-excluded"
  | "auto-excluded"
  | "syncing"
  | "no-series";

const CHIP: Record<CoverageState, { label: string; cls: string }> = {
  "in-blend": { label: "In blend", cls: "text-accent bg-accent/10" },
  "manually-excluded": { label: "Excluded", cls: "text-text-muted bg-track" },
  "auto-excluded": {
    label: "Outside window",
    cls: "text-warning bg-warning-bg border border-warning-border",
  },
  syncing: {
    label: "Syncing",
    cls: "text-warning bg-warning-bg border border-warning-border",
  },
  "no-series": { label: "No data", cls: "text-text-muted bg-track" },
};

// Badge ladder base (Badge.tsx:53, tightened to the 58-UI-SPEC chip tier):
// 4px radius, px-2 py-0.5, 11px uppercase medium tracking.
const BASE =
  "inline-flex items-center rounded-sm px-2 py-0.5 text-fixed-11 font-medium uppercase tracking-wide";

export interface CoverageStateChipProps {
  state: CoverageState;
  className?: string;
}

export function CoverageStateChip({ state, className }: CoverageStateChipProps) {
  const { label, cls } = CHIP[state];
  return <span className={cn(BASE, cls, className)}>{label}</span>;
}
