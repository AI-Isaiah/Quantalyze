"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import type { Layout, LayoutItem } from "react-grid-layout";
import {
  trackUsageEventClient,
  identifyUsageUser,
} from "@/lib/analytics/usage-events-client";
import type { Portfolio, PortfolioAnalytics, WeightSnapshot, PositionSnapshot } from "@/lib/types";
import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";
import type { OutcomeRow } from "@/lib/queries";
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
import { AlertBanner } from "./components/AlertBanner";
import { WIDGET_COMPONENTS } from "./widgets";
import { InsightStrip } from "@/components/portfolio/InsightStrip";
import { Card } from "@/components/ui/Card";
import { WarningBanner } from "@/components/ui/WarningBanner";
import { EmptyState } from "./EmptyState";

// ---------------------------------------------------------------------------
// Types — matches MyAllocationClient props exactly
// ---------------------------------------------------------------------------

interface StrategyRow {
  strategy_id: string;
  current_weight: number | null;
  allocated_amount: number | null;
  alias: string | null;
  /** true when eligible for outcome recording (D-03). */
  eligible_for_outcome: boolean;
  /** the existing bridge_outcomes row, if any. */
  existing_outcome: BridgeOutcome | null;
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

interface AlertCount {
  high: number;
  medium: number;
  low: number;
  total: number;
}

interface AllocationDashboardProps {
  // Phase 07 Plan 04 — portfolio may be null when the allocator has
  // connected an exchange but not yet been assigned a
  // portfolio_strategies row (zero-holdings warm-up / post-first-connect).
  // The legacy Phase 5/9 widgets render their own empty states when
  // portfolio is null.
  portfolio: Portfolio | null;
  analytics: PortfolioAnalytics | null;
  strategies: StrategyRow[];
  apiKeys: ApiKeyRow[];
  alertCount?: AlertCount;
  weightSnapshots?: WeightSnapshot[];
  positionSnapshots?: PositionSnapshot[];
  /** Phase 5 — bridge outcomes for the OutcomesWidget. */
  outcomes?: OutcomeRow[];
  // ─────────────────────────────────────────────────────────────────────
  // Phase 07 / 07-04 extensions (VOICES-ACCEPTED f2 + f7 + f9)
  // Props forwarded from AllocationsTabs → here → KpiStrip / EquityCurve
  // / DrawdownChart. Declared optional so existing call sites (e.g. the
  // regression test at AllocationDashboard.regression-001.test.tsx)
  // remain source-compatible. Task 3 wires the real usage.
  // ─────────────────────────────────────────────────────────────────────
  equitySnapshots?: Array<{
    asof: string;
    value_usd: number;
    breakdown: Record<string, number> | null;
    source: "exchange_primary" | "coingecko_fallback" | "mixed";
    history_depth_months: number | null;
  }>;
  holdingsSummary?: Array<{
    symbol: string;
    quantity: number;
    mark_price_usd: number | null;
    value_usd: number;
    venue: string;
    holding_type: "spot" | "derivative";
    // Phase 08 Plan 02 — optional because existing call sites
    // (widget-gating test, regression-001 test) predate the projection
    // change; runtime queries always include it per queries.ts.
    api_key_id?: string;
  }>;
  snapshotCount?: number;
  allKeysStale?: boolean;
  lastSyncAt?: string | null;
  hasSyncing?: boolean;
  /** Per VOICES-ACCEPTED f7 — forwarded to EquityCurve + DrawdownChart. */
  equityDailyPoints?: DailyPoint[];
  /** Per VOICES-ACCEPTED f9 — forwarded to KpiStrip for venue-specific warm-up. */
  minHistoryDepthMonths?: number | null;
  /** Per VOICES-ACCEPTED f9 — forwarded to KpiStrip. */
  activeVenues?: string[];
}

// ---------------------------------------------------------------------------
// Widget gating — per VOICES-ACCEPTED f2
// ---------------------------------------------------------------------------
//
// The 18 widgets below render from the per-strategy composite return path
// (buildCompositeReturns / computeScenario, which read
// strategies[].strategy_analytics.daily_returns). When an allocator has
// zero strategies (`strategies.length === 0` — zero-holdings + post-first-
// connect state in Phase 07), these widgets render stale data or crash.
// HIDE them entirely instead.
//
// KpiStrip + EquityCurve + DrawdownChart + InsightStrip always render;
// they consume equity-snapshot-derived inputs via the f7 parallel-prop
// path and work fine with zero strategies.
//
// Authoritative widget name list (also referenced by the
// AllocationDashboard.widget-gating.test.tsx spec for grep verification):
//   RollingSharpe, RollingVolatility, CumulativeVsBenchmark, TailRisk,
//   RiskDecomposition, CorrelationMatrix, CorrelationOverTime,
//   AlphaBetaDecomposition, TrackingError, RegimeDetector,
//   StrategyComparison, MonthlyReturns, AnnualReturns, ReturnDistribution,
//   WinRateProfitFactor, BestWorstPeriods, PerformanceByPeriod,
//   VarExpectedShortfall.
//
// The runtime Set uses the kebab-case `widgetId` values (matches the keys
// in WIDGET_REGISTRY + WIDGET_COMPONENTS).

const STRATEGY_COMPOSITE_WIDGETS = new Set<string>([
  "rolling-sharpe",           // RollingSharpe
  "rolling-volatility",       // RollingVolatility
  "cumulative-vs-benchmark",  // CumulativeVsBenchmark
  "tail-risk",                // TailRisk
  "risk-decomposition",       // RiskDecomposition
  "correlation-matrix",       // CorrelationMatrix
  "correlation-over-time",    // CorrelationOverTime
  "alpha-beta-decomposition", // AlphaBetaDecomposition
  "tracking-error",           // TrackingError
  "regime-detector",          // RegimeDetector
  "strategy-comparison",      // StrategyComparison
  "monthly-returns",          // MonthlyReturns
  "annual-returns",           // AnnualReturns
  "return-distribution",      // ReturnDistribution
  "win-rate-profit-factor",   // WinRateProfitFactor
  "best-worst-periods",       // BestWorstPeriods
  "performance-by-period",    // PerformanceByPeriod
  "var-expected-shortfall",   // VarExpectedShortfall
]);

// ---------------------------------------------------------------------------
// Toast state
// ---------------------------------------------------------------------------

interface ToastState {
  widgetName: string;
  tile: TileConfig;
}

// ---------------------------------------------------------------------------
// Phase 07 / 07-05 helpers — stale-data copy arithmetic.
// ---------------------------------------------------------------------------
//
// Local in-browser approximation of "how long ago did we last sync?". The
// copy is best-effort and does not need server-side time skew correction.
// Clamped at 0 so clock-skew futures render as "0h" rather than a negative.
function formatHoursAgo(iso: string): number {
  const diffMs = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AllocationDashboard({
  portfolio,
  analytics,
  strategies,
  apiKeys,
  alertCount,
  weightSnapshots = [],
  positionSnapshots = [],
  outcomes = [],
  // Phase 07 / 07-04 (VOICES-ACCEPTED f2 + f7 + f9) — forwarded to
  // KpiStrip (warm-up context) and EquityCurve + DrawdownChart
  // (parallel-prop path). All optional with sensible defaults so Phase 5/9
  // call sites and the existing regression test stay source-compatible.
  snapshotCount = 30,
  allKeysStale = false,
  minHistoryDepthMonths = null,
  activeVenues = [],
  equityDailyPoints,
  // Phase 07 / 07-05 (PURGE-04 / D-07 / D-08 / D-09 / D-10) — zero /
  // syncing / stale branch inputs. Defaults keep Phase 5/9 + regression
  // test call sites source-compatible (empty holdings => zero rendering
  // would never have landed pre-Phase-07, so default-empty is the right
  // Phase 5/9 signal for "do not trigger EmptyState").
  holdingsSummary = [],
  hasSyncing = false,
  lastSyncAt = null,
}: AllocationDashboardProps) {
  // Phase 07 / VOICES-ACCEPTED f2 — one gate for every strategy-composite
  // widget decision below. A Bridge allocator (post-Phase-09) has
  // `strategies.length > 0` and sees the full widget grid; a zero-
  // holdings allocator sees only the always-render core (KPI + Equity +
  // Drawdown + Insight).
  const hasStrategies = strategies.length > 0;
  const { config, addTile, removeTile, updateLayout, restoreTile } =
    useDashboardConfig();
  const [timeframe, setTimeframe] = useTimeframe("YTD");

  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [recentlyClosed, setRecentlyClosed] = useState<string[]>([]);

  // ── Usage analytics: session_start + widget_viewed ──
  //
  // session_start: fire-and-forget POST on mount. The route owns the
  // 30-min server-side debounce against `user_metadata` so two-tabs /
  // refresh churn is collapsed at the API layer, not here.
  //
  // identifyUsageUser: stitches the client posthog distinct_id to the
  // auth user so client-only events (widget_viewed, bridge_click) join
  // the same person record as the server events.
  // Phase 07 Plan 04 — portfolio may be null for zero-holdings allocators
  // post-first-connect; skip usage identify when we don't yet have the
  // owner id.
  const portfolioOwnerId = portfolio?.user_id ?? null;
  useEffect(() => {
    if (portfolioOwnerId) {
      identifyUsageUser(portfolioOwnerId);
    }
    void fetch("/api/usage/session-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {
      // Fire-and-forget: any error is non-fatal. The route's failure
      // modes (CSRF, debounced, transient) all leave the page usable.
    });
    // Empty deps: fire once per mount. Re-firing on user change would
    // be wrong — the page only ever renders for the current user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // widget_viewed: dedupe per session via a Set on a ref. Each widget
  // tile gets a single `widget_viewed` the first time >= 50% of it
  // crosses the viewport.
  const widgetViewsFiredRef = useRef<Set<string>>(new Set());
  const dashboardContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const root = dashboardContainerRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target as HTMLElement;
          const widgetId = target.dataset.widgetId;
          if (!widgetId) continue;
          if (widgetViewsFiredRef.current.has(widgetId)) continue;
          widgetViewsFiredRef.current.add(widgetId);
          trackUsageEventClient("widget_viewed", { widget_id: widgetId });
          observer.unobserve(target);
        }
      },
      { threshold: 0.5 },
    );

