"use client";

import { useMemo, useState } from "react";
import type { WidgetProps } from "../../lib/types";
import { formatPercent, formatNumber } from "@/lib/utils";
import { computeWinRate } from "@/lib/portfolio-stats";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";

interface StrategyRow {
  strategy_id: string;
  alias: string | null;
  strategy: {
    name: string;
    codename: string | null;
    disclosure_tier: string;
    strategy_analytics: {
      daily_returns: unknown;
      cagr: number | null;
      sharpe: number | null;
      volatility: number | null;
      max_drawdown: number | null;
    } | null;
  };
}

type SortKey = "name" | "cagr" | "sharpe" | "sortino" | "maxDD" | "volatility" | "winRate";

interface RowData {
  name: string;
  cagr: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDD: number | null;
  volatility: number | null;
  winRate: number | null;
}

function displayName(row: StrategyRow): string {
  if (row.alias?.trim()) return row.alias.trim();
  if (row.strategy.disclosure_tier === "exploratory" && row.strategy.codename) {
    return row.strategy.codename;
  }
  return row.strategy.name;
}

/**
 * Strategy Comparison — sortable table of all strategies with key
 * performance metrics from strategy_analytics.
 */
export default function StrategyComparison({ data }: WidgetProps) {
  const [sortKey, setSortKey] = useState<SortKey>("cagr");
  const [sortAsc, setSortAsc] = useState(false);

  const rows = useMemo<RowData[]>(() => {
    const strategies = data?.strategies as StrategyRow[] | undefined;
    if (!strategies?.length) return [];

    return strategies.map((s) => {
      const a = s.strategy.strategy_analytics;
      const dr = normalizeDailyReturns(a?.daily_returns);
      const wr = dr.length > 0 ? computeWinRate(dr.map((d) => d.value)) : null;

      return {
        name: displayName(s),
        cagr: a?.cagr ?? null,
        sharpe: a?.sharpe ?? null,
        sortino: null, // sortino not in the per-strategy analytics subset
        maxDD: a?.max_drawdown ?? null,
        volatility: a?.volatility ?? null,
        winRate: wr?.winRate ?? null,
      };
    });
  }, [data]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return copy;
  }, [rows, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        No strategy data available.
      </div>
    );
  }

  const columns: { key: SortKey; label: string }[] = [
    { key: "name", label: "Name" },
    { key: "cagr", label: "CAGR" },
    { key: "sharpe", label: "Sharpe" },
    { key: "sortino", label: "Sortino" },
    { key: "maxDD", label: "Max DD" },
    { key: "volatility", label: "Vol" },
    { key: "winRate", label: "Win %" },
  ];

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortAsc ? " \u25B2" : " \u25BC";
  };

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm" data-testid="strategy-comparison-table">
        <thead>
          <tr className="border-b border-[#E2E8F0]">
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`py-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted cursor-pointer hover:text-text-primary select-none transition-colors ${
                  col.key === "name" ? "text-left pl-3" : "text-right"
                } ${col.key === columns[columns.length - 1].key ? "pr-3" : ""}`}
              >
                {col.label}
                {sortIndicator(col.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.name}
              className="border-b border-[#E2E8F0] last:border-b-0 hover:bg-[#F8F9FA] transition-colors"
            >
              <td className="py-2.5 pl-3 pr-2 text-text-primary font-medium truncate max-w-[160px]">
                {row.name}
              </td>
              <td className="px-2 py-2.5 text-right font-metric tabular-nums text-text-secondary">
                {formatPercent(row.cagr)}
              </td>
              <td className="px-2 py-2.5 text-right font-metric tabular-nums text-text-secondary">
                {formatNumber(row.sharpe)}
              </td>
              <td className="px-2 py-2.5 text-right font-metric tabular-nums text-text-secondary">
                {formatNumber(row.sortino)}
              </td>
              <td className="px-2 py-2.5 text-right font-metric tabular-nums text-negative">
                {formatPercent(row.maxDD)}
              </td>
              <td className="px-2 py-2.5 text-right font-metric tabular-nums text-text-secondary">
                {formatPercent(row.volatility)}
              </td>
              <td className="px-2 py-2.5 pr-3 text-right font-metric tabular-nums text-text-secondary">
                {row.winRate != null ? `${(row.winRate * 100).toFixed(1)}%` : "\u2014"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
