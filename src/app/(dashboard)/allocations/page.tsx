import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { getMyAllocationDashboard } from "@/lib/queries";
import { AllocationsTabs } from "./AllocationsTabs";
import { AllocationProvider } from "./AllocationContext";
import { redirect } from "next/navigation";

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
 * Empty-state handling (zero holdings) migrates into the AllocationDashboard
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

  const payload = await getMyAllocationDashboard(user.id);

  return (
    <main className="max-w-[1280px] mx-auto p-6 pb-20">
      <PageHeader
        title="My Allocation"
        description="Your live exchange-verified portfolio."
      />
      <Suspense fallback={<div />}>
        {/* Plan 11 / R5 — publish flaggedHoldings.length from the existing
            payload through AllocationProvider; DashboardChrome / Sidebar
            (mounted above this tree) read the count via the provider's
            cross-tree store. No new server query. */}
        <AllocationProvider value={{ flaggedCount: payload.flaggedHoldings.length }}>
          <AllocationsTabs {...payload} />
        </AllocationProvider>
      </Suspense>
    </main>
  );
}
