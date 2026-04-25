import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDashboardConfig, useDashboardConfigV2 } from "./useDashboardConfig";
import { DEFAULT_LAYOUT, LAYOUT_VERSION } from "../lib/dashboard-defaults";
import {
  DESIGNER_KEY_TO_WIDGET_ID,
  resolveWidgetId,
} from "../lib/widget-registry";

/**
 * Phase 09.1 Plan 05 / D-19 — write-time normalization.
 *
 * `useDashboardConfigV2` now resolves designer short keys ("bridge", "kpi",
 * "equity", ...) to WIDGET_REGISTRY ids ("bridge-outcome-banner", "kpi-strip",
 * "equity-curve", ...) before persisting. Every assertion below references
 * the canonical registry id; helper `keyOf(shortKey)` resolves on the fly so
 * the tests survive any future map updates.
 *
 * `expectedDefaultLayout` is the post-normalization shape of DEFAULT_LAYOUT
 * — what the hook actually puts in `config.tiles` when the persisted blob
 * is missing or version-mismatched.
 */
function keyOf(shortOrId: string): string {
  return resolveWidgetId(shortOrId);
}
const expectedDefaultLayout = DEFAULT_LAYOUT.map((t) => ({
  ...t,
  k: keyOf(t.k),
}));

// ---------------------------------------------------------------------------
// Mock localStorage (Phase 08 Plan 02 idiom — vi.stubGlobal is the reliable
// path under vitest 4.1.2; jsdom's built-in localStorage is unstable).
// ---------------------------------------------------------------------------

const store = new Map<string, string>();

const localStorageMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    store.delete(key);
  }),
  clear: vi.fn(() => {
    store.clear();
  }),
  get length() {
    return store.size;
  },
  key: vi.fn(() => null),
};

vi.stubGlobal("localStorage", localStorageMock);

const STORAGE_KEY = "quantalyze-dashboard-config";
const LEGACY_LAYOUT_VERSION = 3;

// ---------------------------------------------------------------------------
// LEGACY hook tests — useDashboardConfig
// ---------------------------------------------------------------------------
//
// The legacy hook is dormant post-v0.15.7.0 (no live callers — the V1
// AllocationDashboard root that consumed it was removed). Tests stay green
// until the follow-up legacy-tree cleanup PR deletes the hook itself. Both
// hooks read/write the SAME storage key (D-02), so the cross-hook reset
// behaviour stays asserted while the dormant code is on disk.

