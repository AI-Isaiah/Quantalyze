"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { formatPercent, formatNumber, metricColor, extractAnalytics } from "@/lib/utils";
import type { StrategyAnalytics, AttributionRow } from "@/lib/types";

type SortKey = "name" | "weight" | "twr" | "sharpe" | "max_dd" | "contribution";
type SortDir = "asc" | "desc";

interface StrategyRow {
  strategy_id: string;
  name: string;
  weight: number | null;
  twr: number | null;
  sharpe: number | null;
  max_dd: number | null;
  contribution: number | null;
}

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Strategy" },
  { key: "weight", label: "Weight %", align: "right" },
  { key: "twr", label: "TWR %", align: "right" },
  { key: "sharpe", label: "Sharpe", align: "right" },
  { key: "max_dd", label: "Max DD %", align: "right" },
  { key: "contribution", label: "Contribution %", align: "right" },
];

interface StrategyBreakdownTableProps {
  strategies: Array<{
    strategy_id: string;
    current_weight: number | null;
    strategies: {
      id: string;
      name: string;
      strategy_analytics: unknown;
    } | null;
  }>;
  attribution: AttributionRow[] | null;
  portfolioId: string;
}

function getSortValue(row: StrategyRow, key: SortKey): number | string {
  switch (key) {
    case "name":
      return row.name;
    case "weight":
      return row.weight ?? 0;
    case "twr":
      return row.twr ?? 0;
    case "sharpe":
      return row.sharpe ?? 0;
    case "max_dd":
      return row.max_dd ?? 0;
    case "contribution":
      return row.contribution ?? 0;
  }
}

export function StrategyBreakdownTable({ strategies, attribution, portfolioId }: StrategyBreakdownTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("weight");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const rows: StrategyRow[] = useMemo(() => {
    return strategies.map((ps) => {
      const s = ps.strategies;
      const analytics = s
        ? (extractAnalytics(s.strategy_analytics) as StrategyAnalytics | null)
        : null;
      const attr = attribution?.find((a) => a.strategy_id === ps.strategy_id);

      // The persisted attribution payload contains contribution + allocation_effect
      // (see analytics-service/services/portfolio_risk.py::compute_attribution).
      // Weight and TWR come from the joined portfolio_strategies row and the
      // strategy's own analytics, not from attribution.
      return {
        strategy_id: ps.strategy_id,
        name: s?.name ?? "Unknown",
        weight: ps.current_weight ?? null,
        twr: analytics?.cagr ?? null,
        sharpe: analytics?.sharpe ?? null,
        max_dd: analytics?.max_drawdown ?? null,
        contribution: attr?.contribution ?? null,
      };
    });
  }, [strategies, attribution]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, sortKey, sortDir]);

  if (sorted.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
        No strategies in this portfolio.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`px-4 py-3 font-medium text-text-muted cursor-pointer hover:text-text-primary transition-colors select-none ${col.align === "right" ? "text-right" : "text-left"}`}
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="ml-1">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.strategy_id}
              className="border-b border-border last:border-0 hover:bg-page/50 transition-colors"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/portfolios/${portfolioId}/strategies/${row.strategy_id}`}
                  className="font-medium text-text-primary hover:text-accent transition-colors"
                >
                  {row.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-right font-metric text-text-secondary">
                {row.weight != null ? formatPercent(row.weight) : "\u2014"}
              </td>
              <td className={`px-4 py-3 text-right font-metric ${metricColor(row.twr)}`}>
                {formatPercent(row.twr)}
              </td>
              <td className={`px-4 py-3 text-right font-metric ${metricColor(row.sharpe)}`}>
                {formatNumber(row.sharpe)}
              </td>
              <td className="px-4 py-3 text-right font-metric text-negative">
                {formatPercent(row.max_dd)}
              </td>
              <td className={`px-4 py-3 text-right font-metric ${metricColor(row.contribution)}`}>
                {row.contribution != null ? formatPercent(row.contribution) : "\u2014"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
