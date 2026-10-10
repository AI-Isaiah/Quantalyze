import { createClient } from "@/lib/supabase/server";
import { requireRolePage } from "@/lib/auth/requireRolePage";
import { withPublishedOnly } from "@/lib/visibility";
import {
  COMPARE_ANALYTICS_COLUMNS,
  EMPTY_ANALYTICS,
  extractAnalytics,
} from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { readHeadlineCoversFrom } from "@/lib/factsheet/composite-read-path";
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
            reflow-sweep anchor (h1:has-text("Compare Strategies")).
            Phase 170, 2026-09-27: the old sentence named a control that does
            not exist. */}
        <PageHeader
          title="Compare Strategies"
          breadcrumb={COMPARE_BREADCRUMB}
        />
        <p className="text-sm text-text-muted text-center py-16">
          Open a strategy&apos;s factsheet and choose &quot;Compare strategies&quot; to start a comparison. Adding strategies to a comparison from this page is not available yet.
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

  // Phase 167.1.2 review round 2 (SFH-R2-02): a failed strategies read used to
  // fold into `data ?? []` and render "This comparison isn't available", which
  // tells the allocator the strategies do not exist. Log the message only and
  // throw to the route's error boundary (compare/error.tsx: digest-only, with a
  // retry). D-15 is unchanged: an unpublished or unowned row is filtered out as
  // ZERO rows, never as an error, so a query failure reveals nothing about it.
  // The holding read throws HoldingCompareLoadError from the adapter for the
  // same reason, which rejects the Promise.all above the same way.
  const strategiesError = (strategiesRes as { error: { message: string } | null })
    .error;
  if (strategiesError) {
    console.error("[compare/page] strategies query failed:", strategiesError.message);
    throw new Error("compare strategies load failed");
  }

  const strategyItems = ((strategiesRes as { data: unknown[] | null }).data ?? []).map((s) => {
    const strat = s as Strategy & { strategy_analytics: unknown };
    const row = extractAnalytics(strat.strategy_analytics) as
      | Partial<StrategyAnalytics>
      | null;
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

  // Phase 170.2 (SC-3, D-07): the overlay draws a chain-broken row over the span
  // its headline cumulative return compounds, which starts on the day the stored
  // cash series names. That series sits behind deny-all RLS, so it is read with
  // the service role (T-170.2-10), and ONLY for a row the visibility-gated read
  // above already returned whose flag alias is exactly the string "true". Only
  // the derived DATE and a status leave this function; the series never does.
  //
  // The reader keeps two non-dated outcomes apart (a missing or undatable series
  // is `null`; a FAILED read throws CompositeSeriesReadError, "so an outage is
  // never rendered as 'the span cannot be named'"), and so does the page. A failed
  // read degrades that ONE row's chart, never the whole page: one chart must not
  // hide the comparison table, and the row is never drawn as a bridged curve.
  const overlayItems = await Promise.all(
    strategyOnlyItems.map(async (it) => {
      if (it.analytics.twr_chain_broken !== "true") return it;
      try {
        const headlineCoversFrom = await readHeadlineCoversFrom(
          createAdminClient(),
          it.strategy.id,
        );
        return {
          ...it,
          headlineCoversFrom,
          headlineCoversFromStatus:
            headlineCoversFrom === null ? ("undatable" as const) : ("dated" as const),
        };
      } catch (err) {
        // House rule: the message, never the error object.
        console.error(
          "[compare/page] covered-from read failed:",
          err instanceof Error ? err.message : String(err),
        );
        return {
          ...it,
          headlineCoversFrom: null,
          headlineCoversFromStatus: "read_failed" as const,
        };
      }
    }),
  );

  return (
    <>
      <PageHeader
        title={title}
        breadcrumb={[{ label: "Discovery", href: "/discovery/crypto-sma" }, { label: "Compare" }]}
      />
      {items.length === 1 ? (
        <p className="text-caption text-text-muted">
          One strategy selected. Adding a second strategy from this page is not available yet.
        </p>
      ) : null}
      {/* APPLY-01 / TYPE-03: compare is a DATA surface. It fluid-filled
          toward ~1920px until 2026-08-09, when the founder ruled that a fixed
          px cap producing dead margin on zoom-out is the worse trade — a table
          the user cannot widen is not "deliberate", it is clipped. Width is now
          owned solely by DashboardChrome's `isWide` arm. */}
      <div>
        <div className="space-y-8">
          <CompareTable items={items} />
          <CompareEquityOverlay items={overlayItems} />
          <CompareCorrelationMatrix items={strategyOnlyItems} />
        </div>
      </div>
    </>
  );
}
