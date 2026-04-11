"use client";

import type React from "react";
import { formatPercent, formatNumber, formatCurrency } from "@/lib/utils";
import type { ComputedMetrics } from "@/lib/scenario";

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

export function KpiStrip({ analytics, metrics, timeframe, aum }: KpiStripProps) {
  const resolvedAum = aum ?? analytics?.total_aum ?? null;

  const groups: { label: string; items: KpiItem[] }[] = [
    {
      label: "Returns",
      items: [
        {
          label: "AUM",
          value: formatCurrency(resolvedAum),
          raw: resolvedAum,
          tooltip: "Assets under management — total portfolio value",
        },
        {
          label: "TWR",
          value: formatPercent(metrics.twr),
          raw: metrics.twr,
          tooltip: "Time-weighted return for the selected timeframe",
        },
        {
          label: "CAGR",
          value: formatPercent(metrics.cagr),
          raw: metrics.cagr,
          tooltip: "Compound annual growth rate",
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
          tooltip: "Sharpe ratio — excess return per unit of total risk",
        },
        {
          label: "Sortino",
          value: formatNumber(metrics.sortino),
          raw: metrics.sortino,
          tooltip: "Sortino ratio — excess return per unit of downside risk",
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
          tooltip: "Calmar ratio — CAGR divided by max drawdown",
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
          tooltip: "Maximum peak-to-trough drawdown",
        },
        {
          label: "Alpha",
          value: formatNumber(analytics?.alpha ?? null),
          raw: analytics?.alpha ?? null,
          tooltip: "Alpha — excess return not explained by market beta",
        },
        {
          label: "Beta",
          value: formatNumber(analytics?.beta ?? null),
          raw: analytics?.beta ?? null,
          tooltip: "Beta — portfolio sensitivity to market movements",
        },
        {
          label: "Vol",
          value: formatPercent(metrics.volatility),
          raw: metrics.volatility,
          tooltip: "Annualized portfolio volatility",
        },
      ],
    },
  ];

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
    <div className="relative mb-6">
      <div className="flex items-center gap-0 overflow-x-auto rounded-lg border border-[#E2E8F0] bg-white">
      {groups.map((group, gi) => (
        <div key={group.label} className="flex items-center">
          {gi > 0 && (
            <div className="w-px self-stretch bg-[#E2E8F0] mx-1" style={{ minHeight: 40 }} />
          )}
          {group.items.map((item) => (
            <div
              key={item.label}
              className="flex flex-col items-center px-4 py-2.5 min-w-[80px]"
              title={item.tooltip}
            >
              <span
                className="text-[10px] uppercase tracking-wider font-semibold"
                style={{ color: "#718096" }}
              >
                {item.label}
              </span>
              <span
                className="font-mono text-sm tabular-nums font-medium"
                style={kpiColor(item.label === "AUM" ? null : item.raw)}
              >
                {item.value}
              </span>
            </div>
          ))}
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
