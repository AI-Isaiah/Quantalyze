"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import type { CtaLocation } from "@/lib/analytics";
import { RequestCallModal } from "./RequestCallModal";

/**
 * Primary + secondary CTA pair for `/for-quants`. Rendered twice (hero +
 * footer) with a `location` prop that feeds into the PostHog event so
 * the funnel can split hero-vs-footer click-through rates.
 *
 * Why the view event fires from here (client) instead of the page
 * (server): PostHog's browser SDK manages its own cookie-based anonymous
 * ID, which stays stable across view → click → submit for a single
 * user. Server-side tracking with an IP hash as distinctId would collide
 * with the client ID and split the funnel across three unrelated IDs.
 *
 * Why the view event uses a module-scope guard: the component mounts
 * twice per page (hero + footer), and we want exactly one view per
 * page load. Module state resets on full navigation, which is the
 * correct granularity.
 *
 * Auth-aware routing:
 *   - Unauthenticated → /signup?role=manager
 *   - Authenticated → /strategies/new (update when the wizard lands)
 */
const LOGGED_OUT_CTA_HREF = "/signup?role=manager";
// Task 1.2 shipped the Connect Your Strategy wizard. Logged-in managers
// land directly on the wizard instead of the legacy StrategyForm.
const LOGGED_IN_CTA_HREF = "/strategies/new/wizard";

let viewEventFired = false;

interface ForQuantsCtasProps {
  location: CtaLocation;
  isLoggedIn: boolean;
}

export function ForQuantsCtas({ location, isLoggedIn }: ForQuantsCtasProps) {
  const [modalOpen, setModalOpen] = useState(false);
  // Stable identity so the modal's Escape listener effect doesn't
  // re-subscribe on every parent re-render.
  const closeModal = useCallback(() => setModalOpen(false), []);

  useEffect(() => {
    if (viewEventFired) return;
    viewEventFired = true;
    trackForQuantsEventClient("for_quants_view", {
      referrer: typeof document !== "undefined" ? document.referrer : null,
    });
  }, []);

  const primaryHref = isLoggedIn ? LOGGED_IN_CTA_HREF : LOGGED_OUT_CTA_HREF;
  const primaryLabel = isLoggedIn ? "Connect your strategy" : "Start Wizard";

  return (
    <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <Link
        href={primaryHref}
        onClick={() =>
          trackForQuantsEventClient("for_quants_cta_click", {
            cta_location: location,
            destination: primaryHref,
          })
        }
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-accent px-6 py-3 text-base font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:w-auto"
      >
        {primaryLabel}
      </Link>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="text-sm text-text-muted underline-offset-4 transition-colors hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:text-text-primary focus-visible:underline"
      >
        Request a Call
      </button>
      <RequestCallModal
        open={modalOpen}
        onClose={closeModal}
        ctaLocation={location}
      />
    </div>
  );
}
