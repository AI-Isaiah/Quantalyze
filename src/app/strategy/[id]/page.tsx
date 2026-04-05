import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicStrategyDetail } from "@/lib/queries";
import { VerifiedBadge } from "@/components/ui/VerifiedBadge";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { Sparkline } from "@/components/charts/Sparkline";
import { Button } from "@/components/ui/Button";
import { formatPercent, formatNumber, metricColor } from "@/lib/utils";

/* ---------- OG metadata ---------- */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getPublicStrategyDetail(id);

  if (!result) {
    return { title: "Strategy Not Found | Quantalyze" };
  }

  const { strategy, analytics } = result;
  const parts: string[] = [];

  if (analytics?.cagr != null) parts.push(`CAGR ${formatPercent(analytics.cagr)}`);
  if (analytics?.sharpe != null) parts.push(`Sharpe ${formatNumber(analytics.sharpe)}`);
  if (analytics?.max_drawdown != null) parts.push(`Max DD ${formatPercent(analytics.max_drawdown)}`);

  const description = parts.length
    ? `${strategy.name} -- ${parts.join(" | ")}. Verified on Quantalyze.`
    : `${strategy.name} -- Verified quantitative strategy on Quantalyze.`;

  return {
    title: `${strategy.name} | Quantalyze`,
    description,
    openGraph: {
      title: `${strategy.name} | Quantalyze`,
      description,
      type: "website",
    },
    twitter: {
      card: "summary",
      title: `${strategy.name} | Quantalyze`,
      description,
    },
  };
}

/* ---------- page ---------- */

interface MetricCardProps {
  label: string;
  value: string;
  colorClass?: string;
}

function MetricCard({ label, value, colorClass }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className={`text-lg font-metric font-semibold ${colorClass ?? "text-text-primary"}`}>
        {value}
      </p>
    </div>
  );
}

export default async function PublicStrategyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getPublicStrategyDetail(id);

  if (!result) notFound();

  const { strategy, analytics } = result;

  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-[32px] font-bold tracking-tight text-text-primary">
              {strategy.name}
            </h1>
            <VerifiedBadge />
          </div>
          {strategy.start_date && (
            <p className="text-sm text-text-muted">
              Live since {strategy.start_date}
            </p>
          )}
        </div>

        {/* Summary metrics */}
        {analytics && analytics.computation_status === "complete" ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-8">
              <MetricCard
                label="CAGR"
                value={formatPercent(analytics.cagr)}
                colorClass={metricColor(analytics.cagr)}
              />
              <MetricCard
                label="Sharpe Ratio"
                value={formatNumber(analytics.sharpe)}
                colorClass={metricColor(analytics.sharpe)}
              />
              <MetricCard
                label="Sortino Ratio"
                value={formatNumber(analytics.sortino)}
                colorClass={metricColor(analytics.sortino)}
              />
              <MetricCard
                label="Max Drawdown"
                value={formatPercent(analytics.max_drawdown)}
                colorClass="text-negative"
              />
              <MetricCard
                label="Volatility"
                value={formatPercent(analytics.volatility)}
              />
              <MetricCard
                label="Cumulative Return"
                value={formatPercent(analytics.cumulative_return)}
                colorClass={metricColor(analytics.cumulative_return)}
              />
            </div>

            {/* Sparkline */}
            {analytics.sparkline_returns && analytics.sparkline_returns.length >= 2 && (
              <div className="rounded-lg border border-border bg-card p-4 mb-8">
                <p className="text-xs text-text-muted mb-3">Equity Curve</p>
                <Sparkline
                  data={analytics.sparkline_returns}
                  width={640}
                  height={80}
                  fill
                  className="w-full"
                />
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-border bg-card p-8 text-center mb-8">
            <p className="text-text-muted">Analytics are being computed. Check back soon.</p>
          </div>
        )}

        {/* CTA */}
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-text-secondary mb-4">
            Sign up to see full analytics, charts, and connect with the strategy manager.
          </p>
          <Link href="/signup">
            <Button size="lg">Sign up to see full analytics</Button>
          </Link>
        </div>

        <Disclaimer variant="strategy" />
      </div>
    </div>
  );
}
