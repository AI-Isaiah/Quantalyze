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

export const WIDGET_COMPONENTS: Record<string, LazyWidget> = {
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
