import { createClient } from "@/lib/supabase/server";
import { getUserPortfolios } from "@/lib/queries";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { CreatePortfolioForm } from "@/components/portfolio/CreatePortfolioForm";
import Link from "next/link";
import { redirect } from "next/navigation";

/**
 * /portfolios — generic portfolios browser.
 *
 * The v0.4.0 pivot dropped the "Test Portfolios" rename and moved the
 * allocator's REAL book to /allocations (their what-if exploration lives
 * in the scenario composer there). This page remains an ALLOCATOR
 * deep-link surface for building comparison collections of discovered
 * strategies — it is reached via AddToPortfolio on the discovery detail
 * page, not from primary nav (removed from the sidebar in v0.4.0).
 * Phase 109 review correction: /portfolios is guarded allocator-owned
 * (prod: 14 allocator owners, 0 manager owners); the prior "kept for
 * managers" note was wrong — no manager has ever owned a portfolio.
 * CreatePortfolioForm is still available for manual (is_test) creation.
 */
export default async function PortfoliosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const portfolios = await getUserPortfolios();

  return (
    <>
      <PageHeader
        title="Portfolios"
        description="Build collections of strategies for comparison."
        actions={<CreatePortfolioForm />}
      />

      {portfolios.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-text-muted mb-4">No portfolios yet.</p>
          <CreatePortfolioForm />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {portfolios.map((p) => (
            <Link key={p.id} href={`/portfolios/${p.id}`}>
              <Card className="hover:border-accent/40 transition-colors h-full">
                <h3 className="font-semibold text-text-primary break-words min-w-0">
                  {p.name}
                </h3>
                {p.description && (
                  /* line-clamp kept: the full description is one click away on
                     this card's own detail page (the whole Card is a Link to
                     /portfolios/[id]) — audit recommendation #3. */
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
