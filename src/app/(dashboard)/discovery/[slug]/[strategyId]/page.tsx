import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { StrategyHeader } from "@/components/strategy/StrategyHeader";
import { MetadataCards } from "@/components/strategy/MetadataCards";
import { PerformanceReport } from "@/components/strategy/PerformanceReport";
import { ComputeStatus } from "@/components/strategy/ComputeStatus";
import { RequestIntroButton } from "@/components/strategy/RequestIntroButton";
import { BookIntroCall } from "@/components/strategy/BookIntroCall";
import { ShareableLink } from "@/components/strategy/ShareableLink";
import { AddToPortfolio } from "@/components/portfolio/AddToPortfolio";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { ManagerIdentityPanel } from "@/components/strategy/ManagerIdentityPanel";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getStrategyDetail, getPercentiles } from "@/lib/queries";
import { displayStrategyName } from "@/lib/strategy-display";
import { createClient } from "@/lib/supabase/server";
import { parsePositionRows } from "@/lib/types";
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
  const [result, percentileMap, positionsResult] = await Promise.all([
    getStrategyDetail(strategyId, slug),
    getPercentiles(slug),
    supabase
      .from("positions")
      .select("id, strategy_id, symbol, side, status, entry_price_avg, exit_price_avg, size_base, size_peak, realized_pnl, fee_total, fill_count, opened_at, closed_at, duration_days, roi, funding_pnl")
      .eq("strategy_id", strategyId)
      .order("roi", { ascending: false })
      .limit(20),
  ]);

  if (!result) {
    notFound();
  }

  // Audit 2026-05-07 G12.G.5: surface positions-fetch failures. The pre-
  // audit code ignored `positionsResult.error` and let PositionsTab render
  // its "No positions reconstructed yet" empty state — indistinguishable
  // from a genuine no-positions strategy. Operators had no signal to
  // investigate column-shape drift, RLS regressions, or transient DB
  // failures. Now: log to the server console with the strategyId so the
  // event is searchable, and pass an explicit `positionsError` flag to
  // PerformanceReport so the UI can show a banner instead.
  const positionsError = positionsResult?.error ?? null;
  if (positionsError) {
    console.error("[discovery] positions fetch failed", {
      strategyId,
      slug,
      message: positionsError.message,
      code: positionsError.code,
    });
  }

  const { strategy, analytics, manager, disclosureTier } = result;
  const percentiles = percentileMap?.[strategyId] ?? null;
  const displayName = displayStrategyName(strategy);

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Discovery", href: "/discovery/crypto-sma" },
          { label: cat?.name ?? slug, href: `/discovery/${slug}` },
          { label: displayName },
        ]}
      />
      <div className="flex items-start justify-between mb-6">
        <StrategyHeader strategy={strategy} computedAt={analytics.computed_at} />
        <div className="flex items-center gap-3">
          <ShareableLink strategyId={strategy.id} variant="primary" />
          <a
            href={`/factsheet/${strategy.id}`}
            target="_blank"
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-page transition-colors"
          >
            Factsheet
          </a>
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
      </div>
      <MetadataCards strategy={strategy} />

      <div className="mb-6">
        <ManagerIdentityPanel
          disclosureTier={disclosureTier}
          manager={manager}
          strategyCodename={displayName}
        />
      </div>

      <Disclaimer variant="custody" className="mb-6" />

      {/* Verified vs Self-Reported */}
      {strategy.api_key_id && (
        <div className="flex gap-4 mb-6 text-xs">
          <div className="flex-1 rounded-lg border border-positive/20 bg-positive/5 px-4 py-3">
            <p className="font-semibold text-positive mb-1">Verified (Exchange API)</p>
            <p className="text-text-secondary">Trade history, PnL, returns, all analytics metrics, equity curve</p>
          </div>
          <div className="flex-1 rounded-lg border border-border bg-page px-4 py-3">
            <p className="font-semibold text-text-primary mb-1">Self-Reported</p>
            <p className="text-text-secondary">Strategy description, AUM, capacity, leverage, strategy type</p>
          </div>
        </div>
      )}

      {analytics.computation_status !== "complete" && (
        <div className="mb-6">
          <ComputeStatus status={analytics.computation_status} error={analytics.computation_error} />
        </div>
      )}
      {/* G12.E.1 (audit 2026-05-07): runtime-validate raw Supabase rows
          before casting to Position[]. Preserves the null-vs-empty signal
          the consumers branch on by mapping a missing `data` to null.
          G12.G.5 (audit 2026-05-07): forward `positionsError` so a fetch
          failure renders a banner instead of the silent empty state. */}
      <PerformanceReport
        analytics={analytics}
        percentiles={percentiles}
        positions={positionsResult?.data ? parsePositionRows(positionsResult.data) : null}
        positionsError={positionsError != null}
      />
      <Disclaimer variant="strategy" />

      {/* Sticky Request Intro CTA */}
      <div className="fixed bottom-0 left-0 right-0 md:left-[260px] z-10 border-t border-border bg-white/95 backdrop-blur-sm px-6 py-3 flex items-center justify-between">
        <p className="text-sm text-text-secondary hidden sm:block">
          Interested in <span className="font-medium text-text-primary">{displayName}</span>?
        </p>
        <RequestIntroButton strategyId={strategy.id} />
      </div>
    </>
  );
}
