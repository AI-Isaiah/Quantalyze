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
  // px endpoints map DESIGN.md §Typography 1:1 (hero 48/32, page-title 32,
  // h2 24, h3 16, body 14, small 13, caption 12, micro 10-11). Each `clamp`
  // is a STATIC literal (never `buildClamp(...)` at module-eval) so the drift
  // test reads it verbatim, and MUST appear byte-identically as
  // `--text-${tier}: ${clamp}` in the plain @theme block of globals.css.
  // Invariants (49-RESEARCH Pattern 2): the middle term carries a `rem`
  // component (WCAG 1.4.4 zoom-safety) and maxPx <= 2.5*minPx (200% zoom reach).
  // Anchors derived over the 320px→1280px viewport band.
  hero: { minPx: 32, maxPx: 48, clamp: "clamp(2rem, 1.5rem + 2.5vw, 3rem)" },
  "page-title": {
    minPx: 24,
    maxPx: 32,
    clamp: "clamp(1.5rem, 1.2rem + 1.5vw, 2rem)",
  },
  h2: { minPx: 20, maxPx: 24, clamp: "clamp(1.25rem, 1.1rem + 0.75vw, 1.5rem)" },
  h3: { minPx: 16, maxPx: 18, clamp: "clamp(1rem, 0.95rem + 0.25vw, 1.125rem)" },
  body: {
    minPx: 14,
    maxPx: 16,
    clamp: "clamp(0.875rem, 0.85rem + 0.125vw, 1rem)",
  },
  small: {
    minPx: 13,
    maxPx: 14,
    clamp: "clamp(0.8125rem, 0.8rem + 0.0625vw, 0.875rem)",
  },
  caption: {
    minPx: 12,
    maxPx: 13,
    clamp: "clamp(0.75rem, 0.73rem + 0.0625vw, 0.8125rem)",
  },
  micro: {
    minPx: 10,
    maxPx: 11,
    clamp: "clamp(0.625rem, 0.61rem + 0.0625vw, 0.6875rem)",
  },
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
