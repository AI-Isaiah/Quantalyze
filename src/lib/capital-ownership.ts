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

/**
 * The single-source "is this one of the two marks" narrowing.
 *
 * Fails CLOSED exactly like its `isAllocatable` sibling: `null`, `undefined`
 * and any garbled value arriving from the untyped `text` column are NOT a
 * `CapitalOwnership`. Four sites — the tag, the v2 factsheet's owner lane and
 * the wizard's two finalize narrowings — each hand-spelled this pair of
 * comparisons; a fifth author reasoning about only the two KNOWN values is how
 * a fail-OPEN copy gets written, so the comparison lives here with the marks.
 */
export function isCapitalOwnership(v: unknown): v is CapitalOwnership {
  return v === OWN_CAPITAL || v === TEAM_REVIEW;
}

/**
 * The 23514 refusal, in the voice of the reader who is actually there.
 *
 * TWO ARMS BEHIND ONE `RAISE`. `guard_allocation_requires_own_capital` refuses
 * a position for two different reasons and reports both as a check_violation:
 *
 *   ARM 1 — the strategy is marked `team_review`. Fires for ANYONE, owner or
 *           not (`20260806120000_strategies_capital_ownership.sql`: the
 *           `v_mark = 'team_review'` disjunct carries NO owner conjunct). So
 *           BOTH readers arrive at one sentence, and they have opposite powers:
 *           the owner CAN flip the mark, a third-party allocator cannot — the
 *           row is not theirs, it never appears in their My Strategies list,
 *           and no route lets them mark it.
 *
 *           ⚠️ 151 review I3 — THE ERROR OBJECT CANNOT TELL THEM APART. It
 *           carries a code and a message, never an identity, and neither
 *           browser-direct writer knows the strategy's owner at the point of
 *           refusal (AddToPortfolio takes only a `strategyId`; the wizard's
 *           search projects only `id, name`). Rather than guess, the copy is
 *           written so it is TRUE FOR BOTH: it states the mark, and it
 *           attributes the remedy to the OWNER in the third person. An owner
 *           reads "its owner can change that mark in My Strategies" and knows
 *           both the lever and the screen — the actionable remedy this arm
 *           dropped when it first shipped as a bare statement of fact. A third
 *           party reads the same sentence as a description of someone else's
 *           power, so they are never sent to a screen that will not have the
 *           row. What is NOT said is the second person: no "your", no
 *           imperative aimed at the reader — that is the original finding, and
 *           it stays closed.
 *   ARM 2 — the strategy is SELF-OWNED and unmarked (every pre-150 row is
 *           NULL). The trigger's owner conjunct means only the owner can reach
 *           this arm, so here the second-person imperative is earned: "mark it
 *           in My Strategies" is exactly right, and it is one screen away.
 *
 * The arms are separable only because our own RAISE text carries the mark as
 * `capital_ownership=<mark>` — pinned cross-layer by the P4c census case. The
 * needle is INTERPOLATED from the constant above rather than spelled inline, so
 * a future rename of the mark moves this branch with it instead of silently
 * sending every third-party allocator down the owner-voiced arm.
 *
 * The driver's own `message` is NEVER returned: it carries a raw strategy UUID.
 *
 * ⚠️ This lives HERE, beside the marks, because AddToPortfolio and
 * MigrationWizard both write `portfolio_strategies` directly from the browser
 * and both must answer identically. When the copy was spelled twice, the second
 * site's comment already admitted it was a copy ("same two arms, same copy")
 * rather than sharing it. Their specs assert these sentences as typed LITERALS
 * on purpose — importing the string under test would make the assertion
 * vacuous — so a reword here is meant to redden both of them.
 */
export function capitalOwnershipRefusalMessage(
  error: { message?: string | null } | null | undefined,
): string {
  return error?.message?.includes(`capital_ownership=${TEAM_REVIEW}`)
    ? "This strategy is marked as a trading team's capital under review, so it can't be added to a portfolio. Its owner can change that mark in My Strategies."
    : "This strategy isn't marked as your own capital — mark it in My Strategies first.";
}
