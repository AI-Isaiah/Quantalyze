import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyAllocationDashboard } from "@/lib/queries";
import {
  getLatestExposureSnapshot,
  getNetExposureSeries,
  getAllocationSeries,
} from "@/lib/portfolio-exposure";
import type { ExposureSectionData } from "./lib/exposure-props";
import { AllocationsTabs } from "./AllocationsTabs";
import { AllocationProvider } from "./AllocationContext";
import { redirect } from "next/navigation";
import {
  maybeEmitSignup,
  maybeEmitOnboardingEvent,
  maybeEmitFirstBridgeSurfaced,
} from "@/lib/analytics/onboarding-funnel";

export const dynamic = "force-dynamic";

/**
 * My Allocation — tabbed dashboard.
 *
 * Phase 07 / PURGE-07 / D-04. Two surfaces: Performance (default, real
 * exchange-verified data) and Scenario (Phase 10 stub). URL state is
 * governed by the `?tab=` query param — handled inside AllocationsTabs.
 *
 * The AllocationsTabs client component calls `useSearchParams`, which
 * triggers Next.js 16's CSR-bailout rule for the route unless the
 * component is wrapped in a `<Suspense>` boundary at a parent — we wrap
 * it here with a minimal fallback so the route stays statically
 * optimizable and the build produces no useSearchParams/Suspense warning.
 *
 * Empty-state handling (zero holdings) migrates into the AllocationDashboardV2
 * render path in 07-05 (WarningBanner + minimal 4-widget view). Phase 06
 * moved the "Connect Exchange" key-management flow to `/profile?tab=exchanges`;
 * the inline exchange-manager widget no longer lives on this page.
 */
export default async function MyAllocationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Phase 99 / 99-04 — fetch the polled dashboard payload AND the three
  // exposure reads in ONE Promise.all with the AUTHENTICATED user.id
  // (`supabase.auth.getUser()` above — never a client-supplied id; the
  // rls-auditor carry-forward). The exposure reads are NOT folded into
  // getMyAllocationDashboard (that payload has a client refresh/poll path; the
  // exposure reads are a daily-grain 730-day paged scan that runs once per page
  // load). No error-swallowing wrapper here: the read layer THROWS on PostgREST
  // errors and that throw must reach `allocations/error.tsx` — an error and an
  // empty book are distinct states; never collapse an error into empty-state copy.
  const [payload, snapshot, netSeries, allocationSeries] = await Promise.all([
    getMyAllocationDashboard(user.id),
    getLatestExposureSnapshot(user.id),
    getNetExposureSeries(user.id),
    getAllocationSeries(user.id),
  ]);
  const exposure: ExposureSectionData = { snapshot, netSeries, allocationSeries };

  // Phase 11 / Plan 03 / D-13 — fire onboarding-funnel events (single-fire
  // via *_emitted_at sentinels on auth.users.raw_user_meta_data). All five
  // helpers are non-blocking; allSettled prevents one analytics failure from
  // cascading into a page render error. Each helper short-circuits when the
  // marker has already been emitted, so the steady-state cost is metadata
  // reads only (no PostHog or admin writes).
  const admin = createAdminClient();
  await Promise.allSettled([
    maybeEmitSignup(admin, user),
    maybeEmitOnboardingEvent(admin, user, "first_api_key_added"),
    maybeEmitOnboardingEvent(admin, user, "first_sync_success"),
    maybeEmitOnboardingEvent(admin, user, "first_outcome_recorded"),
    maybeEmitFirstBridgeSurfaced(admin, user, payload.flaggedHoldings.length),
  ]);

  return (
    // JOURNEY-03 (a11y) — this page renders INSIDE DashboardChrome's
    // `<main aria-label="Dashboard content">`, so a second <main> here is a
    // duplicate landmark (axe `landmark-no-duplicate-main`, WCAG best-practice).
    // Use a plain <div>; the chrome owns the single main landmark.
    <div className="max-w-[1920px] mx-auto p-6 pb-20">
      <Suspense fallback={<div />}>
        {/* PR1 QA — page-level PageHeader removed in favor of the
            AllocationsTabs inline header (title + entity name + tabs +
            actions in ONE row), matching designer-bundle/project/src/app.jsx
            lines 460-510. Eliminates the multi-row vertical sprawl visible
            in the QA pass.

            Plan 11 / R5 — publish flaggedHoldings.length from the existing
            payload through AllocationProvider; DashboardChrome / Sidebar
            (mounted above this tree) read the count via the provider's
            cross-tree store. No new server query. */}
        <AllocationProvider value={{ flaggedCount: payload.flaggedHoldings.length }}>
          <AllocationsTabs {...payload} exposure={exposure} />
        </AllocationProvider>
      </Suspense>
    </div>
  );
}
