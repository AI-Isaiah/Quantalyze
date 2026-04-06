import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { AllocationEventForm } from "@/components/portfolio/AllocationEventForm";
import { AllocationTimeline } from "@/components/portfolio/AllocationTimeline";
import { getPortfolioDetail, getPortfolioStrategies, getAllocationEvents } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

const statusStyles: Record<string, string> = {
  connected: "bg-positive/10 text-positive",
  paused: "bg-badge-market-neutral/10 text-badge-market-neutral",
  exited: "bg-negative/10 text-negative",
};

export default async function ManagePortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const portfolio = await getPortfolioDetail(id);
  if (!portfolio) redirect("/portfolios");

  const [strategies, events] = await Promise.all([getPortfolioStrategies(id), getAllocationEvents(id)]);

  const strategyNames: Record<string, string> = {};
  const formStrategies: { strategy_id: string; strategy_name: string }[] = [];
  for (const ps of strategies) {
    const s = (ps as Record<string, unknown>).strategies as { id: string; name: string } | null;
    if (s) {
      strategyNames[s.id] = s.name;
      if (ps.relationship_status !== "exited") formStrategies.push({ strategy_id: s.id, strategy_name: s.name });
    }
  }

  return (
    <>
      <PageHeader
        title={`Manage ${portfolio.name}`}
        actions={
          <Link href={`/portfolios/${id}`} className="inline-flex items-center rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-text-primary hover:bg-page transition-colors">
            Back to Dashboard
          </Link>
        }
      />

      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-text-primary">Strategies</h2>
          <Link href="/discovery/crypto-sma" className="text-sm font-medium text-accent hover:text-accent-hover transition-colors">+ Add Strategy</Link>
        </div>
        {strategies.length === 0 ? (
          <Card className="text-center py-8"><p className="text-sm text-text-muted">No strategies in this portfolio yet.</p></Card>
        ) : (
          <div className="space-y-3">
            {strategies.map((ps) => {
              const s = (ps as Record<string, unknown>).strategies as { id: string; name: string } | null;
              return (
                <Card key={ps.strategy_id} padding="sm">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">{s?.name ?? ps.strategy_id}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-text-secondary">
                        {ps.allocated_amount != null && <span className="font-metric">{formatCurrency(ps.allocated_amount)}</span>}
                        {ps.current_weight != null && <span className="font-metric">{(ps.current_weight * 100).toFixed(1)}%</span>}
                      </div>
                    </div>
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${statusStyles[ps.relationship_status] ?? ""}`}>
                      {ps.relationship_status}
                    </span>
                    {/* TODO: add client RemoveStrategyButton for soft exit */}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {formStrategies.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold text-text-primary mb-4">Record Allocation Event</h2>
          <AllocationEventForm portfolioId={id} strategies={formStrategies} />
        </section>
      )}

      <section>
        <h2 className="text-base font-semibold text-text-primary mb-4">Allocation History</h2>
        <AllocationTimeline events={events} strategyNames={strategyNames} />
      </section>
    </>
  );
}
