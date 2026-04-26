"use client";

import { WarningBanner } from "@/components/ui/WarningBanner";

/**
 * Phase 11 / S5 / D-08 — Persistent withdrawal-permission warning strip.
 *
 * Mounted in WizardClient's parent layout (above the step branches inside
 * <WizardChrome>) so the warning is visible across all 4 wizard steps.
 *
 * UI-SPEC §S5 LOCKED contract:
 *   - Component name `WithdrawalWarningStrip` is byte-identical (no alias,
 *     no rename to WizardSafetyNotice or similar — UI-SPEC AC #7).
 *   - Verbatim CONTEXT D-08 sentence: "READ ONLY ONLY — keys with Trade
 *     or Withdraw permissions are refused on submission."
 *   - Composes from the existing <WarningBanner> primitive with the
 *     locked className override `border-l-4 border-warning bg-warning/5`
 *     (switches the primitive's default `badge-market-neutral` tint to
 *     the warning token from CONTEXT D-08).
 *   - role="note" (NOT role="alert") — strip is persistent informational
 *     context, not a transient announcement.
 *   - NO dismiss control — strip persists for the entire wizard session.
 *
 * Sibling: <WizardIpAllowlistHint /> (S7) is rendered IMMEDIATELY BELOW
 * this component with `mt-2` (8px gap) so the two single-purpose strips
 * read as a stacked safety notice without merging into a 2-line strip.
 * Each strip owns its own ARIA label so screen-readers announce the two
 * notes distinctly.
 */
export function WithdrawalWarningStrip() {
  return (
    <WarningBanner className="border-l-4 border-warning bg-warning/5">
      <div role="note" aria-label="Wizard read-only key requirement">
        <p className="text-sm">
          <span className="font-semibold text-text-primary">READ ONLY</span>{" "}
          <span className="text-text-secondary">
            ONLY — keys with Trade or Withdraw permissions are refused on
            submission.
          </span>
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Read-only is enforced server-side at validation — Trade/Withdraw
          scopes are rejected before encryption.
        </p>
      </div>
    </WarningBanner>
  );
}
