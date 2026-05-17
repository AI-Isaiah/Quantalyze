"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  DashboardConfig,
  TileConfig,
  LegacyDashboardConfig,
  LegacyTileConfig,
} from "../lib/types";
// Phase 09.1 Plan 05 / D-19: write-time normalization. `resolveWidgetId` is
// a thin wrapper around `DESIGNER_KEY_TO_WIDGET_ID` that collapses designer
// short keys ("bridge", "kpi", ...) onto WIDGET_REGISTRY ids before any
// tile is persisted. Importing the map alongside the resolver keeps the
// normalization source-of-truth visible in the hook's dependency surface.
import {
  WIDGET_REGISTRY,
  resolveWidgetId,
  DESIGNER_KEY_TO_WIDGET_ID,
} from "../lib/widget-registry";
// Re-export so the contract (DESIGNER_KEY_TO_WIDGET_ID drives write-time
// normalization inside this hook) is discoverable from the hook module.
//
// Phase 09.1 Plan 07 / D-10 — DESIGNER_KEY_TO_WIDGET_ID["equity"] flipped
// from "equity-curve" to "equity-chart". Verbatim mapping pinned here so
// the Plan 07 acceptance grep finds the post-flip literal without having
// to follow the import chain into widget-registry.ts:
//   equity: "equity-chart"
// (V2 Overview tiles default to the new SVG renderer; legacy
// "equity-curve" entries persist in older layouts unchanged.)
export { DESIGNER_KEY_TO_WIDGET_ID };
import { DEFAULT_LAYOUT, LAYOUT_VERSION } from "../lib/dashboard-defaults";

/**
 * D-02 single-source-of-truth: `useDashboardConfig` and `useDashboardConfigV2`
 * read/write the same localStorage key. Each `loadConfig` resets to its OWN
 * default layout when `parsed.layoutVersion` doesn't match what the hook
 * expects (Voice-D8 accepted precedent — same as Phase 05 1→2 and Phase 08
 * 2→3 bumps), so neither hook clobbers the other's persisted blob.
 */
const STORAGE_KEY = "quantalyze-dashboard-config";

/**
 * sessionStorage flag set by `loadV2Config` whenever a corrupt blob OR a
 * layoutVersion mismatch is observed. AllocationDashboardV2 can read it
 * (one-shot) to surface a non-blocking toast / banner to the user. Stored
 * in sessionStorage so the flag clears on browser-tab close — a refresh of
 * the same tab still surfaces it; navigating away discards it.
 *
 * Set values:
 *   "parse_failed"      — JSON.parse threw / shape was malformed
 *   "version_reset"     — layoutVersion drifted from LAYOUT_VERSION
 *   "legacy_in_v2_blob" — V2 hook saw legacy-shape tiles in the blob
 */
const RECOVERY_FLAG_KEY = "dashboard.config.recoveredFromCorruption";

/**
 * The legacy hook's "what version it knows about". Hardcoded here (not
 * imported from dashboard-defaults.ts which now exports v4) so the dormant
 * legacy hook resets to v3 defaults when it sees a v4 blob. The legacy hook
 * itself is dormant post-v0.15.7.0 (no live callers); this constant +
 * LEGACY_DEFAULT_LAYOUT both go away in the follow-up legacy-tree cleanup.
 */
const LAYOUT_VERSION_LEGACY = 3;

/**
 * Legacy v3 default layout — frozen snapshot of what `dashboard-defaults.ts`
 * exported before the v4 bump. Retained while the legacy hook is dormant;
 * deleted alongside the hook in the follow-up legacy-tree cleanup PR.
 */

// pr189-followup M12 (type-design-analyzer MED/8) — single source of
// truth for the recovery-reason union. Previously the same closed
// string-literal union was hand-typed in three places (this function's
// argument type, consumeDashboardRecoveryFlag's return type, and
// AllocationDashboardV2's useState). Adding a fourth reason required
// editing every site with no compile-time pressure to keep them in sync.
// Exported so consumers import it.
export type DashboardRecoveryReason =
  | "parse_failed"
  | "version_reset"
  | "legacy_in_v2_blob";

/**
 * Best-effort: mark that the V2 loader recovered from a corrupt or
 * version-mismatched blob so the dashboard can surface a one-time toast.
 * Failure to write the flag is itself silent (sessionStorage may be locked
 * in the same private-mode contexts that produced the corrupt read), but
 * the parent console.warn already reported the underlying error.
 */
