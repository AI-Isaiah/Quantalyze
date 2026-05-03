import { cn } from "@/lib/utils";
import { TRUST_TIER_TOKENS, type TrustTier } from "@/lib/design-tokens/trust-tier";

/**
 * Single source-of-truth string for the CSV-uploaded trust-tier label.
 * Phase 15 lock; Phase 17 / DESIGN-01 sources the value from
 * `TRUST_TIER_TOKENS.csv_uploaded.label` so the two stay in sync.
 *
 * Existing consumers that import this constant continue to work
 * unchanged. Do NOT inline this string at any call-site — read it from
 * this constant, OR (preferred for new code) read it from
 * `TRUST_TIER_TOKENS.csv_uploaded.label` directly.
 */
export const CSV_UPLOADED_LABEL = TRUST_TIER_TOKENS.csv_uploaded.label;

/**
 * Re-export the canonical TrustTier union from the design-tokens module
 * for back-compat with existing imports. New code should import from
 * `@/lib/design-tokens/trust-tier` directly.
 */
export type { TrustTier };

interface TrustTierLabelProps {
  trustTier: TrustTier | null | undefined;
  className?: string;
}

/**
 * Phase 17 / DESIGN-01 — three-variant outline pill driven by
 * `TRUST_TIER_TOKENS`. The call signature is byte-identical to the
 * Phase 15 v0 (15-CONTEXT.md "Trust-Tier Placeholder Display") —
 * callers (StrategyHeader, StrategyGrid, future admin row) do NOT
 * refactor.
 *
 * Variants:
 *   - `api_verified`:  filled accent (#1B6B5A) + white text — "API verified"
 *   - `csv_uploaded`:  neutral grey outline (#4A5568 border + text on
 *                      white surface) — "CSV uploaded — verification pending"
 *   - `self_reported`: warning amber outline (#B45309 border + text on
 *                      white surface) — "Self-reported"
 *   - `null` | `undefined`: returns null (no render — preserves the
 *                           Phase 15 v0 contract).
 *
 * Visual lock per DESIGN.md "Trust-Tier Badges" sub-section:
 * `inline-flex items-center rounded-sm border px-2 py-0.5 text-xs
 * font-medium` — 4px radius (`rounded-sm` per the badge ladder), 1px
 * border, 12px DM Sans medium. No icons; identity is carried by border
 * + text colour only.
 *
 * Mirrors the SyncBadge.tsx pure-render pattern — no `"use client"`
 * directive, no hooks. The `data-trust-tier` attribute lets visual-
 * regression and E2E tests target the variant without coupling to the
 * literal label text.
 */
export function TrustTierLabel({
  trustTier,
  className,
}: TrustTierLabelProps) {
  if (trustTier == null) return null;
  const token = TRUST_TIER_TOKENS[trustTier];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={{
        color: token.text,
        backgroundColor: token.fill,
        borderColor: token.border,
      }}
      data-testid="trust-tier-label"
      data-trust-tier={trustTier}
    >
      {token.label}
    </span>
  );
}
