/**
 * Phase 09.1 D-03: TileConfig narrowed to {k, w} for the 4-col CSS grid.
 * Previously {i, widgetId, x, y, w, h} (react-grid-layout units). Auto-height
 * is now content-driven; row wrapping is implicit via CSS grid flow; one
 * instance per widget (no per-instance ids — addWidget is idempotent).
 *
 * audit-2026-05-07 type-safety pass — applied:
 *   H-0147 + M-1093  timeframe: string → TimeframeKey (single source of
 *                    truth at components/ui/TimeframeSelector.tsx).
 *   H-0142           TileConfig.k: string → RegistryWidgetId (brand minted
 *                    by resolveWidgetId / asRegistryWidgetId — see
 *                    widget-registry.ts).
 *   M-0157           WidgetMeta.category: hand-written union → WidgetCategory
 *                    (derived from WIDGET_CATEGORIES `as const`).
 *   M-0155           WidgetMeta.defaultH dropped (dormant legacy hook only).
 *
 * Deferred to a cross-cutting batch (left intentionally open):
 *   H-0141 + H-1086  WidgetProps.data: any — needs a per-widget-id payload
 *                    union indexed at WIDGET_COMPONENTS (see JSDoc on
 *                    WidgetProps.data below for the full rationale).
 *   H-0143 + H-1095  WidgetMeta.defaultW: number — needs registry rewrite
 *                    to split legacy 12-col (3/4/6/12) from V2 4-col
 *                    (1/2/3/4). Cross-file batch with the legacy-hook
 *                    deletion.
 *   H-0146           TileConfig.config: Record<string, unknown> — needs a
 *                    per-widget config map indexed by widget id; touches
 *                    every widget consumer.
 *   M-1094           __v discriminator on TileConfig/LegacyTileConfig —
 *                    deferred (legacy hook is dormant and slated for
 *                    deletion; adding the discriminator just before
 *                    removing the legacy types isn't worth the churn).
 */

// Re-export the brand + derived category from widget-registry so consumers
// of TileConfig/WidgetMeta pull the related types from the same module.
import type { RegistryWidgetId, WidgetCategory } from "./widget-registry";
// PR-3+4 NEW-C06-08 (audit-2026-05-07): LayoutVersion (= `typeof
// LAYOUT_VERSION`) is the type-level discriminant for
// DashboardConfig.layoutVersion (see JSDoc at the field). Type-only
// import avoids a value-cycle with dashboard-defaults (which already
// type-imports TileConfig from this module).
import type { LayoutVersion } from "./dashboard-defaults";
// Re-export TimeframeKey so dashboard slice imports the timeframe vocabulary
// from `lib/types.ts` alongside its peers, not from a UI component module.
import { TIMEFRAMES, type TimeframeKey } from "@/components/ui/TimeframeSelector";

export type { RegistryWidgetId, WidgetCategory, TimeframeKey };

const TIMEFRAME_KEYS: ReadonlySet<TimeframeKey> = new Set<TimeframeKey>(
  TIMEFRAMES.map((t) => t.key),
);

/**
 * Validate `value` against the live TimeframeSelector key set and collapse
 * the legacy "YTD" label (pre-H-0147 builds wrote the label rather than the
 * canonical key "1YTD") onto its canonical key. Falls back to `fallback`
 * (default "1YTD") on any unrecognised input. Single source of truth for
 * timeframe coercion across the dashboard slice.
 */
export function coerceTimeframe(
  value: unknown,
  fallback: TimeframeKey = "1YTD",
): TimeframeKey {
  if (typeof value !== "string") return fallback;
  if (value === "YTD") return "1YTD";
  if (TIMEFRAME_KEYS.has(value as TimeframeKey)) return value as TimeframeKey;
  return fallback;
}

export interface TileConfig {
  /**
   * Widget type id post-normalization. Always a RegistryWidgetId — the
   * brand is minted exclusively by `resolveWidgetId` (write/load paths)
   * and `asRegistryWidgetId` (literal-id helper for defaults/fixtures).
   * (audit-2026-05-07 H-0142)
   */
  k: RegistryWidgetId;
  w: 1 | 2 | 3 | 4;              // columns spanned in the 4-col CSS grid
  config?: Record<string, unknown>;
}