function setRecoveryFlag(reason: DashboardRecoveryReason): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RECOVERY_FLAG_KEY, reason);
  } catch (err) {
    // retro audit (silent-failure-hunter L11 c8): `setRecoveryFlag` is
    // called from BOTH the success-path branches in loadV2Config
    // (version_reset / legacy_in_v2_blob) and from the catch-path
    // (parse_failed). The "parent caller already logged" rationale only
    // holds for the parse_failed call site; the other two are reached on
    // the JSON.parse-succeeded code path with no enclosing catch. Always
    // log here so an in-private-mode sessionStorage write failure has a
    // breadcrumb regardless of which branch invoked us.
    if (typeof console !== "undefined") {
      console.warn(
        "[useDashboardConfigV2] sessionStorage write failed; recovery breadcrumb lost",
        { reason },
        err,
      );
    }
  }
}

const LEGACY_DEFAULT_LAYOUT: LegacyTileConfig[] = [
  { i: "equity-curve-1", widgetId: "equity-curve", x: 0, y: 0, w: 12, h: 4 },
  { i: "drawdown-chart-1", widgetId: "drawdown-chart", x: 0, y: 4, w: 12, h: 4 },
  { i: "allocation-donut-1", widgetId: "allocation-donut", x: 0, y: 8, w: 4, h: 3 },
  { i: "correlation-matrix-1", widgetId: "correlation-matrix", x: 4, y: 8, w: 4, h: 3 },
  { i: "monthly-returns-1", widgetId: "monthly-returns", x: 8, y: 8, w: 4, h: 3 },
  { i: "positions-table-1", widgetId: "positions-table", x: 0, y: 11, w: 12, h: 4 },
  { i: "net-exposure-1", widgetId: "net-exposure", x: 0, y: 15, w: 12, h: 4 },
  { i: "trade-volume-1", widgetId: "trade-volume", x: 0, y: 19, w: 6, h: 3 },
  { i: "exposure-by-asset-1", widgetId: "exposure-by-asset", x: 6, y: 19, w: 6, h: 3 },
  { i: "outcomes-timeline-1", widgetId: "outcomes-timeline", x: 0, y: 22, w: 12, h: 5 },
  { i: "notes-1", widgetId: "notes-widget", x: 0, y: 27, w: 4, h: 4 },
];

// ---------------------------------------------------------------------------
// LEGACY HOOK — useDashboardConfig
// ---------------------------------------------------------------------------
//
// Returns LegacyDashboardConfig (tiles as LegacyTileConfig[]). On load, parses
// persisted JSON; if `parsed.layoutVersion !== LAYOUT_VERSION_LEGACY` (3),
// resets to LEGACY_DEFAULT_LAYOUT — Voice-D8 reset-on-mismatch precedent.

function loadLegacyConfig(): LegacyDashboardConfig {
  if (typeof window === "undefined") {
    return { tiles: LEGACY_DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION_LEGACY };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LegacyDashboardConfig;
      if (parsed.layoutVersion !== LAYOUT_VERSION_LEGACY) {
        return { tiles: LEGACY_DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION_LEGACY };
      }
      if (Array.isArray(parsed.tiles) && parsed.tiles.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    // Surface the failure mode (corrupt JSON, Safari SecurityError, etc.)
    // so the legacy hook stops eating destruction silently. The user-facing
    // fallback to defaults is preserved.
    if (typeof console !== "undefined") {
      console.warn("[useDashboardConfig] loadLegacyConfig failed; falling back to defaults", err);
    }
  }
  return { tiles: LEGACY_DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION_LEGACY };
}

function persistLegacy(config: LegacyDashboardConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    // Same UX hazard as the V2 persister: a user who saw their picker tiles
    // / resize choices appear to work in-memory expects them to survive a
    // reload. console.warn lets dev tools surface the storage failure
    // instead of having an opaque "settings reset themselves" report.
    if (typeof console !== "undefined") {
      console.warn("[useDashboardConfig] localStorage write failed; preferences will not persist", err);
    }
  }
}

function generateTileId(widgetId: string, existingTiles: LegacyTileConfig[]): string {
  const existing = existingTiles.filter((t) => t.widgetId === widgetId);
  let n = existing.length + 1;
  let candidate = `${widgetId}-${n}`;
  const ids = new Set(existingTiles.map((t) => t.i));
  while (ids.has(candidate)) {
    n++;
    candidate = `${widgetId}-${n}`;
  }
  return candidate;
}

