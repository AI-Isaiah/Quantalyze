import type { Metadata } from "next";
import Link from "next/link";
import { getFactsheetDetail, getPercentiles } from "@/lib/queries";
import { displayStrategyName } from "@/lib/strategy-display";
import { formatPercent, formatNumber } from "@/lib/utils";
import { Sparkline } from "@/components/charts/Sparkline";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { FreshnessBadge } from "@/components/strategy/FreshnessBadge";
import { PercentileRankBadge } from "@/components/strategy/PercentileRankBadge";
import { ManagerIdentityPanel } from "@/components/strategy/ManagerIdentityPanel";
import { PrintButton } from "@/components/ui/PrintButton";
import type { DisclosureTier, ManagerIdentity } from "@/lib/types";

const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Quantalyze";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getFactsheetDetail(id);
  const name = result ? displayStrategyName(result.strategy) : "Strategy";
  return {
    title: `${name} — Institutional Tear Sheet`,
    robots: "noindex",
  };
}

/**
 * Institutional-lane tear sheet. Print-first layout (8.5 × 11 portrait, 1"
 * margins ≈ 6.5 × 9" of content). Primary user flow is `window.print()`.
 * The PDF wrapper at `/api/factsheet/[id]/tearsheet.pdf` renders this same
 * page with Puppeteer for an emailable version.
 *
 * Exploratory-tier strategies get a redacted manager panel; institutional-
 * tier strategies show full identity. Redaction is enforced server-side in
 * `getFactsheetDetail()` → we re-fetch manager identity here only if the
 * strategy is institutional.
 */
