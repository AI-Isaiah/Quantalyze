import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { StrategyHeader } from "@/components/strategy/StrategyHeader";
import { MetadataCards } from "@/components/strategy/MetadataCards";
import { PerformanceReport } from "@/components/strategy/PerformanceReport";
import { RequestIntroButton } from "@/components/strategy/RequestIntroButton";
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
        <RequestIntroButton strategyId={strategy.id} />
      </div>
      <MetadataCards strategy={strategy} />
      <PerformanceReport analytics={analytics} />
      <Disclaimer variant="strategy" />
    </>
  );
}