    // Observe each tile via its `[data-widget-id]` marker. The marker
    // is added below in the renderWidget wrapper so it tracks tiles
    // even after add/remove/resize re-renders.
    const tiles = root.querySelectorAll<HTMLElement>("[data-widget-id]");
    tiles.forEach((t) => observer.observe(t));

    // A MutationObserver picks up tiles added later (Add Widget modal).
    const mutation = new MutationObserver(() => {
      const next = root.querySelectorAll<HTMLElement>("[data-widget-id]");
      next.forEach((t) => {
        const id = t.dataset.widgetId;
        if (id && !widgetViewsFiredRef.current.has(id)) observer.observe(t);
      });
    });
    mutation.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, []);

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

  const inceptionDate = portfolio?.created_at?.slice(0, 10) ?? "2022-01-01";

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

  // ── Rebalance drift inputs for InsightStrip ──────────────────────
  // Target weight comes from the most-recent weight_snapshots row per
  // strategy (null when user hasn't set targets — migration 050 seeds
  // NULL on portfolio create). Actual weight is the live portfolio_strategies
  // current_weight; when null we pass null through so the insight's
  // null-target guard can skip the strategy cleanly.
  const latestTargetByStrategy = useMemo(() => {
    const map = new Map<string, { target: number | null; date: string }>();
    for (const ws of weightSnapshots) {
      const existing = map.get(ws.strategy_id);
      if (!existing || ws.snapshot_date > existing.date) {
        map.set(ws.strategy_id, {
          target: ws.target_weight,
          date: ws.snapshot_date,
        });
      }
    }
    return map;
  }, [weightSnapshots]);

  const rebalanceDriftInputs = useMemo(
    () =>
      strategies.map((row) => ({
        strategy_id: row.strategy_id,
        strategy_name: displayName(row),
        actual_weight: row.current_weight,
        target_weight: latestTargetByStrategy.get(row.strategy_id)?.target ?? null,
      })),
    [strategies, latestTargetByStrategy],
  );

  // `Date.now()` is impure — capture it once per mount so React's purity
  // rules accept the derived age in `useMemo`. Age updates on re-mount
  // (navigation, refresh), which is the right cadence for a honeymoon
  // guard anyway.
  const [nowMs] = useState(() => Date.now());
  const portfolioAgeDays = useMemo(() => {
    if (!portfolio?.created_at) return 0;
    const created = new Date(portfolio.created_at).getTime();
    return Math.floor((nowMs - created) / (1000 * 60 * 60 * 24));
  }, [portfolio?.created_at, nowMs]);

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
        // thread eligibility + existing outcome into widget data
        // so PositionsTable can render BridgeOutcomeBanner beneath eligible rows.
        eligible_for_outcome: row.eligible_for_outcome,
        existing_outcome: row.existing_outcome,
        strategy: row.strategy,
      })),
      apiKeys,
      alertCount,
      metrics,
      compositeReturns,
      weightSnapshots,
      positionSnapshots,
      outcomes,
    }),
    [portfolio, analytics, strategies, apiKeys, alertCount, metrics, compositeReturns, weightSnapshots, positionSnapshots, outcomes],
  );

  // ── Widget renderer ─────────────────────────────────────────────

  const renderWidget = useCallback(
    (widgetId: string) => {
      const Widget = WIDGET_COMPONENTS[widgetId];
      if (!Widget) {
        return (
          <div
            className="flex h-full items-center justify-center text-sm"
            data-widget-id={widgetId}
            style={{ color: "#718096" }}
          >
            Widget not found: {widgetId}
          </div>
        );
      }
      // Per VOICES-ACCEPTED f7 — only EquityCurve + DrawdownChart
      // receive `equityDailyPoints` as a direct prop (those are the two
      // widgets with the parallel-prop branch landed in 07-03 Task 4).
      // Every other widget is source-compatible with the base WidgetProps
      // shape and ignores extra props, but passing the prop
      // unconditionally keeps the generic `<Widget ... />` call simple
      // and JSX-typed (WidgetProps allows unknown extras via the `data`
      // pass-through; the compiler doesn't warn).
      const forwardEquityPoints =
        widgetId === "equity-curve" || widgetId === "drawdown-chart";
      // Phase 07 / 07-05 / D-10: when ALL active keys are stale, the
      // equity + drawdown chart wrappers get a 40% page-color overlay
      // with a "Data may be stale" label. Protective posture — the
      // numeric KPI cells already render `—` (via 07-03 warm-up path
      // when allKeysStale=true); this overlay is the visual half of the
      // same gate. Non-chart widgets are untouched.
      const showStaleOverlay = allKeysStale && forwardEquityPoints;
      // The data-widget-id marker is what the IntersectionObserver in
      // the usage-analytics effect above watches for. Wrapping in a
      // div instead of mutating the widget keeps the marker stable
      // across the React subtree's renders.
      return (
        <div data-widget-id={widgetId} className="relative h-full w-full">
          <Widget
            data={widgetData}
            timeframe={timeframe}
            width={0}
            height={0}
            {...(forwardEquityPoints
              ? { equityDailyPoints }
              : {})}
          />
          {showStaleOverlay && (
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-page/40 flex items-center justify-center pointer-events-none"
            >
              {/* Pill the text on a solid background so WCAG AA 4.5:1
                  contrast holds even on busy chart regions where the
                  40% page tint doesn't fully obscure chart lines. */}
              <span className="rounded-md bg-surface px-3 py-1 text-sm font-medium text-text-secondary shadow-sm">
                Data may be stale
              </span>
            </div>
          )}
        </div>
      );
    },
    [widgetData, timeframe, equityDailyPoints, allKeysStale],
  );

  // Per VOICES-ACCEPTED f2 — filter out strategy-composite widgets when
  // `strategies.length === 0`. Bridge allocators (D-05) keep the full
  // grid unchanged; zero-holdings allocators see only the always-render
  // core (equity-curve + drawdown-chart + anything not in the gate list).
  const visibleConfig = useMemo(
    () =>
      hasStrategies
        ? config
        : {
            ...config,
            tiles: config.tiles.filter(
              (t) => !STRATEGY_COMPOSITE_WIDGETS.has(t.widgetId),
            ),
          },
    [config, hasStrategies],
  );

  // Active widget IDs for the modal
  const activeWidgetIds = config.tiles.map((t) => t.widgetId);

  // Phase 07 / 07-05 / D-08 — zero-holdings triggers.
  //
  // Render-matrix summary (see 07-05-PLAN.md §interfaces):
  //   holdingsEmpty && !hasSyncing → full EmptyState replacement +
  //                                  D-09 Notices card (this branch).
  //   holdingsEmpty &&  hasSyncing → InfoBanner at TOP + D-09 Notices card,
  //                                  fall through normal render with
  //                                  07-04 widget-gating filtering the
  //                                  18 strategy-composite widgets.
  //   holdings && allKeysStale     → WarningBanner above KPI strip +
  //                                  chart stale overlay (in renderWidget) +
  //                                  KpiStrip `—` (from 07-03).
  //   holdings && fresh            → normal render (07-04 gating applies
  //                                  when strategies.length === 0).
  const holdingsEmpty = holdingsSummary.length === 0;

  // D-09 — "What we noticed" prompt card for zero-holdings allocators.
  // Rendered inside the full-replacement early-return below AND at the
  // top of the normal render when `holdingsEmpty && hasSyncing`. Copy
  // verbatim from 07-UI-SPEC.md §Copywriting.
  const zeroHoldingsNoticesCard = (
    <section className="mt-6">
      <Card>
        <h3 className="text-base font-semibold text-text-primary mb-2">
          What we noticed
        </h3>
        <p className="text-sm text-text-secondary">
          Connect an exchange to surface insights about your positions.
        </p>
        <Link
          href="/profile?tab=exchanges"
          className="mt-3 inline-block text-sm text-accent underline-offset-4 hover:underline"
        >
          Connect Exchange →
        </Link>
      </Card>
    </section>
  );

  // D-08: zero holdings + no syncing key → full EmptyState replaces the
  // KPI strip + charts + holdings table + all widgets. D-09 Notices card
  // stays visible with the prompt copy below. Short-circuits before the
  // normal render so the 07-04 widget-gating + renderWidget paths are
  // skipped entirely — the allocator sees one headline, one sub-line,
  // one CTA, and one Notices card.
  if (holdingsEmpty && !hasSyncing) {
    // page.tsx already wraps this subtree in <main>; use <section> here to
    // avoid two <main> landmarks per document (HTML5 + WCAG landmark nav).
    return (
      <section className="max-w-[1280px] mx-auto p-6 pb-20">
        <EmptyState hasSyncing={false} />
        {zeroHoldingsNoticesCard}
      </section>
    );
  }

  return (
    <>
      {/* Alert banner renders above the padded main content column intentionally —
          it is full-width and not a dashboard widget, so it sits outside the
          IntersectionObserver root (dashboardContainerRef). When portfolio is
          null (Phase 07 zero-holdings allocator), the banner has nothing to
          fetch alerts for — skip it. */}
      {portfolio && <AlertBanner portfolioId={portfolio.id} />}
      {/* page.tsx already wraps this subtree in <main>; <section> here avoids
          two <main> landmarks per document. */}
      <section
        ref={dashboardContainerRef}
        className="max-w-[1280px] mx-auto p-6 pb-20"
      >
      {/* Header — page.tsx owns the <h1>My Allocation</h1> via PageHeader;
          we render only the metadata sub-line here to avoid duplicate H1s
          (WCAG single-h1 convention, screen-reader heading nav). */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-text-secondary">
          <span>{portfolio?.name ?? "My Allocation"}</span>
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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="whitespace-nowrap rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-page focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            + Add Widget
          </button>
          <TimeframeSelector
            value={timeframe as TimeframeKey}
            onChange={setTimeframe}
          />
        </div>
      </header>

      {/* Phase 07 / 07-05 / D-08 — zero holdings + syncing key:
          InfoBanner at the top of the Performance body, then fall through
          to the normal render. The 07-04 widget-gating filters out the 18
          strategy-composite widgets because `strategies.length === 0` in
          this path; KPI/EquityCurve/DrawdownChart/InsightStrip render
          `—` naturally via the 07-03 warm-up path (snapshotCount is
          typically 0–few at this point). */}
      {holdingsEmpty && hasSyncing && (
        <div className="mb-6">
          <EmptyState hasSyncing={true} />
        </div>
      )}

      {/* Phase 07 / 07-05 / D-10 + D-11 — stale-data WarningBanner.
          Renders above the KPI strip when ALL active keys are >24h old.
          The KpiStrip itself already renders `—` numerics when
          allKeysStale=true (via 07-03 warm-up path) and the chart
          widgets get a 40% page-color overlay (via renderWidget). This
          banner is the third leg of the protective triple — if any one
          of the three fails, the other two still communicate staleness
          (threat T-07-30). */}
      {allKeysStale && lastSyncAt && (
        <div className="mb-6">
          <WarningBanner>
            Data may be stale — last synced {formatHoursAgo(lastSyncAt)}h ago.{" "}
            <Link
              href="/profile?tab=exchanges"
              className="text-accent underline-offset-4 hover:underline"
            >
              Sync your keys to refresh →
            </Link>
          </WarningBanner>
        </div>
      )}

      {/* KPI strip — Phase 07 / 07-04 forwards snapshotCount + allKeysStale
          + minHistoryDepthMonths + activeVenues so the 07-03 warm-up + stale
          rendering kicks in correctly for zero-holdings allocators. */}
      <KpiStrip
        analytics={analytics}
        metrics={metrics}
        timeframe={timeframe}
        aum={aum}
        snapshotCount={snapshotCount}
        allKeysStale={allKeysStale}
        minHistoryDepthMonths={minHistoryDepthMonths}
        activeVenues={activeVenues}
      />

      {/* Insight strip — fixed above the widget grid */}
      <div className="mb-6 rounded-lg border border-[#E2E8F0] bg-white px-5 py-4">
        <InsightStrip
          analytics={analytics}
          portfolioId={portfolio?.id ?? null}
          max={3}
          portfolioStrategies={rebalanceDriftInputs}
          portfolioAgeDays={portfolioAgeDays}
        />
      </div>

      {/* Grid — Phase 07 / 07-04 / f2: `visibleConfig` filters out the 18
          strategy-composite widgets when `strategies.length === 0`, so
          zero-holdings allocators never see stale or crashing widgets
          reading empty daily_returns. Bridge allocators (D-05) see the
          full grid unchanged. */}
      <DashboardGrid
        config={visibleConfig}
        onLayoutChange={handleLayoutChange}
        onClose={handleClose}
        renderWidget={renderWidget}
      />

      {/* Phase 07 / 07-05 / D-09 — zero-holdings Notices card in the
          syncing branch. The full-replacement branch (`holdingsEmpty &&
          !hasSyncing`) has already returned above; we only reach here
          when holdings are empty AND a key is currently syncing, in
          which case we still want the "What we noticed" prompt card
          under the KPI + charts to tell the allocator why the dashboard
          looks sparse. */}
      {holdingsEmpty && hasSyncing && zeroHoldingsNoticesCard}

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
    </section>
    </>
  );
}
