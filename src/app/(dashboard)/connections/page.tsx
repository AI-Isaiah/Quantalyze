import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SyncBadge } from "@/components/strategy/SyncBadge";
import { HealthScore } from "@/components/strategy/HealthScore";
import { formatPercent, formatNumber, metricColor } from "@/lib/utils";
import { extractAnalytics, EMPTY_ANALYTICS } from "@/lib/queries";
import Link from "next/link";
import { redirect } from "next/navigation";

/**
 * Connections page — the allocator's relationships with strategy managers.
 *
 * Promoted from the old cross-portfolio /allocations page (which used to
 * render an "Active Connections" section alongside a portfolios list +
 * aggregate KPIs). The My Allocation restructure split /allocations into
 * a focused multi-strategy dashboard for the single real portfolio, so
 * this relationship-oriented view got its own route.
 *
 * Data shape is unchanged from the old allocations/page.tsx rendering:
 * contact_requests in status 'intro_made' or 'completed', joined with the
 * underlying strategy + its analytics, plus the aggregate metrics header.
 */
export default async function ConnectionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: requests } = await supabase
    .from("contact_requests")
    .select(
      `id, status, message, created_at, founder_notes, allocation_amount,
       strategies (
         id, name, status, strategy_types, supported_exchanges, start_date, aum,
         strategy_analytics (cagr, sharpe, max_drawdown, volatility, cumulative_return, sparkline_returns, computed_at, computation_status)
       )`,
    )
    .eq("allocator_id", user.id)
    .in("status", ["intro_made", "completed"])
    .order("created_at", { ascending: false });

  const connections = (requests ?? []).map((r) => {
    const rawStrategy = r.strategies;
    const strategy = (
      Array.isArray(rawStrategy) ? rawStrategy[0] : rawStrategy
    ) as Record<string, unknown> | null;
    const analytics = strategy
      ? (extractAnalytics(strategy.strategy_analytics) ?? EMPTY_ANALYTICS)
      : EMPTY_ANALYTICS;
    return { request: r, strategy, analytics };
  });

  // Aggregate metrics across all connected strategies.
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

  return (
    <>
      <PageHeader
        title="Connections"
        description="Your intro relationships with strategy managers."
      />

      {connections.length === 0 ? (
        <Card className="text-center py-12">
          <p className="text-text-muted mb-4">
            No active connections yet. Browse strategies and request introductions.
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
              <p className={`mt-1 text-2xl font-bold font-metric ${metricColor(avgCagr)}`}>
                {formatPercent(avgCagr)}
              </p>
            </Card>
            <Card padding="sm" className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                Avg Sharpe
              </p>
              <p className={`mt-1 text-2xl font-bold font-metric ${metricColor(avgSharpe)}`}>
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
                        <Badge label={request.status} type="status" />
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <SyncBadge
                          computedAt={analytics.computed_at}
                          exchange={(s.supported_exchanges as string[])?.[0]}
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
                        <p className="text-[10px] text-text-muted uppercase">CAGR</p>
                        <p className={`text-sm font-metric font-medium ${metricColor(analytics.cagr)}`}>
                          {formatPercent(analytics.cagr)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-text-muted uppercase">Sharpe</p>
                        <p className={`text-sm font-metric font-medium ${metricColor(analytics.sharpe)}`}>
                          {formatNumber(analytics.sharpe)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-text-muted uppercase">Max DD</p>
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