describe("useDashboardConfig (legacy)", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("initializes with the legacy v3 default layout when localStorage is empty", () => {
    const { result } = renderHook(() => useDashboardConfig());

    // Legacy default has 11 tiles (the Phase 08 Plan 03 frozen snapshot).
    expect(result.current.config.tiles.length).toBe(11);
    // Every tile carries the legacy {i, widgetId, x, y, w, h} shape.
    expect(result.current.config.tiles[0]).toHaveProperty("i");
    expect(result.current.config.tiles[0]).toHaveProperty("widgetId");
    expect(result.current.config.tiles[0]).toHaveProperty("x");
    expect(result.current.config.tiles[0]).toHaveProperty("y");
    expect(result.current.config.tiles[0]).toHaveProperty("h");
    expect(result.current.config.timeframe).toBe("YTD");
    expect(result.current.config.layoutVersion).toBe(LEGACY_LAYOUT_VERSION);
  });

  it("addTile appends a tile with the registry's defaultW/defaultH", () => {
    const { result } = renderHook(() => useDashboardConfig());
    const before = result.current.config.tiles.length;

    act(() => {
      result.current.addTile("rolling-sharpe");
    });

    const added = result.current.config.tiles.find((t) => t.widgetId === "rolling-sharpe");
    expect(added).toBeDefined();
    expect(added!.i).toBe("rolling-sharpe-1");
    expect(result.current.config.tiles.length).toBe(before + 1);
  });

  it("removeTile removes the tile and returns it synchronously", () => {
    const { result } = renderHook(() => useDashboardConfig());

    let removed: ReturnType<typeof result.current.removeTile> = null;
    act(() => {
      removed = result.current.removeTile("equity-curve-1");
    });

    expect(removed).not.toBeNull();
    expect(removed!.widgetId).toBe("equity-curve");
    expect(
      result.current.config.tiles.find((t) => t.i === "equity-curve-1"),
    ).toBeUndefined();
  });

  it("resetToDefault restores the legacy default layout", () => {
    const { result } = renderHook(() => useDashboardConfig());

    act(() => {
      result.current.addTile("tail-risk");
    });
    expect(result.current.config.tiles.length).toBe(12);

    act(() => {
      result.current.resetToDefault();
    });

    expect(result.current.config.tiles.length).toBe(11);
    expect(result.current.config.layoutVersion).toBe(LEGACY_LAYOUT_VERSION);
  });

  it("legacy hook resets to LEGACY_DEFAULT_LAYOUT when it sees a V2 layoutVersion (4)", () => {
    // Pre-populate the SHARED key with V2-shape state — Voice-D8 cross-hook
    // reset: the legacy hook doesn't recognise v4 so it resets to its own v3
    // defaults rather than partially consuming the foreign blob.
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        tiles: [
          { k: "bridge", w: 4 },
          { k: "kpi", w: 4 },
        ],
        timeframe: "1Y",
        layoutVersion: LAYOUT_VERSION, // 4
      }),
    );

    const { result } = renderHook(() => useDashboardConfig());

    expect(result.current.config.layoutVersion).toBe(LEGACY_LAYOUT_VERSION);
    expect(result.current.config.tiles.length).toBe(11);
    // Legacy shape — confirms the reset went all the way back to LEGACY_DEFAULT_LAYOUT.
    expect(result.current.config.tiles[0]).toHaveProperty("widgetId");
  });
});

// ---------------------------------------------------------------------------
// V2 hook tests — useDashboardConfigV2
// ---------------------------------------------------------------------------
//
// Every test here both reads from and writes to the SAME storage key
// `quantalyze-dashboard-config` (D-02 single source of truth). The single-key
// invariant (test 11) pins this contract at the assertion level.

