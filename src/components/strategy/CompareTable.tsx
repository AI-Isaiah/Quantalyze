"use client";

import { formatPercent, formatNumber, cn } from "@/lib/utils";
import { getMetricLabel, LABEL_COLORS } from "@/lib/metric-labels";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

interface CompareItem {
  strategy: Strategy;
  analytics: StrategyAnalytics;
}

interface MetricRow {
  label: string;
  key: string;
  format: "percent" | "number" | "days";
  higherIsBetter: boolean;
  qualKey?: string;
}

const METRICS: MetricRow[] = [
  { label: "Cumulative Return", key: "cumulative_return", format: "percent", higherIsBetter: true },
  { label: "CAGR", key: "cagr", format: "percent", higherIsBetter: true, qualKey: "cagr" },
  { label: "Sharpe", key: "sharpe", format: "number", higherIsBetter: true, qualKey: "sharpe" },
  { label: "Sortino", key: "sortino", format: "number", higherIsBetter: true, qualKey: "sortino" },
  { label: "Calmar", key: "calmar", format: "number", higherIsBetter: true, qualKey: "calmar" },
  { label: "Max Drawdown", key: "max_drawdown", format: "percent", higherIsBetter: true, qualKey: "max_drawdown" },
  { label: "DD Duration", key: "max_drawdown_duration_days", format: "days", higherIsBetter: false },
  { label: "Volatility", key: "volatility", format: "percent", higherIsBetter: false, qualKey: "volatility" },
  { label: "6 Month Return", key: "six_month_return", format: "percent", higherIsBetter: true },
];

function getValue(analytics: StrategyAnalytics, key: string): number | null {
  const val = (analytics as unknown as Record<string, unknown>)[key];
  return typeof val === "number" ? val : null;
}

function formatValue(value: number | null, format: MetricRow["format"]): string {
  if (value == null) return "—";
  if (format === "percent") return formatPercent(value);
  if (format === "days") return `${value}d`;
  return formatNumber(value);
}

function findWinner(items: CompareItem[], key: string, higherIsBetter: boolean): number | null {
  let bestIdx: number | null = null;
  let bestVal: number | null = null;
  items.forEach((item, i) => {
    const val = getValue(item.analytics, key);
    if (val == null) return;
    if (bestVal == null || (higherIsBetter ? val > bestVal : val < bestVal)) {
      bestVal = val;
      bestIdx = i;
    }
  });
  return bestIdx;
}

export function CompareTable({ items }: { items: CompareItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-text-muted text-center py-8">Select strategies to compare.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted w-40">Metric</th>
            {items.map((item) => (
              <th key={item.strategy.id} className="text-right px-4 py-3 text-xs font-semibold text-text-primary">
                {item.strategy.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((metric) => {
            const winnerIdx = findWinner(items, metric.key, metric.higherIsBetter);
            return (
              <tr key={metric.key} className="border-b border-border/50 hover:bg-page/50">
                <td className="px-4 py-2.5 text-xs text-text-muted">{metric.label}</td>
                {items.map((item, i) => {
                  const val = getValue(item.analytics, metric.key);
                  const isWinner = winnerIdx === i && items.length > 1;
                  const qual = metric.qualKey ? getMetricLabel(metric.qualKey, val) : null;
                  return (
                    <td key={item.strategy.id} className="text-right px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        {qual && (
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", LABEL_COLORS[qual.color])}>
                            {qual.label}
                          </span>
                        )}
                        <span className={cn(
                          "text-xs font-metric",
                          isWinner ? "text-accent font-bold" : "text-text-secondary",
                        )}>
                          {formatValue(val, metric.format)}
                          {isWinner && " ✓"}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
