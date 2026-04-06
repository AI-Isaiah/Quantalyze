import Link from "next/link";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { Sparkline } from "@/components/charts/Sparkline";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { getPublicStrategyDetail } from "@/lib/queries";
import { formatPercent, formatNumber, metricColor } from "@/lib/utils";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; strategyId: string }>;
}): Promise<Metadata> {
  const { strategyId } = await params;
  const result = await getPublicStrategyDetail(strategyId);
  const name = result?.strategy.name ?? "Strategy";
  return {
    title: `${name} — Quantalyze`,
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
  const result = await getPublicStrategyDetail(strategyId);

  if (!result || !result.analytics) {
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
          { label: "Browse", href: "/browse" },
          { label: cat?.name ?? slug, href: `/browse/${slug}` },
          { label: strategy.name },
        ]}
      />

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary">
              {strategy.name}
            </h1>
            {strategy.api_key_id && (
              <VerifiedBadge className="text-accent" />
            )}
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

      {/* Hero metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <HeroMetric
          label="CAGR"
          value={formatPercent(analytics.cagr)}
          colorClass={metricColor(analytics.cagr)}
        />
        <HeroMetric
          label="Sharpe"
          value={formatNumber(analytics.sharpe)}
          colorClass={metricColor(analytics.sharpe)}
        />
        <HeroMetric
          label="Max Drawdown"
          value={formatPercent(analytics.max_drawdown)}
          colorClass="text-negative"
        />
        <HeroMetric
          label="Volatility"
          value={formatPercent(analytics.volatility)}
          colorClass="text-text-secondary"
        />
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
          value={formatNumber(analytics.sortino)}
        />
        <MiniMetric
          label="Calmar"
          value={formatNumber(analytics.calmar)}
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

      <Disclaimer variant="strategy" />
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
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
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
      <p className="text-[10px] text-text-muted uppercase tracking-wide">
        {label}
      </p>
      <p className="text-sm font-metric font-medium text-text-primary mt-0.5">
        {value}
      </p>
    </div>
  );
}
