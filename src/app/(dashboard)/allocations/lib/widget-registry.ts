import type { WidgetMeta } from "./types";

// ---------------------------------------------------------------------------
// Widget Registry — all 39 widgets for the My Allocation dashboard
// ---------------------------------------------------------------------------
//
// Phase 09.1 Plan 05 / D-08 — picker no longer surfaces "soon" badges for
// correlation / funding / flows. The designer prototype carried "soon"
// badges for these three concepts; in the live registry:
//   - correlation-matrix → status: "ready" (registered below; widgets/risk/
//     CorrelationMatrix). No demotion needed; the "soon" treatment in the
//     designer was a placeholder while the real widget existed.
//   - funding-rates      → not registered (no widget exists yet — picker
//     simply doesn't list it; nothing to demote).
//   - flows-ledger       → not registered (no widget exists yet — picker
//     simply doesn't list it; nothing to demote).
// All entries below currently carry status: "ready". The D-08 stance is
// the registry's source of truth: NO entry should carry status: "todo"
// (or any future "coming-soon" marker) without a real registered widget
// behind it. The Plan 05 WidgetPicker filters by status === "ready" so
// any future "todo" entry would silently disappear from the picker —
// which is preferred over a misleading badge.

export const WIDGET_REGISTRY: Record<string, WidgetMeta> = {
  // ── Performance (10) ────────────────────────────────────────────────
  "equity-curve": {
    id: "equity-curve",
    name: "Equity Curve",
    category: "performance",
    icon: "▲",
    defaultW: 12,
    defaultH: 4,
    description: "Cumulative portfolio growth over time with composite + per-strategy lines.",
    status: "ready",
  },
  // Phase 09.1 Plan 07 / D-10 — V2 SVG equity chart with period toggle
  // (1M/3M/6M/YTD/1Y/ALL/CUSTOM, default 6M), crosshair hover, and
  // holding overlays. Replaces the Recharts-based equity-curve for
  // V2 Overview tiles (DESIGNER_KEY_TO_WIDGET_ID["equity"] points here
  // post-Plan 07). The legacy "equity-curve" entry stays so persisted
  // user layouts pre-Plan-07 continue to render.
  "equity-chart": {
    id: "equity-chart",
    name: "Equity Chart",
    category: "performance",
    icon: "▲",
    defaultW: 4,
    defaultH: 4,
    description: "SVG equity chart with period toggle, crosshair, and holding overlays.",
    status: "ready",
  },
  "drawdown-chart": {
    id: "drawdown-chart",
    name: "Drawdown Chart",
    category: "performance",
    icon: "▲",
    defaultW: 12,
    defaultH: 4,
    description: "Underwater chart showing peak-to-trough drawdowns over time.",
    status: "ready",
  },
  "monthly-returns": {
    id: "monthly-returns",
    name: "Monthly Returns",
    category: "performance",
    icon: "▲",
    defaultW: 4,
    defaultH: 3,
    description: "Calendar heatmap of monthly returns with color-coded cells.",
    status: "ready",
  },
  "annual-returns": {
    id: "annual-returns",
    name: "Annual Returns",
    category: "performance",
    icon: "▲",
    defaultW: 4,
    defaultH: 3,
    description: "Bar chart of annual returns by year.",
    status: "ready",
  },
  "cumulative-vs-benchmark": {
    id: "cumulative-vs-benchmark",
    name: "Cumulative vs Benchmark",
    category: "performance",
    icon: "▲",
    defaultW: 6,
    defaultH: 4,
    description: "Portfolio cumulative return overlaid with benchmark (BTC, ETH, S&P).",
    status: "ready",
  },
  "rolling-sharpe": {
    id: "rolling-sharpe",
    name: "Rolling Sharpe",
    category: "performance",
    icon: "▲",
    defaultW: 6,
    defaultH: 3,
    description: "Rolling 30/60/90-day Sharpe ratio over time.",
    status: "ready",
  },
  "rolling-volatility": {
    id: "rolling-volatility",
    name: "Rolling Volatility",
    category: "performance",
    icon: "▲",
    defaultW: 6,
    defaultH: 3,
    description: "Rolling annualized volatility window chart.",
    status: "ready",
  },
  "return-distribution": {
    id: "return-distribution",
    name: "Return Distribution",
    category: "performance",
    icon: "▲",
    defaultW: 4,
    defaultH: 3,
    description: "Histogram of daily returns with normal distribution overlay.",
    status: "ready",
  },
  "best-worst-periods": {
    id: "best-worst-periods",
    name: "Best / Worst Periods",
    category: "performance",
    icon: "▲",
    defaultW: 4,
    defaultH: 3,
    description: "Top 5 best and worst daily/weekly/monthly returns.",
    status: "ready",
  },
  "win-rate-profit-factor": {
    id: "win-rate-profit-factor",
    name: "Win Rate & Profit Factor",
    category: "performance",
    icon: "▲",
    defaultW: 4,
    defaultH: 3,
    description: "Win/loss ratio and profit factor per strategy.",
    status: "ready",
  },

  // ── Risk (6) ────────────────────────────────────────────────────────
  "correlation-matrix": {
    id: "correlation-matrix",
    name: "Correlation Matrix",
    category: "risk",
    icon: "◆",
    defaultW: 4,
    defaultH: 3,
    description: "Pairwise correlation heatmap between strategies.",
    status: "ready",
  },
  "correlation-over-time": {
    id: "correlation-over-time",
    name: "Correlation Over Time",
    category: "risk",
    icon: "◆",
    defaultW: 6,
    defaultH: 3,
    description: "Rolling pairwise correlation trends to spot regime changes.",
    status: "ready",
  },
  "var-expected-shortfall": {
    id: "var-expected-shortfall",
    name: "VaR & Expected Shortfall",
    category: "risk",
    icon: "◆",
    defaultW: 4,
    defaultH: 3,
    description: "Value at Risk (95%/99%) and Conditional VaR (Expected Shortfall).",
    status: "ready",
  },
  "risk-decomposition": {
    id: "risk-decomposition",
    name: "Risk Decomposition",
    category: "risk",
    icon: "◆",
    defaultW: 6,
    defaultH: 3,
    description: "Contribution of each strategy to total portfolio risk.",
    status: "ready",
  },
  "tail-risk": {
    id: "tail-risk",
    name: "Tail Risk",
    category: "risk",
    icon: "◆",
    defaultW: 4,
    defaultH: 3,
    description: "Skewness, kurtosis, and tail ratio metrics.",
    status: "ready",
  },
  "tracking-error": {
    id: "tracking-error",
    name: "Tracking Error",
    category: "risk",
    icon: "◆",
    defaultW: 4,
    defaultH: 3,
    description: "Standard deviation of active returns vs benchmark.",
    status: "ready",
  },
  // Phase 09.1 PR1 (dashboard parity) — V2 Overview MandateSnapshot tile.
  // Renders the prototype's 5-row pass/fail mandate panel against live
  // allocator_preferences + portfolio analytics via lib/mandate-gates.ts.
  // DESIGNER_KEY_TO_WIDGET_ID["mandate"] points here (was "mandate-compliance"
  // pre-PR1, which had no registered widget and rendered the "Unknown widget"
  // fallback for the seven-tile default Overview).
  "mandate-snapshot": {
    id: "mandate-snapshot",
    name: "Mandate Snapshot",
    category: "risk",
    icon: "◆",
    defaultW: 2,
    defaultH: 3,
    description: "Live pass/fail of mandate gates against current portfolio.",
    status: "ready",
  },

  // ── Allocation (5) ─────────────────────────────────────────────────
  "allocation-donut": {
    id: "allocation-donut",
    name: "Allocation Donut",
    category: "allocation",
    icon: "◉",
    defaultW: 4,
    defaultH: 3,
    description: "AUM split across strategies as a donut chart.",
    status: "ready",
  },
  "allocation-over-time": {
    id: "allocation-over-time",
    name: "Allocation Over Time",
    category: "allocation",
    icon: "◉",
    defaultW: 6,
    defaultH: 3,
    description: "Stacked area chart showing how weights evolved over time.",
    status: "ready",
  },
  "weight-drift-monitor": {
    id: "weight-drift-monitor",
    name: "Weight Drift Monitor",
    category: "allocation",
    icon: "◉",
    defaultW: 6,
    defaultH: 3,
    description: "Shows how actual weights have drifted from target allocations.",
    status: "ready",
  },
  "rebalance-suggestions": {
    id: "rebalance-suggestions",
    name: "Rebalance Suggestions",
    category: "allocation",
    icon: "◉",
    defaultW: 6,
    defaultH: 3,
    description: "Actionable rebalancing trades to return to target weights.",
    status: "ready",
  },
  "strategy-comparison": {
    id: "strategy-comparison",
    name: "Strategy Comparison",
    category: "allocation",
    icon: "◉",
    defaultW: 6,
    defaultH: 3,
    description: "Side-by-side metrics table for all strategies.",
    status: "ready",
  },

  // ── Attribution (3) ────────────────────────────────────────────────
  "attribution-waterfall": {
    id: "attribution-waterfall",
    name: "Attribution Waterfall",
    category: "attribution",
    icon: "▸",
    defaultW: 6,
    defaultH: 4,
    description: "Waterfall chart breaking total return into per-strategy contributions.",
    status: "ready",
  },
  "performance-by-period": {
    id: "performance-by-period",
    name: "Performance by Period",
    category: "attribution",
    icon: "▸",
    defaultW: 6,
    defaultH: 3,
    description: "Returns bucketed by day-of-week, month, or custom period.",
    status: "ready",
  },
  "alpha-beta-decomposition": {
    id: "alpha-beta-decomposition",
    name: "Alpha/Beta Decomposition",
    category: "attribution",
    icon: "▸",
    defaultW: 6,
    defaultH: 3,
    description: "Decompose returns into alpha (skill) and beta (market) components.",
    status: "ready",
  },

  // ── Positions (5) ──────────────────────────────────────────────────
  "positions-table": {
    id: "positions-table",
    name: "Positions Table",
    category: "positions",
    icon: "▦",
    // Full-width default: the Positions Table is a wide data table and
    // looks broken when it sits alone in a half-width row with empty
    // whitespace to its right. Design review FINDING-009.
    defaultW: 12,
    defaultH: 4,
    description: "Live positions with entry price, PnL, and weight.",
    status: "ready",
  },
  "trading-activity-log": {
    id: "trading-activity-log",
    name: "Trading Activity Log",
    category: "positions",
    icon: "▦",
    defaultW: 6,
    defaultH: 4,
    description: "Chronological trade log with filters.",
    status: "ready",
  },
  "trade-volume": {
    id: "trade-volume",
    name: "Trade Volume",
    category: "positions",
    icon: "▦",
    defaultW: 4,
    defaultH: 3,
    description: "Daily/weekly trade volume bars.",
    status: "ready",
  },
  "exposure-by-asset": {
    id: "exposure-by-asset",
    name: "Exposure by Asset",
    category: "positions",
    icon: "▦",
    defaultW: 4,
    defaultH: 3,
    description: "Net exposure breakdown by underlying asset.",
    status: "ready",
  },
  "net-exposure": {
    id: "net-exposure",
    name: "Net Exposure",
    category: "positions",
    icon: "▦",
    defaultW: 4,
    defaultH: 3,
    description: "Long vs short exposure over time.",
    status: "ready",
  },

  // ── Monitoring (4) ─────────────────────────────────────────────────
  "portfolio-alerts": {
    id: "portfolio-alerts",
    name: "Portfolio Alerts",
    category: "monitoring",
    icon: "●",
    defaultW: 6,
    defaultH: 3,
    description: "Active alerts for drawdown, volatility, or weight drift thresholds.",
    status: "ready",
  },
  "exchange-status": {
    id: "exchange-status",
    name: "Exchange Status",
    category: "monitoring",
    icon: "●",
    defaultW: 4,
    defaultH: 3,
    description: "Connection health for each linked exchange API key.",
    status: "ready",
  },
  "strategy-health": {
    id: "strategy-health",
    name: "Strategy Health",
    category: "monitoring",
    icon: "●",
    defaultW: 6,
    defaultH: 3,
    description: "Per-strategy uptime, data freshness, and anomaly flags.",
    status: "ready",
  },
  "data-freshness": {
    id: "data-freshness",
    name: "Data Freshness",
    category: "monitoring",
    icon: "●",
    defaultW: 4,
    defaultH: 3,
    description: "Last sync time per data source with staleness warnings.",
    status: "ready",
  },

  // ── Intelligence (3) ───────────────────────────────────────────────
  "morning-briefing": {
    id: "morning-briefing",
    name: "Morning Briefing",
    category: "intelligence",
    icon: "◈",
    defaultW: 6,
    defaultH: 4,
    description: "AI-generated daily summary of portfolio activity and market context.",
    status: "ready",
  },
  "regime-detector": {
    id: "regime-detector",
    name: "Regime Detector",
    category: "intelligence",
    icon: "◈",
    defaultW: 6,
    defaultH: 3,
    description: "Hidden Markov Model regime classification (risk-on/off/neutral).",
    status: "ready",
  },
  "concentration-risk": {
    id: "concentration-risk",
    name: "Concentration Risk",
    category: "intelligence",
    icon: "◈",
    defaultW: 4,
    defaultH: 3,
    description: "Herfindahl index and top-N concentration metrics.",
    status: "ready",
  },

  // ── Meta (3) ───────────────────────────────────────────────────────
  "custom-kpi-strip": {
    id: "custom-kpi-strip",
    name: "Custom KPI Strip",
    category: "meta",
    icon: "≡",
    defaultW: 12,
    defaultH: 2,
    description: "User-configurable row of key metrics.",
    status: "ready",
  },
  "notes-widget": {
    id: "notes-widget",
    name: "Notes",
    category: "meta",
    icon: "≡",
    defaultW: 4,
    defaultH: 3,
    description: "Free-form markdown notes pinned to the dashboard.",
    status: "ready",
  },
  "quick-actions": {
    id: "quick-actions",
    name: "Quick Actions",
    category: "meta",
    icon: "≡",
    defaultW: 4,
    defaultH: 2,
    description: "One-click shortcuts: rebalance, export, share, snapshot.",
    status: "ready",
  },

  // ── Outcomes (1) ─────────────────────────────────────────────────
  "outcomes-timeline": {
    id: "outcomes-timeline",
    name: "Bridge Outcomes",
    category: "outcomes",
    icon: "\u25C8",
    defaultW: 12,
    defaultH: 5,
    description: "Timeline of recorded Bridge outcomes with win-rate KPIs and delta sparklines.",
    status: "ready",
  },

  // ── Bridge (1) — Phase 09.1 Plan 09 / D-14 + D-15 ───────────────
  // Hero Bridge widget: portfolio-level entry point with Review CTA that
  // opens BridgeDrawer (cross-holdings browse → confirm). Default Overview
  // tile per D-15. Per-row inline BridgeOutcomeBanner stays on Plan 08's
  // HoldingsTable (D-14 / S3 accepted) — no double-mount because this
  // widget renders a portfolio-level summary, not a per-holding banner.
  "bridge-hero": {
    id: "bridge-hero",
    name: "Bridge",
    category: "intelligence",
    icon: "B",
    defaultW: 4,
    defaultH: 3,
    description: "Hero Bridge widget — flagged holdings summary + Review drawer.",
    status: "ready",
  },
};

