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
import { buildFactsheetPayload, deriveIngestSource } from "@/lib/factsheet/build-payload";
import { resolveDailyReturnSeries } from "@/lib/factsheet/allocator-portfolio-payload";
import type { TrustTierKind, IngestSource } from "@/lib/factsheet/types";
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
    | { daily_returns?: unknown; returns_series?: unknown }
    | null
    | undefined;
  const dailyRaw = analyticsRow?.daily_returns;
  const dailyReturns = resolveDailyReturnSeries(
    dailyRaw,
    analyticsRow?.returns_series,
  );

  // Derive ingestSource through the SHARED deriveIngestSource (same source of
  // truth as factsheet/[id]/v2/page.tsx). Without an explicit source,
  // buildFactsheetPayload defaults to "csv" and all gated panels (PeerPercentile,
  // AllocatorSection, Signatures) are permanently suppressed for API strategies
  // on the discovery surface. (RED-TEAM-H1)
  const ingestSource: IngestSource = deriveIngestSource(dailyRaw);

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
