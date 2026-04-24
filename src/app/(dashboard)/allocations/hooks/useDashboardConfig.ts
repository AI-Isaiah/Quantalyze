"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  DashboardConfig,
  TileConfig,
  LegacyDashboardConfig,
  LegacyTileConfig,
} from "../lib/types";
import { WIDGET_REGISTRY } from "../lib/widget-registry";
import { DEFAULT_LAYOUT, LAYOUT_VERSION } from "../lib/dashboard-defaults";

/**
 * D-02 single-source-of-truth: BOTH legacy `useDashboardConfig` and the new
 * `useDashboardConfigV2` read/write the same localStorage key. The two hooks
 * coexist during the bake window: each `loadConfig` resets to its OWN default
 * layout when `parsed.layoutVersion` doesn't match what the hook expects
 * (Voice-D8 accepted precedent — same as Phase 05 1→2 and Phase 08 2→3
 * bumps). Flipping the `allocations.ui_v2` flag does not create orphan
 * parallel state — both bodies see the same persisted blob and the receiving
 * hook resets if it doesn't recognise the version.
 */
const STORAGE_KEY = "quantalyze-dashboard-config";

/**
 * Phase 09.1 D-02: the legacy hook's "what version it knows about". Hardcoded
 * here (not imported from dashboard-defaults.ts which now exports v4) so the
 * legacy body keeps resetting to legacy v3 defaults when it sees a v4 blob
 * left behind by V2. After the post-bake cleanup PR drops the legacy code
 * paths entirely, this constant + LEGACY_DEFAULT_LAYOUT both go away.
 */
const LAYOUT_VERSION_LEGACY = 3;

/**
 * Legacy v3 default layout — frozen snapshot of what `dashboard-defaults.ts`
 * exported before the v4 bump. Lives here so flag-off allocators landing on
 * the legacy hook after a V2 user has written `layoutVersion: 4` reset to
 * the same v3 defaults they'd have seen pre-09.1.
 */
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
  } catch {
    // Corrupted data — fall back to defaults.
  }
  return { tiles: LEGACY_DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION_LEGACY };
}

function persistLegacy(config: LegacyDashboardConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage full or unavailable — silently ignore.
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

  useEffect(() => {
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

function defaultV2Config(): DashboardConfig {
  return { tiles: DEFAULT_LAYOUT, timeframe: "YTD", layoutVersion: LAYOUT_VERSION };
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
        return defaultV2Config();
      }
      // Defensive: never let legacy-shape tiles into the V2 config.
      if (
        !Array.isArray(parsed.tiles) ||
        parsed.tiles.length === 0 ||
        parsed.tiles.some(looksLikeLegacyTile)
      ) {
        return defaultV2Config();
      }
      return parsed;
    }
  } catch {
    // Corrupted JSON — fall through to defaults.
  }
  return defaultV2Config();
}

function persistV2(config: DashboardConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Silent — private-mode / quota-exceeded are non-fatal.
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

export function useDashboardConfigV2(): UseDashboardConfigV2Return {
  const [config, setConfig] = useState<DashboardConfig>(loadV2Config);

  useEffect(() => {
    persistV2(config);
  }, [config]);

  const addWidget = useCallback((k: string) => {
    setConfig((prev) => {
      // D-03 idempotent add — designer-bundle/app.jsx:42-44.
      if (prev.tiles.some((t) => t.k === k)) return prev;
      const meta = WIDGET_REGISTRY[k];
      const w = clampWidth(meta?.defaultW);
      return { ...prev, tiles: [...prev.tiles, { k, w }] };
    });
  }, []);

  const removeWidget = useCallback((k: string) => {
    setConfig((prev) => ({
      ...prev,
      tiles: prev.tiles.filter((t) => t.k !== k),
    }));
  }, []);

  const resizeWidget = useCallback((k: string, w: 1 | 2 | 3 | 4) => {
    setConfig((prev) => ({
      ...prev,
      tiles: prev.tiles.map((t) => (t.k === k ? { ...t, w } : t)),
    }));
  }, []);

  const moveWidget = useCallback((fromK: string, toK: string) => {
    if (fromK === toK) return;
    setConfig((prev) => {
      const fromIdx = prev.tiles.findIndex((t) => t.k === fromK);
      const toIdx = prev.tiles.findIndex((t) => t.k === toK);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = prev.tiles.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...prev, tiles: next };
    });
  }, []);

  const setTimeframe = useCallback((tf: string) => {
    setConfig((prev) => ({ ...prev, timeframe: tf }));
  }, []);

  const resetToDefaults = useCallback(() => {
    setConfig(defaultV2Config());
  }, []);

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
