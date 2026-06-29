import { createClient } from "@/lib/supabase/server";
import { withPublishedOnly } from "@/lib/visibility";
import { EMPTY_ANALYTICS } from "@/lib/queries";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { CompareTable } from "@/components/strategy/CompareTable";
import { CompareEquityOverlay } from "@/components/strategy/CompareEquityOverlay";
import { CompareCorrelationMatrix } from "@/components/strategy/CompareCorrelationMatrix";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import {
  parseHoldingCompareId,
  fetchHoldingCompareItem,
  type HoldingCompareItem,
} from "./lib/holding-compare-adapter";

// Phase 51 NAV-02 — the back-path crumb is identical across all three render
// branches (empty-selection, not-available, results), so it lives in one place.
const COMPARE_BREADCRUMB = [
  { label: "Discovery", href: "/discovery/crypto-sma" },
  { label: "Compare" },
];

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
        {/* 52-UI-SPEC copy contract: the empty-selection state names what is
            missing + what to do (honest absence, neutral muted card — never a
            fabricated zero/count-up; STATE-02). The "Compare Strategies"
            PageHeader title is preserved verbatim — it is the 52-01 e2e
            reflow-sweep anchor (h1:has-text("Compare Strategies")). */}
        <PageHeader
          title="Compare Strategies"
          breadcrumb={COMPARE_BREADCRUMB}
        />
        <p className="text-sm text-text-muted text-center py-16">
          Pick two or more strategies from discovery to see them side by side. Add up to 4 strategies using the compare checkboxes.
        </p>
      </>
    );
  }

  // Phase 09 / Pitfall 8: partition ids BEFORE the strategies fetch.
  // holding: prefixed ids go through the holding path; UUIDs go through strategies.
  const holdingIds = ids.filter((id) => parseHoldingCompareId(id) !== null);
  const strategyIds = ids.filter((id) => parseHoldingCompareId(id) === null);

  const [strategiesRes, holdingItemsRes] = await Promise.all([
    strategyIds.length > 0
      ? withPublishedOnly(
          supabase
            .from("strategies")
            .select("*, strategy_analytics (*)")
            .in("id", strategyIds),
        )
      : Promise.resolve({ data: [], error: null }),
    Promise.all(
      holdingIds.map((hid) =>
        fetchHoldingCompareItem({
          allocator_id: user.id,
          holding_ref: hid,
          supabase,
        }),
      ),
    ),
  ]);

  const strategyItems = ((strategiesRes as { data: unknown[] | null }).data ?? []).map((s) => {
    const strat = s as Strategy & { strategy_analytics: unknown };
    return {
      kind: "strategy" as const,
      strategy: strat as Strategy,
      analytics: ((Array.isArray(strat.strategy_analytics) ? strat.strategy_analytics[0] : strat.strategy_analytics) ?? { ...EMPTY_ANALYTICS, strategy_id: strat.id }) as StrategyAnalytics,
    };
  });

  const holdingItems = holdingItemsRes.filter(
    (x): x is HoldingCompareItem => x !== null,
  );

  // Merged items[] with discriminator; preserve input ordering from ids param
  const items = ids
    .map((id) => {
      if (parseHoldingCompareId(id) !== null) {
        return holdingItems.find((h) => h.holding_ref === id) ?? null;
      }
      return strategyItems.find((s) => s.strategy.id === id) ?? null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // D-15: if all ids were invalid / unowned / not found → generic not-available
  if (items.length === 0) {
    return (
      <>
        <PageHeader
          title="Compare"
          breadcrumb={COMPARE_BREADCRUMB}
        />
        <p className="text-sm text-text-muted text-center py-16">
          This comparison isn&apos;t available.
        </p>
      </>
    );
  }

  // Title: mixed mode says "items", pure-strategy says "Strategies"
  const allStrategies = items.every((item) => item.kind === "strategy");
  const title = allStrategies
    ? `Comparing ${items.length} ${items.length === 1 ? "Strategy" : "Strategies"}`
    : `Comparing ${items.length} ${items.length === 1 ? "item" : "items"}`;

  // CompareEquityOverlay and CompareCorrelationMatrix operate on
  // `item.strategy` — they predate the Phase 09 discriminated union and
  // have no returns-series equivalent for holdings. Pass the strategy slice
  // only; the holding rows render via CompareTable's kind-branch.
  const strategyOnlyItems = items.filter(
    (it): it is Extract<typeof items[number], { kind: "strategy" }> =>
      it.kind === "strategy",
  );

  return (
    <>
      <PageHeader
        title={title}
        breadcrumb={[{ label: "Discovery", href: "/discovery/crypto-sma" }, { label: "Compare" }]}
      />
      {/* APPLY-01 / TYPE-03: compare is a DATA surface — fluid-fill toward
          ~1920px then center with gutters beyond, so the comparison table
          reads as a deliberate institutional layout at the wider measure
          rather than stranded across an uncapped canvas. */}
      <div className="mx-auto max-w-[1920px]">
        <div className="space-y-8">
          <CompareTable items={items} />
          <CompareEquityOverlay items={strategyOnlyItems} />
          <CompareCorrelationMatrix items={strategyOnlyItems} />
        </div>
      </div>
    </>
  );
}
