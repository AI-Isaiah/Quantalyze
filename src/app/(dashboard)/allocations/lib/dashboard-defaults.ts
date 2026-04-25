import type { TileConfig } from "./types";

/**
 * Phase 09.1 PR1 (dashboard parity): bumped 5 → 6. Restores the
 * `mandate` tile on the default Overview now that PR1 ships a real
 * `mandate-snapshot` widget (widgets/risk/MandateSnapshotWidget) and
 * narrows `outcomes` from full-width (4) to half (2) so mandate(2) +
 * outcomes(2) share the final row — matches the prototype's
 * Allocator-Dashboard-Standalone.html screenshot exactly. The
 * `kpi-strip` and `holdings-table` tiles also stop aliasing onto
 * other widgets in PR1; users on v5 reset cleanly to the new shape.
 *
 * v0.15.7.0 follow-up: bumped 4 → 5. Dropped the "mandate" tile from the
 * default Overview because its target id "mandate-compliance" had no
 * widget component (Plan 10 deliverable, never landed). PR1 supersedes.
 * Phase 09.1 D-02: bumped 3 → 4. New 4-col CSS-grid shape (D-03 {k,w}).
 * Phase 08 Plan 03: bumped 2 → 3 (notes widget).
 * Sprint 8 Phase 5:  bumped 1 → 2 (outcomes widget).
 * Voice-D8 accepted precedent: on mismatch, each hook's loadConfig resets to
 * its own defaults; no banner; users with custom layouts lose them once.
 */
export const LAYOUT_VERSION = 6;

/**
 * Phase 09.1 PR1 (dashboard parity): 7-tile Overview default matching
 * the prototype `Allocator Dashboard - Standalone.html` rendered output
 * byte-for-byte (verified 2026-04-25 by Vite-rendering /tmp scratch port
 * and pixel-diffing against the standalone HTML). Widths from prototype
 * `app.jsx:18-26` with the post-PR1 outcomes(4 → 2) narrowing so mandate(2)
 * shares row 5.
 *
 *   Row 1: bridge(4)
 *   Row 2: kpi(4)
 *   Row 3: equity(4)
 *   Row 4: holdings(3) + allocation(1)
 *   Row 5: mandate(2) + outcomes(2)
 *
 * Every short key resolves to a real WIDGET_COMPONENTS entry post-PR1
 * (the dashboard-defaults regression test guards against this).
 */
export const DEFAULT_LAYOUT: TileConfig[] = [
  { k: "bridge", w: 4 },
  { k: "kpi", w: 4 },
  { k: "equity", w: 4 },
  { k: "holdings", w: 3 },
  { k: "allocation", w: 1 },
  { k: "mandate", w: 2 },
  { k: "outcomes", w: 2 },
];
