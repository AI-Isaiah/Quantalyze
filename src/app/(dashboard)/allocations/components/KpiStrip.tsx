"use client";

import type React from "react";
import { useMemo } from "react";
import { formatPercent, formatNumber, formatCurrency } from "@/lib/utils";
import type { ComputedMetrics } from "@/lib/scenario";
import {
  computePortfolioHealthScore,
  HEALTH_THRESHOLD_HEALTHY,
  HEALTH_THRESHOLD_MODERATE,
} from "@/lib/health-score";
import { Tooltip } from "@/components/ui/Tooltip";

interface KpiStripProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analytics: any;
  metrics: ComputedMetrics;
  timeframe: string;
  aum: number | null;
}

interface KpiItem {
  label: string;
  value: string;
  raw: number | null | undefined;
  tooltip: string;
}

function kpiColor(raw: number | null | undefined): React.CSSProperties | undefined {
  if (raw == null) return undefined;
  if (raw > 0) return { color: "#16A34A" };
  if (raw < 0) return { color: "#DC2626" };
  return undefined;
}

/** Color for the portfolio health score badge — green/yellow/red banding. */
function healthColor(score: number): string {
  if (score >= HEALTH_THRESHOLD_HEALTHY) return "#16A34A";
  if (score >= HEALTH_THRESHOLD_MODERATE) return "#D97706";
  return "#DC2626";
}

export function KpiStrip({ analytics, metrics, timeframe, aum }: KpiStripProps) {
  const resolvedAum = aum ?? analytics?.total_aum ?? null;

  const health = useMemo(
    () => computePortfolioHealthScore(analytics),
    [analytics],
  );

  const groups: { label: string; items: KpiItem[] }[] = [
    {
      label: "Returns",
      items: [
        {
          label: "AUM",
          value: formatCurrency(resolvedAum),
          raw: resolvedAum,
          tooltip: "Total assets under management across all strategies in your portfolio. Updated each time analytics are recomputed.",
        },
        {
          label: "TWR",
          value: formatPercent(metrics.twr),
          raw: metrics.twr,
          tooltip: "Time-weighted return isolates portfolio performance from cash flows. Measures how the investment decisions performed over the selected timeframe.",
        },
        {
          label: "CAGR",
          value: formatPercent(metrics.cagr),
          raw: metrics.cagr,
          tooltip: "Compound annual growth rate normalizes returns to a yearly basis. Useful for comparing strategies with different track record lengths.",
        },
      ],
    },
    {
      label: "Risk-adjusted",
      items: [
        {
          label: "Sharpe",
          value: formatNumber(metrics.sharpe),
          raw: metrics.sharpe,
          tooltip: "Excess return per unit of total risk. Above 1.0 is generally considered acceptable; above 2.0 is strong for crypto strategies.",
        },
        {
          label: "Sortino",
          value: formatNumber(metrics.sortino),
          raw: metrics.sortino,
          tooltip: "Like Sharpe but only penalizes downside volatility. A higher Sortino means the portfolio captures more upside without proportional drawdowns.",
        },
        {
          label: "Calmar",
          value: formatNumber(
            metrics.cagr != null && metrics.max_drawdown != null && metrics.max_drawdown !== 0
              ? Math.abs(metrics.cagr / metrics.max_drawdown)
              : null,
          ),
          raw:
            metrics.cagr != null && metrics.max_drawdown != null && metrics.max_drawdown !== 0
              ? Math.abs(metrics.cagr / metrics.max_drawdown)
              : null,
          tooltip: "CAGR divided by max drawdown. Measures how well the portfolio compensates for its worst peak-to-trough loss.",
        },
      ],
    },
    {
      label: "Risk",
      items: [
        {
          label: "Max DD",
          value: formatPercent(metrics.max_drawdown),
          raw: metrics.max_drawdown,
          tooltip: "Maximum peak-to-trough decline over the full track record. Represents the worst loss an investor would have experienced.",
        },
        {
          label: "Alpha",
          value: formatNumber(analytics?.alpha ?? null),
          raw: analytics?.alpha ?? null,
          tooltip: "Excess return not explained by market beta. Positive alpha means the portfolio adds value beyond passive exposure.",
        },
        {
          label: "Beta",
          value: formatNumber(analytics?.beta ?? null),
          raw: analytics?.beta ?? null,
          tooltip: "Sensitivity to broad market movements. A beta of 0.5 means the portfolio moves roughly half as much as the benchmark.",
        },
        {
          label: "Vol",
          value: formatPercent(metrics.volatility),
          raw: metrics.volatility,
          tooltip: "Annualized standard deviation of daily returns. Higher volatility means wider day-to-day swings in portfolio value.",
        },
      ],
    },
  ];

  // 4th group: Portfolio Health (only when analytics available)
  if (health) {
    groups.push({
      label: "Health",
      items: [
        {
          label: "Score",
          value: `${health.total}`,
          raw: health.total,
          tooltip: `Portfolio health ${health.total}/100 (${health.label}). Composite of Sharpe quality, drawdown recovery, correlation spread, and capacity.`,
        },
      ],
    });
  }

  const computedAt = analytics?.computed_at;
  const asOf = computedAt
    ? new Date(computedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="relative mb-3">
      <div className="flex items-center gap-0 overflow-x-auto bg-white border-b border-[#E2E8F0]">
      {groups.map((group, gi) => (
        <div key={group.label} className="flex items-center">
          {gi > 0 && (
            <div className="w-px self-stretch bg-[#E2E8F0] mx-1" style={{ minHeight: 40 }} />
          )}
          {group.items.map((item) => {
            const isHealthScore = group.label === "Health" && item.label === "Score";
            return (
              <Tooltip key={item.label} content={item.tooltip} className="relative inline-flex">
                <div
                  className="flex flex-col items-center px-3 py-1.5 min-w-[72px] cursor-default"
                >
                  <span
                    className="text-[10px] uppercase tracking-wider font-semibold"
                    style={{ color: "#718096" }}
                  >
                    {item.label}
                  </span>
                  <span
                    className="font-metric text-sm tabular-nums font-medium"
                    style={
                      isHealthScore && health
                        ? { color: healthColor(health.total) }
                        : kpiColor(item.label === "AUM" ? null : item.raw)
                    }
                  >
                    {item.value}
                  </span>
                </div>
              </Tooltip>
            );
          })}
        </div>
      ))}

      {/* As-of timestamp */}
      <div className="ml-auto flex-shrink-0 pr-4">
        {asOf && (
          <span style={{ color: "#718096", fontSize: 11 }} className="whitespace-nowrap">
            As of {asOf}
          </span>
        )}
        <span
          className="ml-2 whitespace-nowrap"
          style={{ color: "#718096", fontSize: 11 }}
        >
          {timeframe}
        </span>
      </div>
      </div>
      {/* Right-edge scroll affordance — mobile only. The KPI row already has
          overflow-x-auto, but on 375px viewports ~7 of 10 metrics sit off-screen
          with no visual hint that content extends beyond the edge. This
          linear gradient from opaque-white to transparent signals "more to
          the right". pointer-events-none so it never blocks a tap. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 rounded-r-lg md:hidden"
        style={{
          background: "linear-gradient(to left, white 15%, transparent)",
        }}
      />
    </div>
  );
}
