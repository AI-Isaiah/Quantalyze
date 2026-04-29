"use client";

import { useState, useMemo, useCallback, useEffect, useId } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Sparkline } from "@/components/charts/Sparkline";
import { sparklineColor } from "@/lib/sparkline-color";
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
import { SyncBadge } from "./SyncBadge";
import { StarToggle } from "./StarToggle";
import { WatchlistTabs } from "./WatchlistTabs";
import { EmptyWatchlist } from "./EmptyWatchlist";
import { CustomizeDrawer } from "./CustomizeDrawer";
import { SimulateImpactButton } from "@/components/discovery/SimulateImpactButton";
import { formatPercent, formatNumber, formatCurrency, metricColor } from "@/lib/utils";
import {
  useDiscoveryPrefs,
  type DiscoveryViewPreferences,
} from "@/lib/discovery-prefs";
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
  /**
   * Sprint 6 Task 6.4: the authenticated user's single real portfolio id.
   * When present, each row renders a "Simulate Impact" button that opens
   * the PortfolioImpactPanel. When null, the button is disabled with an
   * explanatory tooltip.
   */
  portfolioId?: string | null;
  /**
   * Phase 13 / Plan 13-01 / DISCO-01 — when present (allocator on
   * /discovery), the table renders the WatchlistTabs scope switch in the
   * filter row, a leading star column on each row, and gates the empty
   * <EmptyWatchlist> state on `scope === "watchlist" && watchedSet.size === 0`.
   * Undefined on /browse (public, unauth) — table renders unchanged.
   */
  userId?: string;
  initialWatchedSet?: Set<string>;
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

