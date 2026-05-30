import { lazy, type ComponentType } from "react";
import type { WidgetProps } from "../lib/types";

// ---------------------------------------------------------------------------
// Widget barrel — maps widgetId strings to lazy-loaded components.
// Every key is a widget id; this barrel is the canonical id → component map.
//
// Scope (B7b-2): the barrel carries ONLY the widgets that a live tab panel
// mounts through it. RiskTabPanel is the sole consumer and mounts these six
// keys. (EquityChart, DrawdownChart, and OutcomesWidget are mounted via
// direct imports elsewhere, not through this barrel.)
//
// Widgets with default exports use `lazy(() => import(...))` directly.
// Widgets with named exports use `.then(m => ({ default: m.Name }))`.
// ---------------------------------------------------------------------------

type LazyWidget = React.LazyExoticComponent<ComponentType<WidgetProps>>;

/**
 * The canonical set of live widget ids (H-0157 / M-1096). `WIDGET_COMPONENTS` is
 * typed `Record<WidgetId, LazyWidget>`, so a missing entry or a typo'd key is a
 * COMPILE error rather than a silent runtime "Unknown widget" fallback — the
 * compiler enforces 1:1 coverage. (The legacy `WIDGET_REGISTRY` this finding
 * referenced was deleted in B7b; `WidgetId` is now the single source of truth,
 * and `RiskTabPanel.RISK_WIDGETS` is typed against it so the panel can only
 * mount ids that exist here.)
 */
export type WidgetId =
  | "var-expected-shortfall"
  | "tail-risk"
  | "risk-decomposition"
  | "correlation-matrix"
  | "alpha-beta-decomposition"
  | "regime-detector";

export const WIDGET_COMPONENTS: Record<WidgetId, LazyWidget> = {
  // ── Risk (RiskTabPanel) ─────────────────────────────────────────────
  "var-expected-shortfall": lazy(() =>
    import("./risk/VarExpectedShortfall").then((m) => ({ default: m.VarExpectedShortfall })),
  ),
  "tail-risk": lazy(() =>
    import("./risk/TailRisk").then((m) => ({ default: m.TailRisk })),
  ),
  "risk-decomposition": lazy(() =>
    import("./risk/RiskDecomposition").then((m) => ({ default: m.RiskDecomposition })),
  ),
  "correlation-matrix": lazy(() =>
    import("./risk/CorrelationMatrix").then((m) => ({ default: m.CorrelationMatrix })),
  ),

  // ── Attribution (RiskTabPanel) ──────────────────────────────────────
  "alpha-beta-decomposition": lazy(() => import("./attribution/AlphaBetaDecomposition")),

  // ── Intelligence (RiskTabPanel) ─────────────────────────────────────
  "regime-detector": lazy(() =>
    import("./intelligence/RegimeDetector").then((m) => ({ default: m.RegimeDetector })),
  ),
};
