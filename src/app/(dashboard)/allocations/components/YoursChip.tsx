import { cn } from "@/lib/utils";

/**
 * Phase 152 / SCEN-02 — the "Yours" ownership chip.
 *
 * One recipe, two sites: the browse drawer's own rows (152-04) and the scenario
 * composer's added-strategy rows (152-05) render THIS component, never a
 * near-duplicate span. Ownership must look identical wherever it is claimed —
 * two hand-rolled chips drift, and a drifting ownership signal is worse than
 * none.
 *
 * Badge FAMILY, not the Badge COMPONENT — and that distinction is mechanical,
 * not stylistic:
 *
 * ⛔ It does NOT widen the capital-ownership tag's closed switch. That switch is
 *    closed over `CapitalOwnership` precisely so an unrecognised value can never
 *    fall through to a trusted-looking default (threat T-150-08). "Yours" is a
 *    different axis entirely — who authored the row, not how the capital is
 *    marked — so adding a key would both muddle the axis and reopen a switch
 *    that was deliberately sealed.
 *
 * ⛔ It does NOT route through the shared status-badge component, whose
 *    unrecognised-label branch falls back to the DRAFT entry: an ownership
 *    string handed to it would silently render as a credible-looking status
 *    badge. A component with no fallback cannot spoof.
 *
 * Anatomy is copied byte-verbatim from the capital-ownership tag
 * (`src/components/strategy/OwnershipTag.tsx:35`) and the ink from its
 * `team_review` entry (`:48`) — the muted member of the same family. `rounded-md`
 * is the persistent-FACT family (Phase-150 reasoning: identity is carried by
 * ink, not by shape); the uppercase `rounded-sm` family belongs to DERIVED state
 * that can change on its own, and ownership never does. The label is sentence
 * case for the same reason — it matches "Own capital" / "Team review", not the
 * shouty derived-state chips.
 *
 * The ink is muted, never amber, never red, never accent: ownership is a neutral
 * persistent fact, not a status and not the mark that unlocks a money action
 * (accent = "verified / action", DESIGN.md).
 *
 * There is deliberately NO variant prop. The component is closed by
 * construction: it renders one label with one ink, so there is no input that
 * could make it claim anything else. Callers gate on `isOwn === true` and simply
 * do not render it otherwise — absence is honest, and a fabricated ownership
 * claim on a legacy row (where the wire is silent) is the failure mode this
 * whole phase exists to avoid.
 */

const ANATOMY =
  "inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium";

const INK = "bg-badge-other/10 text-text-muted";

export interface YoursChipProps {
  className?: string;
  "data-testid"?: string;
}

export function YoursChip({
  className,
  "data-testid": testId,
}: YoursChipProps) {
  return (
    <span className={cn(ANATOMY, INK, className)} data-testid={testId}>
      Yours
    </span>
  );
}