export default async function TearSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getFactsheetDetail(id);

  if (!result || !result.analytics) {
    return <div className="p-8 text-center text-text-muted">Strategy not found.</div>;
  }

  const { strategy, analytics, manager, disclosureTier } = result;
  const displayName = displayStrategyName(strategy);
  const categorySlug: string | undefined =
    (strategy as { discovery_categories?: { slug?: string } | null }).discovery_categories?.slug ??
    undefined;

  const percentileMap = await getPercentiles(categorySlug);
  const percentiles = percentileMap?.[strategy.id] ?? null;

  const m = analytics.metrics_json as Record<string, number> | null;

  return (
    <div className="tearsheet mx-auto my-0 bg-white text-text-primary print:m-0 print:p-0">
      <style>{`
        /* Print layout: 8.5 × 11 portrait, 1" (96px) margins */
        @page {
          size: Letter portrait;
          margin: 1in;
        }
        .tearsheet {
          width: 6.5in;
          padding: 0.75in 0.75in 0.75in 0.75in;
          font-family: var(--font-dm-sans), sans-serif;
        }
        @media print {
          .tearsheet {
            width: 100%;
            padding: 0;
          }
          .print\\:hidden { display: none !important; }
        }
        .tearsheet section {
          page-break-inside: avoid;
        }
      `}</style>

      {/* Header strip */}
      <header className="mb-6 flex items-start justify-between border-b border-border pb-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-text-muted">
            {PLATFORM_NAME} · Institutional Tear Sheet
          </p>
          <h1 className="mt-1 font-display text-3xl leading-tight text-text-primary">
            {displayName}
          </h1>
          <p className="mt-1 text-xs text-text-muted">
            {strategy.strategy_types?.join(" · ")} · {strategy.markets?.join(", ")}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <FreshnessBadge
            computedAt={analytics.computed_at}
            label="Data"
            variant="pill"
          />
          <p className="mt-1 text-[10px] text-text-muted">
            Generated{" "}
            {new Date().toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
      </header>

      {/* Manager identity */}
      <section className="mb-6">
        <ManagerIdentityPanelForTearSheet
          disclosureTier={disclosureTier}
          manager={manager}
          strategyCodename={displayName}
        />
      </section>

      {/* Hero metrics */}
      <section className="mb-6 grid grid-cols-4 gap-3">
        <HeroMetric label="CAGR" value={formatPercent(analytics.cagr)} />
        <HeroMetric label="Sharpe" value={formatNumber(analytics.sharpe)} />
        <HeroMetric label="Sortino" value={formatNumber(analytics.sortino)} />
        <HeroMetric
          label="Max DD"
          value={formatPercent(analytics.max_drawdown)}
          danger
        />
      </section>

      {/* Equity curve */}
      {analytics.sparkline_returns && analytics.sparkline_returns.length > 0 && (
        <section className="mb-6 rounded-lg border border-border p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Equity Curve</h2>
            <span className="text-[10px] text-text-muted">
              {strategy.start_date ? `Live since ${strategy.start_date}` : ""}
            </span>
          </div>
          <div className="h-32">
            <Sparkline
              data={analytics.sparkline_returns}
              width={620}
              height={120}
              color="#1B6B5A"
            />
          </div>
        </section>
      )}

      {/* Percentile ranks */}
      {percentiles && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-text-primary">
            Peer-relative ranks
          </h2>
          <div className="flex flex-wrap gap-2">
            {(["cagr", "sharpe", "sortino", "max_drawdown", "volatility"] as const).map(
              (metric) => (
                <PercentileRankBadge
                  key={metric}
                  metric={metric}
                  percentile={percentiles[metric]}
                  categoryLabel={categorySlug ?? undefined}
                />
              ),
            )}
          </div>
        </section>
      )}

      {/* Detail metrics */}
      <section className="mb-6 grid grid-cols-4 gap-3">
        <DetailMetric label="Volatility" value={formatPercent(analytics.volatility)} />
        <DetailMetric label="Calmar" value={formatNumber(analytics.calmar)} />
        <DetailMetric label="6 Month" value={formatPercent(analytics.six_month_return)} />
        <DetailMetric
          label="Cumulative"
          value={formatPercent(analytics.cumulative_return)}
        />
        <DetailMetric label="VaR (95%)" value={formatPercent(m?.var_1d_95)} />
        <DetailMetric label="CVaR" value={formatPercent(m?.cvar)} />
        <DetailMetric label="Best Day" value={formatPercent(m?.best_day)} />
        <DetailMetric label="Worst Day" value={formatPercent(m?.worst_day)} />
      </section>

      {/* Monthly returns heatmap */}
      {analytics.monthly_returns && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-text-primary">Monthly Returns</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-1 pr-2 text-left font-medium text-text-muted">Year</th>
                  {MONTHS.map((mm) => (
                    <th
                      key={mm}
                      className="py-1 px-1 text-right font-medium text-text-muted"
                    >
                      {mm}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(analytics.monthly_returns)
                  .sort()
                  .map(([year, months]) => (
                    <tr key={year} className="border-b border-border/30">
                      <td className="py-1 pr-2 font-medium text-text-primary">{year}</td>
                      {MONTHS.map((mm) => {
                        const val = (months as Record<string, number>)[mm];
                        return (
                          <td
                            key={mm}
                            className={`py-1 px-1 text-right font-metric ${
                              val == null
                                ? "text-text-muted"
                                : val >= 0
                                  ? "text-positive"
                                  : "text-negative"
                            }`}
                          >
                            {val != null ? `${(val * 100).toFixed(1)}%` : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Fees, minimum, lockup */}
      <section className="mb-6 rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold text-text-primary">Allocation Terms</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <TermRow label="Minimum Allocation" value={strategy.aum ? `$${Math.round(strategy.aum).toLocaleString()}` : "Negotiable"} />
          <TermRow label="Leverage" value={strategy.leverage_range ?? "Not disclosed"} />
          <TermRow label="Lockup" value="None (read-only API)" />
          <TermRow label="Benchmark" value={strategy.benchmark ?? "BTC"} />
        </dl>
      </section>

      {/* Custody disclosure */}
      <section className="mb-6">
        <Disclaimer variant="custody" />
      </section>

      {/* Risk disclosure */}
      <section className="mb-6 border-t border-border pt-4">
        <h2 className="mb-2 text-sm font-semibold text-text-primary">Risk Disclosure</h2>
        <p className="text-[10px] text-text-muted leading-relaxed">
          Past performance does not guarantee future results. Cryptocurrency
          trading involves substantial risk of total loss. This tear sheet is
          for informational purposes only and does not constitute investment,
          legal, or tax advice. Strategies are monitored via read-only exchange
          APIs; managers retain asset custody. Read the full risk disclaimer at{" "}
          <Link
            href="/legal/disclaimer"
            className="underline hover:text-text-primary"
          >
            /legal/disclaimer
          </Link>
          .
        </p>
      </section>

      {/* Contact CTA */}
      <section className="mb-2 rounded-lg border border-accent/30 bg-accent/5 p-4 text-center">
        <p className="text-sm font-semibold text-text-primary">
          Interested in {displayName}?
        </p>
        <p className="mt-1 text-xs text-text-secondary">
          Request an introduction through {PLATFORM_NAME}. The manager will be
          notified and will respond directly.
        </p>
        <Link
          href={`/factsheet/${strategy.id}`}
          className="mt-3 inline-flex items-center rounded-md bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover transition-colors print:hidden"
        >
          View full factsheet →
        </Link>
      </section>

      {/* Print + PDF buttons — hidden in print/PDF output */}
      <div className="mt-6 flex items-center justify-center gap-3 print:hidden">
        <PrintButton />
        <a
          href={`/api/factsheet/${id}/tearsheet.pdf`}
          target="_blank"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
        >
          Download PDF
        </a>
      </div>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function HeroMetric({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <p className="text-[9px] uppercase tracking-wider text-text-muted">{label}</p>
      <p
        className={`mt-1 font-metric text-xl font-bold ${
          danger ? "text-negative" : "text-text-primary"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-[9px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-0.5 font-metric text-sm font-medium text-text-primary">
        {value}
      </p>
    </div>
  );
}

function TermRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-medium text-text-primary">{value}</dd>
    </div>
  );
}

/**
 * Tearsheet-specific wrapper around ManagerIdentityPanel to avoid the Card
 * component's default large padding on a print-constrained page.
 */
function ManagerIdentityPanelForTearSheet({
  disclosureTier,
  manager,
  strategyCodename,
}: {
  disclosureTier: DisclosureTier;
  manager: ManagerIdentity | null;
  strategyCodename: string;
}) {
  return (
    <ManagerIdentityPanel
      disclosureTier={disclosureTier}
      manager={manager}
      strategyCodename={strategyCodename}
    />
  );
}
