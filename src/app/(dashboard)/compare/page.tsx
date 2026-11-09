import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireRolePage } from "@/lib/auth/requireRolePage";
import { withPublishedOnly } from "@/lib/visibility";
import {
  COMPARE_ANALYTICS_COLUMNS,
  EMPTY_ANALYTICS,
  extractAnalytics,
} from "@/lib/queries";
import { readHeadlineBasis } from "@/lib/factsheet/headline-basis";
import { usesLastSuccessSnapshot } from "@/lib/stored-analytics-result";
import { annualizationPeriods } from "@/lib/closed-sets";
import { figureRecord, type FigureRecord } from "@/lib/figure-gate";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { CompareTable } from "@/components/strategy/CompareTable";
import { CompareEquityOverlay } from "@/components/strategy/CompareEquityOverlay";
import { CompareCorrelationMatrix } from "@/components/strategy/CompareCorrelationMatrix";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { COMPARE_MAX_ITEMS, compareHref } from "@/lib/compare-href";
import { CompareAddStrategy } from "./CompareAddStrategy";
import {
  parseHoldingCompareId,
  fetchHoldingCompareItem,
  type HoldingCompareItem,
} from "./lib/holding-compare-adapter";

export const metadata: Metadata = { title: "Compare strategies" };

/**
 * One compare row as the projection returns it: the analytics columns, plus the
 * phase 190 alias INPUTS (`COMPARE_ANALYTICS_COLUMNS`) that pick the row's flags
 * generation. They are consumed in the page and never placed on an item.
 * `src/lib/types.ts` carries the two shared ones; the other two are compare-only.
 * `record_observations` (194 D-15) is the stored count of return observations, appended
 * at this page's own select call site; it too is consumed here and never placed on an item.
 */
