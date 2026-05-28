import type { TileConfig } from "./types";
import { asRegistryWidgetId } from "./widget-registry";

/**
 * Bumping LAYOUT_VERSION resets every persisted user layout to
 * DEFAULT_LAYOUT on next load. Bump whenever a tile id changes meaning,
 * a tile is removed, or the default layout shape changes in a way that
 * would silently break users carrying a stale persisted `tiles[]`.
 *
 * PR-3+4 NEW-C06-08 (audit-2026-05-07): `as const` so the inferred type
 * is the literal `9`, not `number`. `DashboardConfig.layoutVersion` is
 * typed as `LayoutVersion` (= `typeof LAYOUT_VERSION`) so writers that
 * hardcode a stale literal (`layoutVersion: 8`) fail to compile.
 */
export const LAYOUT_VERSION = 9 as const;
export type LayoutVersion = typeof LAYOUT_VERSION;

/**
 * Default Overview layout. Holdings is intentionally absent — it lives on
 * the dedicated Holdings tab, where the full-width detail table belongs.
 * Every short key must resolve to a real `WIDGET_COMPONENTS` entry; the
 * dashboard-defaults regression test guards against drift.
 *
 * audit-2026-05-07 H-0142 — the literal short keys are routed through
 * `asRegistryWidgetId` at module-init so each `k` is a real RegistryWidgetId
 * before any consumer reads from this array. `asRegistryWidgetId` normalizes
 * the short key via `resolveWidgetId` AND asserts the resolved id is a real
 * WIDGET_REGISTRY own-key, so a typo here crashes at module load rather than
 * rendering the "Unknown widget" placeholder.
 */
export const DEFAULT_LAYOUT: TileConfig[] = [
  { k: asRegistryWidgetId("kpi"), w: 4 },
  { k: asRegistryWidgetId("bridge"), w: 4 },
  { k: asRegistryWidgetId("equity"), w: 4 },
  { k: asRegistryWidgetId("allocation"), w: 2 },
  { k: asRegistryWidgetId("mandate"), w: 2 },
  { k: asRegistryWidgetId("outcomes"), w: 4 },
];
