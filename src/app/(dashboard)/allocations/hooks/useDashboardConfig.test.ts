import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDashboardConfig } from "./useDashboardConfig";
import { DEFAULT_LAYOUT } from "../lib/dashboard-defaults";

// ---------------------------------------------------------------------------
// Mock localStorage
// ---------------------------------------------------------------------------

const store = new Map<string, string>();

const localStorageMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
  removeItem: vi.fn((key: string) => { store.delete(key); }),
  clear: vi.fn(() => { store.clear(); }),
  get length() { return store.size; },
  key: vi.fn(() => null),
};

vi.stubGlobal("localStorage", localStorageMock);

const STORAGE_KEY = "quantalyze-dashboard-config";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useDashboardConfig", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("initializes with defaults when localStorage is empty", () => {
    const { result } = renderHook(() => useDashboardConfig());

    expect(result.current.config.tiles).toEqual(DEFAULT_LAYOUT);
    expect(result.current.config.timeframe).toBe("YTD");
  });

  it("addTile adds a tile with correct widgetId", () => {
    const { result } = renderHook(() => useDashboardConfig());

    act(() => {
      result.current.addTile("rolling-sharpe");
    });

    const added = result.current.config.tiles.find(
      (t) => t.widgetId === "rolling-sharpe",
    );
    expect(added).toBeDefined();
    expect(added!.i).toBe("rolling-sharpe-1");
    expect(added!.w).toBe(6); // defaultW for rolling-sharpe
    expect(added!.h).toBe(3); // defaultH for rolling-sharpe
    expect(result.current.config.tiles.length).toBe(DEFAULT_LAYOUT.length + 1);
  });

  it("removeTile removes and returns the tile", () => {
    const { result } = renderHook(() => useDashboardConfig());

    let removed: ReturnType<typeof result.current.removeTile> = null;
    act(() => {
      removed = result.current.removeTile("equity-curve-1");
    });

    expect(removed).not.toBeNull();
    expect(removed!.i).toBe("equity-curve-1");
    expect(removed!.widgetId).toBe("equity-curve");
    expect(
      result.current.config.tiles.find((t) => t.i === "equity-curve-1"),
    ).toBeUndefined();
    expect(result.current.config.tiles.length).toBe(DEFAULT_LAYOUT.length - 1);
  });

  it("removeTile returns null for non-existent tile", () => {
    const { result } = renderHook(() => useDashboardConfig());

    let removed: ReturnType<typeof result.current.removeTile> = null;
    act(() => {
      removed = result.current.removeTile("does-not-exist");
    });

    expect(removed).toBeNull();
    expect(result.current.config.tiles.length).toBe(DEFAULT_LAYOUT.length);
  });

  it("restoreTile restores a removed tile", () => {
    const { result } = renderHook(() => useDashboardConfig());

    let removed: ReturnType<typeof result.current.removeTile> = null;
    act(() => {
      removed = result.current.removeTile("equity-curve-1");
    });
    expect(removed).not.toBeNull();

    act(() => {
      result.current.restoreTile(removed!);
    });

    const restored = result.current.config.tiles.find(
      (t) => t.i === "equity-curve-1",
    );
    expect(restored).toBeDefined();
    expect(restored!.widgetId).toBe("equity-curve");
    expect(result.current.config.tiles.length).toBe(DEFAULT_LAYOUT.length);
  });

  it("resetToDefault restores defaults", () => {
    const { result } = renderHook(() => useDashboardConfig());

    // Mutate: add two tiles so length differs from default
    act(() => {
      result.current.addTile("tail-risk");
      result.current.addTile("rolling-sharpe");
    });
    expect(result.current.config.tiles.length).toBe(DEFAULT_LAYOUT.length + 2);

    // Reset
    act(() => {
      result.current.resetToDefault();
    });

    expect(result.current.config.tiles).toEqual(DEFAULT_LAYOUT);
    expect(result.current.config.timeframe).toBe("YTD");
  });

  it("persists to localStorage on change", () => {
    const { result } = renderHook(() => useDashboardConfig());

    act(() => {
      result.current.addTile("tail-risk");
    });

    // The useEffect should have persisted
    const stored = store.get(STORAGE_KEY);
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!);
    expect(parsed.tiles.length).toBe(DEFAULT_LAYOUT.length + 1);
    expect(
      parsed.tiles.find((t: { widgetId: string }) => t.widgetId === "tail-risk"),
    ).toBeDefined();
  });

  it("loads persisted config from localStorage", () => {
    const custom = {
      tiles: [{ i: "custom-1", widgetId: "tail-risk", x: 0, y: 0, w: 4, h: 3 }],
      timeframe: "1M",
    };
    store.set(STORAGE_KEY, JSON.stringify(custom));

    const { result } = renderHook(() => useDashboardConfig());

    expect(result.current.config.tiles.length).toBe(1);
    expect(result.current.config.tiles[0].widgetId).toBe("tail-risk");
    expect(result.current.config.timeframe).toBe("1M");
  });

  it("updateLayout syncs positions from react-grid-layout", () => {
    const { result } = renderHook(() => useDashboardConfig());

    act(() => {
      result.current.updateLayout([
        { i: "equity-curve-1", x: 0, y: 0, w: 6, h: 3 },
        { i: "drawdown-chart-1", x: 6, y: 0, w: 6, h: 3 },
      ]);
    });

    const eq = result.current.config.tiles.find((t) => t.i === "equity-curve-1");
    expect(eq!.w).toBe(6);
    expect(eq!.h).toBe(3);

    const dd = result.current.config.tiles.find((t) => t.i === "drawdown-chart-1");
    expect(dd!.x).toBe(6);
    expect(dd!.y).toBe(0);
  });

  it("removeTile returns the removed tile synchronously (not null)", () => {
    // Regression: old implementation assigned `removed` inside the setConfig
    // updater callback, which runs asynchronously. The fix reads from
    // config.tiles before calling setConfig.
    const { result } = renderHook(() => useDashboardConfig());

    // Call removeTile and capture the return value in the same act()
    let removed: ReturnType<typeof result.current.removeTile> = null;
    act(() => {
      removed = result.current.removeTile("equity-curve-1");
    });

    // Must be non-null and contain the correct tile data
    expect(removed).not.toBeNull();
    expect(removed!.i).toBe("equity-curve-1");
    expect(removed!.widgetId).toBe("equity-curve");

    // The tile must actually be removed from config
    expect(
      result.current.config.tiles.find((t) => t.i === "equity-curve-1"),
    ).toBeUndefined();
  });

  it("updateTileConfig merges config into a tile", () => {
    const { result } = renderHook(() => useDashboardConfig());

    act(() => {
      result.current.updateTileConfig("equity-curve-1", { showBenchmark: true });
    });

    const tile = result.current.config.tiles.find((t) => t.i === "equity-curve-1");
    expect(tile!.config).toEqual({ showBenchmark: true });

    // Merge second key
    act(() => {
      result.current.updateTileConfig("equity-curve-1", { logScale: false });
    });

    const tile2 = result.current.config.tiles.find((t) => t.i === "equity-curve-1");
    expect(tile2!.config).toEqual({ showBenchmark: true, logScale: false });
  });
});
