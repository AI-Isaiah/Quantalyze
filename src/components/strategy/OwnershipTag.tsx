import { cn } from "@/lib/utils";
import {
  OWN_CAPITAL,
  TEAM_REVIEW,
  type CapitalOwnership,
} from "@/lib/capital-ownership";

/**
 * Phase 150 / OWN-03 — the capital-ownership mark tag.
 *
 * Badge FAMILY, not the Badge COMPONENT. The anatomy class string below is
 * reused verbatim from `Badge.tsx:62` (`rounded-md` — the persistent,
 * owner-declared family, the same one the status Badge belongs to; identity
 * within the family is carried by INK, not by shape). It is deliberately NOT
 * the uppercase `rounded-sm` chip family used by StrategyTable for pipeline
 * state — that family is DERIVED state that can change on its own, and the
 * mark never does.
 *
 * ⛔ This is a separate component rather than a `Badge type="status"` call or a
 * new key in Badge's status lookup, and that is mechanical, not stylistic:
 * `Badge.tsx:55` falls back to the DRAFT entry for any unrecognised label, so
 * an ownership value routed through it would silently render as a
 * trusted-looking Draft badge (threat T-150-08 — UI spoofing). A closed switch
 * with no fallback cannot.
 *
 * (The two forbidden identifiers are deliberately NOT spelled here: the
 * acceptance grep for them runs over this file and would match its own prose.)
 *
 * Three display states, and one of them is nothing: an unmarked legacy row
 * renders NO tag. Absence is honest — the remedy is the Mark-ownership dialog,
 * never a fabricated default. See `@/lib/capital-ownership`.
 */

const ANATOMY =
  "inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium";

const LABELS = {
  [OWN_CAPITAL]: "Own capital",
  [TEAM_REVIEW]: "Team review",
} as const;

const INK = {
  // Accent = "verified / action" (DESIGN.md). This mark IS the fact that
  // unlocks the money action. In-family precedent: Badge's `intro_made` ink.
  [OWN_CAPITAL]: "bg-accent/10 text-accent",
  // The default, and a neutral fact — never red, never amber, never "less
  // than". Same muted ink Badge uses for `private` / `archived`.
  [TEAM_REVIEW]: "bg-badge-other/10 text-text-muted",
} as const;

export function OwnershipTag({
  mark,
}: {
  mark: CapitalOwnership | null | undefined;
}) {
  if (mark !== OWN_CAPITAL && mark !== TEAM_REVIEW) return null;

  return <span className={cn(ANATOMY, INK[mark])}>{LABELS[mark]}</span>;
}