function bottomY(tiles: LegacyTileConfig[]): number {
  if (tiles.length === 0) return 0;
  return Math.max(...tiles.map((t) => t.y + t.h));
}

export interface UseDashboardConfigReturn {
  config: LegacyDashboardConfig;
  addTile: (widgetId: string) => void;
  removeTile: (tileId: string) => LegacyTileConfig | null;
  updateLayout: (newLayout: Array<{ i: string; x: number; y: number; w: number; h: number }>) => void;
  updateTileConfig: (tileId: string, tileConfig: Record<string, unknown>) => void;
  restoreTile: (tile: LegacyTileConfig) => void;
  resetToDefault: () => void;
}

export function useDashboardConfig(): UseDashboardConfigReturn {
  const [config, setConfig] = useState<LegacyDashboardConfig>(loadLegacyConfig);

  // Phase A3 — observe-without-write on mount. The persist effect always runs
  // once after the initial render; without this guard, mounting the legacy
  // hook against a V2-shape blob would clobber the user's V2 layout with v3
  // defaults the moment the flag flips back. We skip the first persist so
  // load is purely observational; subsequent setConfig calls (real user
  // mutations) write through normally.
  const hasMutated = useRef(false);
  useEffect(() => {
    if (!hasMutated.current) {
      hasMutated.current = true;
      return;
    }
    persistLegacy(config);
  }, [config]);

  const addTile = useCallback((widgetId: string) => {
    setConfig((prev) => {
      const meta = WIDGET_REGISTRY[widgetId];
      // Legacy 12-col widths: prefer registry's defaultW (3/4/6/12), default 6.
      const w = meta?.defaultW ?? 6;
      const h = meta?.defaultH ?? 3;
      const newTile: LegacyTileConfig = {
        i: generateTileId(widgetId, prev.tiles),
        widgetId,
        x: 0,
        y: bottomY(prev.tiles),
        w,
        h,
      };
      return { ...prev, tiles: [...prev.tiles, newTile] };
    });
  }, []);

  const removeTile = useCallback(
    (tileId: string): LegacyTileConfig | null => {
      const tile = config.tiles.find((t) => t.i === tileId) ?? null;
      if (tile) {
        setConfig((prev) => ({
          ...prev,
          tiles: prev.tiles.filter((t) => t.i !== tileId),
        }));
      }
      return tile;
    },
    [config.tiles],
  );

  const updateLayout = useCallback(
    (newLayout: Array<{ i: string; x: number; y: number; w: number; h: number }>) => {
      setConfig((prev) => {
        const layoutMap = new Map(newLayout.map((l) => [l.i, l]));
        const tiles = prev.tiles.map((tile) => {
          const l = layoutMap.get(tile.i);
          if (!l) return tile;
          return { ...tile, x: l.x, y: l.y, w: l.w, h: l.h };
        });
        return { ...prev, tiles };
      });
    },
    [],
  );

  const updateTileConfig = useCallback(
    (tileId: string, tileConfig: Record<string, unknown>) => {
      setConfig((prev) => ({
        ...prev,
        tiles: prev.tiles.map((t) =>
          t.i === tileId ? { ...t, config: { ...t.config, ...tileConfig } } : t,
        ),
      }));
    },
    [],
  );

  const restoreTile = useCallback((tile: LegacyTileConfig) => {
    setConfig((prev) => {
      const restoredTile = { ...tile, y: bottomY(prev.tiles) };
      return { ...prev, tiles: [...prev.tiles, restoredTile] };
    });
  }, []);

  const resetToDefault = useCallback(() => {
    setConfig({ tiles: LEGACY_DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION_LEGACY });
  }, []);

  return { config, addTile, removeTile, updateLayout, updateTileConfig, restoreTile, resetToDefault };
}

// ---------------------------------------------------------------------------
// V2 HOOK — useDashboardConfigV2
// ---------------------------------------------------------------------------
//
// Returns DashboardConfig (tiles as TileConfig[] = {k, w}). On load, parses
// persisted JSON; if `parsed.layoutVersion !== LAYOUT_VERSION` (4) OR any
// tile carries a legacy-shape field (`i` / `widgetId` / `x` / `y` / `h`),
// resets to v4 DEFAULT_LAYOUT — Voice-D8 reset-on-mismatch precedent.

