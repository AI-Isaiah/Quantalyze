import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { StrategyHeader } from "@/components/strategy/StrategyHeader";
import { MetadataCards } from "@/components/strategy/MetadataCards";
import { PerformanceReport } from "@/components/strategy/PerformanceReport";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { MOCK_STRATEGIES, generateDetailAnalytics } from "@/lib/mock-data";

export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ slug: string; strategyId: string }>;
}) {
  const { slug, strategyId } = await params;
  const cat = DISCOVERY_CATEGORIES.find((c) => c.slug === slug);
  const strategy = MOCK_STRATEGIES.find((s) => s.id === strategyId);

  if (!strategy) {
    return (
      <div className="text-center py-16 text-text-muted">
        Strategy not found.
      </div>
    );
  }

  const analytics = generateDetailAnalytics(strategyId);

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Discovery", href: "/discovery/crypto-sma" },
          { label: cat?.name ?? slug, href: `/discovery/${slug}` },
          { label: strategy.name },
        ]}
      />
      <StrategyHeader strategy={strategy} onRequestIntro={() => {}} />
      <MetadataCards strategy={strategy} />
      <PerformanceReport analytics={analytics} />
    </>
  );
}
