import { createAdminClient } from "@/lib/supabase/admin";
import { extractAnalytics } from "@/lib/queries";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import { Disclaimer } from "@/components/ui/Disclaimer";
import type {
  Portfolio,
  PortfolioAnalytics,
  StrategyAnalytics,
} from "@/lib/types";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const admin = createAdminClient();
  const { data } = await admin
    .from("portfolios")
    .select("name")
    .eq("id", id)
    .single();
  const name = (data as { name?: string } | null)?.name ?? "Portfolio";
  return {
    title: `${name} — Quantalyze Portfolio Report`,
    robots: "noindex",
  };
}

type StrategyRow = {
  strategy_id: string;
  name: string;
  weight: number | null;
  twr: number | null;
  sharpe: number | null;
  max_dd: number | null;
  contribution: number | null;
};

export default async function PortfolioPdfPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: portfolio } = await admin
    .from("portfolios")
    .select("*")
    .eq("id", id)
    .single();

  if (!portfolio) {
    return (
      <div className="p-8 text-center text-text-muted">
        Portfolio not found.
      </div>
    );
  }

  const { data: analyticsRow } = await admin
    .from("portfolio_analytics")
    .select("*")
    .eq("portfolio_id", id)
    .order("computed_at", { ascending: false })
    .limit(1)
    .single();

  const analytics = analyticsRow as PortfolioAnalytics | null;

  const { data: strategiesRaw } = await admin
    .from("portfolio_strategies")
    .select(
      `*, strategies (id, name, strategy_analytics (cagr, sharpe, max_drawdown, volatility))`,
    )
    .eq("portfolio_id", id)
    .order("added_at", { ascending: false });

  const strategyList = (strategiesRaw ?? []) as Array<{
    strategy_id: string;
    current_weight: number | null;
    strategies: {
      id: string;
      name: string;
      strategy_analytics: unknown;
    } | null;
  }>;

  const attribution = analytics?.attribution_breakdown ?? null;

  const rows: StrategyRow[] = strategyList.map((ps) => {
    const s = ps.strategies;
    const a = s
      ? (extractAnalytics(
          (s as Record<string, unknown>).strategy_analytics,
        ) as StrategyAnalytics | null)
      : null;
    const attr = attribution?.find((x) => x.strategy_id === ps.strategy_id);
    return {
      strategy_id: ps.strategy_id,
      name: s?.name ?? "Unknown",
      weight: attr?.weight ?? ps.current_weight ?? null,
      twr: attr?.twr ?? a?.cagr ?? null,
      sharpe: a?.sharpe ?? null,
      max_dd: a?.max_drawdown ?? null,
      contribution: attr?.contribution ?? null,
    };
  });

  const p = portfolio as Portfolio;
  const generatedAt = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const kpis = [
    { label: "AUM", value: formatCurrency(analytics?.total_aum) },
    { label: "TWR (total)", value: formatPercent(analytics?.total_return_twr) },
    { label: "Portfolio Sharpe", value: formatNumber(analytics?.portfolio_sharpe) },
    { label: "Volatility", value: formatPercent(analytics?.portfolio_volatility) },
    { label: "Max Drawdown", value: formatPercent(analytics?.portfolio_max_drawdown) },
    { label: "Avg Correlation", value: formatNumber(analytics?.avg_pairwise_correlation) },
  ];

  const correlationMatrix = analytics?.correlation_matrix ?? null;
  const correlationKeys = correlationMatrix
    ? Object.keys(correlationMatrix)
    : [];
  const strategyNameById = new Map(
    strategyList
      .filter((s) => s.strategies)
      .map((s) => [s.strategy_id, s.strategies!.name] as const),
  );

  return (
    <div className="max-w-[800px] mx-auto p-8 bg-white print:p-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{p.name}</h1>
          {p.description && (
            <p className="text-sm text-text-muted mt-1">{p.description}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-accent">
            Portfolio Report
          </p>
          <p className="text-[10px] text-text-muted">Generated {generatedAt}</p>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-lg border border-border p-3"
          >
            <p className="text-[10px] text-text-muted uppercase tracking-wide">
              {kpi.label}
            </p>
            <p className="text-lg font-bold font-metric text-text-primary mt-1">
              {kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Narrative summary */}
      {analytics?.narrative_summary && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-text-primary mb-2">
            Morning Briefing
          </h2>
          <p className="text-xs text-text-secondary leading-relaxed">
            {analytics.narrative_summary}
          </p>
        </div>
      )}

      {/* Strategy table */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-text-primary mb-2">
          Strategy Breakdown
        </h2>
        {rows.length === 0 ? (
          <p className="text-xs text-text-muted">
            No strategies in this portfolio.
          </p>
        ) : (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1 px-1 font-medium text-text-muted">
                  Strategy
                </th>
                <th className="text-right py-1 px-1 font-medium text-text-muted">
                  Weight
                </th>
                <th className="text-right py-1 px-1 font-medium text-text-muted">
                  TWR
                </th>
                <th className="text-right py-1 px-1 font-medium text-text-muted">
                  Sharpe
                </th>
                <th className="text-right py-1 px-1 font-medium text-text-muted">
                  Max DD
                </th>
                <th className="text-right py-1 px-1 font-medium text-text-muted">
                  Contribution
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.strategy_id}
                  className="border-b border-border/30"
                >
                  <td className="py-1 px-1 font-medium text-text-primary">
                    {row.name}
                  </td>
                  <td className="text-right py-1 px-1 font-metric text-text-secondary">
                    {row.weight != null ? formatPercent(row.weight) : "\u2014"}
                  </td>
                  <td className="text-right py-1 px-1 font-metric text-text-primary">
                    {formatPercent(row.twr)}
                  </td>
                  <td className="text-right py-1 px-1 font-metric text-text-primary">
                    {formatNumber(row.sharpe)}
                  </td>
                  <td className="text-right py-1 px-1 font-metric text-negative">
                    {formatPercent(row.max_dd)}
                  </td>
                  <td className="text-right py-1 px-1 font-metric text-text-primary">
                    {row.contribution != null
                      ? formatPercent(row.contribution)
                      : "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Correlation matrix */}
      {correlationMatrix && correlationKeys.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-text-primary mb-2">
            Correlation Matrix
          </h2>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1 px-1 font-medium text-text-muted">
                  Strategy
                </th>
                {correlationKeys.map((k) => (
                  <th
                    key={k}
                    className="text-right py-1 px-1 font-medium text-text-muted"
                  >
                    {(strategyNameById.get(k) ?? k).slice(0, 10)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {correlationKeys.map((rowKey) => (
                <tr key={rowKey} className="border-b border-border/30">
                  <td className="py-1 px-1 font-medium text-text-primary">
                    {(strategyNameById.get(rowKey) ?? rowKey).slice(0, 14)}
                  </td>
                  {correlationKeys.map((colKey) => {
                    const val = correlationMatrix[rowKey]?.[colKey];
                    return (
                      <td
                        key={colKey}
                        className="text-right py-1 px-1 font-metric text-text-primary"
                      >
                        {val != null ? formatNumber(val) : "\u2014"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Disclaimer */}
      <Disclaimer variant="factsheet" />
    </div>
  );
}
