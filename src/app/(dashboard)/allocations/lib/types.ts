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

/**
 * Phase 09.1 D-02 transition alias — legacy v3 tile shape, consumed by
 * components/DashboardGrid.tsx and components/TileWrapper.tsx. The V1
 * dashboard root that wired these together was removed in v0.15.7.0;
 * remaining usages are dormant pending a follow-up legacy-tree cleanup.
 */
export interface LegacyTileConfig {
  i: string;
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}

export interface LegacyDashboardConfig {
  tiles: LegacyTileConfig[];
  timeframe: string;
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
  /**
   * Suggested width for picker → grid placement.
   *
   * Phase 09.1 D-03 transition note: the v4 grid is 4-col so persisted
   * `TileConfig.w` is `1 | 2 | 3 | 4`. The legacy widget-registry still
   * carries 12-col values (3/4/6/12) for the legacy `LegacyTileConfig.w`
   * path. The V2 hook clamps registry values to 1..4 at addWidget time.
   * Plan 05's widget-registry overhaul narrows this further once the
   * registry is rewritten in V2 form.
   */
  defaultW: number;
  /**
   * Legacy 12-col grid row-height. Consumed only by the legacy
   * useDashboardConfig.addTile path; the V2 grid is content-driven
   * (auto-height) so V2 callers ignore this field. Optional so Plan 05's
   * trimmed registry doesn't have to carry it forward.
   */
  defaultH?: number;
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
