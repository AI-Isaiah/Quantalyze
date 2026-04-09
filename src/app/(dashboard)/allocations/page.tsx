import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { getMyAllocationDashboard } from "@/lib/queries";
import { MyAllocationClient } from "./MyAllocationClient";
import Link from "next/link";
import { redirect } from "next/navigation";

/**
 * My Allocation — the allocator's single real invested book, visualized
 * as a multi-strategy dashboard.
 *
 * Top-level server component for the route. Calls
 * getMyAllocationDashboard (wrapped in React.cache) to fetch the real
 * portfolio + analytics + strategies-with-daily-returns + favorites +
 * alert counts in one parallel round of Supabase queries, then hands
 * the payload off to MyAllocationClient to render the interactive
 * chart + KPI strip + bars + table.
 *
 * No 'use cache' directive: the project does not enable Cache Components
 * in next.config.ts. The page is effectively dynamic (createClient reads
 * cookies for auth) and each load gets a fresh DB read, with React.cache
 * in queries.ts deduplicating per-request.
 *
 * The Favorites panel is NOT wired here — that lands in the next commit
 * on this branch (PR 4). The header button is a disabled stub until
 * then.
 */
export default async function MyAllocationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { portfolio, analytics, strategies, alertCount } =
    await getMyAllocationDashboard(user.id);

  if (!portfolio) {
    return (
      <>
        <PageHeader title="My Allocation" />
        <Card className="text-center py-12">
          <p className="text-text-muted mb-4">
            Your book is empty. Browse strategies to add your first
            allocation.
          </p>
          <Link
            href="/strategies"
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Browse Strategies
          </Link>
        </Card>
      </>
    );
  }

  return (
    <MyAllocationClient
      portfolio={portfolio}
      analytics={analytics}
      strategies={strategies}
      alertCount={alertCount}
    />
  );
}
