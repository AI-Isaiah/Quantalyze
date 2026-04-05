import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { StrategyHeader } from "@/components/strategy/StrategyHeader";
import { MetadataCards } from "@/components/strategy/MetadataCards";
import { PerformanceReport } from "@/components/strategy/PerformanceReport";
import { ComputeStatus } from "@/components/strategy/ComputeStatus";
import { RequestIntroButton } from "@/components/strategy/RequestIntroButton";
import { ShareableLink } from "@/components/strategy/ShareableLink";
import { AddToPortfolio } from "@/components/portfolio/AddToPortfolio";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getStrategyDetail } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ slug: string; strategyId: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { slug, strategyId } = await params;
  const cat = DISCOVERY_CATEGORIES.find((c) => c.slug === slug);
  const result = await getStrategyDetail(strategyId);

  if (!result) {
    return (
      <div className="text-center py-16 text-text-muted">
        Strategy not found.
      </div>
    );
  }

  const { strategy, analytics } = result;

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Discovery", href: "/discovery/crypto-sma" },
          { label: cat?.name ?? slug, href: `/discovery/${slug}` },
          { label: strategy.name },
        ]}
      />
      <div className="flex items-start justify-between mb-6">
        <StrategyHeader strategy={strategy} computedAt={analytics.computed_at} />
        <div className="flex items-center gap-3">
          <a
            href={`/factsheet/${strategy.id}`}
            target="_blank"
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-page transition-colors"
          >
            Factsheet
          </a>
          <AddToPortfolio strategyId={strategy.id} />
          <ShareableLink strategyId={strategy.id} />
          <RequestIntroButton strategyId={strategy.id} />
        </div>
      </div>
      <MetadataCards strategy={strategy} />
      {analytics.computation_status !== "complete" && (
        <div className="mb-6">
          <ComputeStatus status={analytics.computation_status} error={analytics.computation_error} />
        </div>
      )}
      <PerformanceReport analytics={analytics} />
      <Disclaimer variant="strategy" />
    </>
  );
}
