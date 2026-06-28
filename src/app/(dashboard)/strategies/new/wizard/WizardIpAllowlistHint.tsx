"use client";

import { WarningBanner } from "@/components/ui/WarningBanner";

/**
 * Phase 11 / S7 / D-07 — Persistent IP-allowlist hint strip.
 *
 * Mounted in WizardClient's parent layout IMMEDIATELY BELOW the
 * <WithdrawalWarningStrip /> (S5) with `mt-2` (8px gap) so the two
 * single-purpose safety notices stack without merging.
 *
 * Locked copy contract:
 *   - Verbatim CONTEXT D-07 sentence: "Locking your exchange key to an
 *     IP allowlist? Allow our egress IPs — see /security#egress-ips."
 *   - The `/security#egress-ips` token renders as a real <a> with
 *     visible text byte-identical to "/security#egress-ips" (the
 *     CONTEXT D-07 phrasing).
 *   - Composes from the existing <WarningBanner> primitive with the
 *     same className override as S5 so the wizard chrome reads as a
 *     visually consistent safety strip.
 *   - role="note" (NOT role="alert") — persistent informational
 *     context, not a transient announcement.
 *   - NO dismiss control — strip persists for the entire wizard session.
 */
export function WizardIpAllowlistHint() {
  return (
    <WarningBanner className="mt-2 border-l-4 border-warning bg-warning/5">
      <p
        role="note"
        aria-label="Exchange IP allowlist hint"
        className="text-sm text-text-secondary"
      >
        Locking your exchange key to an IP allowlist? Allow our egress IPs —
        see{" "}
        <a
          href="/security#egress-ips"
          className="text-accent underline underline-offset-4"
        >
          /security#egress-ips
        </a>
        .
      </p>
    </WarningBanner>
  );
}
