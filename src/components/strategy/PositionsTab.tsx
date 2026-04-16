"use client";

import { useMemo } from "react";
import { formatPercent, formatNumber, cn } from "@/lib/utils";
import type { StrategyAnalytics, Position } from "@/lib/types";

export function PositionsTab({
  analytics,
  positions,
}: {
  analytics: StrategyAnalytics;
  positions: Position[] | null;
}) {
  const dqf = analytics.data_quality_flags ?? null;
  const positionMetricsFailed = dqf?.position_metrics_failed === true;

  const tm = analytics.trade_metrics as Record<string, number> | null;

  const closedPositions = useMemo(() => {
    if (!positions) return [];
    return positions.filter((p) => p.status === "closed" && p.roi != null);
  }, [positions]);

  const bestTrades = useMemo(
    () => [...closedPositions].sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0)).slice(0, 5),
    [closedPositions],
  );

  const worstTrades = useMemo(
    () => [...closedPositions].sort((a, b) => (a.roi ?? 0) - (b.roi ?? 0)).slice(0, 5),
    [closedPositions],
  );

  // Show funding breakdown in tooltip if ANY closed position has a non-zero
  // funding_pnl. Use per-row presence check rather than summing — avoids
  // false-negative when payments cancel out to zero total.
  const hasFunding = useMemo(
    () => closedPositions.some((p) => p.funding_pnl != null && p.funding_pnl !== 0),
    [closedPositions],
  );
  const totalFundingPnl = useMemo(
    () => closedPositions.reduce((s, p) => s + (p.funding_pnl ?? 0), 0),
    [closedPositions],
  );
  const totalRealizedPnl = useMemo(
    () => closedPositions.reduce((s, p) => s + (p.realized_pnl ?? 0), 0),
    [closedPositions],
  );

  // Duration stats from positions if available
  const durationStats = useMemo(() => {
    const durations = closedPositions
      .map((p) => p.duration_days)
      .filter((d): d is number => d != null)
      .sort((a, b) => a - b);
    if (durations.length === 0) return null;
    const mean = durations.reduce((s, d) => s + d, 0) / durations.length;
    const median = durations.length % 2 === 0
      ? (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
      : durations[Math.floor(durations.length / 2)];
    const max = durations[durations.length - 1];
    return { mean, median, max };
  }, [closedPositions]);

  // Empty state (AFTER all hooks — react-hooks/rules-of-hooks)
  if ((!positions || positions.length === 0) && !tm) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-text-muted text-center">
          No positions reconstructed yet. Trade data needs to sync first.
        </p>
      </div>
    );
  }

  const totalPositions = tm?.total_positions ?? positions?.length ?? 0;
  const openPositions = tm?.open_positions ?? positions?.filter((p) => p.status === "open").length ?? 0;
  const closedCount = tm?.closed_positions ?? closedPositions.length;
  const winRate = tm?.win_rate;
  const longCount = tm?.long_count ?? positions?.filter((p) => p.side === "long").length ?? 0;
  const shortCount = tm?.short_count ?? positions?.filter((p) => p.side === "short").length ?? 0;
  const totalLS = longCount + shortCount;
  const longPct = totalLS > 0 ? longCount / totalLS : 0;
  const shortPct = totalLS > 0 ? shortCount / totalLS : 0;
  const avgDuration = tm?.avg_duration_days;
  const avgRoi = tm?.avg_roi;
  const bestRoi = tm?.best_trade_roi ?? (bestTrades[0]?.roi ?? null);
  const worstRoi = tm?.worst_trade_roi ?? (worstTrades[0]?.roi ?? null);
  return (
    <>
      {/* Error state */}
      {positionMetricsFailed && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
          <p className="text-sm font-medium text-warning">
            Position metrics couldn&apos;t be computed.
          </p>
        </div>
      )}

      <div className="flex gap-6">
        {/* LEFT COLUMN — 65% trade tables */}
        <div className="flex-[65] min-w-0 space-y-6">
          {/* Top 5 Best Trades */}
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-3">Top 5 Best Trades</h3>
            <TradesTable trades={bestTrades} />
          </div>

          {/* Top 5 Worst Trades */}
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-3">Top 5 Worst Trades</h3>
            <TradesTable trades={worstTrades} />
          </div>
        </div>

        {/* RIGHT COLUMN — 35% metrics sidebar */}
        <div className="flex-[35] min-w-0">
          <div className="bg-white border border-border rounded-lg sticky top-8">
            {/* Position counts */}
            <div className="px-4 py-3">
              <h4 className="text-sm font-semibold text-text-primary mb-3">Position Counts</h4>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xl font-bold font-metric text-text-primary">{totalPositions}</p>
                  <p className="text-[10px] uppercase tracking-wider text-text-muted">Total</p>
                </div>
                <div>
                  <p className="text-xl font-bold font-metric text-positive">{openPositions}</p>
                  <p className="text-[10px] uppercase tracking-wider text-text-muted">Open</p>
                </div>
                <div>
                  <p className="text-xl font-bold font-metric text-text-secondary">{closedCount}</p>
                  <p className="text-[10px] uppercase tracking-wider text-text-muted">Closed</p>
                </div>
              </div>
            </div>

            {/* Win Rate */}
            <div className="border-t border-border" />
            <div className="px-4 py-3">
              <h4 className="text-sm font-semibold text-text-primary mb-1">Win Rate</h4>
              <p className="text-2xl font-bold font-metric text-text-primary">
                {winRate != null ? formatPercent(winRate) : "--"}
              </p>
            </div>

            {/* Long/Short Split */}
            <div className="border-t border-border" />
            <div className="px-4 py-3">
              <h4 className="text-sm font-semibold text-text-primary mb-2">Long / Short Split</h4>
              <div className="space-y-1">
                <MetricRow label="Long" value={formatPercent(longPct)} colorClass="text-positive" />
                <MetricRow label="Short" value={formatPercent(shortPct)} colorClass="text-negative" />
              </div>
            </div>

            {/* Duration */}
            <div className="border-t border-border" />
            <div className="px-4 py-3">
              <h4 className="text-sm font-semibold text-text-primary mb-2">Duration (days)</h4>
              <div className="space-y-1">
                <MetricRow
                  label="Mean"
                  value={avgDuration != null ? formatNumber(avgDuration, 1) : durationStats ? formatNumber(durationStats.mean, 1) : "--"}
                />
                <MetricRow
                  label="Median"
                  value={durationStats ? formatNumber(durationStats.median, 1) : "--"}
                />
                <MetricRow
                  label="Max"
                  value={durationStats ? formatNumber(durationStats.max, 0) : "--"}
                />
              </div>
            </div>

            {/* ROI Stats */}
            <div className="border-t border-border" />
            <div className="px-4 py-3">
              <div className="flex items-center gap-1 mb-2">
                <h4 className="text-sm font-semibold text-text-primary">
                  {hasFunding ? "Total ROI (incl. funding)" : "ROI"}
                </h4>
                <span className="group relative" data-testid="roi-info">
                  <svg className="h-3.5 w-3.5 text-text-muted cursor-help" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M8 7v4" />
                    <circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none" />
                  </svg>
                  <span
                    className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 hidden group-hover:block w-56 rounded bg-text-primary px-2 py-1 text-[10px] text-white text-center shadow-lg z-10"
                    data-testid="roi-tooltip"
                  >
                    {hasFunding
                      ? `Price ROI: ${formatNumber(totalRealizedPnl, 2)} + Funding: ${formatNumber(totalFundingPnl, 2)}`
                      : "Price ROI excludes funding payments"}
                  </span>
                </span>
              </div>
              <div className="space-y-1">
                <MetricRow
                  label="Mean"
                  value={avgRoi != null ? formatPercent(avgRoi) : "--"}
                />
                <MetricRow
                  label="Best"
                  value={bestRoi != null ? formatPercent(bestRoi) : "--"}
                  colorClass="text-positive"
                />
                <MetricRow
                  label="Worst"
                  value={worstRoi != null ? formatPercent(worstRoi) : "--"}
                  colorClass="text-negative"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function TradesTable({ trades }: { trades: Position[] }) {
  if (trades.length === 0) {
    return (
      <p className="text-sm text-text-muted py-4">No closed trades to display.</p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          {["Symbol", "Side", "ROI%", "Duration", "Opened", "Closed"].map((h) => (
            <th
              key={h}
              className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-text-muted"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => (
          <tr
            key={t.id}
            className="border-b border-border last:border-b-0 hover:bg-gray-50 transition-colors"
          >
            <td className="px-3 py-2 font-metric text-xs text-text-primary">{t.symbol}</td>
            <td className="px-3 py-2">
              <span
                className={cn(
                  "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                  t.side === "long"
                    ? "bg-green-50 text-positive"
                    : "bg-red-50 text-negative",
                )}
              >
                {t.side}
              </span>
            </td>
            <td
              className={cn(
                "px-3 py-2 font-metric text-xs",
                t.roi != null && t.roi >= 0 ? "text-positive" : "text-negative",
              )}
            >
              {formatPercent(t.roi)}
            </td>
            <td className="px-3 py-2 font-metric text-xs text-text-secondary">
              {t.duration_days != null ? `${t.duration_days}d` : "--"}
            </td>
            <td className="px-3 py-2 text-xs text-text-muted">
              {t.opened_at ? new Date(t.opened_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "--"}
            </td>
            <td className="px-3 py-2 text-xs text-text-muted">
              {t.closed_at ? new Date(t.closed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "--"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MetricRow({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-muted">{label}</span>
      <span className={cn("text-xs font-metric", colorClass ?? "text-text-secondary")}>{value}</span>
    </div>
  );
}
