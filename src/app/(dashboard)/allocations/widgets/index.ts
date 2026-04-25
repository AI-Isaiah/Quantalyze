import { lazy, type ComponentType } from "react";
import type { WidgetProps } from "../lib/types";

// ---------------------------------------------------------------------------
// Widget barrel — maps widgetId strings to lazy-loaded components.
// Every key must match a key in WIDGET_REGISTRY (lib/widget-registry.ts).
//
// Widgets with default exports use `lazy(() => import(...))` directly.
// Widgets with named exports use `.then(m => ({ default: m.Name }))`.
// ---------------------------------------------------------------------------

type LazyWidget = React.LazyExoticComponent<ComponentType<WidgetProps>>;

export const WIDGET_COMPONENTS: Record<string, LazyWidget> = {
  // ── Performance (11) ────────────────────────────────────────────────
  "equity-curve": lazy(() => import("./performance/EquityCurve")),
  // Phase 09.1 Plan 07 — V2 SVG equity chart with period toggle + crosshair
  // + holding overlays. Default-export is the WidgetProps adapter; the
  // named EquityChart export is consumed directly by tests.
  "equity-chart": lazy(() => import("./performance/EquityChart")),
  "drawdown-chart": lazy(() => import("./performance/DrawdownChart")),
  "monthly-returns": lazy(() => import("./performance/MonthlyReturns")),
  "annual-returns": lazy(() => import("./performance/AnnualReturns")),
  "cumulative-vs-benchmark": lazy(() => import("./performance/CumulativeVsBenchmark")),
  "rolling-sharpe": lazy(() => import("./performance/RollingSharpe")),
  "rolling-volatility": lazy(() => import("./performance/RollingVolatility")),
  "return-distribution": lazy(() => import("./performance/ReturnDistribution")),
  "best-worst-periods": lazy(() => import("./performance/BestWorstPeriods")),
  "win-rate-profit-factor": lazy(() => import("./performance/WinRateProfitFactor")),

  // ── Risk (6) ────────────────────────────────────────────────────────
  "correlation-matrix": lazy(() =>
    import("./risk/CorrelationMatrix").then((m) => ({ default: m.CorrelationMatrix })),
  ),
  "correlation-over-time": lazy(() =>
    import("./risk/CorrelationOverTime").then((m) => ({ default: m.CorrelationOverTime })),
  ),
  "var-expected-shortfall": lazy(() =>
    import("./risk/VarExpectedShortfall").then((m) => ({ default: m.VarExpectedShortfall })),
  ),
  "risk-decomposition": lazy(() =>
    import("./risk/RiskDecomposition").then((m) => ({ default: m.RiskDecomposition })),
  ),
  "tail-risk": lazy(() =>
    import("./risk/TailRisk").then((m) => ({ default: m.TailRisk })),
  ),
  "tracking-error": lazy(() =>
    import("./risk/TrackingError").then((m) => ({ default: m.TrackingError })),
  ),

  // ── Allocation (5) ─────────────────────────────────────────────────
  "allocation-donut": lazy(() => import("./allocation/AllocationDonut")),
  "allocation-over-time": lazy(() => import("./allocation/AllocationOverTime")),
  "weight-drift-monitor": lazy(() => import("./allocation/WeightDriftMonitor")),
  "rebalance-suggestions": lazy(() => import("./allocation/RebalanceSuggestions")),
  "strategy-comparison": lazy(() => import("./allocation/StrategyComparison")),

  // ── Attribution (3) ────────────────────────────────────────────────
  "attribution-waterfall": lazy(() => import("./attribution/AttributionWaterfall")),
  "performance-by-period": lazy(() => import("./attribution/PerformanceByPeriod")),
  "alpha-beta-decomposition": lazy(() => import("./attribution/AlphaBetaDecomposition")),

  // ── Positions (5) ──────────────────────────────────────────────────
  "positions-table": lazy(() => import("./positions/PositionsTable")),
  "trading-activity-log": lazy(() => import("./positions/TradingActivityLog")),
  "trade-volume": lazy(() => import("./positions/TradeVolume")),
  "exposure-by-asset": lazy(() => import("./positions/ExposureByAsset")),
  "net-exposure": lazy(() => import("./positions/NetExposure")),

  // ── Monitoring (4) ─────────────────────────────────────────────────
  "portfolio-alerts": lazy(() =>
    import("./monitoring/PortfolioAlerts").then((m) => ({ default: m.PortfolioAlerts })),
  ),
  "exchange-status": lazy(() =>
    import("./monitoring/ExchangeStatus").then((m) => ({ default: m.ExchangeStatus })),
  ),
  "strategy-health": lazy(() =>
    import("./monitoring/StrategyHealth").then((m) => ({ default: m.StrategyHealth })),
  ),
  "data-freshness": lazy(() =>
    import("./monitoring/DataFreshness").then((m) => ({ default: m.DataFreshness })),
  ),

  // ── Intelligence (3) ───────────────────────────────────────────────
  "morning-briefing": lazy(() =>
    import("./intelligence/MorningBriefing").then((m) => ({ default: m.MorningBriefing })),
  ),
  "regime-detector": lazy(() =>
    import("./intelligence/RegimeDetector").then((m) => ({ default: m.RegimeDetector })),
  ),
  "concentration-risk": lazy(() =>
    import("./intelligence/ConcentrationRisk").then((m) => ({ default: m.ConcentrationRisk })),
  ),

  // ── Meta (3) ───────────────────────────────────────────────────────
  "custom-kpi-strip": lazy(() =>
    import("./meta/CustomKpiStrip").then((m) => ({ default: m.CustomKpiStrip })),
  ),
  "notes-widget": lazy(() =>
    import("./meta/NotesWidget").then((m) => ({ default: m.NotesWidget })),
  ),
  "quick-actions": lazy(() =>
    import("./meta/QuickActions").then((m) => ({ default: m.QuickActions })),
  ),

  // ── Outcomes (1) ───────────────────────────────────────────────────
  "outcomes-timeline": lazy(() => import("./outcomes/OutcomesWidget")),

  // ── Bridge (1) — Phase 09.1 Plan 09 / D-14 + D-15 ──────────────────
  // Hero Bridge widget. The lazy chunk pulls in the BridgeWidget
  // component + the BridgeDrawer it composes. The default export is a
  // thin WidgetProps adapter that pulls flaggedHoldings + the match
  // decisions map out of the dashboard payload (data prop).
  "bridge-hero": lazy(() => import("./bridge/BridgeHeroWidget")),

  // ── Default-Overview placeholder aliases (v0.15.7.0 retire-V1 follow-up)
  // DESIGNER_KEY_TO_WIDGET_ID maps the designer short keys ("kpi",
  // "holdings") to canonical ids ("kpi-strip", "holdings-table") that
  // never got dedicated components. Until purpose-built widgets land,
  // alias them to the closest existing equivalents so the Overview tab
  // renders content instead of the "Unknown widget" debug fallback.
  "kpi-strip": lazy(() =>
    import("./meta/CustomKpiStrip").then((m) => ({ default: m.CustomKpiStrip })),
  ),
  "holdings-table": lazy(() => import("./positions/PositionsTable")),
};
