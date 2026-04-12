"use client";

import { useMemo, useState, useCallback } from "react";
import type { Layout, LayoutItem } from "react-grid-layout";
import type { Portfolio, PortfolioAnalytics, WeightSnapshot, PositionSnapshot } from "@/lib/types";
import type { TileConfig } from "./lib/types";
import { WIDGET_REGISTRY } from "./lib/widget-registry";
import { useDashboardConfig } from "./hooks/useDashboardConfig";
import { useTimeframe } from "./hooks/useTimeframe";
import {
  buildDateMapCache,
  computeScenario,
  type StrategyForBuilder,
  type DailyPoint,
  type ScenarioState,
} from "@/lib/scenario";
import { normalizeDailyReturns, displayName, getTimeframeStart } from "@/lib/allocation-helpers";
import { buildCompositeReturns } from "./widgets/lib/composite-returns";
import type { TimeframeKey } from "@/components/ui/TimeframeSelector";
import { TimeframeSelector } from "@/components/ui/TimeframeSelector";
import { formatCurrency } from "@/lib/utils";

import { KpiStrip } from "./components/KpiStrip";
import { DashboardGrid } from "./components/DashboardGrid";
import { AddWidgetModal } from "./components/AddWidgetModal";
import { UndoToast } from "./components/UndoToast";
import { WIDGET_COMPONENTS } from "./widgets";

// ---------------------------------------------------------------------------
// Types — matches MyAllocationClient props exactly
// ---------------------------------------------------------------------------

interface StrategyRow {
  strategy_id: string;
  current_weight: number | null;
  allocated_amount: number | null;
  alias: string | null;
  strategy: {
    id: string;
    name: string;
    codename: string | null;
    disclosure_tier: string;
    strategy_types: string[];
    markets: string[];
    start_date: string | null;
    strategy_analytics: {
      daily_returns:
        | Record<string, Record<string, number>>
        | DailyPoint[]
        | null;
      cagr: number | null;
      sharpe: number | null;
      volatility: number | null;
      max_drawdown: number | null;
    } | null;
  };
}

interface ApiKeyRow {
  id: string;
  exchange: string;
  label: string;
  is_active: boolean;
  sync_status: string | null;
  last_sync_at: string | null;
  account_balance_usdt: number | null;
  created_at: string;
}

interface AllocationDashboardProps {
  portfolio: Portfolio;
  analytics: PortfolioAnalytics | null;
  strategies: StrategyRow[];
  apiKeys: ApiKeyRow[];
  weightSnapshots?: WeightSnapshot[];
  positionSnapshots?: PositionSnapshot[];
}

// ---------------------------------------------------------------------------
// Toast state
// ---------------------------------------------------------------------------

