"use client";

import Link from "next/link";
import { WarningBanner } from "@/components/ui/WarningBanner";
import { useSessionStorageBoolean } from "@/lib/hooks/useSessionStorageBoolean";

/**
 * Onboarding banner.
 *
 * Visibility predicate (gated by parent):
 *   visible = (apiKeysCount === 0)
 *           && !sessionStorage["allocations.onboarding_banner_dismissed"]
 *
 * SSR safety + CLS guard:
 *   Server renders the banner unconditionally when apiKeysCount===0.
 *   Client useEffect reads sessionStorage post-mount and may HIDE
 *   the banner (state update — no layout shift on initial paint).
 *
 * Composition: <WarningBanner className="border-l-4 border-warning
 * bg-warning/5">. No new wrapper component.
 *
 * Copy: locked. Do not rephrase. The byte-identical "Connect Exchange →"
 * string also appears in EmptyState.tsx.
 */

const STORAGE_KEY = "allocations.onboarding_banner_dismissed";

export function OnboardingBanner() {
  // useSessionStorageBoolean consolidates the SSR-safe
  // "render-then-hide-after-mount" pattern and the dismiss-flag write.
  // First paint renders the banner; the post-mount effect inside the hook
  // may flip dismissed=true.
  const [dismissed, setDismissed] = useSessionStorageBoolean(STORAGE_KEY);

  const handleDismiss = () => setDismissed(true);

  if (dismissed) return null;

  return (
    <WarningBanner className="border-l-4 border-warning bg-warning/5">
      {/*
        flex-wrap + a grouped shrink-0 actions block: the CTA Link and the
        dismiss × are kept together and never compressed. On wide/normal widths
        (>=~336px) everything sits on one row (heading grows to fill). On very
        narrow phones the actions block wraps BELOW the heading instead of
        stealing its width. Rationale: pinning only the × (shrink-0) would just
        move flex-compression onto the un-pinned Link, which could clip/overflow
        the "Connect Exchange →" pill at ~320px. Grouping the actions removes the
        horizontal competition entirely so the × keeps its full 32×32 tap target
        (WCAG 2.5.8) at every width.
      */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1">
          {/*
            This heading is <h2>: the page outline on /allocations is
            <h1>My Allocation</h1> at the AllocationsTabs section heading
            and nothing at h2 yet. The banner is the FIRST top-level
            subsection on the page, so h2 is the correct level — h1 → h3
            would be a WCAG 1.3.1 skip (screen-reader heading-navigation
            gap). Peer subsection headings on the same page
            (MandateQuickSetCard, AuditLogSubsection) already use <h2>.
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
        <div className="flex shrink-0 items-center gap-4">
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
            // shrink-0 (belt-and-suspenders under the shrink-0 actions wrapper):
            // keeps the 32×32 box from ever compressing below WCAG 2.5.8 — the
            // prior bare button collapsed to ~15px wide on narrow phones. Full
            // 32×32 visible, 44×44 with the `before:inset-[-6px]` hit-area.
            className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center text-text-muted hover:text-text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 before:absolute before:inset-[-6px] before:content-['']"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
    </WarningBanner>
  );
}
