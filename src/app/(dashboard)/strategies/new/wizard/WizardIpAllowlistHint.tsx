"use client";

import { ContactPointerText } from "@/components/contact/ContactPointerText";
import { WarningBanner } from "@/components/ui/WarningBanner";
import { EGRESS_IP_STATUS_LINK } from "@/lib/contact";

/**
 * Phase 11 / S7 / D-07 — Persistent IP-allowlist hint strip; pointer reworked by
 * Phase 201 PLAINWORDS plan 32 (F-12, UI-SPEC 8.2, U-28), which overrides plan
 * 05's D-13 contact-form version.
 *
 * Mounted in WizardClient's parent layout IMMEDIATELY BELOW the
 * <WithdrawalWarningStrip /> (S5) with `mt-2` (8px gap) so the two
 * single-purpose safety notices stack without merging.
 *
 * Locked copy contract:
 *   - Sentence: "Locking your exchange key to an IP allowlist? Check our
 *     egress IP status first."
 *   - The phrase `egress IP status` is the one link, to the `/security`
 *     section that says whether there is an address to allow. The phrase and
 *     href are the shared EGRESS_IP_STATUS_LINK pair, rendered by
 *     <ContactPointerText> in a new tab because the wizard sits over unsaved
 *     state. No contact-form link, no raw path.
 *   - Composes from the existing <WarningBanner> primitive with the
 *     same className override as S5 so the wizard chrome reads as a
 *     visually consistent safety strip.
 *   - role="note" (NOT role="alert") — persistent informational
 *     context, not a transient announcement.
 *   - NO dismiss control — strip persists for the entire wizard session.
 */
export function WizardIpAllowlistHint() {
  return (
    <WarningBanner className="mt-2 rounded-md border border-warning/30 bg-warning/5">
      <p
        role="note"
        aria-label="Exchange IP allowlist hint"
        className="text-body text-text-secondary"
      >
        <ContactPointerText
          text={`Locking your exchange key to an IP allowlist? Check our ${EGRESS_IP_STATUS_LINK.text} first.`}
          href={EGRESS_IP_STATUS_LINK.href}
          linkText={EGRESS_IP_STATUS_LINK.text}
          newTab
        />
      </p>
    </WarningBanner>
  );
}
