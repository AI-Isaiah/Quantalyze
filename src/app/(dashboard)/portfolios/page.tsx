import { createClient } from "@/lib/supabase/server";
import { getTestPortfolios } from "@/lib/queries";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { CreatePortfolioForm } from "@/components/portfolio/CreatePortfolioForm";
import Link from "next/link";
import { redirect } from "next/navigation";

/**
 * Test Portfolios — saved hypothetical what-if scenarios.
 *
 * Renamed from the old generic "Portfolios" page as part of the My
 * Allocation restructure. The allocator's REAL invested book (single row
 * with is_test=false) lives on /allocations (My Allocation). This page
 * only ever lists the scenarios they've saved from the Favorites panel's
 * Save-as-Test flow (or created via the manual CreatePortfolioForm for
 * backwards compatibility).
 *
 * Detail pages (/portfolios/[id]) are unchanged — they still render the
 * full analytics dashboard, just reached from Test Portfolios instead of
 * the old top-level Portfolios list.
 */
export default async function TestPortfoliosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const portfolios = await getTestPortfolios(user.id);

  return (
    <>
      <PageHeader
        title="Test Portfolios"
        description="Saved what-if scenarios built from your Favorites. These never touch real money."
        actions={<CreatePortfolioForm />}
      />

      {portfolios.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-text-muted mb-4">
            No test portfolios yet. Open My Allocation, toggle some favorites
            on, and save the scenario you like.
          </p>
          <Link
            href="/allocations"
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Go to My Allocation
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {portfolios.map((p) => (
            <Link key={p.id} href={`/portfolios/${p.id}`}>
              <Card className="hover:border-accent/40 transition-colors h-full">
                <h3 className="font-semibold text-text-primary truncate">
                  {p.name}
                </h3>
                {p.description && (
                  <p className="mt-1 text-sm text-text-secondary line-clamp-2">
                    {p.description}
                  </p>
                )}
                <div className="mt-4 flex items-center justify-between text-xs text-text-muted">
                  <span>
                    {p.strategy_count} {p.strategy_count === 1 ? "strategy" : "strategies"}
                  </span>
                  <span>{new Date(p.created_at).toLocaleDateString()}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