interface ToastState {
  widgetName: string;
  tile: TileConfig;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AllocationDashboard({
  portfolio,
  analytics,
  strategies,
  apiKeys,
  weightSnapshots = [],
  positionSnapshots = [],
}: AllocationDashboardProps) {
  const { config, addTile, removeTile, updateLayout, restoreTile } =
    useDashboardConfig();
  const [timeframe, setTimeframe] = useTimeframe("YTD");

  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [recentlyClosed, setRecentlyClosed] = useState<string[]>([]);

  // ── Portfolio analytics via scenario math ─────────────────────────

  const strategiesForBuilder = useMemo<StrategyForBuilder[]>(
    () =>
      strategies
        .map((row) => {
          const dr = normalizeDailyReturns(
            row.strategy.strategy_analytics?.daily_returns,
          );
          return {
            id: row.strategy_id,
            name: displayName(row),
            codename: row.strategy.codename ?? null,
            disclosure_tier: row.strategy.disclosure_tier ?? "exploratory",
            strategy_types: row.strategy.strategy_types,
            markets: row.strategy.markets,
            start_date: row.strategy.start_date,
            daily_returns: dr,
            cagr: row.strategy.strategy_analytics?.cagr ?? null,
            sharpe: row.strategy.strategy_analytics?.sharpe ?? null,
            volatility: row.strategy.strategy_analytics?.volatility ?? null,
            max_drawdown: row.strategy.strategy_analytics?.max_drawdown ?? null,
          };
        })
        .filter((s) => s.daily_returns.length > 0),
    [strategies],
  );

  const dateMapCache = useMemo(
    () => buildDateMapCache(strategiesForBuilder),
    [strategiesForBuilder],
  );

  const lastDataDate = useMemo(() => {
    let latest: string | null = null;
    for (const s of strategiesForBuilder) {
      const tail = s.daily_returns[s.daily_returns.length - 1]?.date;
      if (tail && (!latest || tail > latest)) latest = tail;
    }
    return latest;
  }, [strategiesForBuilder]);

  const inceptionDate = portfolio.created_at?.slice(0, 10) ?? "2022-01-01";

  const timeframeStart = useMemo(
    () => getTimeframeStart(timeframe as TimeframeKey, lastDataDate, inceptionDate),
    [timeframe, lastDataDate, inceptionDate],
  );

  const scenarioState = useMemo<ScenarioState>(() => {
    const selected: Record<string, boolean> = {};
    const weights: Record<string, number> = {};
    const startDates: Record<string, string> = {};
    for (const row of strategies) {
      const ownStart = row.strategy.start_date ?? inceptionDate;
      const clampedStart = timeframeStart > ownStart ? timeframeStart : ownStart;
      selected[row.strategy_id] = true;
      weights[row.strategy_id] = row.current_weight ?? 0;
      startDates[row.strategy_id] = clampedStart;
    }
    return { selected, weights, startDates };
  }, [strategies, timeframeStart, inceptionDate]);

  const metrics = useMemo(
    () => computeScenario(strategiesForBuilder, scenarioState, dateMapCache),
    [strategiesForBuilder, scenarioState, dateMapCache],
  );

  // Pre-compute composite weighted daily returns once for all widgets
  const compositeReturns = useMemo(
    () => buildCompositeReturns(strategies),
    [strategies],
  );

  const totalAllocated = useMemo(
    () => strategies.reduce((sum, row) => sum + (row.allocated_amount ?? 0), 0),
    [strategies],
  );
  const aum = analytics?.total_aum ?? (totalAllocated > 0 ? totalAllocated : null);

  // ── Tile close / undo / add handlers ──────────────────────────────

  const handleClose = useCallback(
    (tileId: string) => {
      const removed = removeTile(tileId);
      if (removed) {
        const meta = WIDGET_REGISTRY[removed.widgetId];
        const name = meta?.name ?? removed.widgetId;
        setToast({ widgetName: name, tile: removed });
        setRecentlyClosed((prev) =>
          prev.includes(removed.widgetId) ? prev : [removed.widgetId, ...prev].slice(0, 5),
        );
      }
    },
    [removeTile],
  );

  const handleUndo = useCallback(() => {
    if (toast) {
      restoreTile(toast.tile);
      setRecentlyClosed((prev) => prev.filter((id) => id !== toast.tile.widgetId));
    }
    setToast(null);
  }, [toast, restoreTile]);

  const handleDismiss = useCallback(() => {
    setToast(null);
  }, []);

  const handleAdd = useCallback(
    (widgetId: string) => {
      addTile(widgetId);
      setRecentlyClosed((prev) => prev.filter((id) => id !== widgetId));
    },
    [addTile],
  );

  const handleLayoutChange = useCallback(
    (layout: Layout) => {
      // Layout is readonly LayoutItem[] in v2; map to mutable array for updateLayout
      updateLayout(
        layout.map((item: LayoutItem) => ({
          i: item.i,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        })),
      );
    },
    [updateLayout],
  );

  // ── Widget data payload (shared across all widgets) ──────────────
  // NOTE (I-F6): TradingActivityLog and TradeVolume both independently
  // fetch /api/activity/portfolio. Ideally, activity data (DailyPnlRow[])
  // would be fetched once in the server component and passed through
  // widgetData. Skipped for now: the server component doesn't have access
  // to portfolio_id at the point where it assembles props, and hoisting
  // the fetch would require restructuring the page-level data flow.
  // The duplicate fetch is ~1 extra API call per page load — acceptable
  // until the allocation page performance budget gets tighter.

  const widgetData = useMemo(
    () => ({
      portfolio,
      analytics,
      strategies: strategies.map((row) => ({
        strategy_id: row.strategy_id,
        weight: row.current_weight ?? 0,
        allocated_amount: row.allocated_amount,
        alias: row.alias,
        strategy: row.strategy,
      })),
      apiKeys,
      metrics,
      compositeReturns,
      weightSnapshots,
      positionSnapshots,
    }),
    [portfolio, analytics, strategies, apiKeys, metrics, compositeReturns, weightSnapshots, positionSnapshots],
  );

  // ── Widget renderer ─────────────────────────────────────────────

  const renderWidget = useCallback(
    (widgetId: string) => {
      const Widget = WIDGET_COMPONENTS[widgetId];
      if (!Widget) {
        return (
          <div
            className="flex h-full items-center justify-center text-sm"
            style={{ color: "#718096" }}
          >
            Widget not found: {widgetId}
          </div>
        );
      }
      return <Widget data={widgetData} timeframe={timeframe} width={0} height={0} />;
    },
    [widgetData, timeframe],
  );

  // Active widget IDs for the modal
  const activeWidgetIds = config.tiles.map((t) => t.widgetId);

  return (
    <main className="max-w-[1280px] mx-auto p-6 pb-20">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl md:text-4xl text-text-primary tracking-tight">
            My Allocation
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            <span>{portfolio.name}</span>
            <span className="mx-2 text-text-muted">&middot;</span>
            <span className="font-metric tabular-nums">{strategies.length}</span>
            <span className="text-text-muted">
              {" "}
              {strategies.length === 1 ? "investment" : "investments"}
            </span>
            {aum != null && (
              <>
                <span className="mx-2 text-text-muted">&middot;</span>
                <span className="font-metric tabular-nums">
                  {formatCurrency(aum)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="whitespace-nowrap rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[#F8F9FA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B6B5A]"
            style={{ color: "#1B6B5A" }}
          >
            + Add Widget
          </button>
          <TimeframeSelector
            value={timeframe as TimeframeKey}
            onChange={setTimeframe}
          />
        </div>
      </header>

      {/* KPI strip */}
      <KpiStrip
        analytics={analytics}
        metrics={metrics}
        timeframe={timeframe}
        aum={aum}
      />

      {/* Grid */}
      <DashboardGrid
        config={config}
        onLayoutChange={handleLayoutChange}
        onClose={handleClose}
        renderWidget={renderWidget}
      />

      {/* Add Widget Modal */}
      <AddWidgetModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onAdd={handleAdd}
        activeWidgetIds={activeWidgetIds}
        recentlyClosed={recentlyClosed}
      />

      {/* Undo Toast */}
      {toast && (
        <UndoToast
          widgetName={toast.widgetName}
          onUndo={handleUndo}
          onDismiss={handleDismiss}
        />
      )}
    </main>
  );
}
