import { createClient } from "@/lib/supabase/server";
import { requireRolePage } from "@/lib/auth/requireRolePage";
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

/**
 * Phase 159 (159-03, RANK-02 / decision D-02) — the compare analytics
 * projection, replacing a wildcard analytics embed.
 *
 * Compare is an AUTHED allocator surface, but it is CROSS-TENANT: an allocator
 * reads other managers' published strategies, which is why the requirement
 * names this site alongside the anonymous ones. RLS is ROW-level and cannot
 * hide a column, so an explicit column list is the only control over what
 * leaves the database — `daily_returns`, the `metrics_json` blob and
 * `data_quality_flags` are all absent here and none of them was ever read.
 *
 * Enumerated from the compare UI at HEAD (enumerate before cutting):
 *   - the nine `METRICS` rows in CompareTable (:27-37), read by DYNAMIC key
 *     (`getValue(item.analytics, metric.key)`), so a missing column shows as
 *     an em-dash rather than a crash — a silent regression, hence the pin in
 *     page.test.tsx.
 *   - `returns_series`, read by BOTH CompareEquityOverlay (:40) and
 *     CompareCorrelationMatrix (:26). Dropping it blanks both charts.
 */
const COMPARE_ANALYTICS_COLUMNS =
  "cumulative_return, cagr, sharpe, sortino, calmar, max_drawdown, max_drawdown_duration_days, volatility, six_month_return, returns_series";

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
  // Phase 109 ROLE-04 — allocator-owned surface. OUTSIDE any try/catch:
  // the wrong-role redirect() throws NEXT_REDIRECT.
  await requireRolePage(supabase, user, "allocator");

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
            .select(`*, strategy_analytics (${COMPARE_ANALYTICS_COLUMNS})`)
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
    const row = (Array.isArray(strat.strategy_analytics)
      ? strat.strategy_analytics[0]
      : strat.strategy_analytics) as Partial<StrategyAnalytics> | null | undefined;
    return {
      kind: "strategy" as const,
      strategy: strat as Strategy,
      // Phase 159 (159-03 / RANK-02): the read above is now a PARTIAL
      // projection, so compose it over EMPTY_ANALYTICS — defaults first,
      // fetched columns second. Downstream reads are typed `StrategyAnalytics`
      // and would otherwise see `undefined` (not `null`) for any column the
      // projection omits. This is the same fallback shape an ABSENT analytics
      // row already produced; the spread simply also covers the present-row
      // case. Fetched values always win — no fetched column is defaulted over.
      analytics: {
        ...EMPTY_ANALYTICS,
        strategy_id: strat.id,
        ...(row ?? {}),
      } as StrategyAnalytics,
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
      {/* APPLY-01 / TYPE-03: compare is a DATA surface. It fluid-filled
          toward ~1920px until 2026-08-09, when the founder ruled that a fixed
          px cap producing dead margin on zoom-out is the worse trade — a table
          the user cannot widen is not "deliberate", it is clipped. Width is now
          owned solely by DashboardChrome's `isWide` arm. */}
      <div>
        <div className="space-y-8">
          <CompareTable items={items} />
          <CompareEquityOverlay items={strategyOnlyItems} />
          <CompareCorrelationMatrix items={strategyOnlyItems} />
        </div>
      </div>
    </>
  );
}
