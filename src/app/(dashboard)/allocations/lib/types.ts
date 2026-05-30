/**
 * Allocations dashboard shared types.
 *
 * The configurable widget-grid dashboard (TileConfig / DashboardConfig /
 * WidgetMeta / the legacy v3 tile shapes / the V1+V2 useDashboardConfig
 * hooks) was retired in B7b: the Overview became the factsheet view in
 * v0.23.0.0 (#227), which left the entire tile-grid subsystem dormant with
 * no live caller. What remains here is the live surface — the timeframe
 * vocabulary re-export and the `WidgetProps` contract every `widgets/*`
 * renderer consumes (the renderers are still mounted via WIDGET_COMPONENTS
 * in RiskTabPanel / OutcomesTabPanel and directly by the factsheet Overview).
 *
 * Deferred (intentionally open) — WidgetProps.data is `any`:
 *   H-0141 + H-1086  needs a per-widget-id payload union indexed at
 *                    WIDGET_COMPONENTS (widgets/index.ts), or a per-widget
 *                    props refactor so each renderer exports its own Props.
 */

// Re-export TimeframeKey so the dashboard slice imports the timeframe
// vocabulary from `lib/types.ts` alongside its peers, not from a UI
// component module.
import type { TimeframeKey } from "@/components/ui/TimeframeSelector";

export type { TimeframeKey };

export interface WidgetProps {
  /**
   * pr189-followup M14 (type-design-analyzer MED/8): widen-but-typed —
   * intentionally `any` because callers in this dashboard register
   * heterogeneous widgets (RegimeDetector, TailRisk, AlphaBetaDecomposition,
   * etc.) and each destructures a different payload shape. Tightening
   * requires either:
   *   (a) a per-widget-id payload union indexed at the WIDGET_COMPONENTS
   *       registry (`data: WidgetDataByKind[K]`), OR
   *   (b) a per-widget props refactor so each widget exports its own
   *       Props type and the registry passes the right shape.
   *
   * audit-2026-05-07 H-0141 + H-1086 — see top-of-file deferral note.
   * This JSDoc makes the choice discoverable to the next reader of
   * types.ts so they don't (1) rip out the eslint-disable and break the
   * registry, or (2) extend `any` to neighbouring fields.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  /**
   * Display timeframe — selected via TimeframeSelector. audit-2026-05-07
   * H-0147 + M-1093: narrowed from `string` to TimeframeKey.
   */
  timeframe: TimeframeKey;
  width: number;
  height: number;
}