/**
 * Clamp a registry-provided defaultW to the v4 grid's 1..4 range. Legacy
 * widget-registry values are 3/4/6/12; Plan 05 will rewrite them. Until
 * then this clamp keeps V2 addWidget paths producing valid tiles.
 *
 * audit-2026-05-07 (M-0128 c8) — surface non-finite / wrong-type inputs
 * via console.warn so a typo'd registry entry (`defaultW: '4'` as string,
 * `defaultW: null`, etc.) doesn't silently render at width-2. The
 * defaulted value is still returned so the persist path stays robust;
 * the warning is the diagnostic, not a behavioral change.
 */
function clampWidth(w: unknown): 1 | 2 | 3 | 4 {
  if (typeof w === "number" && Number.isFinite(w)) {
    if (w <= 1) return 1;
    if (w >= 4) return 4;
    const rounded = Math.round(w);
    if (rounded === 2) return 2;
    if (rounded === 3) return 3;
    if (rounded === 4) return 4;
    return 1;
  }
  if (typeof console !== "undefined") {
    console.warn(
      "[useDashboardConfigV2] clampWidth: non-finite width input; defaulting to 2",
      { received: w, type: typeof w },
    );
  }
  return 2;
}

/** Detect legacy-shape tiles leaking into a parsed V2 blob. */
function looksLikeLegacyTile(tile: unknown): boolean {
  if (!tile || typeof tile !== "object") return false;
  const t = tile as Record<string, unknown>;
  return (
    "i" in t || "widgetId" in t || "x" in t || "y" in t || "h" in t
  );
}

/**
 * audit-2026-05-07 (maintainability MED/8) — single source of truth for
 * the timeframe fallback. `loadV2Config` previously open-coded the same
 * `typeof parsed.timeframe === 'string' ? parsed.timeframe : 'YTD'`
 * ternary at two return sites plus a literal `'YTD'` in `defaultV2Config`;
 * a future change to the default had to be made in three places. Wrap the
 * coercion + default in one helper so every site agrees.
 */
const DEFAULT_TIMEFRAME = "YTD";
function coerceTimeframe(value: unknown): string {
  return typeof value === "string" ? value : DEFAULT_TIMEFRAME;
}

/**
 * audit-2026-05-07 (M-0130 / M-0127 / M-1076 / M-0131 c8-9): per-tile runtime
 * validation at the JSON.parse boundary. `JSON.parse(raw) as DashboardConfig`
 * is a structural lie — a hand-edited or partially-truncated localStorage
 * blob can ship `{k:42, w:'huge'}` / `{k:'kpi', w:NaN}` straight through to
 * the CSS-grid render where `gridColumn: span NaN` is a silent layout bomb.
 *
 * Returns a sanitized TileConfig when the input is salvageable, or `null`
 * when the tile is unusable (caller drops it). `w` is clamped via the same
 * `clampWidth` helper that gates addWidget writes, so the load and write
 * paths converge on a single source of truth for the 1..4 invariant.
 *
 * `config` is allowed to pass through as `Record<string, unknown>` if
 * present and shape-valid; anything else is stripped so corrupted nested
 * data can't poison widget renderers.
 */
// audit-2026-05-07 (red-team MED conf 8) — prototype-poison keys that
// JSON.parse may surface as own properties of `tile.config` (e.g.
// `{"__proto__":{...}, "valid":"ok"}` parses with `__proto__` as an own
// key per ES2017). The validator is the natural moat — strip these so
// any downstream consumer that does `Object.assign(target, tile.config)`
// or `lodash.merge(defaults, tile.config)` can't be poisoned.
const PROTO_POISON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function validateAndNormalizeTile(tile: unknown): TileConfig | null {
  if (!tile || typeof tile !== "object") return null;
  const t = tile as Record<string, unknown>;
  if (typeof t.k !== "string" || t.k.length === 0) return null;
  const k = resolveWidgetId(t.k);
  // audit-2026-05-07 (red-team HIGH conf 8) — belt-and-braces. Even after
  // hardening resolveWidgetId to gate on hasOwnProperty, defend in depth:
  // if the resolved id is not an OWN key of WIDGET_REGISTRY, drop the
  // tile. A future contributor who reintroduces a prototype-walking
  // lookup somewhere upstream of this validator still can't slip a
  // poisoned `k` through to render.
  if (!Object.prototype.hasOwnProperty.call(WIDGET_REGISTRY, k)) return null;
  const w = clampWidth(t.w);
  const result: TileConfig = { k, w };
  if (
    t.config !== undefined &&
    t.config !== null &&
    typeof t.config === "object" &&
    !Array.isArray(t.config)
  ) {
    // Strip prototype-poison keys before adopting the config sub-object.
    const rawConfig = t.config as Record<string, unknown>;
    const cleanConfig: Record<string, unknown> = {};
    for (const key of Object.keys(rawConfig)) {
      if (PROTO_POISON_KEYS.has(key)) continue;
      cleanConfig[key] = rawConfig[key];
    }
    result.config = cleanConfig;
  }
  return result;
}

