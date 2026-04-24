/**
 * Phase 09.1 D-03: TileConfig narrowed to {k, w} for the 4-col CSS grid.
 * Previously {i, widgetId, x, y, w, h} (react-grid-layout units). Auto-height
 * is now content-driven; row wrapping is implicit via CSS grid flow; one
 * instance per widget (no per-instance ids — addWidget is idempotent).
 */
export interface TileConfig {
  k: string;                     // widget type id (e.g. "bridge", "kpi", "equity")
  w: 1 | 2 | 3 | 4;              // columns spanned in the 4-col CSS grid
  config?: Record<string, unknown>;
}

export interface DashboardConfig {
  tiles: TileConfig[];
  timeframe: string;
  /** Layout schema version — when this differs from LAYOUT_VERSION, reset to defaults. */
  layoutVersion?: number;
}

export interface WidgetMeta {
  id: string;
  name: string;
  category:
    | "performance"
    | "risk"
    | "allocation"
    | "attribution"
    | "positions"
    | "monitoring"
    | "intelligence"
    | "meta"
    | "outcomes";
  icon: string;
  defaultW: 1 | 2 | 3 | 4;       // new 4-col default width (was 3/4/6/12)
  description: string;
  status: "ready" | "todo";
}

export interface WidgetProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  timeframe: string;
  width: number;
  height: number;
}
