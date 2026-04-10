import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { getMyAllocationDashboard } from "@/lib/queries";
import { AllocatorExchangeManager } from "@/components/exchanges/AllocatorExchangeManager";
import { AllocationDashboard } from "./AllocationDashboard";
import Link from "next/link";
import { redirect } from "next/navigation";

/**
 * My Allocation — the allocator's live view of their actual investments.
 *
 * v0.4.0 pivot: Scenarios-style dashboard (KPI strip + equity curve +
 * investment list) driven by real data from exchange-sync'd portfolio
 * strategies. No favorites, no test portfolios, no what-if toggles —
 * that surface is /scenarios. Each row is a real investment made by
 * connecting a team to the allocator's exchange account via a
 * read-only API key.
 *
 * Empty state (no real portfolio yet): shows the inline
 * AllocatorExchangeManager directly so the allocator can connect their
 * first exchange without navigating anywhere.
 */
export default async function MyAllocationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { portfolio, analytics, strategies, apiKeys } =
    await getMyAllocationDashboard(user.id);

  if (!portfolio) {
    return (
      <main className="max-w-[1280px] mx-auto p-6 pb-20">
        <PageHeader
          title="My Allocation"
          description="Connect a read-only exchange API key to start tracking your real investments."
        />
        {apiKeys.length === 0 ? (
          <Card className="text-center py-12">
            <p className="text-text-muted mb-4">
              No exchange connections yet. Add a read-only API key from your
              exchange account to start tracking investments you&apos;ve made
              with external teams.
            </p>
            <Link
              href="/strategies"
              className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              Browse Strategies
            </Link>
          </Card>
        ) : null}
        <AllocatorExchangeManager initialKeys={apiKeys} />
      </main>
    );
  }

  return (
    <AllocationDashboard
      portfolio={portfolio}
      analytics={analytics}
      strategies={strategies}
      apiKeys={apiKeys}
    />
  );
}
