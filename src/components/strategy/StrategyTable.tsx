"use client";

import { useState, useMemo, useCallback, useEffect, useId, useRef } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ResponsiveTable } from "@/components/ResponsiveTable";
import { withViewTransition } from "@/lib/view-transition";
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

// Priority order (50-UI-SPEC §Dense Reshape behavior 2): Strategy > Return% >
// CAGR > Sharpe > Max DD stay visible at every container width; Volatility,
// 6 Month, AUM (and the two sparkline columns, handled inline below) collapse
// first at narrow widths via the Tailwind v4 `@container` `@max-3xl:hidden`
// variant — their REAL values relocate into the per-row <details>, never a
// fabricated zero/em-dash (no-invented-data / STATE-02).
const COLUMNS: {
  key: TableSortKey;
  label: string;
  align?: "right";
  collapse?: boolean;
}[] = [
  { key: "name", label: "Strategy" },
  { key: "cumulative_return", label: "Return %", align: "right" },
  { key: "cagr", label: "CAGR", align: "right" },
  { key: "sharpe", label: "Sharpe", align: "right" },
  { key: "max_drawdown", label: "Max DD", align: "right" },
  { key: "volatility", label: "Volatility", align: "right", collapse: true },
  { key: "six_month_return", label: "6 Month", align: "right", collapse: true },
  { key: "aum", label: "AUM", align: "right", collapse: true },
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
   * When present (signed-in allocator on /discovery), the table renders the
   * WatchlistTabs scope switch, a leading star column, and gates the
   * <EmptyWatchlist> state on `scope === "watchlist" && watchedSet.size === 0`.
   * Undefined on /browse — table renders unchanged.
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

  // STATE-03 dense reshape — table-scoped density ("comfortable" = the :root
  // 44px/16px default, "compact" = the [data-strategy-table][data-density="tight"]
  // 36px/12px step from globals.css). This data-density attribute lands on the
  // TABLE ROOT only (never <body>), so it cannot leak into the allocator
  // dashboard's global body[data-density] knob (RESEARCH Q2 / globals.css §50).
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");

  // Visible scroll-cue gate. The cue (and the ResponsiveTable aria announcement
  // it pairs with) is only meaningful when the table actually overflows its
  // horizontal scroll container. Measured from the scroll container on mount,
  // resize, and whenever the rendered column set changes (density/paging).
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  // Column header sort (uses a superset of SortKey)
  const [tableSortKey, setTableSortKey] = useState<TableSortKey>("sharpe");
  const [tableSortDir, setTableSortDir] = useState<SortDir>("desc");

  // Capture wall-clock time at mount for the track-record filter (stable across renders)
  const [mountedAtMs] = useState(() => Date.now());

  // Watchlist scope + watched-set. Hydrated from the SSR initialWatchedSet
  // so the leading star column reflects persisted state without a flash.
  // onToggleStar applies an optimistic flip; StarToggle reverts via the
  // same callback on a server failure, keeping this state in lock-step.
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

  // useDiscoveryPrefs(undefined, slug) is a safe no-op on the persistence
  // path — /browse callers (no userId) never write to localStorage.
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
  //
  // F9 M-0475/M-0476 — "once on hydration" is per-MOUNT, not per-session. On a
  // client-side category navigation (/discovery/crypto-sma → /discovery/equity-sma)
  // useDiscoveryPrefs returns the new slug's prefs, but `prefsHydrated` stays
  // true across the key flip, so this effect would NOT re-fire and the legacy
  // view/sort/showExamples state would stay pinned to the previous category.
  // The fix lives at the call sites: both /discovery/[slug] and /browse/[slug]
  // now pass `key={(user,)slug}` so a scope change REMOUNTS this component and
  // this effect re-runs cleanly for the new scope. Do not relax that key
  // without re-introducing a slug-aware re-mirror here.
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
    // Apply the saved prefs to the legacy state slots immediately so the
    // visible view reflects the change without a refresh. Without this the
    // hydration effect — gated on `prefsHydrated` only — leaves the table
    // showing the previous view/sort/hide-examples until reload.
    setViewMode(draftPrefs.view);
    setSortKey(draftPrefs.sort.key);
    setSortDir(draftPrefs.sort.dir);
    setTableSortKey(draftPrefs.sort.key);
    setTableSortDir(draftPrefs.sort.dir);
    setShowExamples(!draftPrefs.hide_examples);
    setPage(0);
    setCustomizeOpen(false);
  }, [draftPrefs, setPrefs]);

  const handleCloseCustomize = useCallback(() => {
    setCustomizeOpen(false);
  }, []);

  // STATE-04 — the row-height change cross-fades via the native View-Transition
  // helper (250ms crossfade), falling back to an instant swap under
  // prefers-reduced-motion / no-API support / SSR. No-op when the value is
  // already active so a repeat click doesn't trigger a needless snapshot. The
  // closure reads the current `density` each render (useCallback dep), so the
  // guard is correct without an updater-function side effect.
  const handleDensityChange = useCallback(
    (next: "comfortable" | "compact") => {
      if (density === next) return;
      withViewTransition(() => setDensity(next));
    },
    [density],
  );

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

    // Watchlist scope narrows FIRST — restricting to starred strategies
    // before search/advanced/sort/paging avoids paginating across all
    // strategies only to discover the visible page is empty.
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

  // STATE-03 scroll-cue gate. Measure the scroll container's overflow whenever
  // the rendered layout can change width: on mount, on viewport resize, and on
  // density / page / view-mode / row-count changes (each can grow or shrink the
  // table). The cue is purely a visible hint — its SR equivalent is the
  // ResponsiveTable region aria-label, so this only drives the aria-hidden cue.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      setIsOverflowing(false);
      return;
    }
    const measure = () => {
      const node = scrollContainerRef.current;
      if (node) setIsOverflowing(node.scrollWidth > node.clientWidth);
    };
    measure();
    // ResizeObserver tracks the container's own box (container-query-correct);
    // guard for jsdom / older runtimes where it is absent.
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [density, page, viewMode, paged.length]);

  // Column count for the "no rows" placeholder. Visible-always: Strategy +
  // Return% + CAGR + Sharpe + Max DD (5). Priority-collapsed but still in the
  // DOM (CSS @max-3xl:hidden): Volatility + 6 Month + AUM + Return spark +
  // Underwater spark (5). Plus the per-row Details disclosure column (1) and
  // Actions (1) = 12; +1 leading star column when userId is present.
  const showStarColumn = userId !== undefined;
  const emptyRowColSpan = showStarColumn ? 13 : 12;

  const showEmptyWatchlist = scope === "watchlist" && watchedSet.size === 0;

  return (
    <div>
      <StrategyFilters
        search={search}
        onSearchChange={(s) => { setSearch(s); setPage(0); }}
        showExamples={showExamples}
        onToggleExamples={() => {
          // Functional update so the handler reads the current `showExamples`
          // value at fire time, not the value captured when the click handler
          // closure was created. Defends against a hydration race where the
          // hydration effect at line 162-171 queues a `setShowExamples`
          // between the click being scheduled and the closure invoking the
          // setter — the stale closure would otherwise flip back to the
          // pre-hydration value. Tied to the e2e flake documented in
          // e2e/discovery-hide-examples-default.spec.ts:103-117.
          setShowExamples((v) => !v);
          setPage(0);
        }}
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
          <div
            data-strategy-table=""
            data-density={density === "compact" ? "tight" : undefined}
            className="relative rounded-xl border border-border bg-surface"
          >
            {/* Density control \u2014 table-SCOPED (drives the data-density on this
                root only, never <body>, so it cannot flip the allocator
                dashboard). Wrapped through withViewTransition for the
                reduced-motion-safe row-height crossfade (STATE-04). */}
            <div className="flex items-center justify-end border-b border-border px-4 py-2">
              <div
                role="group"
                aria-label="Table density"
                className="inline-flex overflow-hidden rounded-lg border border-border"
              >
                <button
                  type="button"
                  aria-pressed={density === "comfortable"}
                  onClick={() => handleDensityChange("comfortable")}
                  className={`px-3 py-1 text-caption transition-colors ${
                    density === "comfortable"
                      ? "bg-page text-accent"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  Comfortable
                </button>
                <button
                  type="button"
                  aria-pressed={density === "compact"}
                  onClick={() => handleDensityChange("compact")}
                  className={`border-l border-border px-3 py-1 text-caption transition-colors ${
                    density === "compact"
                      ? "bg-page text-accent"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  Compact
                </button>
              </div>
            </div>

            {/* ResponsiveTable is the SINGLE scroll region \u2014 it owns the
                role=region + unique aria-label landmark (the SR scroll-affordance
                announcement) and, via `className`, doubles as the @container
                containment context for the priority-collapse. `scrollRef` lets
                the visible cue measure the real scroll box. */}
            <ResponsiveTable
              label="Strategies"
              className="@container"
              scrollRef={scrollContainerRef}
            >
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-border">
                    {showStarColumn && (
                      <th
                        scope="col"
                        className="sticky left-0 top-0 z-30 w-11 bg-surface px-2 py-3 text-left font-medium text-text-muted"
                      >
                        <span className="sr-only">Watchlist</span>
                      </th>
                    )}
                    {COLUMNS.map((col, i) => {
                      // The Strategy-name column (the first non-star column) is
                      // the sticky first column. When the star column is present
                      // it is the corner cell (z-30); otherwise the name header is
                      // the corner. Sticky-left + opaque bg + a right hairline so
                      // it reads as pinned on horizontal scroll (Pattern 3).
                      const isFirstCol = i === 0;
                      const stickyLeft = isFirstCol
                        ? showStarColumn
                          ? "sticky left-11 top-0 z-20 bg-surface border-r border-border"
                          : "sticky left-0 top-0 z-30 bg-surface border-r border-border"
                        : "sticky top-0 z-20 bg-surface";
                      return (
                        <th
                          key={col.key}
                          scope="col"
                          onClick={() => handleColumnSort(col.key)}
                          className={`${stickyLeft} px-4 py-3 font-medium text-text-muted cursor-pointer hover:text-text-primary transition-colors select-none ${col.align === "right" ? "text-right" : "text-left"} ${col.collapse ? "@max-3xl:hidden" : ""}`}
                        >
                          {col.label}
                          {tableSortKey === col.key && (
                            <span className="ml-1">{tableSortDir === "asc" ? "\u2191" : "\u2193"}</span>
                          )}
                        </th>
                      );
                    })}
                    <th className="sticky top-0 z-20 bg-surface px-4 py-3 text-left font-medium text-text-muted @max-3xl:hidden">Return</th>
                    <th className="sticky top-0 z-20 bg-surface px-4 py-3 text-left font-medium text-text-muted @max-3xl:hidden">Underwater</th>
                    {/* Details disclosure column \u2014 surfaces the collapsed values
                        at narrow widths; the header is a screen-reader label. */}
                    <th scope="col" className="sticky top-0 z-20 bg-surface px-4 py-3 text-left font-medium text-text-muted @3xl:hidden">
                      <span className="sr-only">Details</span>
                    </th>
                    <th className="sticky top-0 z-20 bg-surface px-4 py-3 text-right font-medium text-text-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((s) => {
                    // Compute each collapsible cell's value ONCE so the visible
                    // cell and the relocated <details> render the IDENTICAL real
                    // value via the honest-null formatters \u2014 never a fabricated
                    // 0/\u2014/demo number (no-invented-data / STATE-02 / T-50-09).
                    const volatilityText = formatPercent(s.analytics.volatility);
                    const sixMonthText = formatPercent(s.analytics.six_month_return);
                    const aumText = formatCurrency(s.aum);
                    return (
                      <tr
                        key={s.id}
                        className="group border-b border-border last:border-0 transition-colors"
                        style={{ height: "var(--row-h)" }}
                      >
                        {showStarColumn && (
                          <td className="sticky left-0 z-10 w-11 bg-surface px-2 py-3 align-middle">
                            <StarToggle
                              strategyId={s.id}
                              name={s.name}
                              starred={watchedSet.has(s.id)}
                              onToggle={onToggleStar}
                              size="table"
                            />
                          </td>
                        )}
                        {/* Sticky first data column \u2014 solid bg-surface, NOT the
                            translucent hover:bg-page/50, so scrolled cells do not
                            bleed through (Pitfall 5). */}
                        <td
                          className={`sticky z-10 bg-surface px-4 py-3 border-r border-border ${showStarColumn ? "left-11" : "left-0"}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={`/factsheet/${s.id}`}
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
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors ${metricColor(s.analytics.cumulative_return)}`}>
                          {formatPercent(s.analytics.cumulative_return)}
                        </td>
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors ${metricColor(s.analytics.cagr)}`}>
                          {formatPercent(s.analytics.cagr)}
                        </td>
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors ${metricColor(s.analytics.sharpe)}`}>
                          {formatNumber(s.analytics.sharpe)}
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums text-negative group-hover:bg-page/50 transition-colors">
                          {formatPercent(s.analytics.max_drawdown)}
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums text-text-secondary group-hover:bg-page/50 transition-colors @max-3xl:hidden">
                          {volatilityText}
                        </td>
                        <td className={`px-4 py-3 text-right font-metric tabular-nums group-hover:bg-page/50 transition-colors @max-3xl:hidden ${metricColor(s.analytics.six_month_return)}`}>
                          {sixMonthText}
                        </td>
                        <td className="px-4 py-3 text-right font-metric tabular-nums text-text-secondary group-hover:bg-page/50 transition-colors @max-3xl:hidden">
                          {aumText}
                        </td>
                        <td className="px-4 py-3 group-hover:bg-page/50 transition-colors @max-3xl:hidden" data-testid="sparkline-cell-returns">
                          <Sparkline
                            data={s.analytics.sparkline_returns ?? []}
                            color={sparklineColor(s.analytics.sparkline_returns ?? [])}
                            data-testid="sparkline-returns"
                          />
                        </td>
                        <td className="px-4 py-3 group-hover:bg-page/50 transition-colors @max-3xl:hidden" data-testid="sparkline-cell-drawdown">
                          <Sparkline
                            data={s.analytics.sparkline_drawdown ?? []}
                            color="var(--color-negative)"
                            fill
                          />
                        </td>
                        {/* Priority-collapse detail \u2014 only shown once the
                            columns above collapse (@3xl:hidden = visible below
                            the 3xl container width). Relocates the SAME real
                            values (volatilityText/sixMonthText/aumText) computed
                            once above; sparklines relocate too. */}
                        <td className="px-4 py-3 align-top group-hover:bg-page/50 transition-colors @3xl:hidden">
                          <details className="text-caption text-text-secondary">
                            <summary className="cursor-pointer select-none text-text-muted hover:text-text-primary">
                              More
                            </summary>
                            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
                              <dt className="text-text-muted">Volatility</dt>
                              <dd className="text-right font-metric tabular-nums">{volatilityText}</dd>
                              <dt className="text-text-muted">6 Month</dt>
                              <dd className={`text-right font-metric tabular-nums ${metricColor(s.analytics.six_month_return)}`}>{sixMonthText}</dd>
                              <dt className="text-text-muted">AUM</dt>
                              <dd className="text-right font-metric tabular-nums">{aumText}</dd>
                              <dt className="text-text-muted">Return</dt>
                              <dd className="flex justify-end">
                                <Sparkline
                                  data={s.analytics.sparkline_returns ?? []}
                                  color={sparklineColor(s.analytics.sparkline_returns ?? [])}
                                />
                              </dd>
                              <dt className="text-text-muted">Underwater</dt>
                              <dd className="flex justify-end">
                                <Sparkline
                                  data={s.analytics.sparkline_drawdown ?? []}
                                  color="var(--color-negative)"
                                  fill
                                />
                              </dd>
                            </dl>
                          </details>
                        </td>
                        <td className="px-4 py-3 text-right group-hover:bg-page/50 transition-colors">
                          <SimulateImpactButton
                            candidateStrategyId={s.id}
                            candidateName={s.name}
                            portfolioId={portfolioId}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {paged.length === 0 && (
                    <tr>
                      <td colSpan={emptyRowColSpan} className="px-4 py-8 text-center text-text-muted">
                        No strategies match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ResponsiveTable>

            {/* Visible scroll cue \u2014 a right-edge gradient fade + hint, shown ONLY
                when the table overflows its scroll container. aria-hidden: it
                pairs with (never replaces) the ResponsiveTable region aria-label,
                so SR users are not double-announced (STATE-03 / 50-UI-SPEC). */}
            {isOverflowing && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 flex items-end justify-end rounded-r-xl bg-gradient-to-l from-surface to-transparent pb-3 pr-3 pl-12"
              >
                <span className="text-caption text-text-muted">
                  Scroll for more columns &rarr;
                </span>
              </div>
            )}
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

      {/* Drawer is owned here so the page doesn't thread props through;
          only rendered when signed in. */}
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