describe("useDashboardConfigV2", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("v3 reset: legacy-shape persisted blob (layoutVersion: 3) → V2 loads v4 DEFAULT_LAYOUT (normalized)", () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        tiles: [{ i: "a", widgetId: "b", x: 0, y: 0, w: 12, h: 4 }],
        timeframe: "YTD",
        layoutVersion: 3,
      }),
    );

    const { result } = renderHook(() => useDashboardConfigV2());

    // D-19: tiles ship through resolveWidgetId at default-load time, so
    // every k is a WIDGET_REGISTRY id — never a designer short key.
    expect(result.current.config.tiles).toEqual(expectedDefaultLayout);
    expect(result.current.config.layoutVersion).toBe(LAYOUT_VERSION);
    expect(result.current.config.timeframe).toBe("YTD");
  });

  it("v4 preserve + normalize: persisted v4 blob with short-key tiles → V2 loads them with registry-id k", () => {
    // D-19 belt-and-braces: even if a partially-migrated blob lands in
    // localStorage with designer short keys, the read path normalizes them
    // to registry ids before render. Widths are preserved verbatim.
    const custom = {
      tiles: [
        { k: "bridge", w: 4 },
        { k: "kpi", w: 2 },
      ] as const,
      timeframe: "1M",
      layoutVersion: 4,
    };
    store.set(STORAGE_KEY, JSON.stringify(custom));

    const { result } = renderHook(() => useDashboardConfigV2());

    expect(result.current.config.tiles.length).toBe(2);
    expect(result.current.config.tiles[0].k).toBe(keyOf("bridge"));
    expect(result.current.config.tiles[0].w).toBe(4);
    expect(result.current.config.tiles[1].k).toBe(keyOf("kpi"));
    expect(result.current.config.tiles[1].w).toBe(2);
    expect(result.current.config.timeframe).toBe("1M");
  });

  it("addWidget is idempotent — calling addWidget(<bridge short key>) when the resolved registry id is already present is a no-op", () => {
    const { result } = renderHook(() => useDashboardConfigV2());
    const bridgeId = keyOf("bridge");
    const before = result.current.config.tiles.length;
    expect(result.current.config.tiles.some((t) => t.k === bridgeId)).toBe(true);

    act(() => {
      // Pass the designer short key — write-time normalization should
      // resolve it to bridgeId, find the existing tile, and no-op.
      result.current.addWidget("bridge");
    });

    expect(result.current.config.tiles.length).toBe(before);
    expect(
      result.current.config.tiles.filter((t) => t.k === bridgeId).length,
    ).toBe(1);
    // The designer short key MUST NOT leak into config.tiles — D-19.
    expect(result.current.config.tiles.some((t) => t.k === "bridge")).toBe(
      bridgeId === "bridge",
    );
  });

  it("addWidget appends a NEW widget with the registry-clamped default width", () => {
    const { result } = renderHook(() => useDashboardConfigV2());
    const before = result.current.config.tiles.length;

    act(() => {
      result.current.addWidget("correlation-matrix");
    });

    const added = result.current.config.tiles.find((t) => t.k === "correlation-matrix");
    expect(added).toBeDefined();
    // correlation-matrix has registry defaultW=4 → clamped to 4.
    expect(added!.w).toBe(4);
    expect(result.current.config.tiles.length).toBe(before + 1);
  });

  it("removeWidget filters the tile out by k (registry id)", () => {
    const { result } = renderHook(() => useDashboardConfigV2());
    const bridgeId = keyOf("bridge");
    expect(result.current.config.tiles.some((t) => t.k === bridgeId)).toBe(true);

    act(() => {
      // removeWidget takes the canonical registry id; tiles[*].k is
      // already normalized so no resolve step is required on this API.
      result.current.removeWidget(bridgeId);
    });

    expect(result.current.config.tiles.some((t) => t.k === bridgeId)).toBe(
      false,
    );
  });

  it("resizeWidget updates the tile's w in place (registry id)", () => {
    const { result } = renderHook(() => useDashboardConfigV2());
    const bridgeId = keyOf("bridge");

    act(() => {
      result.current.resizeWidget(bridgeId, 2);
    });

    const bridge = result.current.config.tiles.find((t) => t.k === bridgeId);
    expect(bridge).toBeDefined();
    expect(bridge!.w).toBe(2);
  });

  it("moveWidget reorders one tile to another tile's position via splice", () => {
    const { result } = renderHook(() => useDashboardConfigV2());

    // Default order is [bridge, kpi, equity, holdings, allocation, mandate,
    // outcomes] — all normalized to their registry ids on load (D-19).
    expect(result.current.config.tiles[0].k).toBe(keyOf("bridge"));
    expect(result.current.config.tiles[6].k).toBe(keyOf("outcomes"));

    act(() => {
      result.current.moveWidget(keyOf("outcomes"), keyOf("bridge"));
    });

    // outcomes moved into bridge's position (idx 0); bridge shifts right.
    expect(result.current.config.tiles[0].k).toBe(keyOf("outcomes"));
    expect(
      result.current.config.tiles.findIndex((t) => t.k === keyOf("bridge")),
    ).toBeGreaterThan(0);
  });

  it("malformed JSON: non-parseable blob → V2 loads DEFAULT_LAYOUT (normalized)", () => {
    store.set(STORAGE_KEY, "not-json");

    const { result } = renderHook(() => useDashboardConfigV2());

    expect(result.current.config.tiles).toEqual(expectedDefaultLayout);
    expect(result.current.config.layoutVersion).toBe(LAYOUT_VERSION);
  });

  it("SSR / private-mode safety: hook returns DEFAULT_LAYOUT when localStorage.getItem throws", () => {
    // The hook's loadV2Config wraps localStorage access in try/catch so
    // that SSR (no window), Safari private mode (quota errors), and any
    // other runtime where `localStorage` is hostile fall back to defaults
    // instead of throwing. We simulate the hostile environment by making
    // getItem throw on this test only — the cleanup in beforeEach + the
    // explicit restore at the end keep subsequent tests on the happy path.
    const original = localStorageMock.getItem;
    localStorageMock.getItem = vi.fn(() => {
      throw new Error("storage disabled");
    });

    let result: ReturnType<typeof renderHook<ReturnType<typeof useDashboardConfigV2>, unknown>>["result"];
    expect(() => {
      ({ result } = renderHook(() => useDashboardConfigV2()));
    }).not.toThrow();

    // Falls back to v4 defaults (post-D-19 normalization).
    expect(result!.current.config.tiles).toEqual(expectedDefaultLayout);
    expect(result!.current.config.layoutVersion).toBe(LAYOUT_VERSION);

    // Restore so subsequent tests see the normal mock.
    localStorageMock.getItem = original;
  });

  it("persist effect: addWidget writes the new config to localStorage[STORAGE_KEY]", () => {
    const { result } = renderHook(() => useDashboardConfigV2());

    act(() => {
      result.current.addWidget("correlation-matrix");
    });

    const stored = store.get(STORAGE_KEY);
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!);
    expect(parsed.tiles.some((t: { k: string }) => t.k === "correlation-matrix")).toBe(true);
    expect(parsed.layoutVersion).toBe(LAYOUT_VERSION);
  });

  it("single storage key invariant: V2 mutations NEVER write to a -v2 suffix key", () => {
    const { result } = renderHook(() => useDashboardConfigV2());

    act(() => {
      result.current.addWidget("correlation-matrix");
      result.current.removeWidget(keyOf("bridge"));
      result.current.resizeWidget(keyOf("kpi"), 2);
    });

    // The V2 state lives at the canonical key.
    expect(store.get(STORAGE_KEY)).toBeDefined();
    // No parallel suffix key is ever touched. We construct candidate keys
    // from STORAGE_KEY + suffix so the source file doesn't carry a literal
    // forbidden-key string (D-02 — single source of truth, no suffix split).
    for (const suffix of ["-v2", "-legacy", "-V2"]) {
      expect(store.get(`${STORAGE_KEY}${suffix}`)).toBeUndefined();
    }
  });

  it("legacy-shape leak guard: blob has layoutVersion 4 but tiles carry `i`/`widgetId` → V2 resets to defaults", () => {
    // Defensive belt-and-braces: even if a malicious / corrupted writer stamps
    // layoutVersion: 4 onto legacy-shape tiles, the V2 hook treats it as a
    // mismatch and resets — never let legacy tiles into the V2 config path.
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        tiles: [
          { i: "a", widgetId: "equity-curve", x: 0, y: 0, w: 12, h: 4 },
        ],
        timeframe: "YTD",
        layoutVersion: 4,
      }),
    );

    const { result } = renderHook(() => useDashboardConfigV2());

    expect(result.current.config.tiles).toEqual(expectedDefaultLayout);
  });

  it("setTimeframe updates the timeframe and persists", () => {
    const { result } = renderHook(() => useDashboardConfigV2());

    act(() => {
      result.current.setTimeframe("3M");
    });

    expect(result.current.config.timeframe).toBe("3M");
    const stored = JSON.parse(store.get(STORAGE_KEY)!);
    expect(stored.timeframe).toBe("3M");
  });

  it("resetToDefaults restores the v4 DEFAULT_LAYOUT (normalized)", () => {
    const { result } = renderHook(() => useDashboardConfigV2());

    act(() => {
      result.current.removeWidget(keyOf("bridge"));
      result.current.removeWidget(keyOf("kpi"));
    });
    expect(result.current.config.tiles.length).toBe(DEFAULT_LAYOUT.length - 2);

    act(() => {
      result.current.resetToDefaults();
    });

    expect(result.current.config.tiles).toEqual(expectedDefaultLayout);
    expect(result.current.config.layoutVersion).toBe(LAYOUT_VERSION);
    expect(result.current.config.timeframe).toBe("YTD");
  });

  it("D-19 write-time normalization: addWidget with a designer short key lands the registry id in tiles", () => {
    // Seed a minimal v4 blob so the V2 hook loads cleanly.
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        tiles: [{ k: "correlation-matrix", w: 2 }],
        timeframe: "YTD",
        layoutVersion: 4,
      }),
    );

    const { result } = renderHook(() => useDashboardConfigV2());

    // Find an unambiguous short key → registry id mapping. "allocation"
    // resolves to "allocation-donut" and neither is seeded, so the test
    // verifies that the short key is resolved before the tile is pushed.
    const shortKey = "allocation";
    const registryId = DESIGNER_KEY_TO_WIDGET_ID[shortKey];
    expect(registryId).toBe("allocation-donut");

    act(() => {
      result.current.addWidget(shortKey);
    });

    // The tile MUST land under the registry id, never the short key.
    expect(result.current.config.tiles.some((t) => t.k === registryId)).toBe(
      true,
    );
    expect(result.current.config.tiles.some((t) => t.k === shortKey)).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase A3 regression — observe-without-write on mount.
