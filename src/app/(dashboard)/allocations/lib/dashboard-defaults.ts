import type { TileConfig } from "./types";

/**
 * Bump this version whenever the default GRID layout changes materially.
 * The useDashboardConfig hook compares this against the persisted version
 * and resets to defaults when it differs.
 *
 * Sprint 4: NOT bumped. InsightStrip and health score live ABOVE the grid
 * (fixed elements, not grid tiles), so existing user layouts are preserved.
 */
export const LAYOUT_VERSION = 1;

export const DEFAULT_LAYOUT: TileConfig[] = [
  { i: "equity-curve-1", widgetId: "equity-curve", x: 0, y: 0, w: 12, h: 4 },
  { i: "drawdown-chart-1", widgetId: "drawdown-chart", x: 0, y: 4, w: 12, h: 4 },
  { i: "allocation-donut-1", widgetId: "allocation-donut", x: 0, y: 8, w: 4, h: 3 },
  { i: "correlation-matrix-1", widgetId: "correlation-matrix", x: 4, y: 8, w: 4, h: 3 },
  { i: "monthly-returns-1", widgetId: "monthly-returns", x: 8, y: 8, w: 4, h: 3 },
  // Full-width so the Positions Table doesn't render alone in a half-width
  // row with empty whitespace to its right. Design review FINDING-009b.
  // Users with saved custom layouts keep their existing width.
  { i: "positions-table-1", widgetId: "positions-table", x: 0, y: 11, w: 12, h: 4 },
  { i: "net-exposure-1", widgetId: "net-exposure", x: 0, y: 15, w: 12, h: 4 },
  { i: "trade-volume-1", widgetId: "trade-volume", x: 0, y: 19, w: 6, h: 3 },
  { i: "exposure-by-asset-1", widgetId: "exposure-by-asset", x: 6, y: 19, w: 6, h: 3 },
];