export interface DashboardConfig {
  tiles: TileConfig[];
  /**
   * Selected timeframe (1DTD/1WTD/1MTD/1QTD/1YTD/3YTD/ALL — see
   * TimeframeSelector for the canonical list). audit-2026-05-07 H-0147 +
   * M-1093: narrowed from `string` so a typo'd literal fails to compile.
   */
  timeframe: TimeframeKey;
  /**
   * Layout schema version — when this differs from LAYOUT_VERSION, reset to
   * defaults. Required (was optional) so a writer that omits it fails to
   * compile rather than silently producing an omitted version that the hook
   * treats as `undefined !== LAYOUT_VERSION` → reset on every load.
   *
   * PR-3+4 NEW-C06-08 (audit-2026-05-07): narrowed from `number` to
   * `typeof LAYOUT_VERSION`. Writers that hardcode a stale literal (e.g.
   * `layoutVersion: 8` after a bump to 9) now fail to compile rather than
   * shipping a blob the hook silently resets at load. Parsed JSON blobs
   * cast through this type at the boundary, but the runtime drift check
   * (`parsed.layoutVersion !== LAYOUT_VERSION`) still catches inbound
   * stale data — so this narrow is a producer-side guard, not a parser
   * guard.
   */
  layoutVersion: LayoutVersion;
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
  /** See DashboardConfig.timeframe (audit-2026-05-07 H-0147 + M-1093). */
  timeframe: TimeframeKey;
  /**
   * Required — see DashboardConfig.layoutVersion JSDoc (NEW-C06-08).
   * Kept as `number` here because the legacy LAYOUT_VERSION_LEGACY
   * constant (= 3) is internal to useDashboardConfig.ts and the legacy
   * tree is dormant + slated for deletion (M-1094). Narrowing to a
   * literal here would require leaking the legacy constant into the
   * public types surface for a code path being removed.
   */
  layoutVersion: number;
}

export interface WidgetMeta {
  id: string;
  name: string;
  /**
   * Widget picker category. Derived from WIDGET_CATEGORIES `as const` —
   * adding a category row extends the union automatically; deleting one
   * collapses the union so the type-checker flags every registry entry
   * that still references the deleted category. (audit-2026-05-07 M-0157)
   */
  category: WidgetCategory;
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
  description: string;
  /**
   * All registered widgets carry status "ready". The "todo" arm has been
   * removed: the D-08 registry contract prohibits "todo" entries (they
   * silently disappear from the picker filter which gates on === "ready"),
   * and the audit confirmed zero "todo" entries exist across all registry
   * entries. Narrowed from `"ready" | "todo"` per M-0156 / H-0148.
   */
  status: "ready";
}

export interface WidgetProps {
  /**
   * pr189-followup M14 (type-design-analyzer MED/8): widen-but-typed —
   * intentionally `any` because callers in this dashboard register
   * heterogeneous widgets (ConcentrationRisk, NotesWidget, RegimeDetector,
   * etc.) and each destructures a different payload shape. Tightening
   * requires either:
   *   (a) a per-widget-id payload union indexed at the WIDGET_COMPONENTS
   *       registry (`data: WidgetDataByKind[K]`), OR
   *   (b) a per-widget props refactor so each widget exports its own
   *       Props type and the registry passes the right shape.
   *
   * audit-2026-05-07 H-0141 + H-1086 — see top-of-file deferral note.
   * This JSDoc makes the choice discoverable to the next reader of
   * types.ts so they don't (1) rip out the eslint-disable and break the
   * registry, or (2) extend `any` to neighbouring fields.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  /**
   * Display timeframe — selected via TimeframeSelector. audit-2026-05-07
   * H-0147 + M-1093: narrowed from `string` to TimeframeKey.
   */
  timeframe: TimeframeKey;
  width: number;
  height: number;
}