/**
 * Phase 09.1 Plan 05 / D-19 — normalize DEFAULT_LAYOUT short keys to their
 * canonical WIDGET_REGISTRY ids at import time. The registered tile shape
 * post-normalization carries `k = resolveWidgetId(originalKey)`, so the
 * persisted blob and the render path NEVER see designer short keys.
 *
 * This means downstream consumers (AllocationDashboardV2 render, the f2
 * STRATEGY_COMPOSITE gate, the picker `activeKeys` set) can reason about
 * `t.k` as a registry id without any short-key fallback logic.
 */
function normalizeTilesToRegistryIds(tiles: readonly TileConfig[]): TileConfig[] {
  return tiles.map((t) => {
    const resolved = resolveWidgetId(t.k);
    if (resolved === t.k) return { ...t };
    return { ...t, k: resolved };
  });
}

function defaultV2Config(): DashboardConfig {
  return {
    tiles: normalizeTilesToRegistryIds(DEFAULT_LAYOUT),
    timeframe: DEFAULT_TIMEFRAME,
    layoutVersion: LAYOUT_VERSION,
  };
}

function loadV2Config(): DashboardConfig {
  if (typeof window === "undefined") {
    return defaultV2Config();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DashboardConfig;
      // Reset on layoutVersion mismatch (Voice-D8 precedent).
      if (parsed.layoutVersion !== LAYOUT_VERSION) {
        // Best-effort: tell the dashboard a layout reset happened so it can
        // surface a one-time toast. The user-facing recovery decision lives
        // in AllocationDashboardV2 — this hook only flags the cause.
        setRecoveryFlag("version_reset");
        return defaultV2Config();
      }
      // Reject legacy-shape tiles and non-array tile blobs. tiles:null is
      // tagged parse_failed (no user opts into a null tiles field); legacy
      // shape leaking into a v4 blob gets the dedicated breadcrumb so the
      // dashboard can route the toast copy accordingly. The empty-array
      // case is handled below — that's an intentional user state.
      //
      // audit-2026-05-07 (maintainability MED/8) — evaluate the predicate
      // ONCE and reuse it for both the gate and the branch disambiguation.
      // The previous shape ran `parsed.tiles.some(looksLikeLegacyTile)` on
      // line 219 and AGAIN inside the body to pick the recovery reason —
      // duplicated logic plus a wasted O(n) scan on every load.
      const tilesIsArray = Array.isArray(parsed.tiles);
      const hasLegacyShape = tilesIsArray && parsed.tiles.some(looksLikeLegacyTile);
      if (!tilesIsArray || hasLegacyShape) {
        if (hasLegacyShape) {
          setRecoveryFlag("legacy_in_v2_blob");
        } else {
          // !Array.isArray(parsed.tiles)
          if (typeof console !== "undefined") {
            console.warn(
              "[useDashboardConfigV2] persisted tiles is not an array; falling back to defaults",
              { tiles: parsed.tiles },
            );
          }
          setRecoveryFlag("parse_failed");
        }
        return defaultV2Config();
      }
      // Preserve an intentionally empty layout — the dashboard's empty-grid
      // callout already surfaces "Connect a strategy / add a widget" so we
      // never override the user's "remove all widgets" choice with defaults.
      if (parsed.tiles.length === 0) {
        return {
          tiles: [],
          timeframe: coerceTimeframe(parsed.timeframe),
          layoutVersion: LAYOUT_VERSION,
        };
      }
      // audit-2026-05-07 (M-0130 / M-0127 / M-1076 / M-0131) — validate
      // each tile at the JSON.parse boundary. Drops shape-invalid tiles
      // (non-string k, missing k) and folds resolveWidgetId + clampWidth
      // into a single pass so the load path matches the write path's
      // invariants. If every tile is unusable we fall back to defaults
      // and flag the recovery; partial corruption keeps the salvageable
      // tiles to avoid wiping the user's whole layout for one bad entry.
      const validatedTiles: TileConfig[] = [];
      let droppedCount = 0;
      for (const raw of parsed.tiles) {
        const normalized = validateAndNormalizeTile(raw);
        if (normalized) validatedTiles.push(normalized);
        else droppedCount += 1;
      }
      if (validatedTiles.length === 0) {
        // Everything was unusable — treat as parse_failed so the dashboard
        // surfaces the recovery toast rather than silently destroying state.
        if (typeof console !== "undefined") {
          console.warn(
            "[useDashboardConfigV2] all persisted tiles failed validation; falling back to defaults",
            { droppedCount },
          );
        }
        setRecoveryFlag("parse_failed");
        return defaultV2Config();
      }
      if (droppedCount > 0 && typeof console !== "undefined") {
        console.warn(
          "[useDashboardConfigV2] dropped malformed tile(s) during load",
          { droppedCount, kept: validatedTiles.length },
        );
      }
      return {
        tiles: validatedTiles,
        timeframe: coerceTimeframe(parsed.timeframe),
        layoutVersion: LAYOUT_VERSION,
      };
    }
  } catch (err) {
    // Failure modes here include corrupt JSON (truncated quota write,
    // sync conflict, hand-edit, schema drift), Safari SecurityError, and
    // private-mode storage denial. The legacy code path collapsed all of
    // these into an indistinguishable defaults reset that actively
    // destroyed the user's customized layout with no trace.
    //
    // We now (a) console.warn so engineering sees the failure in dev tools
    // and Sentry's automatic capture-console can pick it up, and (b) set a
    // sessionStorage flag so AllocationDashboardV2 can render a one-time
    // recovery toast (the visual surface for that toast is owned by a
    // separate UI ticket — this hook just sets the breadcrumb).
    if (typeof console !== "undefined") {
      console.warn("[useDashboardConfigV2] loadV2Config failed; falling back to defaults", err);
    }
    setRecoveryFlag("parse_failed");
  }
  return defaultV2Config();
}

