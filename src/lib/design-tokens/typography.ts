/**
 * Phase 49 / DS-02·DS-03 — Fluid type-scale design tokens.
 *
 * Single source-of-truth for the named fluid (clamp-based) type tiers.
 * Framework-neutral (no React import) so this file loads cleanly from
 * Vitest tests, server components, and any future Storybook.
 *
 * Consistency with DESIGN.md AND globals.css @theme is asserted by
 * `tests/a11y/design-token-drift.test.ts` — every `clamp(...)` below MUST
 * appear verbatim in the plain @theme block of globals.css (NOT the
 * `@theme inline` block, which bakes the literal and flattens the var()
 * chain) and every px endpoint in DESIGN.md §Typography, or that test
 * fails on CI.
 */

/**
 * A single fluid type tier. `clamp` is the literal CSS `clamp(...)` string
 * the drift test reads verbatim out of globals.css; `minPx`/`maxPx` are the
 * px endpoints that must appear in DESIGN.md §Typography. Hard invariants
 * (49-RESEARCH Pattern 2, enforced by the guard tests): the `clamp` middle
 * term carries a `rem` component (WCAG 1.4.4 zoom-safety) and
 * `maxPx <= 2.5 * minPx` (guarantees 200% zoom reach).
 */
export interface TypeTier {
  readonly minPx: number;
  readonly maxPx: number;
  readonly clamp: string;
}

/**
 * The named fluid type tiers (hero / page-title / h2 / h3 / body / small /
 * caption / micro per DESIGN.md §Typography).
 *
 * Tiers populated in 49-02 (Wave 1). Wave 0 ships this skeleton so the drift
 * test imports cleanly and fails on assertions, not on a missing module.
 */
export const TYPE_SCALE = {
  // Tiers populated in 49-02 (Wave 1). Wave 0 ships this skeleton so the drift
  // test imports cleanly and fails on assertions, not on a missing module.
} as const satisfies Record<string, TypeTier>;

/**
 * Pure helper that derives a CSS `clamp(<minRem>, <interceptRem> + <slopeVw>, <maxRem>)`
 * string from px endpoints and the viewport range they interpolate across
 * (49-RESEARCH Pattern 2 derivation). 49-02 uses this to derive-then-check-in
 * the static `clamp` strings; the emitted CSS field is always a literal string
 * the drift test reads verbatim, so this helper never runs at render time.
 *
 *   slopeVw     = (maxPx - minPx) / (maxVw - minVw) * 100   // vw coefficient
 *   interceptRem = (minPx - slopeVw / 100 * minVw) / 16     // y-intercept in rem
 *   min/max rem  = px / 16
 */
export function buildClamp({
  minPx,
  maxPx,
  minVw,
  maxVw,
}: {
  minPx: number;
  maxPx: number;
  minVw: number;
  maxVw: number;
}): string {
  const slopeVw = ((maxPx - minPx) / (maxVw - minVw)) * 100;
  const interceptRem = (minPx - (slopeVw / 100) * minVw) / 16;
  const minRem = minPx / 16;
  const maxRem = maxPx / 16;
  return `clamp(${minRem}rem, ${interceptRem}rem + ${slopeVw}vw, ${maxRem}rem)`;
}
