"use client";

import Link from "next/link";
import { WarningBanner } from "@/components/ui/WarningBanner";
import { useSessionStorageBoolean } from "@/lib/hooks/useSessionStorageBoolean";

/**
 * Phase 11 / 11-05 / S1 / ONBOARD-01 — Onboarding banner.
 *
 * Visibility predicate (UI-SPEC §Interaction Contract — gated by parent):
 *   visible = (apiKeysCount === 0)
 *           && !sessionStorage["allocations.onboarding_banner_dismissed"]
 *
 * SSR safety + CLS guard (RESEARCH Pitfall 6 + 8):
 *   Server renders the banner unconditionally when apiKeysCount===0.
 *   Client useEffect reads sessionStorage post-mount and may HIDE
 *   the banner (state update — no layout shift on initial paint).
 *
 * Composition (UI-SPEC AC #14):
 *   <WarningBanner className="border-l-4 border-warning bg-warning/5">
 *   No new wrapper component.
 *
 * Copy: VERBATIM from UI-SPEC §S1. Do not rephrase. The byte-identical
 * "Connect Exchange →" string appears in EmptyState.tsx — Plan 04 already
 * permits this file in the Connect-Exchange copy allowlist.
 */

const STORAGE_KEY = "allocations.onboarding_banner_dismissed";

export function OnboardingBanner() {
  // Phase 11 review fix IN-01: useSessionStorageBoolean consolidates the
  // SSR-safe "render-then-hide-after-mount" pattern (RESEARCH Pitfall 6)
  // and the dismiss-flag write. First paint renders the banner; the
  // post-mount effect inside the hook may flip dismissed=true.
  const [dismissed, setDismissed] = useSessionStorageBoolean(STORAGE_KEY);

  const handleDismiss = () => setDismissed(true);

  if (dismissed) return null;

  return (
    <WarningBanner className="border-l-4 border-warning bg-warning/5">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          {/*
            Phase 11 review fix WR-03: this heading was previously <h3>, but
            the page outline on /allocations is <h1>My Allocation</h1> at
            the AllocationsTabs section heading and nothing at h2 yet. The
            banner is the FIRST top-level subsection on the page, so h2 is
            the correct level. h1 → h3 was a WCAG 1.3.1 skip (screen-reader
            heading-navigation gap). Peer subsection headings on the same
            page (MandateQuickSetCard, AuditLogSubsection) already use <h2>.
          */}
          <h2
            id="onboarding-banner-heading"
            className="text-lg font-semibold text-text-primary leading-snug"
          >
            Connect your exchange to see real performance
          </h2>
          <p className="text-sm text-text-secondary leading-relaxed mt-1">
            Add a read-only API key — we&apos;ll pull your real holdings within
            one sync cycle and populate Performance, Bridge, and Scenario.
          </p>
        </div>
        <Link
          href="/profile?tab=exchanges"
          className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          Connect Exchange →
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss for this session"
          className="relative inline-flex h-8 w-8 items-center justify-center text-text-muted hover:text-text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 before:absolute before:inset-[-6px] before:content-['']"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </WarningBanner>
  );
}
