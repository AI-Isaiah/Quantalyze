import { cn } from "@/lib/utils";

/**
 * CoverageStateChip (COVERAGE-02) — the reusable three-state per-row legibility
 * chip for the scenario coverage-window blend.
 *
 * Presentation-only. The chip receives its `state` as a prop; membership
 * derivation lives in ScenarioComposer (from `selected` + `coverageEligible`,
 * the single engine-reconciled axis). This component NEVER imports the window
 * helpers or re-derives membership — that would risk disagreeing with the blend
 * divisor (Pitfall 1, divisor desync).
 *
 * LOCKED state → label → token mapping (58-UI-SPEC §Color, DESIGN.md-grounded):
 *   in-blend           → "In blend"       accent      (verified member)
 *   manually-excluded  → "Excluded"       muted-neutral (deliberate + sticky)
 *   auto-excluded      → "Outside window" warning-amber (transient-recoverable)
 *
 * The text label always carries the meaning — color is never the sole signal
 * (WCAG-AA). Auto-excluded is AMBER (the DESIGN.md reservation for transient
 * recoverable states — narrowing the window brings the strategy back), NEVER
 * negative/red (that would signal permanent failure). Reuses the exact
 * HoldingsTable revoked-key chip tokens (warning / warning-bg / warning-border).
 */
export type CoverageState = "in-blend" | "manually-excluded" | "auto-excluded";

const CHIP: Record<CoverageState, { label: string; cls: string }> = {
  "in-blend": { label: "In blend", cls: "text-accent bg-accent/10" },
  "manually-excluded": { label: "Excluded", cls: "text-text-muted bg-track" },
  "auto-excluded": {
    label: "Outside window",
    cls: "text-warning bg-warning-bg border border-warning-border",
  },
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
