import type { TileConfig } from "./types";

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
];
