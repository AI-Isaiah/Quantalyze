import Link from "next/link";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { ManagerIdentityPanel } from "@/components/strategy/ManagerIdentityPanel";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getPublicStrategyDetail } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { annualizationPeriods } from "@/lib/closed-sets";
import {
  figureRecord,
  gateAnnualized,
  gatedValue,
  shortTrackNote,
  withheldReason,
} from "@/lib/figure-gate";
import { readRecordSpan, type RecordSpanRead } from "@/lib/record-span-read";
import { captureToSentry } from "@/lib/sentry-capture";
import { getBrowseCategories } from "../../browse-categories";
import { displayStrategyName } from "@/lib/strategy-display";
import { formatPercent, formatNumber, metricColor } from "@/lib/utils";
import { drawdownTone } from "@/lib/factsheet/display-sign";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; strategyId: string }>;
}): Promise<Metadata> {
  const { strategyId } = await params;
  const result = await getPublicStrategyDetail(strategyId);
  const name = result ? displayStrategyName(result.strategy) : "Strategy";
  return {
    title: name,
    description: `Exchange-verified performance data for ${name}.`,
  };
}

export default async function PublicStrategyDetailPage({
  params,
}: {
  params: Promise<{ slug: string; strategyId: string }>;
}) {
  const { slug, strategyId } = await params;
  const cat = DISCOVERY_CATEGORIES.find((c) => c.slug === slug);
  const [result, { onlySlug }] = await Promise.all([
    getPublicStrategyDetail(strategyId),
    getBrowseCategories(),
  ]);

  if (!result || !result.analytics) {
    return (
      <div className="text-center py-16 text-text-muted">
        Strategy not found.
      </div>
    );
  }

  const { strategy, analytics, manager, disclosureTier } = result;
  const displayName = displayStrategyName(strategy);

  // 194 D-04 as superseded by D-15: the strategy's TOTAL record decides whether the
  // five annualised figures print. One request-scoped, published-only scalar read, one
  // record, one verdict. A read that cannot be made fails CLOSED: the figures print as
  // dashes and no caption claims a record length we could not read.
  let spanRead: RecordSpanRead = { determined: false };
  try {
    spanRead = await readRecordSpan(await createClient(), strategy.id);
  } catch (err) {
    // createClient threw (cookies unavailable): the same fail-closed answer as a failed
    // read, but reported. A failed readRecordSpan reports itself to Sentry; this catch
    // is the one failure it cannot see.
    captureToSentry(err, {
      tags: { stage: "record-span-read", reason: "client_unavailable", strategy_id: strategy.id },
    });
    console.error("[browse] record span read failed", { strategyId: strategy.id, error: err });
  }
  if (!spanRead.determined) {
    console.error("[browse] record span read failed", { strategyId: strategy.id });
  }
  const record = spanRead.determined
    ? figureRecord({
        seriesStart: spanRead.seriesStart,
        seriesEnd: spanRead.seriesEnd,
        headlineSince: spanRead.headlineSince,
        observations: spanRead.observations,
        periodsPerYear: annualizationPeriods(strategy.asset_class),
      })
    : null;
  const gateState = record ? gateAnnualized(record) : "withheld";
  const gateNote =
    record && gateState === "withheld"
      ? withheldReason("record", record)
      : record && gateState === "short" && record.spanDays != null
        ? shortTrackNote("record", record.spanDays)
        : null;
  // A read that could not be made is not a record length: say the figures are
  // unavailable and that a reload retries, instead of leaving bare dashes.
  const unavailableNote = spanRead.determined
    ? null
    : "Annualized figures are temporarily unavailable. Reload to retry.";
  const annualized = (value: number | null | undefined) => gatedValue(value, gateState);
  const cagr = annualized(analytics.cagr);
  const sharpe = annualized(analytics.sharpe);
  const volatility = annualized(analytics.volatility);
  const sortino = annualized(analytics.sortino);
  const calmar = annualized(analytics.calmar);

  return (
    <>
      <Breadcrumb
        items={[
          // /browse redirects to the category when it is the only one (D-08),
          // so on that category the root crumb must not link back to it. Under
          // any OTHER slug the redirect lands elsewhere, so the link stays.
          onlySlug === slug
            ? { label: "Browse" }
            : { label: "Browse", href: "/browse" },
          { label: cat?.name ?? slug, href: `/browse/${slug}` },
          { label: displayName },
        ]}
      />

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">
              {displayName}
            </h1>
            {/* Phase 170.6.1.1 (census G): follows the public trust tier,
                not api_key_id, which public rows no longer carry. */}
            <VerifiedBadge
              trustTier={strategy.trust_tier}
              className="text-accent"
            />
          </div>
          <div className="flex gap-1.5 mt-2">
            {strategy.strategy_types?.map((t: string) => (
              <Badge key={t} label={t} />
            ))}
          </div>
          {strategy.description && (
            <p className="mt-3 text-sm text-text-secondary max-w-2xl leading-relaxed">
              {strategy.description}
            </p>
          )}
        </div>
      </div>

      <div className="mb-6">
        <ManagerIdentityPanel
          disclosureTier={disclosureTier}
          manager={manager}
          strategyCodename={displayName}
        />
      </div>

      {/* Hero metrics */}
      <div className="mb-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <HeroMetric
          label="CAGR"
          value={formatPercent(cagr)}
          colorClass={metricColor(cagr, "percent")}
        />
        <HeroMetric
          label="Sharpe"
          value={formatNumber(sharpe)}
          colorClass={metricColor(sharpe, "ratio")}
        />
        <HeroMetric
          label="Max Drawdown"
          value={formatPercent(analytics.max_drawdown)}
          colorClass={
            // D-03/D-04: red only when the ROUNDED drawdown is below zero; never green.
            drawdownTone(analytics.max_drawdown, 2, 100) === "negative" ? "text-negative" : "text-text-primary"
          }
        />
        <HeroMetric
          label="Volatility"
          value={formatPercent(volatility)}
          colorClass="text-text-secondary"
        />
      </div>
      {(gateNote ?? unavailableNote) && (
        <p className="mt-2 text-xs text-text-muted" data-testid="browse-figure-gate-note">
          {gateNote ?? unavailableNote}
        </p>
      )}
      </div>

      {/* Sparkline */}
      {analytics.sparkline_returns &&
        analytics.sparkline_returns.length > 0 && (
          <Card className="mb-6" padding="sm">
            <div className="px-4 pt-3 pb-1">
              <h3 className="text-sm font-semibold text-text-primary">
                Equity Curve
              </h3>
            </div>
            <div className="h-32 px-2 pb-2">
              <Sparkline
                data={analytics.sparkline_returns}
                width={700}
                height={120}
                color="#0D9488"
              />
            </div>
          </Card>
        )}

      {/* Additional public metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MiniMetric
          label="Sortino"
          value={formatNumber(sortino)}
        />
        <MiniMetric
          label="Calmar"
          value={formatNumber(calmar)}
        />
        <MiniMetric
          label="6 Month Return"
          value={formatPercent(analytics.six_month_return)}
        />
        <MiniMetric
          label="Cumulative Return"
          value={formatPercent(analytics.cumulative_return)}
        />
      </div>

      {/* CTA: sign up for full analytics */}
      <div className="rounded-xl border-2 border-accent/20 bg-accent/5 p-6 text-center mb-8">
        <h2 className="text-lg font-semibold text-text-primary">
          Want full analytics and introductions?
        </h2>
        <p className="mt-2 text-sm text-text-secondary max-w-lg mx-auto">
          Sign up to see detailed charts, monthly returns heatmaps, rolling
          metrics, risk analysis, and to request an introduction to this
          strategy manager.
        </p>
        <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/signup"
            className="inline-flex items-center rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Sign up free
          </Link>
          <Link
            href={`/factsheet/${strategy.id}`}
            className="inline-flex items-center rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-text-primary hover:bg-page transition-colors"
          >
            View factsheet
          </Link>
        </div>
      </div>

      {/* D-09: the one disclaimer block on this page (custody + provenance +
          general risk), last content element, replacing the custody box, the
          bottom strategy paragraph and the layout footer. */}
      <Disclaimer variant="strategy-page" trustTier={strategy.trust_tier} />
    </>
  );
}

function HeroMetric({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass?: string;
}) {
  return (
    <Card padding="sm" className="text-center">
      <p className="text-fixed-10 uppercase tracking-wider text-text-muted font-medium">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-bold font-metric ${colorClass ?? "text-text-primary"}`}
      >
        {value}
      </p>
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-fixed-10 text-text-muted uppercase tracking-wide">
        {label}
      </p>
      <p className="text-sm font-metric font-medium text-text-primary mt-0.5">
        {value}
      </p>
    </div>
  );
}
