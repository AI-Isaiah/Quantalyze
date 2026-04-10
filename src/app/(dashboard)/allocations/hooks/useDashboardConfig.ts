"use client";

import { useState, useEffect, useCallback } from "react";
import type { DashboardConfig, TileConfig } from "../lib/types";
import { WIDGET_REGISTRY } from "../lib/widget-registry";
import { DEFAULT_LAYOUT } from "../lib/dashboard-defaults";

const STORAGE_KEY = "quantalyze-dashboard-config";

function loadConfig(): DashboardConfig {
  if (typeof window === "undefined") {
    return { tiles: DEFAULT_LAYOUT, timeframe: "YTD" };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DashboardConfig;
      if (Array.isArray(parsed.tiles) && parsed.tiles.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Corrupted data — fall back to defaults
  }
  return { tiles: DEFAULT_LAYOUT, timeframe: "YTD" };
}

function persist(config: DashboardConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/** Generate a unique tile instance ID for a given widget type. */
function generateTileId(widgetId: string, existingTiles: TileConfig[]): string {
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

/** Find the bottom-most y position across all tiles. */
function bottomY(tiles: TileConfig[]): number {
  if (tiles.length === 0) return 0;
  return Math.max(...tiles.map((t) => t.y + t.h));
}

export interface UseDashboardConfigReturn {
  config: DashboardConfig;
  addTile: (widgetId: string) => void;
  removeTile: (tileId: string) => TileConfig | null;
  updateLayout: (newLayout: Array<{ i: string; x: number; y: number; w: number; h: number }>) => void;
  updateTileConfig: (tileId: string, tileConfig: Record<string, unknown>) => void;
  restoreTile: (tile: TileConfig) => void;
  resetToDefault: () => void;
}

export function useDashboardConfig(): UseDashboardConfigReturn {
  const [config, setConfig] = useState<DashboardConfig>(loadConfig);

  // Persist to localStorage whenever config changes (skip initial mount)
  useEffect(() => {
    persist(config);
  }, [config]);

  const addTile = useCallback((widgetId: string) => {
    setConfig((prev) => {
      const meta = WIDGET_REGISTRY[widgetId];
      const w = meta?.defaultW ?? 6;
      const h = meta?.defaultH ?? 3;
      const newTile: TileConfig = {
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

  const removeTile = useCallback((tileId: string): TileConfig | null => {
    let removed: TileConfig | null = null;
    setConfig((prev) => {
      const idx = prev.tiles.findIndex((t) => t.i === tileId);
      if (idx === -1) return prev;
      removed = prev.tiles[idx];
      return { ...prev, tiles: prev.tiles.filter((t) => t.i !== tileId) };
    });
    return removed;
  }, []);

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

  const restoreTile = useCallback((tile: TileConfig) => {
    setConfig((prev) => {
      // Place at current bottom if its slot is now occupied
      const restoredTile = { ...tile, y: bottomY(prev.tiles) };
      return { ...prev, tiles: [...prev.tiles, restoredTile] };
    });
  }, []);

  const resetToDefault = useCallback(() => {
    setConfig({ tiles: DEFAULT_LAYOUT, timeframe: "YTD" });
  }, []);

  return { config, addTile, removeTile, updateLayout, updateTileConfig, restoreTile, resetToDefault };
}
