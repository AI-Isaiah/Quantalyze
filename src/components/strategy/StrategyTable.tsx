"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Sparkline } from "@/components/charts/Sparkline";
import {
  StrategyFilters,
  EMPTY_ADVANCED_FILTERS,
  type SortKey,
  type SortDir,
  type ViewMode,
  type AdvancedFilters,
  type RangeFilter,
} from "./StrategyFilters";
import { StrategyGrid } from "./StrategyGrid";
import { formatPercent, formatNumber, formatCurrency, metricColor } from "@/lib/utils";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

type TableSortKey = SortKey | "name" | "six_month_return";

const COLUMNS: { key: TableSortKey; label: string; align?: "right" }[] = [
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
  basePath?: string;
}

// --- Range filter helper ---

function matchesRange(value: number | null | undefined, range: RangeFilter, scale: number): boolean {
  if (range.from === "" && range.to === "") return true;
  const v = value ?? 0;
  const scaled = v * scale;
  if (range.from !== "" && scaled < parseFloat(range.from)) return false;
  if (range.to !== "" && scaled > parseFloat(range.to)) return false;
  return true;
}

function matchesRangeRaw(value: number | null | undefined, range: RangeFilter): boolean {
  if (range.from === "" && range.to === "") return true;
  const v = value ?? 0;
  if (range.from !== "" && v < parseFloat(range.from)) return false;
  if (range.to !== "" && v > parseFloat(range.to)) return false;
  return true;
}

// --- Sort value getter ---

function getSortValue(s: StrategyWithAnalytics, key: TableSortKey): number | string {
  switch (key) {
    case "name":
      return s.name;
    case "aum":
      return s.aum ?? 0;
    case "computed_at":
      return s.analytics.computed_at ?? "";
    case "six_month_return":
      return s.analytics.six_month_return ?? 0;
    default:
      return (s.analytics[key as keyof StrategyAnalytics] as number) ?? 0;
  }
}

export function StrategyTable({ strategies, categorySlug, basePath = "/discovery" }: StrategyTableProps) {
  const [search, setSearch] = useState("");
  const [showExamples, setShowExamples] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("sharpe");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(EMPTY_ADVANCED_FILTERS);
  const [page, setPage] = useState(0);

  // Column header sort (uses a superset of SortKey)
  const [tableSortKey, setTableSortKey] = useState<TableSortKey>("sharpe");
  const [tableSortDir, setTableSortDir] = useState<SortDir>("desc");

  function handleColumnSort(key: TableSortKey) {
    if (tableSortKey === key) {
      setTableSortDir(tableSortDir === "asc" ? "desc" : "asc");
    } else {
      setTableSortKey(key);
      setTableSortDir("desc");
    }
    setPage(0);
  }

  // Sync top-bar sort changes to column sort
  function handleSortKeyChange(key: SortKey) {
    setSortKey(key);
    setTableSortKey(key);
    setPage(0);
  }

  function handleSortDirChange(dir: SortDir) {
    setSortDir(dir);
    setTableSortDir(dir);
    setPage(0);
  }

  const filtered = useMemo(() => {
    let result = strategies.filter((s) => s.status === "published");

    if (!showExamples) {
      result = result.filter((s) => !s.is_example);
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((s) => s.name.toLowerCase().includes(q));
    }

    // Advanced: types
    if (advancedFilters.types.length > 0) {
      result = result.filter((s) =>
        s.strategy_types.some((t) => advancedFilters.types.includes(t))
      );
    }

    // Advanced: subtypes
    if (advancedFilters.subtypes.length > 0) {
      result = result.filter((s) =>
        s.subtypes.some((t) => advancedFilters.subtypes.includes(t))
      );
    }

    // Advanced: markets
    if (advancedFilters.markets.length > 0) {
      result = result.filter((s) =>
        s.markets.some((m) => advancedFilters.markets.includes(m))
      );
    }

    // Advanced: capital ranges (raw dollar values)
    result = result.filter((s) => matchesRangeRaw(s.aum, advancedFilters.aum));
    result = result.filter((s) => matchesRangeRaw(s.max_capacity, advancedFilters.maxCapacity));

    // Advanced: performance ranges (analytics are decimal ratios, user enters %)
    // For percentage filters: user enters e.g. "50" meaning 50%, stored as 0.5
    result = result.filter((s) => matchesRange(s.analytics.cumulative_return, advancedFilters.cumulativeReturn, 100));
    result = result.filter((s) => matchesRange(s.analytics.cagr, advancedFilters.cagr, 100));
    result = result.filter((s) => matchesRange(s.analytics.max_drawdown, advancedFilters.maxDrawdown, 100));
    result = result.filter((s) => matchesRange(s.analytics.volatility, advancedFilters.volatility, 100));
    result = result.filter((s) => matchesRangeRaw(s.analytics.sharpe, advancedFilters.sharpe));
    result = result.filter((s) => matchesRange(s.analytics.six_month_return, advancedFilters.sixMonth, 100));
    result = result.filter((s) => matchesRangeRaw(s.analytics.calmar, advancedFilters.calmar));

    // 3M: from metrics_json if present
    if (advancedFilters.threeMonth.from !== "" || advancedFilters.threeMonth.to !== "") {
      result = result.filter((s) => {
        const mj = s.analytics.metrics_json as Record<string, number> | null;
        const val = mj?.three_month ?? null;
        return matchesRange(val, advancedFilters.threeMonth, 100);
      });
    }

    // Sort - in table mode use column sort, in grid mode use top-bar sort
    const effectiveSortKey = viewMode === "table" ? tableSortKey : sortKey;
    const effectiveSortDir = viewMode === "table" ? tableSortDir : sortDir;

    result.sort((a, b) => {
      const aVal = getSortValue(a, effectiveSortKey);
      const bVal = getSortValue(b, effectiveSortKey);

      if (aVal < bVal) return effectiveSortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return effectiveSortDir === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [strategies, search, showExamples, advancedFilters, sortKey, sortDir, tableSortKey, tableSortDir, viewMode]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div>
      <StrategyFilters
        search={search}
        onSearchChange={(s) => { setSearch(s); setPage(0); }}
        showExamples={showExamples}
        onToggleExamples={() => { setShowExamples(!showExamples); setPage(0); }}
        sortKey={sortKey}
        onSortKeyChange={handleSortKeyChange}
        sortDir={sortDir}
        onSortDirChange={handleSortDirChange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        advancedFilters={advancedFilters}
        onAdvancedFiltersChange={(f) => { setAdvancedFilters(f); setPage(0); }}
      />

      {viewMode === "table" ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleColumnSort(col.key)}
                    className={`px-4 py-3 font-medium text-text-muted cursor-pointer hover:text-text-primary transition-colors select-none ${col.align === "right" ? "text-right" : "text-left"}`}
                  >
                    {col.label}
                    {tableSortKey === col.key && (
                      <span className="ml-1">{tableSortDir === "asc" ? "\u2191" : "\u2193"}</span>
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
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`${basePath}/${categorySlug}/${s.id}`}
                        className="font-medium text-text-primary hover:text-accent transition-colors"
                      >
                        {s.name}
                      </Link>
                      {s.api_key_id && (
                        <span title="Verified via exchange API" className="text-accent">
                          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm3.78 5.22a.75.75 0 00-1.06 0L7 8.94 5.28 7.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25a.75.75 0 000-1.06z" />
                          </svg>
                        </span>
                      )}
                    </div>
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
      ) : (
        <StrategyGrid strategies={paged} categorySlug={categorySlug} basePath={basePath} />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-text-muted">
          <span>
            Showing {page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
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
