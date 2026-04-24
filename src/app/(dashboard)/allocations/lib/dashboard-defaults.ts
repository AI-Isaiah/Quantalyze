import type { TileConfig } from "./types";

/**
 * Phase 09.1 D-02: bumped 3 → 4. New 4-col CSS-grid shape (D-03 {k,w}).
 * Phase 08 Plan 03: bumped 2 → 3 (notes widget).
 * Sprint 8 Phase 5:  bumped 1 → 2 (outcomes widget).
 * Voice-D8 accepted precedent: on mismatch, each hook's loadConfig resets to
 * its own defaults; no banner; users with custom layouts lose them once.
 */
export const LAYOUT_VERSION = 4;

/**
 * D-06: 7-widget Overview default. Widths from designer-bundle/app.jsx:18-26.
 */
export const DEFAULT_LAYOUT: TileConfig[] = [
  { k: "bridge", w: 4 },
  { k: "kpi", w: 4 },
  { k: "equity", w: 4 },
  { k: "holdings", w: 3 },
  { k: "allocation", w: 1 },
  { k: "mandate", w: 2 },
  { k: "outcomes", w: 4 },
];
