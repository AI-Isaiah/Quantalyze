"use client";

import { formatPercent, formatNumber, formatCurrency, cn } from "@/lib/utils";
import type { StrategyAnalytics } from "@/lib/types";

export function VolumeExposureTab({ analytics }: { analytics: StrategyAnalytics }) {
  const dqf = analytics.data_quality_flags ?? null;
  const positionMetricsFailed = dqf?.position_metrics_failed === true;

  const vm = analytics.volume_metrics as {
    buy_volume_pct?: number;
    sell_volume_pct?: number;
    long_volume_pct?: number;
    short_volume_pct?: number;
    total_fills?: number;
    total_volume_usd?: number;
  } | null | undefined;

  const em = analytics.exposure_metrics as {
    mean_gross_exposure?: number;
    std_gross_exposure?: number;
    max_gross_exposure?: number;
    mean_net_exposure?: number;
    std_net_exposure?: number;
    max_net_exposure?: number;
  } | null | undefined;

  const tm = analytics.trade_metrics as Record<string, number> | null;

  // Empty state
  if (!vm && !em && !tm) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-text-muted text-center">
          No trade data yet. Sync this strategy to see volume and exposure metrics.
        </p>
      </div>
    );
  }

  const buyPct = vm?.buy_volume_pct ?? 0;
  const sellPct = vm?.sell_volume_pct ?? 0;
  const longPct = vm?.long_volume_pct ?? 0;
  const shortPct = vm?.short_volume_pct ?? 0;

  return (
    <>
      {/* Error state */}
      {positionMetricsFailed && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
          <p className="text-sm font-medium text-warning">
            Volume metrics couldn&apos;t be computed.
          </p>
        </div>
      )}

      <div className="flex gap-6">
        {/* LEFT COLUMN — 65% charts */}
        <div className="flex-[65] min-w-0 space-y-6">
          {/* Buy/Sell volume bar */}
          <div className="bg-white border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Buy / Sell Volume</h3>
            <HorizontalStackedBar
              leftPct={buyPct}
              rightPct={sellPct}
              leftLabel="Buy"
              rightLabel="Sell"
              leftColor="bg-positive"
              rightColor="bg-negative"
            />
          </div>

          {/* Long/Short volume bar */}
          <div className="bg-white border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Long / Short Volume</h3>
            <HorizontalStackedBar
              leftPct={longPct}
              rightPct={shortPct}
              leftLabel="Long"
              rightLabel="Short"
              leftColor="bg-positive"
              rightColor="bg-negative"
            />
          </div>

          {/* Trade counts from trade_metrics */}
          {tm && (
            <div className="bg-white border border-border rounded-lg p-4">
              <h3 className="text-sm font-semibold text-text-primary mb-3">Trade Counts</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-text-muted">Total Positions</p>
                  <p className="font-metric text-lg text-text-primary">
                    {tm.total_positions != null ? Math.round(tm.total_positions).toLocaleString() : "--"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Win Rate</p>
                  <p className="font-metric text-lg text-text-primary">
                    {formatPercent(tm.win_rate)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Long</p>
                  <p className="font-metric text-sm text-positive">
                    {tm.long_count != null ? Math.round(tm.long_count).toLocaleString() : "--"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-muted">Short</p>
                  <p className="font-metric text-sm text-negative">
                    {tm.short_count != null ? Math.round(tm.short_count).toLocaleString() : "--"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN — 35% metrics sidebar */}
        <div className="flex-[35] min-w-0">
          <div className="bg-white border border-border rounded-lg sticky top-8">
            {/* Volume stats */}
            <div className="px-4 py-3">
              <h4 className="text-sm font-semibold text-text-primary mb-2">Volume Stats</h4>
              <div className="space-y-2">
                <MetricRow label="Total Fills" value={vm?.total_fills != null ? vm.total_fills.toLocaleString() : "--"} />
                <MetricRow label="Total Volume" value={vm?.total_volume_usd != null ? formatCurrency(vm.total_volume_usd) : "--"} />
              </div>
            </div>

            {/* Exposure stats */}
            {em && (
              <>
                <div className="border-t border-border" />
                <div className="px-4 py-3">
                  <h4 className="text-sm font-semibold text-text-primary mb-2">Exposure</h4>
                  <div className="space-y-2">
                    <MetricRow label="Gross (mean)" value={formatNumber(em.mean_gross_exposure)} />
                    <MetricRow label="Gross (std)" value={formatNumber(em.std_gross_exposure)} />
                    <MetricRow label="Gross (max)" value={formatNumber(em.max_gross_exposure)} />
                    <MetricRow label="Net (mean)" value={formatNumber(em.mean_net_exposure)} />
                    <MetricRow label="Net (std)" value={formatNumber(em.std_net_exposure)} />
                    <MetricRow label="Net (max)" value={formatNumber(em.max_net_exposure)} />
                  </div>
                </div>
              </>
            )}

            {/* Turnover placeholder */}
            <div className="border-t border-border" />
            <div className="px-4 py-3">
              <h4 className="text-sm font-semibold text-text-primary mb-2">Turnover</h4>
              <p className="text-xs text-text-muted">Turnover analysis coming soon.</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function HorizontalStackedBar({
  leftPct,
  rightPct,
  leftLabel,
  rightLabel,
  leftColor,
  rightColor,
}: {
  leftPct: number;
  rightPct: number;
  leftLabel: string;
  rightLabel: string;
  leftColor: string;
  rightColor: string;
}) {
  const leftWidth = leftPct + rightPct > 0 ? (leftPct / (leftPct + rightPct)) * 100 : 50;
  const rightWidth = 100 - leftWidth;

  return (
    <div>
      <div className="flex h-8 w-full overflow-hidden">
        <div className={cn(leftColor, "h-full transition-all")} style={{ width: `${leftWidth}%` }} />
        <div className={cn(rightColor, "h-full transition-all")} style={{ width: `${rightWidth}%` }} />
      </div>
      <div className="flex justify-between mt-2">
        <span className="text-xs text-text-muted">
          {leftLabel}{" "}
          <span className="font-metric text-positive">{(leftPct * 100).toFixed(1)}%</span>
        </span>
        <span className="text-xs text-text-muted">
          {rightLabel}{" "}
          <span className="font-metric text-negative">{(rightPct * 100).toFixed(1)}%</span>
        </span>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-xs font-metric text-text-secondary">{value}</span>
    </div>
  );
}