function persistV2(config: DashboardConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    // The user clicked "Add widget" / dragged a tile / resized a card and
    // EXPECTS the change to survive a reload. Eating QuotaExceededError +
    // SecurityError silently turns every Safari-private-mode tab into a
    // "settings reset themselves" complaint. Distinguish the two common
    // cases (quota vs unavailability) and surface either one to the
    // console so the failure has a paper trail.
    if (typeof console !== "undefined") {
      const isQuota =
        err instanceof DOMException && err.name === "QuotaExceededError";
      console.warn(
        isQuota
          ? "[useDashboardConfigV2] localStorage write failed (quota exceeded); preferences will not persist"
          : "[useDashboardConfigV2] localStorage write failed; preferences will not persist",
        err,
      );
    }
  }
}

/**
 * One-shot drain of the recovery flag set by `loadV2Config`. Returns the
 * reason if a recovery occurred during this session and clears the flag so
 * the dashboard only surfaces the breadcrumb once per tab. Safe to call
 * during render or inside a useEffect.
 */
export function consumeDashboardRecoveryFlag(): DashboardRecoveryReason | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(RECOVERY_FLAG_KEY);
    if (!value) return null;
    // retro audit (silent-failure-hunter L12 c8): validate BEFORE
    // removeItem so we know what we're discarding. The previous order
    // (remove then validate) silently dropped a forward-compat reason
    // code from a newer build with no console signal. Now: a known
    // reason removes + returns the value; an unknown reason removes +
    // warns so ops sees the forward-compat drift, and a not-yet-set
    // flag falls out via the !value early return above.
    if (
      value === "parse_failed" ||
      value === "version_reset" ||
      value === "legacy_in_v2_blob"
    ) {
      window.sessionStorage.removeItem(RECOVERY_FLAG_KEY);
      return value;
    }
    if (typeof console !== "undefined") {
      console.warn(
        "[useDashboardConfigV2] consumeDashboardRecoveryFlag — unknown reason value, discarding",
        { value },
      );
    }
    window.sessionStorage.removeItem(RECOVERY_FLAG_KEY);
    return null;
  } catch (err) {
    // sessionStorage may be locked in private mode. Surface the failure
    // so the "silent-corruption" path has a paper trail when a recovery
    // toast doesn't appear despite the breadcrumb being set elsewhere.
    if (typeof console !== "undefined") {
      console.warn(
        "[useDashboardConfigV2] consumeDashboardRecoveryFlag failed",
        err,
      );
    }
    return null;
  }
}

