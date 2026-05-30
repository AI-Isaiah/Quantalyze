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
 * WidgetProps.data is `unknown` (B21, H-0141 + H-1086 closed): every widget now
 * runs `data` through a zod schema before reading it — the risk widgets +
 * EquityChart + OutcomesWidget via the `withWidgetBoundary` HOC, DrawdownChart
 * via an inline `riskWidgetDataSchema.safeParse`. `unknown` (not `any`) at the
 * prop boundary FORCES that validation step: a widget cannot destructure the
 * payload without first narrowing it, which is exactly the B21 invariant. The
 * heterogeneous-payload problem the old deferral note described is solved by the
 * per-widget schema (each widget's `z.infer` IS its typed view), not by a
 * registry-indexed union.
 */

// Re-export TimeframeKey so the dashboard slice imports the timeframe
// vocabulary from `lib/types.ts` alongside its peers, not from a UI
// component module.
import type { TimeframeKey } from "@/components/ui/TimeframeSelector";

export type { TimeframeKey };

export interface WidgetProps {
  /**
   * The dashboard payload, passed through unread by the mount and validated by
   * each widget. `unknown` (B21, H-0141 + H-1086): a widget must narrow it
   * through its zod schema (the `withWidgetBoundary` HOC, or DrawdownChart's
   * inline `safeParse`) before reading any field — there is no longer an `any`
   * escape hatch that lets a widget destructure an unchecked shape.
   */
  data: unknown;
  /**
   * Display timeframe — selected via TimeframeSelector. audit-2026-05-07
   * H-0147 + M-1093: narrowed from `string` to TimeframeKey.
   */
  timeframe: TimeframeKey;
  width: number;
  height: number;
}
