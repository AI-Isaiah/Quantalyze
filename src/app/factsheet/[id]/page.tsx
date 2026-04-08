import { getFactsheetDetail } from "@/lib/queries";
import { formatPercent, formatNumber } from "@/lib/utils";
import { getMetricLabel } from "@/lib/metric-labels";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { Sparkline } from "@/components/charts/Sparkline";
import { PrintButton } from "@/components/ui/PrintButton";
import type { Metadata } from "next";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getFactsheetDetail(id);
  const name = result?.strategy.name ?? "Strategy";
  return {
    title: `${name} — Quantalyze Factsheet`,
    robots: "noindex",
  };
}

export default async function FactsheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getFactsheetDetail(id);

  if (!result || !result.analytics) {
    return <div className="p-8 text-center text-text-muted">Strategy not found.</div>;
  }

  const { strategy, analytics } = result;
  const m = analytics.metrics_json as Record<string, number> | null;

  const heroMetrics = [
    { label: "CAGR", value: formatPercent(analytics.cagr), qualKey: "cagr", raw: analytics.cagr },
    { label: "Sharpe", value: formatNumber(analytics.sharpe), qualKey: "sharpe", raw: analytics.sharpe },
    { label: "Sortino", value: formatNumber(analytics.sortino), qualKey: "sortino", raw: analytics.sortino },
    { label: "Max Drawdown", value: formatPercent(analytics.max_drawdown), qualKey: "max_drawdown", raw: analytics.max_drawdown },
    { label: "Volatility", value: formatPercent(analytics.volatility), qualKey: "volatility", raw: analytics.volatility },
    { label: "Cumulative Return", value: formatPercent(analytics.cumulative_return), qualKey: undefined, raw: analytics.cumulative_return },
  ];

  const detailMetrics = [
    { label: "Calmar", value: formatNumber(analytics.calmar) },
    { label: "DD Duration", value: analytics.max_drawdown_duration_days != null ? `${analytics.max_drawdown_duration_days}d` : "—" },
    { label: "6 Month", value: formatPercent(analytics.six_month_return) },
    { label: "VaR (1d 95%)", value: formatPercent(m?.var_1d_95) },
    { label: "CVaR", value: formatPercent(m?.cvar) },
    { label: "Best Day", value: formatPercent(m?.best_day) },
    { label: "Worst Day", value: formatPercent(m?.worst_day) },
    { label: "Profit Factor", value: formatNumber(m?.profit_factor) },
  ];

  return (
    <div className="max-w-[800px] mx-auto p-8 bg-white print:p-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{strategy.name}</h1>
          <p className="text-sm text-text-muted mt-1">
            {strategy.strategy_types?.join(", ")} · {strategy.markets?.join(", ")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-accent">Verified by Quantalyze</p>
          <p className="text-[10px] text-text-muted">
            Data verified from exchange API · {new Date(analytics.computed_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Equity Curve Sparkline */}
      {analytics.sparkline_returns && analytics.sparkline_returns.length > 0 && (
        <div className="mb-6 h-20">
          <Sparkline data={analytics.sparkline_returns} width={760} height={80} color="#0D9488" />
        </div>
      )}

      {/* Hero Metrics */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {heroMetrics.map((metric) => {
          const qual = metric.qualKey ? getMetricLabel(metric.qualKey, metric.raw) : null;
          return (
            <div key={metric.label} className="rounded-lg border border-border p-3">
              <p className="text-[10px] text-text-muted uppercase tracking-wide">{metric.label}</p>
              <p className="text-lg font-bold font-metric text-text-primary mt-1">{metric.value}</p>
              {qual && (
                <p className="text-[10px] text-text-muted mt-0.5">{qual.label}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Detail Metrics */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {detailMetrics.map((metric) => (
          <div key={metric.label} className="text-center">
            <p className="text-[10px] text-text-muted">{metric.label}</p>
            <p className="text-sm font-metric font-medium text-text-primary">{metric.value}</p>
          </div>
        ))}
      </div>

      {/* Monthly Returns Table */}
      {analytics.monthly_returns && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-text-primary mb-2">Monthly Returns</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 px-1 font-medium text-text-muted">Year</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="text-right py-1 px-1 font-medium text-text-muted">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(analytics.monthly_returns).sort().map(([year, months]) => (
                  <tr key={year} className="border-b border-border/30">
                    <td className="py-1 px-1 font-medium text-text-primary">{year}</td>
                    {MONTHS.map((m) => {
                      const val = (months as Record<string, number>)[m];
                      return (
                        <td key={m} className={`text-right py-1 px-1 font-metric ${
                          val == null ? "text-text-muted" : val >= 0 ? "text-positive" : "text-negative"
                        }`}>
                          {val != null ? `${(val * 100).toFixed(1)}%` : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Strategy Description */}
      {strategy.description && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-text-primary mb-2">Strategy Description</h2>
          <p className="text-xs text-text-secondary leading-relaxed">{strategy.description}</p>
        </div>
      )}

      {/* Custody statement */}
      <div className="mb-6">
        <Disclaimer variant="custody" />
      </div>

      {/* Risk disclosure block */}
      <div className="mb-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Risk Disclosure</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <div className="flex justify-between">
            <dt className="text-text-muted">Leverage</dt>
            <dd className="font-medium text-text-primary">
              {strategy.leverage_range ?? "Not disclosed"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-muted">Max Drawdown</dt>
            <dd className="font-metric text-text-primary">
              {formatPercent(analytics.max_drawdown)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-muted">Minimum Allocation</dt>
            <dd className="font-medium text-text-primary">
              {strategy.aum ? `$${Math.round(strategy.aum).toLocaleString()}` : "Negotiable"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-muted">Lockup</dt>
            <dd className="font-medium text-text-primary">None (read-only API)</dd>
          </div>
        </dl>
        <p className="mt-3 border-t border-border pt-3 text-[10px] text-text-muted leading-relaxed">
          Past performance does not guarantee future results. Cryptocurrency
          trading involves substantial risk of total loss. This factsheet is
          for informational purposes only and does not constitute investment
          advice.
        </p>
      </div>

      {/* Footer */}
      <Disclaimer variant="factsheet" />

      {/* Actions (hidden in print) */}
      <div className="mt-6 flex items-center justify-center gap-4 print:hidden">
        <a
          href={`/api/factsheet/${id}/pdf`}
          target="_blank"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10v3h10v-3M8 2v8M5 7l3 3 3-3" />
          </svg>
          Download PDF
        </a>
        <PrintButton />
      </div>
    </div>
  );
}