export function StrategyTable({
  strategies,
  categorySlug,
  basePath = "/discovery",
  portfolioId = null,
  userId,
  initialWatchedSet,
}: StrategyTableProps) {
  const reactId = useId();
  const tabIdBase = `watchlist${reactId}`;
  const panelId = `strategy-list${reactId}`;
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

  // Capture wall-clock time at mount for the track-record filter (stable across renders)
  const [mountedAtMs] = useState(() => Date.now());

  // Phase 13 / DISCO-01 — Watchlist scope + watched-set state. Hydrated on
  // first render from the server-rendered initialWatchedSet so the leading
  // star column reflects the persisted state without a flash. The watched
  // set mutates optimistically in onToggleStar (mirrors StarToggle's
  // optimistic flip → useTransition PUT pattern); a server failure inside
  // StarToggle calls onToggleStar a second time with the original value to
  // revert this state in lock-step.
  const [scope, setScope] = useState<"all" | "watchlist">("all");
  const [watchedSet, setWatchedSet] = useState<Set<string>>(
    () => initialWatchedSet ?? new Set<string>(),
  );

  const onToggleStar = useCallback((strategyId: string, nextStarred: boolean) => {
    setWatchedSet((prev) => {
      const next = new Set(prev);
      if (nextStarred) next.add(strategyId);
      else next.delete(strategyId);
      return next;
    });
  }, []);

  // Phase 13 / DISCO-02 — Customize drawer + per-user prefs.
  // useDiscoveryPrefs(undefined, slug) safely no-ops on the persistence
  // path when no userId is present (locked by Plan 13-02 Task 1 case 12),
  // so /browse callers without a userId can render this hook without
  // ever writing to localStorage.
  const { prefs, setPrefs, hydrated: prefsHydrated } = useDiscoveryPrefs(
    userId,
    categorySlug,
  );
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draftPrefs, setDraftPrefs] = useState<DiscoveryViewPreferences>(prefs);

  // Mirror prefs into legacy state slots once on hydration. Gating on
  // `prefsHydrated` only (not `prefs`) prevents a post-Save re-render from
  // clobbering user-driven column-sort or view-toggle changes that haven't
  // been persisted yet.
  useEffect(() => {
    if (!prefsHydrated) return;
    setViewMode(prefs.view);
    setSortKey(prefs.sort.key);
    setSortDir(prefs.sort.dir);
    setTableSortKey(prefs.sort.key);
    setTableSortDir(prefs.sort.dir);
    setShowExamples(!prefs.hide_examples);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsHydrated]);

  const handleOpenCustomize = useCallback(() => {
    setDraftPrefs(prefs);
    setCustomizeOpen(true);
  }, [prefs]);

  const handleSavePrefs = useCallback(() => {
    setPrefs(draftPrefs);
    setCustomizeOpen(false);
  }, [draftPrefs, setPrefs]);

  const handleCloseCustomize = useCallback(() => {
    setCustomizeOpen(false);
  }, []);

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

    // Phase 13 / DISCO-01 — Watchlist scope is the FIRST narrowing pass.
    // When scope === "watchlist" we restrict the candidate set to currently
    // starred strategies before any other filter runs, so the rest of the
    // pipeline (search, advanced filters, sort, paging) sees a small
    // pre-narrowed list — avoids paginating across all strategies and then
    // discovering the visible page is empty.
    if (scope === "watchlist") {
      result = result.filter((s) => watchedSet.has(s.id));
    }

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

    // Advanced: exchanges
    if (advancedFilters.exchanges.length > 0) {
      result = result.filter((s) =>
        s.supported_exchanges.some((e) =>
          advancedFilters.exchanges.some((f) => f.toLowerCase() === e.toLowerCase())
        )
      );
    }

    // Advanced: min track record
    if (advancedFilters.minTrackRecord !== "") {
      const minDays = parseInt(advancedFilters.minTrackRecord, 10);
      result = result.filter((s) => {
        if (!s.start_date) return false;
        const start = new Date(s.start_date);
        const daysSince = (mountedAtMs - start.getTime()) / (1000 * 60 * 60 * 24);
        return daysSince >= minDays;
      });
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
  }, [strategies, search, showExamples, advancedFilters, sortKey, sortDir, tableSortKey, tableSortDir, viewMode, mountedAtMs, scope, watchedSet]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Phase 13 / DISCO-01 — column count for the "no rows" placeholder. The
  // existing table has 11 cells per row (8 sort columns + Return spark +
  // Underwater spark + Actions). When userId is present, we add a leading
  // 12th cell for the star toggle.
  const showStarColumn = userId !== undefined;
  const emptyRowColSpan = showStarColumn ? 12 : 11;

  const showEmptyWatchlist = scope === "watchlist" && watchedSet.size === 0;

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
        leadingSlot={
          userId !== undefined ? (
            <WatchlistTabs
              scope={scope}
              onScopeChange={(s) => { setScope(s); setPage(0); }}
              count={watchedSet.size}
              idBase={tabIdBase}
              panelId={panelId}
            />
          ) : undefined
        }
        onOpenCustomize={
          userId !== undefined ? handleOpenCustomize : undefined
        }
      />

      <div
        id={panelId}
        {...(userId !== undefined
          ? {
              role: "tabpanel",
              "aria-labelledby":
                scope === "watchlist"
                  ? `${tabIdBase}-tab-watchlist`
                  : `${tabIdBase}-tab-all`,
            }
          : {})}
      >
        {showEmptyWatchlist ? (
          <EmptyWatchlist />
        ) : viewMode === "table" ? (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {showStarColumn && (
                    <th
                      scope="col"
                      className="px-2 py-3 w-11 text-left font-medium text-text-muted"
                    >
                      <span className="sr-only">Watchlist</span>
                    </th>
                  )}
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
                  <th className="px-4 py-3 text-right font-medium text-text-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-border last:border-0"
                  >
                    {showStarColumn && (
                      <td className="px-2 py-3 w-11 align-middle">
                        <StarToggle
                          strategyId={s.id}
                          name={s.name}
                          starred={watchedSet.has(s.id)}
                          onToggle={onToggleStar}
                          size="table"
                        />
                      </td>
                    )}
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
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex gap-1">
                          {s.strategy_types.map((t) => (
                            <Badge key={t} label={t} />
                          ))}
                        </div>
                        <SyncBadge computedAt={s.analytics.computed_at} exchange={s.supported_exchanges?.[0]} />
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
                      <Sparkline
                        data={s.analytics.sparkline_returns ?? []}
                        color={sparklineColor(s.analytics.sparkline_returns ?? [])}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Sparkline
                        data={s.analytics.sparkline_drawdown ?? []}
                        color="var(--color-negative)"
                        fill
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <SimulateImpactButton
                        candidateStrategyId={s.id}
                        candidateName={s.name}
                        portfolioId={portfolioId}
                      />
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={emptyRowColSpan} className="px-4 py-8 text-center text-text-muted">
                      No strategies match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <StrategyGrid
            strategies={paged}
            categorySlug={categorySlug}
            basePath={basePath}
            userId={userId}
            watchedSet={watchedSet}
            onToggleStar={onToggleStar}
          />
        )}

        {!showEmptyWatchlist && totalPages > 1 && (
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

      {/* Phase 13 / DISCO-02 — CustomizeDrawer is owned here so the parent
          (the discovery page) doesn't have to thread props through; only
          rendered when the allocator is signed in (userId present). */}
      {userId !== undefined && (
        <CustomizeDrawer
          open={customizeOpen}
          onClose={handleCloseCustomize}
          draft={draftPrefs}
          setDraft={setDraftPrefs}
          persisted={prefs}
          onSave={handleSavePrefs}
        />
      )}
    </div>
  );
}
