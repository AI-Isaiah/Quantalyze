import { createClient } from "@/lib/supabase/server";
import { EMPTY_ANALYTICS } from "@/lib/queries";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { CompareTable } from "@/components/strategy/CompareTable";
import { CompareEquityOverlay } from "@/components/strategy/CompareEquityOverlay";
import { CompareCorrelationMatrix } from "@/components/strategy/CompareCorrelationMatrix";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const ids = params.ids?.split(",").filter(Boolean).slice(0, 4) ?? [];

  if (ids.length === 0) {
    return (
      <>
        <Breadcrumb items={[{ label: "Compare Strategies" }]} />
        <PageHeader title="Compare Strategies" />
        <p className="text-sm text-text-muted text-center py-16">
          Select strategies from the discovery page to compare. Add up to 4 strategies using the compare checkboxes.
        </p>
      </>
    );
  }

  const { data: strategies } = await supabase
    .from("strategies")
    .select("*, strategy_analytics (*)")
    .in("id", ids)
    .eq("status", "published");

  const items = (strategies ?? []).map((s) => ({
    strategy: s as Strategy,
    analytics: ((Array.isArray(s.strategy_analytics) ? s.strategy_analytics[0] : s.strategy_analytics) ?? { ...EMPTY_ANALYTICS, strategy_id: s.id }) as StrategyAnalytics,
  }));

  return (
    <>
      <Breadcrumb items={[{ label: "Discovery", href: "/discovery/crypto-sma" }, { label: "Compare" }]} />
      <PageHeader title={`Comparing ${items.length} Strategies`} />
      <div className="space-y-8">
        <CompareTable items={items} />
        <CompareEquityOverlay items={items} />
        <CompareCorrelationMatrix items={items} />
      </div>
    </>
  );
}
