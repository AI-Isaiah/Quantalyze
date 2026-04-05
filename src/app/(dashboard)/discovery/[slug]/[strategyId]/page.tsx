import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { StrategyHeader } from "@/components/strategy/StrategyHeader";
import { MetadataCards } from "@/components/strategy/MetadataCards";
import { PerformanceReport } from "@/components/strategy/PerformanceReport";
import { RequestIntroButton } from "@/components/strategy/RequestIntroButton";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getStrategyDetail } from "@/lib/queries";

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ slug: string; strategyId: string }>;
}) {
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
        <StrategyHeader strategy={strategy} />
        <RequestIntroButton strategyId={strategy.id} />
      </div>
      <MetadataCards strategy={strategy} />
      <PerformanceReport analytics={analytics} />
    </>
  );
}
