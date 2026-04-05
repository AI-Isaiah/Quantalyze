"use client";

import { useState } from "react";
import { formatPercent, formatNumber, metricColor, cn } from "@/lib/utils";
import type { StrategyAnalytics } from "@/lib/types";

interface MetricGroup {
  title: string;
  defaultOpen: boolean;
  hide?: boolean;
  metrics: { label: string; value: string; colorClass?: string }[];
}

function buildGroups(a: StrategyAnalytics): MetricGroup[] {
  const m = a.metrics_json as Record<string, number> | null;
  const tm = a.trade_metrics as Record<string, number> | null;

  return [
    {
      title: "Main Metrics",
      defaultOpen: true,
      metrics: [
        { label: "Cumulative Return", value: formatPercent(a.cumulative_return), colorClass: metricColor(a.cumulative_return) },
        { label: "CAGR", value: formatPercent(a.cagr), colorClass: metricColor(a.cagr) },
        { label: "Volatility", value: formatPercent(a.volatility) },
        { label: "Sharpe", value: formatNumber(a.sharpe), colorClass: metricColor(a.sharpe) },
        { label: "Sortino", value: formatNumber(a.sortino), colorClass: metricColor(a.sortino) },
        { label: "Calmar", value: formatNumber(a.calmar), colorClass: metricColor(a.calmar) },
        { label: "Max Drawdown", value: formatPercent(a.max_drawdown), colorClass: "text-negative" },
        { label: "DD Duration", value: a.max_drawdown_duration_days != null ? `${a.max_drawdown_duration_days}d` : "—" },
      ],
    },
    {
      title: "Returns Metrics",
      defaultOpen: true,
      metrics: [
        { label: "VaR (1d 95%)", value: formatPercent(m?.var_1d_95) },
        { label: "VaR (1m 99%)", value: formatPercent(m?.var_1m_99) },
        { label: "CVaR", value: formatPercent(m?.cvar) },
        { label: "Gini", value: formatNumber(m?.gini) },
        { label: "Omega", value: formatNumber(m?.omega) },
        { label: "Gain/Pain", value: formatNumber(m?.gain_pain) },
        { label: "Tail Ratio", value: formatNumber(m?.tail_ratio) },
      ],
    },
    {
      title: "Cumulative Returns",
      defaultOpen: false,
      metrics: [
        { label: "MTD", value: formatPercent(m?.mtd), colorClass: metricColor(m?.mtd) },
        { label: "3 Month", value: formatPercent(m?.three_month), colorClass: metricColor(m?.three_month) },
        { label: "6 Month", value: formatPercent(a.six_month_return), colorClass: metricColor(a.six_month_return) },
        { label: "YTD", value: formatPercent(m?.ytd), colorClass: metricColor(m?.ytd) },
        { label: "Best Day", value: formatPercent(m?.best_day), colorClass: "text-positive" },
        { label: "Worst Day", value: formatPercent(m?.worst_day), colorClass: "text-negative" },
        { label: "Best Month", value: formatPercent(m?.best_month), colorClass: "text-positive" },
        { label: "Worst Month", value: formatPercent(m?.worst_month), colorClass: "text-negative" },
      ],
    },
    {
      title: "Benchmark Metrics",
      defaultOpen: false,
      hide: m?.alpha == null && m?.beta == null,
      metrics: [
        { label: "Alpha", value: formatNumber(m?.alpha), colorClass: metricColor(m?.alpha) },
        { label: "Beta", value: formatNumber(m?.beta) },
        { label: "Info Ratio", value: formatNumber(m?.info_ratio), colorClass: metricColor(m?.info_ratio) },
        { label: "Treynor", value: formatNumber(m?.treynor) },
        { label: "Correlation", value: formatNumber(m?.correlation) },
      ],
    },
    {
      title: "Distribution",
      defaultOpen: false,
      hide: m?.skewness == null && m?.kurtosis == null,
      metrics: [
        { label: "Skewness", value: formatNumber(m?.skewness) },
        { label: "Kurtosis", value: formatNumber(m?.kurtosis) },
        { label: "Smart Sharpe", value: formatNumber(m?.smart_sharpe), colorClass: metricColor(m?.smart_sharpe) },
        { label: "Smart Sortino", value: formatNumber(m?.smart_sortino), colorClass: metricColor(m?.smart_sortino) },
        { label: "Outlier Win %", value: formatPercent(m?.outlier_win_ratio) },
        { label: "Outlier Loss %", value: formatPercent(m?.outlier_loss_ratio) },
      ],
    },
    {
      title: "Win/Loss Analysis",
      defaultOpen: false,
      hide: m?.avg_win == null && m?.avg_loss == null,
      metrics: [
        { label: "Avg Win", value: formatPercent(m?.avg_win), colorClass: "text-positive" },
        { label: "Avg Loss", value: formatPercent(m?.avg_loss), colorClass: "text-negative" },
        { label: "Win/Loss Ratio", value: formatNumber(m?.win_loss_ratio) },
        { label: "Payoff Ratio", value: formatNumber(m?.payoff_ratio) },
        { label: "Profit Factor", value: formatNumber(m?.profit_factor), colorClass: metricColor(m?.profit_factor != null ? m.profit_factor - 1 : null) },
        { label: "Max Win Streak", value: m?.consecutive_wins != null ? String(m.consecutive_wins) : "—" },
        { label: "Max Loss Streak", value: m?.consecutive_losses != null ? String(m.consecutive_losses) : "—" },
      ],
    },
    {
      title: "Trade Metrics",
      defaultOpen: false,
      hide: tm == null,
      metrics: [
        { label: "Total Trades", value: tm?.total_trades != null ? Math.round(tm.total_trades).toLocaleString() : "—" },
        { label: "Win Rate", value: formatPercent(tm?.win_rate) },
        { label: "Maker %", value: formatPercent(tm?.maker_pct) },
        { label: "Long %", value: formatPercent(tm?.long_pct) },
      ],
    },
  ];
}

export function MetricPanel({ analytics }: { analytics: StrategyAnalytics }) {
  const groups = buildGroups(analytics);

  return (
    <div className="sticky top-8 space-y-1 overflow-y-auto max-h-[calc(100vh-8rem)]">
      {groups.filter((g) => !g.hide).map((group) => (
        <MetricAccordion key={group.title} group={group} />
      ))}
    </div>
  );
}

function MetricAccordion({ group }: { group: MetricGroup }) {
  const [open, setOpen] = useState(group.defaultOpen);

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-text-primary hover:bg-page/50 transition-colors"
      >
        {group.title}
        <svg
          className={cn("h-4 w-4 text-text-muted transition-transform", open && "rotate-180")}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2">
          {group.metrics.map((m) => (
            <div key={m.label} className="flex items-center justify-between">
              <span className="text-xs text-text-muted">{m.label}</span>
              <span className={cn("text-xs font-metric", m.colorClass ?? "text-text-secondary")}>
                {m.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