// ---------------------------------------------------------------------------
// Category metadata for the widget picker modal
// ---------------------------------------------------------------------------

export const WIDGET_CATEGORIES = [
  { id: "performance" as const, name: "Performance", icon: "▲" },
  { id: "risk" as const, name: "Risk", icon: "◆" },
  { id: "allocation" as const, name: "Allocation", icon: "◉" },
  { id: "attribution" as const, name: "Attribution", icon: "▸" },
  { id: "positions" as const, name: "Positions", icon: "▦" },
  { id: "monitoring" as const, name: "Monitoring", icon: "●" },
  { id: "intelligence" as const, name: "Intelligence", icon: "◈" },
  { id: "meta" as const, name: "Meta", icon: "≡" },
  { id: "outcomes" as const, name: "Outcomes", icon: "\u25C8" },
];

// ---------------------------------------------------------------------------
// Designer short-key → WIDGET_REGISTRY id map (Phase 09.1 Plan 05 / D-19)
// ---------------------------------------------------------------------------
//
// The designer bundle (designer-bundle/project/src/app.jsx:18-26) refers to
// the 7 default Overview widgets by short keys ("bridge", "kpi", "equity",
// "holdings", "allocation", "mandate", "outcomes"). The live registry uses
// kebab-case ids ("bridge-outcome-banner", "kpi-strip", "equity-curve",
// etc.). The two label spaces must never mix in persisted state.
//
// `resolveWidgetId(k)` returns the canonical WIDGET_REGISTRY id for a
// given input. The hook applies this at write time (addWidget) AND when
// importing DEFAULT_LAYOUT short keys, so config.tiles[*].k is ALWAYS a
// valid registry id post-normalization. The render path can then index
// WIDGET_COMPONENTS directly by t.k — no `?? t.k` fallback required.
//
// Mapping notes:
//   - "equity" routes to "equity-chart" — Plan 07 flipped this entry from
//     "equity-curve" to the new V2 SVG renderer (Phase 09.1 / D-10).
//     Persisted layouts already carrying "equity-curve" continue to
//     render the legacy widget; only newly-defaulted layouts pick up the
//     SVG chart.
//   - "mandate" currently routes to "mandate-compliance" — there is no
//     widget for it yet, so the renderer falls back to a generic "Unknown
//     widget" message until Plan 10 lands "mandate-snapshot" (which may
//     also become the canonical mapping for "mandate").
//   - "kpi" / "holdings" / "bridge" point to ids that don't yet exist in
//     the registry. The picker only ever surfaces real registry ids, so
//     these short keys CAN'T be re-introduced via addWidget; the
//     mapping exists for the DEFAULT_LAYOUT import path only.
//
// If a short key has no entry in this map AND is not already a valid
// WIDGET_REGISTRY id, `resolveWidgetId` returns it unchanged (the
// renderer will then surface the "Unknown widget" fallback).
export const DESIGNER_KEY_TO_WIDGET_ID: Record<string, string> = {
  // Phase 09.1 Plan 09 / D-15 — Hero Bridge widget is the default Overview
  // tile for the "bridge" short key. Was "bridge-outcome-banner" pre-Plan-09;
  // the per-row BridgeOutcomeBanner stays in Plan 08's HoldingsTable
  // (D-14 / S3 accepted) and is no longer the portfolio-level surface.
  // Existing persisted V2 configs that already carry "bridge-outcome-banner"
  // as a tile id continue to render the legacy banner widget (write-time
  // normalization only — no migration code needed).
  bridge: "bridge-hero",
  kpi: "kpi-strip",
  equity: "equity-chart",
  holdings: "holdings-table",
  allocation: "allocation-donut",
  // PR1 (dashboard parity) — was "mandate-compliance" (unregistered, rendered
  // "Unknown widget" fallback). Now points at the new MandateSnapshotWidget
  // (widgets/risk/MandateSnapshotWidget.tsx) so the seven-tile DEFAULT_LAYOUT
  // resolves cleanly. Persisted V2 configs that already carry
  // "mandate-compliance" as a tile id continue to render the unknown-widget
  // fallback (write-time normalization only — no migration code needed).
  mandate: "mandate-snapshot",
  outcomes: "outcomes-timeline",
};

/**
 * Resolve a designer short key OR a registry id to its canonical
 * WIDGET_REGISTRY id. Pass-through when the input is already a registry
 * id; map lookup when the input is a known short key. Unknown values
 * pass through unchanged so the renderer's "unknown widget" path can
 * make the mismatch visible.
 */
export function resolveWidgetId(k: string): string {
  if (k in WIDGET_REGISTRY) return k;
  return DESIGNER_KEY_TO_WIDGET_ID[k] ?? k;
}
