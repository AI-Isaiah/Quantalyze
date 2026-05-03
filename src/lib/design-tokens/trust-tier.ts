/**
 * Phase 17 / DESIGN-01 — Trust-tier badge design tokens.
 *
 * Single source-of-truth for the three pill variants used across
 * factsheet headers, marketplace tiles, and the admin /admin/csv-status
 * surface. Framework-neutral (no React import) so this file loads cleanly
 * from Vitest tests, server components, and any future Storybook.
 *
 * Consistency with DESIGN.md is asserted by
 * `tests/a11y/trust-tier-tokens.test.ts` — every hex below MUST appear
 * verbatim in DESIGN.md or that test fails on CI.
 *
 * Self-reported uses #B45309 (canonical `--color-warning` since
 * 2026-04-30 amber-700 shift; 5.05:1 on white = AA pass). REQ DESIGN-01
 * named the retired #D97706 hex; REQUIREMENTS.md is corrected in the
 * same wave (see Plan 17-02 of Phase 17).
 */

/**
 * Trust-tier variant union — canonical declaration. The legacy
 * `@/components/strategy/TrustTierLabel` location re-exports this type
 * for back-compat with existing imports (Phase 15 callers, future
 * Phase 18 consumers). Keep the data and the type co-located in the
 * design-tokens module so any future variant addition is a single-file
 * change.
 */
export type TrustTier = "api_verified" | "csv_uploaded" | "self_reported";

/**
 * Per-variant slot palette. `fill` is the inner background (or `#FFFFFF`
 * for outline variants), `text` is the label colour, `border` is the
 * 1px border colour, `label` is the user-facing pill text.
 */
export interface TrustTierTokenSlot {
  readonly fill: string;
  readonly text: string;
  readonly border: string;
  readonly label: string;
}

export const TRUST_TIER_TOKENS = {
  api_verified: {
    fill: "#1B6B5A",
    text: "#FFFFFF", // white on accent — 6.37:1 (AA pass; does NOT hit AAA 7:1)
    border: "#1B6B5A", // accent on white — 6.37:1
    label: "API verified",
  },
  csv_uploaded: {
    fill: "#FFFFFF",
    text: "#4A5568",
    border: "#4A5568",
    label: "CSV uploaded — verification pending",
  },
  self_reported: {
    fill: "#FFFFFF",
    text: "#B45309",
    border: "#B45309",
    label: "Self-reported",
  },
} as const satisfies Record<TrustTier, TrustTierTokenSlot>;
