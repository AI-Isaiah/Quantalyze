import { cn } from "@/lib/utils";

/**
 * Single source-of-truth string for the CSV-uploaded trust-tier label.
 * Exported for tests + Phase 17 / DESIGN-01 promotion to
 * `src/lib/design-tokens/trust-tier.ts`. Do NOT inline this string at
 * any call-site — read it from this constant.
 */
export const CSV_UPLOADED_LABEL = "CSV uploaded — verification pending";

export type TrustTier = "api_verified" | "csv_uploaded" | "self_reported";

interface TrustTierLabelProps {
  trustTier: TrustTier | null | undefined;
  className?: string;
}

/**
 * Phase 15 v0 — plain muted text for the csv_uploaded variant; renders
 * nothing for api_verified / self_reported / null / undefined. Phase 17
 * / DESIGN-01 swaps the internals to a polished outline pill (#4A5568
 * neutral) without changing this call signature. Callers must NOT
 * depend on the rendered DOM shape.
 *
 * UI-SPEC §3 typography lock: text-xs text-text-muted (12px / 400 /
 * #64748B). UI-SPEC §8.8 copy lock: CSV_UPLOADED_LABEL exact string.
 *
 * Mirrors the SyncBadge.tsx pattern — pure render, no client directive,
 * no hooks. The `data-trust-tier` attribute lets Phase 17 visual-
 * regression tests target the placeholder without coupling to the
 * literal text.
 */
export function TrustTierLabel({
  trustTier,
  className,
}: TrustTierLabelProps) {
  if (trustTier !== "csv_uploaded") return null;
  return (
    <span
      className={cn("text-xs text-text-muted", className)}
      data-testid="trust-tier-label"
      data-trust-tier="csv_uploaded"
    >
      {CSV_UPLOADED_LABEL}
    </span>
  );
}
