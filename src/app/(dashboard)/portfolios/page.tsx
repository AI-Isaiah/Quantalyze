import { createClient } from "@/lib/supabase/server";
import { getUserPortfolios } from "@/lib/queries";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { CreatePortfolioForm } from "@/components/portfolio/CreatePortfolioForm";
import Link from "next/link";
import { redirect } from "next/navigation";

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