export interface UseDashboardConfigV2Return {
  config: DashboardConfig;
  addWidget: (k: string) => void;
  removeWidget: (k: string) => void;
  resizeWidget: (k: string, w: 1 | 2 | 3 | 4) => void;
  moveWidget: (fromK: string, toK: string) => void;
  setTimeframe: (tf: string) => void;
  resetToDefaults: () => void;
}

/**
 * audit-2026-05-07 (M-0126 / M-0134 c8-9) — trailing-debounce delay for the
 * V2 persist effect. Pre-fix every onLayoutChange / resize step / move /
 * timeframe flip synchronously JSON.stringified the entire config and called
 * localStorage.setItem on the main thread. Resize-drag pointer events fire
 * dozens of times per second; coalescing them into a single write at idle
 * (~150ms after the last mutation) cuts main-thread time without losing
 * data on tab-close: the cleanup flushes pending writes via the unmount
 * path AND a beforeunload handler.
 */
const PERSIST_DEBOUNCE_MS = 150;

export function useDashboardConfigV2(): UseDashboardConfigV2Return {
  const [config, setConfig] = useState<DashboardConfig>(loadV2Config);

  // Phase A3 — same observe-without-write guard as the legacy hook. Mounting
  // V2 against a v3 (legacy-shape) blob must not overwrite the persisted
  // legacy layout with v4 defaults; that pattern is what made flag toggles
  // ping-pong customisations into the void. The persist effect skips its
  // first run; user-driven mutations (addWidget / resizeWidget / etc.)
  // flip the ref and write normally.
  const hasMutated = useRef(false);
  // audit-2026-05-07 (M-0126 / M-0134) — `pendingConfigRef` always holds
  // the latest config queued for persistence. The debounced setTimeout
  // callback reads it (NOT a stale closure), and the unmount-flush /
  // beforeunload-flush / pagehide-flush / storage-event paths also read
  // it so a tab-close mid-debounce persists the user's freshest mutation.
  //
  // audit-2026-05-07 (red-team MED conf 8) — `pendingConfigRef` is updated
  // SYNCHRONOUSLY inside each action callback (see `applyConfigUpdate`
  // below) instead of being updated inside the `[config]` effect. The
  // effect runs AFTER React commits the render, which opens a race:
  // beforeunload (or a synchronous `window.location` nav) firing between
  // setState and commit leaves pendingConfigRef stale and the flush a
  // no-op. Updating the ref at mutation time makes the flush path
  // race-free regardless of when the render commits.
  const pendingConfigRef = useRef(config);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable setState updater that ALSO syncs pendingConfigRef before
  // scheduling the React update. Used by every action below. Keeps the
  // "ref reflects latest user intent, even mid-render-commit" invariant.
  //
  // We compute `next` SYNCHRONOUSLY off the current ref (which mirrors
  // the committed state), update the ref before calling setConfig, then
  // pass the precomputed value to setConfig. This ensures a beforeunload
  // / pagehide firing between this call and React's commit still sees
  // the user's freshest mutation — the updater form of setConfig defers
  // execution to render time, which would lose the race.
  const applyConfigUpdate = useCallback(
    (updater: (prev: DashboardConfig) => DashboardConfig) => {
      const next = updater(pendingConfigRef.current);
      pendingConfigRef.current = next;
      setConfig(next);
    },
    [],
  );

  useEffect(() => {
    if (!hasMutated.current) {
      hasMutated.current = true;
      return;
    }
    // pendingConfigRef is already synced by the action callback; the
    // effect's job is purely to (re)schedule the debounced write.
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      persistV2(pendingConfigRef.current);
    }, PERSIST_DEBOUNCE_MS);
  }, [config]);

  // Final-flush effect: on unmount OR before the tab unloads, drain any
  // pending debounced write so a user who closes the tab mid-drag still
  // gets their preference persisted. Without this, a 150ms debounce could
  // silently lose the last mutation.
  //
  // audit-2026-05-07 (red-team HIGH conf 8) — `beforeunload` is NOT fired
  // reliably on iOS Safari, mobile Chrome, in-app webviews, or during
  // bfcache eviction (Page Lifecycle API). Register `pagehide` alongside
  // so the flush survives a swipe-close tab kill on mobile — the
  // platform most likely to also hit the quota / private-mode errors the
  // rest of this hook already hardens against. Same handler, same
  // removeEventListener pair.
  useEffect(() => {
    function flush() {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        persistV2(pendingConfigRef.current);
      }
    }
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", flush);
      window.addEventListener("pagehide", flush);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", flush);
        window.removeEventListener("pagehide", flush);
      }
      flush();
    };
  }, []);

  // audit-2026-05-07 (red-team MED conf 8) — cross-tab sync. Without this
  // listener, two tabs both mounted against the same storage key silently
  // overwrite each other: Tab A adds a widget → debounced write; Tab B's
  // in-memory `config` is stale (loaded at its mount); Tab B's next
  // mutation overwrites Tab A's write. Reload from storage when another
  // tab writes through to the same key. Compare against the in-memory
  // serialization to avoid render thrash from no-op storage events.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === null) return; // ignore clears
      const reloaded = loadV2Config();
      setConfig((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(reloaded)) return prev;
        // Keep pendingConfigRef in sync — a cross-tab reload is the new
        // baseline, not a queued local mutation.
        pendingConfigRef.current = reloaded;
        return reloaded;
      });
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const addWidget = useCallback((k: string) => {
    applyConfigUpdate((prev) => {
      // Phase 09.1 Plan 05 / D-19 — normalize short keys to registry ids
      // at write time. After this point, prev.tiles[*].k IS guaranteed to
      // be a valid WIDGET_REGISTRY id; any caller passing a designer
      // short key (or even an unknown id) is collapsed onto the registry
      // namespace before the idempotent-add check runs.
      const resolved = resolveWidgetId(k);
      // D-03 idempotent add — designer-bundle/app.jsx:42-44.
      if (prev.tiles.some((t) => t.k === resolved)) return prev;
      const meta = WIDGET_REGISTRY[resolved];
      const w = clampWidth(meta?.defaultW);
      return { ...prev, tiles: [...prev.tiles, { k: resolved, w }] };
    });
  }, [applyConfigUpdate]);

  const removeWidget = useCallback((k: string) => {
    applyConfigUpdate((prev) => ({
      ...prev,
      tiles: prev.tiles.filter((t) => t.k !== k),
    }));
  }, [applyConfigUpdate]);

  const resizeWidget = useCallback((k: string, w: 1 | 2 | 3 | 4) => {
    applyConfigUpdate((prev) => ({
      ...prev,
      tiles: prev.tiles.map((t) => (t.k === k ? { ...t, w } : t)),
    }));
  }, [applyConfigUpdate]);

  const moveWidget = useCallback((fromK: string, toK: string) => {
    if (fromK === toK) return;
    applyConfigUpdate((prev) => {
      const fromIdx = prev.tiles.findIndex((t) => t.k === fromK);
      const toIdx = prev.tiles.findIndex((t) => t.k === toK);
      if (fromIdx < 0 || toIdx < 0) {
        // audit-2026-05-07 (H-1214 c8) — surface the no-op so a keyboard
        // reorder or DnD against a key that drifted out of tiles (race
        // after a removal, stale closure) leaves a paper trail. The
        // visual no-op was previously SILENT — the WidgetChrome
        // aria-live region still announced "Moved X" because the
        // announce() call doesn't gate on outcome. Logging here makes
        // the divergence surfaceable in Sentry's capture-console and
        // unblocks a follow-up boolean-return refactor (caller-side
        // ARIA wiring is owned by AllocationDashboardV2 +
        // WidgetChrome — cross-file changes are scoped to a separate
        // PR).
        if (typeof console !== "undefined") {
          console.warn(
            "[useDashboardConfigV2] moveWidget: tile not found; reorder ignored",
            { fromK, toK, fromIdx, toIdx },
          );
        }
        return prev;
      }
      const next = prev.tiles.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...prev, tiles: next };
    });
  }, [applyConfigUpdate]);

  const setTimeframe = useCallback((tf: string) => {
    applyConfigUpdate((prev) => ({ ...prev, timeframe: tf }));
  }, [applyConfigUpdate]);

  const resetToDefaults = useCallback(() => {
    applyConfigUpdate(() => defaultV2Config());
  }, [applyConfigUpdate]);

  return {
    config,
    addWidget,
    removeWidget,
    resizeWidget,
    moveWidget,
    setTimeframe,
    resetToDefaults,
  };
}

// Suppress unused-import warning if a TileConfig consumer is not in this
// file but is re-exported via type usage above.
export type { TileConfig };
