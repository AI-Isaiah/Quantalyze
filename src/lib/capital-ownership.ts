/**
 * Phase 150 / OWN-03 — the capital-ownership mark and its ONE predicate.
 *
 * THREE DISPLAY STATES, TWO LOGIC STATES.
 *
 *   `null`          — never asked (legacy rows onboarded before this phase).
 *                     Renders NO tag. Absence is honest; the remedy is the
 *                     Mark-ownership dialog, not a fabricated default.
 *   `"team_review"` — the owner is verifying a trading team's key.
 *                     Renders the MUTED tag. It is the wizard default.
 *   `"own_capital"` — the owner's own money is in this key.
 *                     Renders the ACCENT tag. The ONLY allocatable mark.
 *
 * `null` and `"team_review"` collapse to the same LOGIC state (both
 * non-allocatable) while staying distinct DISPLAY states. Do NOT "simplify"
 * the three into two, in either direction: stamping legacy rows with a
 * `team_review` default would be a fabricated claim about whose capital it is
 * (no-invented-data), and treating `null` as allocatable would mint the money
 * action for a strategy nobody ever marked. See 150-RESEARCH.md
 * § Schema Findings 1 — the column is deliberately NULLABLE, no DEFAULT, no
 * backfill.
 *
 * The predicate is spelled HERE and nowhere else. A second ad-hoc
 * `=== "own_capital"` comparison is the drift this module exists to prevent
 * (threat T-150-07); the phase gate pins the literal to this file.
 */

export const OWN_CAPITAL = "own_capital" as const;
export const TEAM_REVIEW = "team_review" as const;

export type CapitalOwnership = typeof OWN_CAPITAL | typeof TEAM_REVIEW;

/**
 * The single-source allocatable predicate.
 *
 * Fails CLOSED: anything that is not exactly `own_capital` — including `null`,
 * `undefined`, and any future/garbled value arriving from the untyped `text`
 * column — is NON-allocatable.
 */
export function isAllocatable(
  mark: CapitalOwnership | null | undefined,
): boolean {
  return mark === OWN_CAPITAL;
}
