import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { StrategyHeader } from "@/components/strategy/StrategyHeader";
import { MetadataCards } from "@/components/strategy/MetadataCards";
import { PerformanceReport } from "@/components/strategy/PerformanceReport";
import { ComputeStatus } from "@/components/strategy/ComputeStatus";
import { RequestIntroButton } from "@/components/strategy/RequestIntroButton";
import { BookIntroCall } from "@/components/strategy/BookIntroCall";
import { ShareableLink } from "@/components/strategy/ShareableLink";
import { AddToPortfolio } from "@/components/portfolio/AddToPortfolio";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { ManagerIdentityPanel } from "@/components/strategy/ManagerIdentityPanel";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getStrategyDetail, getPercentiles } from "@/lib/queries";
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
  const [result, percentileMap] = await Promise.all([
    getStrategyDetail(strategyId),
    getPercentiles(slug),
  ]);

  if (!result) {
    return (
      <div className="text-center py-16 text-text-muted">
        Strategy not found.
      </div>
    );
  }

  const { strategy, analytics, manager, disclosureTier } = result;
  const percentiles = percentileMap?.[strategyId] ?? null;

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
          <ShareableLink strategyId={strategy.id} variant="primary" />
          <a
            href={`/factsheet/${strategy.id}`}
            target="_blank"
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-page transition-colors"
          >
            Factsheet
          </a>
          {disclosureTier === "institutional" && (
            <a
              href={`/factsheet/${strategy.id}/tearsheet`}
              target="_blank"
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-page transition-colors"
            >
              Tear Sheet
            </a>
          )}
          <AddToPortfolio strategyId={strategy.id} />
          <BookIntroCall strategyName={strategy.name} />
          <RequestIntroButton strategyId={strategy.id} />
        </div>
      </div>
      <MetadataCards strategy={strategy} />

      <div className="mb-6">
        <ManagerIdentityPanel
          disclosureTier={disclosureTier}
          manager={manager}
          strategyCodename={strategy.name}
        />
      </div>

      <Disclaimer variant="custody" className="mb-6" />

      {/* Verified vs Self-Reported */}
      {strategy.api_key_id && (
        <div className="flex gap-4 mb-6 text-xs">
          <div className="flex-1 rounded-lg border border-positive/20 bg-positive/5 px-4 py-3">
            <p className="font-semibold text-positive mb-1">Verified (Exchange API)</p>
            <p className="text-text-secondary">Trade history, PnL, returns, all analytics metrics, equity curve</p>
          </div>
          <div className="flex-1 rounded-lg border border-border bg-page px-4 py-3">
            <p className="font-semibold text-text-primary mb-1">Self-Reported</p>
            <p className="text-text-secondary">Strategy description, AUM, capacity, leverage, strategy type</p>
          </div>
        </div>
      )}

      {analytics.computation_status !== "complete" && (
        <div className="mb-6">
          <ComputeStatus status={analytics.computation_status} error={analytics.computation_error} />
        </div>
      )}
      <PerformanceReport analytics={analytics} percentiles={percentiles} />
      <Disclaimer variant="strategy" />

      {/* Sticky Request Intro CTA */}
      <div className="fixed bottom-0 left-0 right-0 md:left-[260px] z-10 border-t border-border bg-white/95 backdrop-blur-sm px-6 py-3 flex items-center justify-between">
        <p className="text-sm text-text-secondary hidden sm:block">
          Interested in <span className="font-medium text-text-primary">{strategy.name}</span>?
        </p>
        <RequestIntroButton strategyId={strategy.id} />
      </div>
    </>
  );
}
