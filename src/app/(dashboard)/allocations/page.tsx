import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { getRealPortfolio } from "@/lib/queries";
import Link from "next/link";
import { redirect } from "next/navigation";

/**
 * My Allocation — the allocator's single real invested book.
 *
 * PR 2 of the My Allocation restructure: the old cross-portfolio
 * scaffolding (4 aggregate KPI cards, portfolio list, alerts aggregate,
 * Active Connections) has been stripped. Connections now live at
 * /connections (lifted verbatim in this PR). The KPI row + portfolio list
 * are obsolete now that each allocator has exactly one real portfolio.
 *
 * PR 3 of the restructure fills this page with the full multi-strategy
 * dashboard: Fund KPI strip, YTD PnL by Strategy chart, MTD bars, and
 * strategy breakdown table. PR 4 wires the Favorites panel + Save-as-Test
 * modal on top.
 *
 * For the interim commit between PR 2 and PR 3 this page renders a
 * minimal "coming soon" shell so navigation still works and the route
 * doesn't crash.
 */
export default async function MyAllocationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const portfolio = await getRealPortfolio(user.id);

  if (!portfolio) {
    return (
      <>
        <PageHeader title="My Allocation" />
        <Card className="text-center py-12">
          <p className="text-text-muted mb-4">
            Your book is empty. Browse strategies to add your first allocation.
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
    <>
      <PageHeader
        title="My Allocation"
        description={portfolio.name}
      />
      <Card className="text-center py-12">
        <p className="text-text-muted">
          Multi-strategy dashboard loading in the next commit on this branch.
        </p>
      </Card>
    </>
  );
}