// ---------------------------------------------------------------------------
//
// Pre-fix: each hook persisted its in-memory state via useEffect on every
// render — including the very first render. So mounting the dormant hook
// against a foreign-version blob clobbered the persisted layout with the
// dormant hook's defaults, which would reset the user's customisations
// whenever the two hooks were mounted in alternation.
//
// Post-fix: the first persist is skipped. Loading is observational; only
// user-initiated setConfig calls write back. Mounting V2 → legacy → V2 → ...
// preserves whatever blob the authoritative hook wrote, plus any subsequent
// mutations.

describe("dual-hook ping-pong (Phase A3 regression)", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("V2 hook mounting against an existing v3 blob does NOT overwrite localStorage on mount", () => {
    const v3Blob = JSON.stringify({
      tiles: [{ i: "equity-curve-1", widgetId: "equity-curve", x: 0, y: 0, w: 12, h: 4 }],
      timeframe: "YTD",
      layoutVersion: 3,
    });
    store.set(STORAGE_KEY, v3Blob);

    const { unmount } = renderHook(() => useDashboardConfigV2());

    // The hook returns v4 defaults in-memory (existing reset-on-mismatch
    // contract — see "v3 reset" test above). But the persisted blob must
    // remain v3, so the legacy hook can read it back unchanged after a
    // toggle.
    expect(store.get(STORAGE_KEY)).toBe(v3Blob);
    unmount();
  });

  it("legacy hook mounting against an existing v4 blob does NOT overwrite localStorage on mount", () => {
    const v4Blob = JSON.stringify({
      tiles: [
        { k: keyOf("bridge"), w: 4 },
        { k: keyOf("kpi"), w: 2 },
      ],
      timeframe: "1M",
      layoutVersion: LAYOUT_VERSION,
    });
    store.set(STORAGE_KEY, v4Blob);

    const { unmount } = renderHook(() => useDashboardConfig());

    expect(store.get(STORAGE_KEY)).toBe(v4Blob);
    unmount();
  });

  it("toggling the flag 5x preserves the V2 blob the user customised", () => {
    // User on V2 customises layout → real persist call.
    const { result: v2, unmount: unmountV2 } = renderHook(() =>
      useDashboardConfigV2(),
    );
    act(() => {
      v2.current.addWidget("correlation-matrix");
    });
    const customisedBlob = store.get(STORAGE_KEY);
    expect(customisedBlob).toBeDefined();
    unmountV2();

    // Five toggle cycles: V1 mount → unmount → V2 mount → unmount → ...
    for (let i = 0; i < 5; i++) {
      const legacy = renderHook(() => useDashboardConfig());
      legacy.unmount();
      const v2Round = renderHook(() => useDashboardConfigV2());
      v2Round.unmount();
    }

    // The user's customised v4 blob is still in storage — neither hook
    // clobbered it on its observational mount.
    expect(store.get(STORAGE_KEY)).toBe(customisedBlob);

    // And remounting V2 yields the same customised tiles.
    const { result: final } = renderHook(() => useDashboardConfigV2());
    expect(
      final.current.config.tiles.some((t) => t.k === "correlation-matrix"),
    ).toBe(true);
  });
});
