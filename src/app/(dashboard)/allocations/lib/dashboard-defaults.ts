import type { TileConfig } from "./types";

/**
 * v0.15.7.0 follow-up: bumped 4 → 5. Drops the "mandate" tile from the
 * default Overview because its target id "mandate-compliance" has no
 * widget component (Plan 10 deliverable). Existing v4 configs reset
 * to the new default; users keep the Mandate tab for compliance details.
 * Phase 09.1 D-02: bumped 3 → 4. New 4-col CSS-grid shape (D-03 {k,w}).
 * Phase 08 Plan 03: bumped 2 → 3 (notes widget).
 * Sprint 8 Phase 5:  bumped 1 → 2 (outcomes widget).
 * Voice-D8 accepted precedent: on mismatch, each hook's loadConfig resets to
 * its own defaults; no banner; users with custom layouts lose them once.
 */
export const LAYOUT_VERSION = 5;

/**
 * D-06: 6-widget Overview default. Widths from designer-bundle/app.jsx:18-26.
 * "mandate" was removed in v0.15.7.0 follow-up — no widget exists for
 * "mandate-compliance" yet (Plan 10). Mandate compliance still surfaces
 * via the Mandate tab.
 */
export const DEFAULT_LAYOUT: TileConfig[] = [
  { k: "bridge", w: 4 },
  { k: "kpi", w: 4 },
  { k: "equity", w: 4 },
  { k: "holdings", w: 3 },
  { k: "allocation", w: 1 },
  { k: "outcomes", w: 4 },
];
