import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SyncBadge } from "@/components/strategy/SyncBadge";
import { HealthScore } from "@/components/strategy/HealthScore";
import { formatPercent, formatNumber, formatCurrency, metricColor } from "@/lib/utils";
import { extractAnalytics, EMPTY_ANALYTICS, getAllocatorAggregates } from "@/lib/queries";
import type { PortfolioAnalytics } from "@/lib/types";
import Link from "next/link";
import { redirect } from "next/navigation";

const severityStyles: Record<string, string> = {
  high: "bg-negative/10 text-negative",
  medium: "bg-badge-market-neutral/10 text-badge-market-neutral",
  low: "bg-badge-other/10 text-badge-other",
};

export default async function AllocationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch portfolio aggregates and contact requests in parallel
  const [aggregates, { data: requests }] = await Promise.all([
    getAllocatorAggregates(user.id),
    supabase
      .from("contact_requests")
      .select(
        `id, status, message, created_at, founder_notes, allocation_amount,
         strategies (
           id, name, status, strategy_types, supported_exchanges, start_date, aum,
           strategy_analytics (cagr, sharpe, max_drawdown, volatility, cumulative_return, sparkline_returns, computed_at, computation_status)
         )`
      )
      .eq("allocator_id", user.id)
      .in("status", ["intro_made", "completed"])
      .order("created_at", { ascending: false }),
  ]);

  const { portfolios, analytics: allAnalytics } = aggregates;

  // Fetch alerts for user's portfolios (needs portfolio IDs from aggregates)
  const portfolioIds = portfolios.map((p) => p.id);
  let activeAlerts: { id: string; portfolio_id: string; severity: string }[] = [];
  if (portfolioIds.length > 0) {
    const { data: alerts } = await supabase
      .from("portfolio_alerts")
      .select("id, portfolio_id, severity")
      .is("acknowledged_at", null)
      .in("portfolio_id", portfolioIds);
    activeAlerts = alerts ?? [];
  }

  // Build a map: portfolio_id -> latest analytics snapshot
  const analyticsMap = new Map<string, PortfolioAnalytics>();
  for (const a of allAnalytics) {
    if (!analyticsMap.has(a.portfolio_id)) {
      analyticsMap.set(a.portfolio_id, a);
    }
  }

  // Cross-portfolio aggregate KPIs
  const totalAum = allAnalytics.reduce(
    (sum, a) => sum + (analyticsMap.get(a.portfolio_id) === a && a.total_aum ? a.total_aum : 0),
    0,
  );
  const latestSnapshots = Array.from(analyticsMap.values());
  const bestMtd = latestSnapshots.reduce(
    (best, a) => (a.return_mtd != null && (best == null || a.return_mtd > best) ? a.return_mtd : best),
    null as number | null,
  );
  const avgCorrelation =
    latestSnapshots.length > 0
      ? latestSnapshots.reduce((sum, a) => sum + (a.avg_pairwise_correlation ?? 0), 0) /
        latestSnapshots.filter((a) => a.avg_pairwise_correlation != null).length || null
      : null;

  // Portfolio strategy counts (from portfolio_strategies)
  const { data: strategyCounts } = portfolioIds.length
    ? await supabase
        .from("portfolio_strategies")
        .select("portfolio_id")
        .in("portfolio_id", portfolioIds)
    : { data: [] };
  const strategyCountMap = new Map<string, number>();
  for (const row of strategyCounts ?? []) {
    strategyCountMap.set(row.portfolio_id, (strategyCountMap.get(row.portfolio_id) ?? 0) + 1);
  }

  // Alert severity counts
  const alertCounts = { high: 0, medium: 0, low: 0 };
  for (const a of activeAlerts) {
    const sev = a.severity as keyof typeof alertCounts;
    if (sev in alertCounts) alertCounts[sev]++;
  }
  const totalAlerts = alertCounts.high + alertCounts.medium + alertCounts.low;

  // Connection cards data (existing logic)
  const connections = (requests ?? []).map((r) => {
    const rawStrategy = r.strategies;
    const strategy = (Array.isArray(rawStrategy) ? rawStrategy[0] : rawStrategy) as Record<string, unknown> | null;
    const analytics = strategy
      ? extractAnalytics(strategy.strategy_analytics) ?? EMPTY_ANALYTICS
      : EMPTY_ANALYTICS;
    return { request: r, strategy, analytics };
  });

  // Aggregate metrics across all connected strategies
  const aggMetrics = connections.reduce(
    (acc, c) => {
      if (c.analytics.cagr != null) {
        acc.totalCagr += c.analytics.cagr;
        acc.count++;
      }
      if (c.analytics.sharpe != null) acc.totalSharpe += c.analytics.sharpe;
      if (c.analytics.max_drawdown != null)
        acc.worstDrawdown = Math.min(acc.worstDrawdown, c.analytics.max_drawdown);
      return acc;
    },
    { totalCagr: 0, totalSharpe: 0, worstDrawdown: 0, count: 0 },
  );

  const avgCagr = aggMetrics.count > 0 ? aggMetrics.totalCagr / aggMetrics.count : null;
  const avgSharpe = aggMetrics.count > 0 ? aggMetrics.totalSharpe / aggMetrics.count : null;

  function correlationColor(value: number | null | undefined): string {
    if (value == null) return "text-text-muted";
    if (value >= 0.7) return "text-negative";
    if (value >= 0.4) return "text-text-secondary";
    return "text-positive";
  }

  return (
    <>
      <PageHeader title="My Allocations" />

      {/* ── Section 1: Cross-Portfolio Aggregate KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card padding="sm" className="text-center">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
            Total AUM
          </p>
          <p className="mt-1 text-2xl font-bold font-metric text-text-primary">
            {totalAum > 0 ? formatCurrency(totalAum) : "--"}
          </p>
        </Card>
        <Card padding="sm" className="text-center">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
            Best MTD
          </p>
          <p className={`mt-1 text-2xl font-bold font-metric ${metricColor(bestMtd)}`}>
            {formatPercent(bestMtd)}
          </p>
        </Card>
        <Card padding="sm" className="text-center">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
            Avg Correlation
          </p>
          <p className={`mt-1 text-2xl font-bold font-metric ${correlationColor(avgCorrelation)}`}>
            {avgCorrelation != null ? formatNumber(avgCorrelation) : "--"}
          </p>
        </Card>
        <Card padding="sm" className="text-center">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
            Portfolios
          </p>
          <p className="mt-1 text-2xl font-bold font-metric text-text-primary">
            {portfolios.length}
          </p>
        </Card>
      </div>

      {/* ── Section 2: Portfolio List ── */}
      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
        Portfolios
      </h2>
      {portfolios.length === 0 ? (
        <Card className="text-center py-8 mb-6">
          <p className="text-text-muted mb-4">
            No portfolios yet. Create one to start tracking your allocations.
          </p>
          <Link
            href="/portfolios"
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Create your first portfolio
          </Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {portfolios.map((p) => {
            const pa = analyticsMap.get(p.id);
            const count = strategyCountMap.get(p.id) ?? 0;
            return (
              <Link key={p.id} href={`/portfolios/${p.id}`}>
                <Card className="hover:border-accent/40 transition-colors cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-text-primary truncate">
                        {p.name}
                      </p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {count} {count === 1 ? "strategy" : "strategies"}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 ml-4 text-right">
                      <div>
                        <p className="text-[10px] text-text-muted uppercase">TWR</p>
                        <p className={`text-sm font-metric font-medium ${metricColor(pa?.total_return_twr)}`}>
                          {formatPercent(pa?.total_return_twr)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-text-muted uppercase">Sharpe</p>
                        <p className={`text-sm font-metric font-medium ${metricColor(pa?.portfolio_sharpe)}`}>
                          {formatNumber(pa?.portfolio_sharpe)}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Section 3: Active Alerts Summary ── */}
      {totalAlerts > 0 && (
        <>
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
            Active Alerts
          </h2>
          <Card className="mb-6">
            <div className="flex items-center gap-4">
              <p className="text-sm text-text-secondary">
                {totalAlerts} unacknowledged {totalAlerts === 1 ? "alert" : "alerts"} across your portfolios
              </p>
              <div className="flex items-center gap-2">
                {alertCounts.high > 0 && (
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${severityStyles.high}`}>
                    {alertCounts.high} High
                  </span>
                )}
                {alertCounts.medium > 0 && (
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${severityStyles.medium}`}>
                    {alertCounts.medium} Medium
                  </span>
                )}
                {alertCounts.low > 0 && (
                  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${severityStyles.low}`}>
                    {alertCounts.low} Low
                  </span>
                )}
              </div>
            </div>
          </Card>
        </>
      )}

      {/* ── Section 4: Active Connections (existing) ── */}
      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
        Active Connections
      </h2>

      {connections.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-text-muted mb-4">
            No active connections yet. Browse strategies and request
            introductions.
          </p>
          <Link
            href="/discovery/crypto-sma"
            className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Browse Strategies
          </Link>
        </Card>
      ) : (
        <>
          {/* Connection aggregate overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card padding="sm" className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                Connected
              </p>
              <p className="mt-1 text-2xl font-bold font-metric text-text-primary">
                {connections.length}
              </p>
            </Card>
            <Card padding="sm" className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                Avg CAGR
              </p>
              <p
                className={`mt-1 text-2xl font-bold font-metric ${metricColor(avgCagr)}`}
              >
                {formatPercent(avgCagr)}
              </p>
            </Card>
            <Card padding="sm" className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                Avg Sharpe
              </p>
              <p
                className={`mt-1 text-2xl font-bold font-metric ${metricColor(avgSharpe)}`}
              >
                {formatNumber(avgSharpe)}
              </p>
            </Card>
            <Card padding="sm" className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                Worst DD
              </p>
              <p className="mt-1 text-2xl font-bold font-metric text-negative">
                {aggMetrics.worstDrawdown < 0
                  ? formatPercent(aggMetrics.worstDrawdown)
                  : "--"}
              </p>
            </Card>
          </div>

          {/* Connection cards */}
          <div className="space-y-3">
            {connections.map(({ request, strategy, analytics }) => {
              const s = strategy as Record<string, unknown> | null;
              if (!s) return null;
              return (
                <Card key={request.id}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/discovery/crypto-sma/${s.id}`}
                          className="font-medium text-text-primary hover:text-accent transition-colors"
                        >
                          {s.name as string}
                        </Link>
                        <HealthScore
                          analytics={analytics}
                          startDate={s.start_date as string | null}
                        />
                        <Badge
                          label={request.status}
                          type="status"
                        />
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <SyncBadge
                          computedAt={analytics.computed_at}
                          exchange={
                            (s.supported_exchanges as string[])?.[0]
                          }
                        />
                        {(s.strategy_types as string[])?.map((t) => (
                          <Badge key={t} label={t} />
                        ))}
                      </div>
                      {request.founder_notes && (
                        <p className="mt-2 text-xs text-text-secondary bg-accent/5 rounded px-2 py-1 border border-accent/10">
                          {request.founder_notes}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-6 ml-4 text-right">
                      <div>
                        <p className="text-[10px] text-text-muted uppercase">
                          CAGR
                        </p>
                        <p
                          className={`text-sm font-metric font-medium ${metricColor(analytics.cagr)}`}
                        >
                          {formatPercent(analytics.cagr)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-text-muted uppercase">
                          Sharpe
                        </p>
                        <p
                          className={`text-sm font-metric font-medium ${metricColor(analytics.sharpe)}`}
                        >
                          {formatNumber(analytics.sharpe)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-text-muted uppercase">
                          Max DD
                        </p>
                        <p className="text-sm font-metric font-medium text-negative">
                          {formatPercent(analytics.max_drawdown)}
                        </p>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
