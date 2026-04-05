"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Sparkline } from "@/components/charts/Sparkline";
import { StrategyFilters } from "./StrategyFilters";
import { formatPercent, formatNumber, formatCurrency, metricColor } from "@/lib/utils";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

type SortKey = "name" | "cumulative_return" | "cagr" | "sharpe" | "max_drawdown" | "volatility" | "six_month_return" | "aum";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Strategy" },
  { key: "cumulative_return", label: "Return %", align: "right" },
  { key: "cagr", label: "CAGR", align: "right" },
  { key: "sharpe", label: "Sharpe", align: "right" },
  { key: "max_drawdown", label: "Max DD", align: "right" },
  { key: "volatility", label: "Volatility", align: "right" },
  { key: "six_month_return", label: "6 Month", align: "right" },
  { key: "aum", label: "AUM", align: "right" },
];

const PAGE_SIZE = 20;

interface StrategyTableProps {
  strategies: StrategyWithAnalytics[];
  categorySlug: string;
}

export function StrategyTable({ strategies, categorySlug }: StrategyTableProps) {
  const [selectedType, setSelectedType] = useState("");
  const [search, setSearch] = useState("");
  const [showExamples, setShowExamples] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("sharpe");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  }

  const filtered = useMemo(() => {
    let result = strategies.filter((s) => s.status === "published");

    if (!showExamples) {
      result = result.filter((s) => !s.is_example);
    }
    if (selectedType) {
      result = result.filter((s) => s.strategy_types.includes(selectedType));
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((s) => s.name.toLowerCase().includes(q));
    }

    result.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      if (sortKey === "name") {
        aVal = a.name;
        bVal = b.name;
      } else if (sortKey === "aum") {
        aVal = a.aum ?? 0;
        bVal = b.aum ?? 0;
      } else {
        aVal = a.analytics[sortKey] ?? 0;
        bVal = b.analytics[sortKey] ?? 0;
      }

      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [strategies, selectedType, search, showExamples, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div>
      <StrategyFilters
        selectedType={selectedType}
        onTypeChange={(t) => { setSelectedType(t); setPage(0); }}
        search={search}
        onSearchChange={(s) => { setSearch(s); setPage(0); }}
        showExamples={showExamples}
        onToggleExamples={() => { setShowExamples(!showExamples); setPage(0); }}
      />

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
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
                    <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
                  )}
                </th>
              ))}
              <th className="px-4 py-3 text-left font-medium text-text-muted">Return</th>
              <th className="px-4 py-3 text-left font-medium text-text-muted">Underwater</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((s) => (
              <tr
                key={s.id}
                className="border-b border-border last:border-0 hover:bg-page/50 transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/discovery/${categorySlug}/${s.id}`}
                    className="font-medium text-text-primary hover:text-accent transition-colors"
                  >
                    {s.name}
                  </Link>
                  <div className="flex gap-1 mt-1">
                    {s.strategy_types.map((t) => (
                      <Badge key={t} label={t} />
                    ))}
                  </div>
                </td>
                <td className={`px-4 py-3 text-right font-metric ${metricColor(s.analytics.cumulative_return)}`}>
                  {formatPercent(s.analytics.cumulative_return)}
                </td>
                <td className={`px-4 py-3 text-right font-metric ${metricColor(s.analytics.cagr)}`}>
                  {formatPercent(s.analytics.cagr)}
                </td>
                <td className={`px-4 py-3 text-right font-metric ${metricColor(s.analytics.sharpe)}`}>
                  {formatNumber(s.analytics.sharpe)}
                </td>
                <td className="px-4 py-3 text-right font-metric text-negative">
                  {formatPercent(s.analytics.max_drawdown)}
                </td>
                <td className="px-4 py-3 text-right font-metric text-text-secondary">
                  {formatPercent(s.analytics.volatility)}
                </td>
                <td className={`px-4 py-3 text-right font-metric ${metricColor(s.analytics.six_month_return)}`}>
                  {formatPercent(s.analytics.six_month_return)}
                </td>
                <td className="px-4 py-3 text-right font-metric text-text-secondary">
                  {formatCurrency(s.aum)}
                </td>
                <td className="px-4 py-3">
                  <Sparkline data={s.analytics.sparkline_returns ?? []} />
                </td>
                <td className="px-4 py-3">
                  <Sparkline
                    data={s.analytics.sparkline_drawdown ?? []}
                    color="var(--color-negative)"
                    fill
                  />
                </td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-text-muted">
                  No strategies match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-text-muted">
          <span>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 0}
              className="px-3 py-1 rounded border border-border bg-surface text-text-secondary disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 rounded border border-border bg-surface text-text-secondary disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
