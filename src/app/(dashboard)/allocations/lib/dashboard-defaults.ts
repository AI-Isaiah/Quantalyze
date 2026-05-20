import type { TileConfig } from "./types";

/**
 * Bumping LAYOUT_VERSION resets every persisted user layout to
 * DEFAULT_LAYOUT on next load. Bump whenever a tile id changes meaning,
 * a tile is removed, or the default layout shape changes in a way that
 * would silently break users carrying a stale persisted `tiles[]`.
 */
export const LAYOUT_VERSION = 9;

/**
 * Default Overview layout. Holdings is intentionally absent — it lives on
 * the dedicated Holdings tab, where the full-width detail table belongs.
 * Every short key must resolve to a real `WIDGET_COMPONENTS` entry; the
 * dashboard-defaults regression test guards against drift.
 */
export const DEFAULT_LAYOUT: TileConfig[] = [
  { k: "kpi", w: 4 },
  { k: "bridge", w: 4 },
  { k: "equity", w: 4 },
  { k: "allocation", w: 2 },
  { k: "mandate", w: 2 },
  { k: "outcomes", w: 4 },
];