type CompareProjectedRow = Partial<StrategyAnalytics> & {
  record_observations?: number | null;
  headline_since?: string | null;
  last_success_twr_chain_broken?: string | null;
  last_success_headline_since?: string | null;
};

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
  const ids = params.ids?.split(",").filter(Boolean).slice(0, COMPARE_MAX_ITEMS) ?? [];

  if (ids.length === 0) {
    return (
      <>
        {/* 52-UI-SPEC copy contract: the empty-selection state names what is
            missing + what to do (honest absence, never a fabricated zero; STATE-02).
            The "Compare strategies" PageHeader title is preserved verbatim: it is
            the 52-01 e2e reflow-sweep anchor (h1:has-text("Compare strategies")).
            Phase 197 (D-04): the page now adds strategies itself, so the removed
            copy that said adding was unavailable is gone and the search leads. */}
        <PageHeader
          title="Compare strategies"
          breadcrumb={COMPARE_BREADCRUMB}
        />
        <CompareAddStrategy currentIds={[]} />
        <p className="text-caption text-text-muted">
          No strategies selected yet. Add one above, or select 2 to 4 in Discovery and choose Compare.
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
            // 194 D-15: the stored observation count is appended HERE, not in
            // COMPARE_ANALYTICS_COLUMNS, so queries.ts and its exact-set pin stay as
            // they are. One scalar alias; `metrics_json` itself is never projected.
            .select(
              `*, strategy_analytics (${COMPARE_ANALYTICS_COLUMNS}, record_observations:metrics_json->record_observations)`,
            )
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

  // Phase 190 plan 07 (D-02, SC-6): the effective covered-from date per strategy
  // id, taken from the same flags generation as the row's chain-broken flag and
  // curve method. It is kept here, outside the item, because `headline_since` is
  // an alias INPUT that never reaches a client component.
  const effectiveHeadlineSince = new Map<string, unknown>();
  // 194 D-15: each strategy column's TOTAL record (three scalars), built here from the
  // row's first and last return date, the effective `headline_since` and the stored
  // observation count. It is NOT counted from `returns_series`, which the producer caps.
  const figureRecords = new Map<string, FigureRecord>();

  const strategyItems = ((strategiesRes as { data: unknown[] | null }).data ?? []).map((s) => {
    const strat = s as Strategy & { strategy_analytics: unknown };
    const row = extractAnalytics(strat.strategy_analytics) as
      | CompareProjectedRow
      | null;

    // One flags generation per row (plan 03's effective flags, over scalar
    // aliases). The derive hop's prestamp replaces the LIVE flags before the new
    // run writes its figures, while the stored curve and headline stay the last
    // success's. When the live marker is gone and the last-success aliases are
    // bound to this row's `computed_at`, the whole row (chain-broken flag, curve
    // method, covered-from date) reads from the last success. Otherwise it reads
    // from the live aliases, as fetched. Never a mix of the two.
    const fromSnapshot = usesLastSuccessSnapshot(row);
    effectiveHeadlineSince.set(
      strat.id,
      fromSnapshot ? row?.last_success_headline_since : row?.headline_since,
    );
    const series = Array.isArray(row?.returns_series) ? row.returns_series : null;
    const headlineSince = effectiveHeadlineSince.get(strat.id);
    figureRecords.set(
      strat.id,
      figureRecord({
        seriesStart: series?.[0]?.date ?? null,
        seriesEnd: series?.[series.length - 1]?.date ?? null,
        headlineSince: typeof headlineSince === "string" ? headlineSince : null,
        observations: row?.record_observations,
        periodsPerYear: annualizationPeriods(strat.asset_class),
      }),
    );
    const generation: Partial<StrategyAnalytics> = fromSnapshot
      ? {
          twr_chain_broken: row?.last_success_twr_chain_broken ?? null,
          cumulative_method: row?.last_success_cumulative_method ?? null,
        }
      : {};

    // The alias inputs are consumed above and dropped here, before the row is
    // placed on any item a client component can receive.
    const fetched: CompareProjectedRow = { ...(row ?? {}) };
    delete fetched.headline_since;
    delete fetched.record_observations;
    delete fetched.last_success_computed_at;
    delete fetched.last_success_cumulative_method;
    delete fetched.last_success_twr_chain_broken;
    delete fetched.last_success_headline_since;

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
      // The effective generation, when it is the snapshot's, wins over the
      // fetched live aliases for exactly the two fields it names.
      analytics: {
        ...EMPTY_ANALYTICS,
        strategy_id: strat.id,
        ...fetched,
        ...generation,
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
        <CompareAddStrategy currentIds={[]} />
      </>
    );
  }

  // The ids the page actually renders (strategy ids and holding refs), in display
  // order. The search and the Remove links build their URLs from these, never from
  // the raw `ids` value: an id the page could not resolve is dropped, and the cap
  // counts what is on screen.
  const currentIds = items.map((it) =>
    it.kind === "strategy" ? it.strategy.id : it.holding_ref,
  );

  // Remove link per strategy column: the same comparison without that id. Removing
  // the last one gives compareHref([]), which is /compare.
  const removeHrefs: Record<string, string> = {};
  for (const it of items) {
    if (it.kind === "strategy") {
      removeHrefs[it.strategy.id] = compareHref(
        currentIds.filter((id) => id !== it.strategy.id),
      );
    }
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
  // its headline cumulative return compounds, which starts on the day the
  // headline's own run names. Since phase 190 that day is the row's effective
  // `headline_since`, the field and validator (`readHeadlineBasis`) the factsheet
  // dates the same headline by; Python writes it in the same run as the headline.
  //
  // The stored cash series row is NOT read: the derive hop rewrites it
  // (`_persist_cash_series`) before the success write, so it can name a new
  // derive's last-break date over the last success's curve. For the same reason
  // the flag and method come from the effective generation above, not the live
  // aliases, which the derive hop's prestamp rewrites. The rule does not depend
  // on computation_status: a chain-broken row is `complete_with_warnings` and
  // the status bridge holds it there through the derive hop, so a rule keyed on
  // pending or computing would miss the window this exists for.
  //
  // Nothing is left that can fail: no read, no outage state. A chain-broken row
  // with no valid `headline_since` (a legacy mixed-basis row, which the factsheet
  // Withholds) is "undatable": the overlay draws no curve for it.
  const overlayItems = strategyOnlyItems.map((it) => {
    if (it.analytics.twr_chain_broken !== "true") return it;
    const { headlineSince } = readHeadlineBasis({
      twr_chain_broken: true,
      headline_since: effectiveHeadlineSince.get(it.strategy.id),
    });
    return {
      ...it,
      headlineCoversFrom: headlineSince,
      headlineCoversFromStatus:
        headlineSince === null ? ("undatable" as const) : ("dated" as const),
    };
  });

  // 194 D-15: the table's strategy columns carry their record; the overlay and the matrix
  // keep the items above, so their key sets do not change.
  const tableItems = items.map((it) =>
    it.kind === "strategy"
      ? { ...it, figureRecord: figureRecords.get(it.strategy.id) as FigureRecord }
      : it,
  );

  return (
    <>
      <PageHeader
        title={title}
        breadcrumb={[{ label: "Discovery", href: "/discovery/crypto-sma" }, { label: "Compare" }]}
      />
      {/* Phase 197 (D-04): one item gets a caption above the search; every state
          below the cap gets the search, built from the resolved ids. The cap caption
          sits inside the content stack below. Spacing uses space-y here, not margin
          classes, so the box-inset match with loading.tsx (loading.test.tsx) holds. */}
      {items.length < COMPARE_MAX_ITEMS ? (
        <div className="space-y-4">
          {items.length === 1 ? (
            <p className="text-caption text-text-muted">
              One strategy selected. Add another to compare.
            </p>
          ) : null}
          <CompareAddStrategy currentIds={currentIds} />
        </div>
      ) : null}
      {/* APPLY-01 / TYPE-03: compare is a DATA surface. It fluid-filled
          toward ~1920px until 2026-08-09, when the founder ruled that a fixed
          px cap producing dead margin on zoom-out is the worse trade — a table
          the user cannot widen is not "deliberate", it is clipped. Width is now
          owned solely by DashboardChrome's `isWide` arm. */}
      <div>
        <div className="space-y-8">
          {items.length >= COMPARE_MAX_ITEMS ? (
            <p className="text-caption text-text-muted">
              Comparing {COMPARE_MAX_ITEMS} strategies, the maximum. Remove one to add another.
            </p>
          ) : null}
          <CompareTable items={tableItems} removeHrefs={removeHrefs} />
          <CompareEquityOverlay items={overlayItems} />
          <CompareCorrelationMatrix items={strategyOnlyItems} />
        </div>
      </div>
    </>
  );
}
