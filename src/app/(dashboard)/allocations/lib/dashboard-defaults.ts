import type { TileConfig } from "./types";

/**
 * Bump this version whenever the default GRID layout changes materially.
 * The useDashboardConfig hook compares this against the persisted
 * (localStorage) version and resets to defaults when it differs.
 *
 * Sprint 4: NOT bumped (InsightStrip/health score live ABOVE the grid).
 * Sprint 8 Phase 5: bumped 1 -> 2 to force the Outcomes widget into
 * existing user layouts on next page load (D-18). Side effect: users
 * with localStorage-persisted custom layouts will lose their
 * customizations. Server-side impact is zero-measurable (storage is
 * local, not DB). See 05-01-LAYOUT-BUMP-NOTES.md (Voice-D8).
 *
 * Phase 08 Plan 03: bumped 2 -> 3 to force the NotesWidget (notes-1) into
 * existing user layouts (D-15 / MANAGE-05). Same localStorage-reset side
 * effect as the Phase 5 bump; no user-facing banner (Voice-D8 accepted).
 */
export const LAYOUT_VERSION = 3;

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
  // Phase 5 — Outcomes widget default-visible (D-18). Full width row below
  // the exposure pair.
  { i: "outcomes-timeline-1", widgetId: "outcomes-timeline", x: 0, y: 22, w: 12, h: 5 },
  // Phase 08: portfolio-scope NotesWidget (MANAGE-05). LAYOUT_VERSION bumped 2→3 per UI-SPEC §8.
  { i: "notes-1", widgetId: "notes-widget", x: 0, y: 27, w: 4, h: 4 },
];
