import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { RequestIntroButton } from "@/components/strategy/RequestIntroButton";
import { BookIntroCall } from "@/components/strategy/BookIntroCall";
import { ShareableLink } from "@/components/strategy/ShareableLink";
import { AddToPortfolio } from "@/components/portfolio/AddToPortfolio";
import { FactsheetView } from "@/app/factsheet/[id]/v2/FactsheetView";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getStrategyDetail } from "@/lib/queries";
import { displayStrategyName } from "@/lib/strategy-display";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildFactsheetPayload, deriveIngestSource } from "@/lib/factsheet/build-payload";
import type { BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import { readCompositeFactsheet, singleKeyDataQuality, singleKeyBasisOpts, shouldReadSingleKeyMtmSeries, readMtmSeries } from "@/lib/factsheet/composite-read-path";
import { resolveDailyReturnSeries } from "@/lib/factsheet/allocator-portfolio-payload";
import type { DailyReturn, TrustTierKind, IngestSource } from "@/lib/factsheet/types";
import { notFound, redirect } from "next/navigation";

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
  // Audit 2026-05-07 G11.E.7: unknown slug → 404 immediately. Avoids
  // even firing the strategy fetch for slugs not on the published list.
  if (!cat) notFound();

  // Audit 2026-05-07 G11.E.7: pass the slug to getStrategyDetail so the
  // `discovery_categories!inner(slug)` filter rejects strategy/slug
  // mismatches at the SQL layer (returns null → not-found UI). Without
  // this, /discovery/<wrong-slug>/<strategyId> renders the full chart
  // suite + RSC payload for any published strategy.
  const result = await getStrategyDetail(strategyId, slug);
  if (!result) notFound();

  const { strategy, analytics, disclosureTier } = result;
  // Breadcrumb still uses the pseudonym-safe label (it shows in the
  // sidebar context above the factsheet). The factsheet body itself is a
  // full-identity context and uses the real name when present.
  const breadcrumbName = displayStrategyName(strategy);
  const factsheetName =
    strategy.name ?? strategy.codename ?? breadcrumbName;
  const displayName = factsheetName;

  // analytics-service-only strategies have daily_returns=null but the
  // real cumprod equity curve in returns_series. resolveDailyReturnSeries
  // handles both shapes + the three real-world daily_returns dict layouts.
  const analyticsRow = analytics as
    | {
        daily_returns?: unknown;
        returns_series?: unknown;
        data_quality_flags?: unknown;
        metrics_json_by_basis?: unknown;
        computation_status?: unknown;
      }
    | null
    | undefined;
  const dailyRaw = analyticsRow?.daily_returns;
  let dailyReturns = resolveDailyReturnSeries(
    dailyRaw,
    analyticsRow?.returns_series,
  );

  // Derive ingestSource through the SHARED deriveIngestSource (same source of
  // truth as factsheet/[id]/v2/page.tsx). Without an explicit source,
  // buildFactsheetPayload defaults to "csv" and all gated panels (PeerPercentile,
  // AllocatorSection, Signatures) are permanently suppressed for API strategies
  // on the discovery surface. (RED-TEAM-H1)
  let ingestSource: IngestSource = deriveIngestSource(dailyRaw);

  // H-2 (Round 2): a stitched composite has daily_returns=NULL + returns_series
  // populated, so the plain path above would classify it "api" (invented
  // PeerPercentile / AllocatorSection / EventSignatures) and draw a dense-0.0
  // gap-filled series (flat-zero gap lines). Route it through the SAME shared
  // composite read-path the factsheet route uses: force ingestSource "csv"
  // (suppresses the invented panels), read the honest sparse csv_daily_returns
  // series, and thread the marker/basis/method opts. A null result = data defect
  // → the still-computing placeholder (never the api arm).
  const dqf = analyticsRow?.data_quality_flags as
    | { composite?: unknown; mtm_gated_reason?: unknown; per_key?: unknown; gap_spans?: unknown; insufficient_window?: unknown; cumulative_method?: unknown }
    | null
    | undefined;
  let buildOpts: BuildFactsheetOpts | undefined;
  if (dqf?.composite === true) {
    ingestSource = "csv";
    const admin = createAdminClient();
    const composite = await readCompositeFactsheet(admin, {
      strategyId: strategy.id,
      dqf,
      metricsJsonByBasis: analyticsRow?.metrics_json_by_basis,
      returnsDenominatorConfig: (strategy as { returns_denominator_config?: unknown })
        .returns_denominator_config,
    });
    if (composite) {
      dailyReturns = composite.dailyReturns;
      buildOpts = composite.buildOpts;
    } else {
      // Data defect (untrusted cash headline) → empty series → placeholder.
      dailyReturns = [] as DailyReturn[];
    }
  } else {
    // HARD-04 (#67) / Finding B: single-key strategies persist
    // `insufficient_window` at the analytics_runner CAGR site too, but buildOpts
    // was assigned ONLY on the composite arm, so `payload.dataQuality` stayed
    // undefined and the FactsheetView :876 caveat never rendered single-key
    // despite the server truth. Thread it through the ONE shared owner
    // (`singleKeyDataQuality`) so this discovery surface and the factsheet route
    // can't diverge on the DQ opt (the composite "one path" lesson).
    //
    // MTM-01 (Phase 102): mirror the factsheet route's single-key OPTIONS MTM read
    // through the SAME shared owner (`singleKeyBasisOpts`) so the two surfaces
    // cannot diverge. getStrategyDetail selects `strategy_analytics (*)`
    // (queries.ts:416) so `computation_status` arrives on the row; `{}` for every
    // non-options single-key strategy keeps the payload byte-identical.
    //
    // MTM-04 (Phase 103): mirror the factsheet route — read the persisted
    // `mtm_daily_returns` series through the SAME shared predicate + reader so the
    // two surfaces can't diverge. The series lives behind deny-all RLS, so it needs
    // the service-role admin handle (created here only when the cheap gate holds —
    // the hot non-options path stays roundtrip-free). Degrades to no-bundle on a
    // failed/malformed row.
    const mtmSeries = shouldReadSingleKeyMtmSeries(
      analyticsRow?.metrics_json_by_basis,
      analyticsRow?.computation_status,
    )
      ? await readMtmSeries(createAdminClient(), strategy.id)
      : null;
    buildOpts = {
      ...(buildOpts ?? {}),
      dataQuality: singleKeyDataQuality(dqf),
      ...singleKeyBasisOpts(
        dqf,
        analyticsRow?.metrics_json_by_basis,
        analyticsRow?.computation_status,
        mtmSeries,
      ),
    };
  }

  // RED-TEAM-H2: Never fall back to "now" for a missing computed_at — that
  // would make FreshnessChip show a green "fresh" badge for a strategy with
  // no real analytics data. Mirror the epoch sentinel from page.tsx so the
  // chip correctly signals staleness. Consistent with FINDING-5 fix.
  if (!analytics?.computed_at) {
    console.warn(
      "[discovery/strategyDetail] analytics.computed_at missing, freshness chip will show epoch",
      { strategyId },
    );
  }
  const computedAt = analytics?.computed_at ?? "1970-01-01T00:00:00Z";

  const factsheetPayload = buildFactsheetPayload(
    {
      id: strategy.id,
      name: factsheetName,
      types: strategy.strategy_types ?? [],
      markets: strategy.markets ?? [],
      computedAt,
      trustTier: (strategy.trust_tier ?? null) as TrustTierKind | null,
      ingestSource,
      description: strategy.description ?? null,
      subtypes: strategy.subtypes ?? [],
      supportedExchanges: strategy.supported_exchanges ?? [],
      leverageRange: strategy.leverage_range ?? null,
      aum: strategy.aum ?? null,
      maxCapacity: strategy.max_capacity ?? null,
      avgDailyTurnover: strategy.avg_daily_turnover ?? null,
      startDate: strategy.start_date ?? null,
      benchmark: strategy.benchmark ?? null,
      assetClass: strategy.asset_class ?? null,
    },
    dailyReturns,
    buildOpts,
  );

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Discovery", href: "/discovery/crypto-sma" },
          { label: cat?.name ?? slug, href: `/discovery/${slug}` },
          { label: breadcrumbName },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        <ShareableLink strategyId={strategy.id} variant="primary" />
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
        <BookIntroCall strategyName={displayName} />
        <RequestIntroButton strategyId={strategy.id} />
      </div>

      {factsheetPayload ? (
        <FactsheetView payload={factsheetPayload} />
      ) : (
        <article className="mx-auto max-w-[760px] px-4 sm:px-6 lg:px-10 py-12">
          <p className="text-micro font-mono uppercase tracking-[0.22em] text-text-muted">
            Institutional Factsheet · Quantalyze
          </p>
          <h1 className="mt-2 font-serif text-page-title leading-tight text-text-primary">
            {displayName}
          </h1>
          <p className="mt-6 text-small text-text-secondary">
            The detailed factsheet for this strategy is still computing.
            Daily-return data hasn&apos;t been ingested yet — once the
            analytics service finishes the first compute pass, the full
            panel set will render here.
          </p>
        </article>
      )}

      <div className="fixed bottom-0 left-0 right-0 md:left-[260px] z-10 border-t border-border bg-white/95 backdrop-blur-sm px-6 py-3 flex items-center justify-between">
        <p className="text-sm text-text-secondary hidden sm:block">
          Interested in{" "}
          <span className="font-medium text-text-primary">{displayName}</span>?
        </p>
        <RequestIntroButton strategyId={strategy.id} />
      </div>
    </>
  );
}
