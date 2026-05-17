import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  consumeDashboardRecoveryFlag,
  useDashboardConfig,
  useDashboardConfigV2,
} from "./useDashboardConfig";
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

const sessionStore = new Map<string, string>();
const sessionStorageMock = {
  getItem: vi.fn((key: string) => sessionStore.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    sessionStore.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    sessionStore.delete(key);
  }),
  clear: vi.fn(() => {
    sessionStore.clear();
  }),
  get length() {
    return sessionStore.size;
  },
  key: vi.fn(() => null),
};
vi.stubGlobal("sessionStorage", sessionStorageMock);

const STORAGE_KEY = "quantalyze-dashboard-config";
const RECOVERY_FLAG_KEY = "dashboard.config.recoveredFromCorruption";
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
      // Track LAYOUT_VERSION rather than hard-coding the literal: this
      // test asserts a matching-version blob is preserved verbatim, so any
      // future bump (PR1 5→6, etc.) keeps the assertion truthful.
      layoutVersion: LAYOUT_VERSION,
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
    // outcomes] — all normalized to their registry ids on load (D-19). PR1
    // restored mandate at index 5 and moved outcomes to index 6 (was 5
    // when mandate was dropped in v0.15.7.0).
    expect(result.current.config.tiles[0].k).toBe(keyOf("bridge"));
    expect(result.current.config.tiles.at(-1)?.k).toBe(keyOf("outcomes"));

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
    vi.useFakeTimers();
    try {
      const { result, unmount } = renderHook(() => useDashboardConfigV2());

      act(() => {
        result.current.addWidget("correlation-matrix");
      });
      // audit-2026-05-07 M-0126/M-0134 — persist now uses a trailing debounce
      // so the timer must be drained before the assertion. The unmount-flush
      // path ALSO drains the pending write; either advancing timers or
      // unmounting works. Advance first to assert the debounce window is the
      // happy path (drag-coalesce contract), then unmount.
      act(() => {
        vi.runAllTimers();
      });

      const stored = store.get(STORAGE_KEY);
      expect(stored).toBeDefined();
      const parsed = JSON.parse(stored!);
      expect(parsed.tiles.some((t: { k: string }) => t.k === "correlation-matrix")).toBe(true);
      expect(parsed.layoutVersion).toBe(LAYOUT_VERSION);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("single storage key invariant: V2 mutations NEVER write to a -v2 suffix key", () => {
    vi.useFakeTimers();
    try {
      const { result, unmount } = renderHook(() => useDashboardConfigV2());

      act(() => {
        result.current.addWidget("correlation-matrix");
        result.current.removeWidget(keyOf("bridge"));
        result.current.resizeWidget(keyOf("kpi"), 2);
      });
      act(() => {
        vi.runAllTimers();
      });

      // The V2 state lives at the canonical key.
      expect(store.get(STORAGE_KEY)).toBeDefined();
      // No parallel suffix key is ever touched. We construct candidate keys
      // from STORAGE_KEY + suffix so the source file doesn't carry a literal
      // forbidden-key string (D-02 — single source of truth, no suffix split).
      for (const suffix of ["-v2", "-legacy", "-V2"]) {
        expect(store.get(`${STORAGE_KEY}${suffix}`)).toBeUndefined();
      }
      unmount();
    } finally {
      vi.useRealTimers();
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
    vi.useFakeTimers();
    try {
      const { result, unmount } = renderHook(() => useDashboardConfigV2());

      act(() => {
        result.current.setTimeframe("3M");
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(result.current.config.timeframe).toBe("3M");
      const stored = JSON.parse(store.get(STORAGE_KEY)!);
      expect(stored.timeframe).toBe("3M");
      unmount();
    } finally {
      vi.useRealTimers();
    }
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
    // resolves to "allocation-by-style" (PR1 QA flipped this from
    // "allocation-donut"); neither is seeded so the test verifies the
    // short key is resolved before the tile is pushed.
    const shortKey = "allocation";
    const registryId = DESIGNER_KEY_TO_WIDGET_ID[shortKey];
    expect(registryId).toBe("allocation-by-style");

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
    vi.useFakeTimers();
    // User on V2 customises layout → real persist call (debounced; drain
    // via vi.runAllTimers before reading the persisted blob).
    const { result: v2, unmount: unmountV2 } = renderHook(() =>
      useDashboardConfigV2(),
    );
    act(() => {
      v2.current.addWidget("correlation-matrix");
    });
    act(() => {
      vi.runAllTimers();
    });
    const customisedBlob = store.get(STORAGE_KEY);
    expect(customisedBlob).toBeDefined();
    unmountV2();
    vi.useRealTimers();

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

// ---------------------------------------------------------------------------
// audit-2026-05-07 — silent-failure-hunter c10 regression coverage.
// ---------------------------------------------------------------------------
//
// loadV2Config / loadLegacyConfig / persistV2 / persistLegacy used to swallow
// every failure mode (corrupt JSON, Safari SecurityError, quota exceeded,
// schema-version mismatch) in bare `catch {}` blocks — no console.warn,
// no Sentry breadcrumb. C-0332..C-0335 (conf 10) flagged these as the
// single most painful silent-failure cluster in the dashboard. The fixes
// (a) console.warn on each catch and (b) set a sessionStorage recovery
// flag for the V2 load path that the dashboard can drain to surface a
// one-shot toast.

describe("audit-2026-05-07 — silent-failure-hunter c10 (recovery flag + console.warn)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store.clear();
    sessionStore.clear();
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("loadV2Config: corrupt JSON triggers console.warn AND sets the parse_failed recovery flag", () => {
    store.set(STORAGE_KEY, "{not-valid-json");

    renderHook(() => useDashboardConfigV2());

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("loadV2Config failed"),
      expect.any(Error),
    );
    expect(sessionStore.get(RECOVERY_FLAG_KEY)).toBe("parse_failed");
  });

  it("loadV2Config: layoutVersion drift sets version_reset recovery flag without console.warn (expected drift, not error)", () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        tiles: [{ k: "kpi-strip", w: 4 }],
        timeframe: "YTD",
        layoutVersion: 9999, // future version
      }),
    );

    renderHook(() => useDashboardConfigV2());

    // Drift is expected on version bumps — no console.warn, just the flag.
    expect(warnSpy).not.toHaveBeenCalled();
    expect(sessionStore.get(RECOVERY_FLAG_KEY)).toBe("version_reset");
  });

  it("loadV2Config: a v2 blob carrying legacy-shape tiles sets legacy_in_v2_blob recovery flag", () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        tiles: [
          // v4 shape mixed with v3 (legacy) shape — looksLikeLegacyTile trips
          { i: "equity-curve-1", widgetId: "equity-curve", x: 0, y: 0, w: 12, h: 4 },
        ],
        timeframe: "YTD",
        layoutVersion: LAYOUT_VERSION,
      }),
    );

    renderHook(() => useDashboardConfigV2());

    expect(sessionStore.get(RECOVERY_FLAG_KEY)).toBe("legacy_in_v2_blob");
  });

  it("loadV2Config: getItem throwing (Safari SecurityError-equivalent) console.warns and sets parse_failed flag", () => {
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new Error("SecurityError: storage disabled");
    });

    renderHook(() => useDashboardConfigV2());

    expect(warnSpy).toHaveBeenCalled();
    expect(sessionStore.get(RECOVERY_FLAG_KEY)).toBe("parse_failed");
  });

  it("persistV2: localStorage.setItem throwing QuotaExceededError surfaces a distinct quota message", () => {
    vi.useFakeTimers();
    try {
      localStorageMock.setItem.mockImplementationOnce(() => {
        const err = new DOMException(
          "quota",
          "QuotaExceededError",
        );
        throw err;
      });

      const { result, unmount } = renderHook(() => useDashboardConfigV2());
      act(() => {
        result.current.setTimeframe("1M");
      });
      // audit-2026-05-07 M-0126/M-0134 — drain the debounce timer to fire
      // the (failing) persist call so warnSpy can capture the quota message.
      act(() => {
        vi.runAllTimers();
      });

      expect(
        warnSpy.mock.calls.some(
          (c: unknown[]) =>
            typeof c[0] === "string" && c[0].includes("quota exceeded"),
        ),
      ).toBe(true);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("persistV2: a generic setItem failure uses the non-quota copy", () => {
    vi.useFakeTimers();
    try {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error("storage unavailable");
      });

      const { result, unmount } = renderHook(() => useDashboardConfigV2());
      act(() => {
        result.current.setTimeframe("1M");
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(
        warnSpy.mock.calls.some(
          (c: unknown[]) =>
            typeof c[0] === "string" &&
            c[0].includes("localStorage write failed") &&
            !c[0].includes("quota"),
        ),
      ).toBe(true);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loadLegacyConfig: corrupt JSON triggers console.warn (legacy hook parity with V2)", () => {
    store.set(STORAGE_KEY, "{bad");

    renderHook(() => useDashboardConfig());

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("loadLegacyConfig failed"),
      expect.any(Error),
    );
  });

  it("persistLegacy: setItem failure triggers console.warn", () => {
    localStorageMock.setItem.mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    const { result } = renderHook(() => useDashboardConfig());
    // Force a mutation so the persist effect actually fires after the
    // first observe-without-write pass.
    act(() => {
      result.current.addTile("rolling-sharpe");
    });
    act(() => {
      result.current.addTile("correlation-matrix");
    });

    expect(
      warnSpy.mock.calls.some(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes("[useDashboardConfig] localStorage write failed"),
      ),
    ).toBe(true);
  });

  it("consumeDashboardRecoveryFlag drains the flag exactly once", () => {
    sessionStore.set(RECOVERY_FLAG_KEY, "parse_failed");

    expect(consumeDashboardRecoveryFlag()).toBe("parse_failed");
    // Second call: flag was cleared on read.
    expect(consumeDashboardRecoveryFlag()).toBeNull();
  });

  it("consumeDashboardRecoveryFlag returns null when no flag is set", () => {
    expect(consumeDashboardRecoveryFlag()).toBeNull();
  });

  it("consumeDashboardRecoveryFlag ignores unrecognised values", () => {
    sessionStore.set(RECOVERY_FLAG_KEY, "not_a_known_reason");

    expect(consumeDashboardRecoveryFlag()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// audit-2026-05-07 — per-tile runtime validation
// (M-0130 / M-0127 / M-1076 / M-0131 c8-9)
// ---------------------------------------------------------------------------
//
// `JSON.parse(raw) as DashboardConfig` is a structural lie — only
// layoutVersion + Array.isArray(tiles) + looksLikeLegacyTile were checked
// before. A hand-edited / corrupted blob carrying `{k:42, w:'huge'}` or
// `{k:'kpi', w:NaN}` flowed straight into the CSS-grid render. The
// validator drops shape-invalid tiles and clamps `w` to 1..4 at the load
// boundary so the load and write paths converge on a single invariant.

describe("audit-2026-05-07 — per-tile validation on load", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store.clear();
    sessionStore.clear();
    vi.clearAllMocks();
    // Restore the default localStorage mock implementations — the prior
    // describe block (silent-failure-hunter) installs throw-on-setItem
    // implementations via mockImplementation that vi.clearAllMocks does
    // NOT reset (clearAllMocks only resets call history). Without this
    // reseat, every test below inherits a throwing setItem and the
    // debounced persist never lands its write.
    localStorageMock.setItem.mockImplementation((key: string, value: string) => {
      store.set(key, value);
    });
    localStorageMock.getItem.mockImplementation((key: string) => store.get(key) ?? null);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("drops tiles whose `k` is not a non-empty string, keeps salvageable tiles", () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        tiles: [
          { k: "correlation-matrix", w: 2 },
          { k: 42, w: 2 }, // non-string k → drop
          { k: "", w: 2 }, // empty k → drop
          { k: "kpi-strip", w: 4 },
        ],
        timeframe: "YTD",
        layoutVersion: LAYOUT_VERSION,
      }),
    );

    const { result } = renderHook(() => useDashboardConfigV2());

    expect(result.current.config.tiles.length).toBe(2);
    expect(
      result.current.config.tiles.every((t) => typeof t.k === "string" && t.k.length > 0),
    ).toBe(true);
    // The drop is surfaced via console.warn (regression-test guard for
    // M-0131 — silent-drop was a documented anti-pattern).
    expect(
      warnSpy.mock.calls.some(
        (c: unknown[]) =>
          typeof c[0] === "string" && c[0].includes("dropped malformed tile"),
      ),
    ).toBe(true);
  });

  it("clamps non-1|2|3|4 widths to a valid value at load time (M-1076)", () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        tiles: [
          { k: "correlation-matrix", w: 7 }, // out of range high → clamp to 4
          { k: "kpi-strip", w: -3 }, // out of range low → clamp to 1
          { k: "rolling-sharpe", w: "wide" }, // wrong type → clamp default 2
          { k: "tail-risk", w: Number.NaN }, // NaN → clamp default 2
        ],
        timeframe: "YTD",
        layoutVersion: LAYOUT_VERSION,
      }),
    );

    const { result } = renderHook(() => useDashboardConfigV2());

    // Every persisted w MUST be in {1,2,3,4} regardless of what the blob said.
    for (const t of result.current.config.tiles) {
      expect([1, 2, 3, 4]).toContain(t.w);
    }
    const byKey = new Map(result.current.config.tiles.map((t) => [t.k, t.w]));
    expect(byKey.get("correlation-matrix")).toBe(4);
    expect(byKey.get("kpi-strip")).toBe(1);
    // 'wide' / NaN both fall through to clampWidth's default branch (2).
    expect(byKey.get("rolling-sharpe")).toBe(2);
    expect(byKey.get("tail-risk")).toBe(2);
  });

  it("when every tile is unusable, resets to defaults AND sets the parse_failed recovery flag", () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        tiles: [
          { k: 1, w: 2 }, // numeric k
          { k: null, w: 2 }, // null k
          { notK: "missing", w: 2 }, // missing k entirely
        ],
        timeframe: "YTD",
        layoutVersion: LAYOUT_VERSION,
      }),
    );

    const { result } = renderHook(() => useDashboardConfigV2());

    // Falls back to DEFAULT_LAYOUT (normalized) and flags the recovery so
    // the dashboard can surface a one-time toast.
    expect(result.current.config.tiles).toEqual(expectedDefaultLayout);
    expect(sessionStore.get(RECOVERY_FLAG_KEY)).toBe("parse_failed");
  });

  it("drops a tile whose `config` is the wrong shape (array / scalar) but keeps the rest", () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        tiles: [
          { k: "correlation-matrix", w: 2, config: ["not", "an", "object"] },
          { k: "kpi-strip", w: 4, config: { foo: "bar" } },
        ],
        timeframe: "YTD",
        layoutVersion: LAYOUT_VERSION,
      }),
    );

    const { result } = renderHook(() => useDashboardConfigV2());

    expect(result.current.config.tiles.length).toBe(2);
    // The array-config is stripped; the object-config is preserved.
    const corr = result.current.config.tiles.find((t) => t.k === "correlation-matrix");
    const kpi = result.current.config.tiles.find((t) => t.k === "kpi-strip");
    expect(corr?.config).toBeUndefined();
    expect(kpi?.config).toEqual({ foo: "bar" });
  });

  it("debounce: 5 rapid resizeWidget calls coalesce into a single localStorage.setItem (M-0126/M-0134)", () => {
    vi.useFakeTimers();
    try {
      // Seed a known v4 blob so the hook loads cleanly and we can count
      // setItem calls AFTER the load path (which itself never writes).
      store.set(
        STORAGE_KEY,
        JSON.stringify({
          tiles: [{ k: "kpi-strip", w: 1 }],
          timeframe: "YTD",
          layoutVersion: LAYOUT_VERSION,
        }),
      );

      const { result, unmount } = renderHook(() => useDashboardConfigV2());
      localStorageMock.setItem.mockClear();

      // Simulate a resize-drag: pointermove fires onResize at 60Hz. Five
      // synchronous setConfig calls within one debounce window must produce
      // exactly one write, not five.
      act(() => {
        result.current.resizeWidget("kpi-strip", 2);
        result.current.resizeWidget("kpi-strip", 3);
        result.current.resizeWidget("kpi-strip", 4);
        result.current.resizeWidget("kpi-strip", 3);
        result.current.resizeWidget("kpi-strip", 2);
      });
      // Before the debounce drains: NO writes have hit localStorage yet.
      expect(localStorageMock.setItem).not.toHaveBeenCalled();

      act(() => {
        vi.runAllTimers();
      });

      // One write, carrying the LAST mutation's value (w=2).
      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
      const stored = JSON.parse(store.get(STORAGE_KEY)!);
      const kpi = stored.tiles.find((t: { k: string }) => t.k === "kpi-strip");
      expect(kpi.w).toBe(2);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("debounce: unmount before timer fires still flushes the pending write (M-0126/M-0134)", () => {
    vi.useFakeTimers();
    try {
      store.set(
        STORAGE_KEY,
        JSON.stringify({
          tiles: [{ k: "kpi-strip", w: 1 }],
          timeframe: "YTD",
          layoutVersion: LAYOUT_VERSION,
        }),
      );

      const { result, unmount } = renderHook(() => useDashboardConfigV2());
      localStorageMock.setItem.mockClear();

      act(() => {
        result.current.resizeWidget("kpi-strip", 3);
      });
      // Pending — debounce window has not elapsed.
      expect(localStorageMock.setItem).not.toHaveBeenCalled();

      // Tab close / route change before the timer fires: the cleanup
      // effect MUST flush the pending mutation so the user's resize is
      // not silently lost.
      unmount();

      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
      const stored = JSON.parse(store.get(STORAGE_KEY)!);
      const kpi = stored.tiles.find((t: { k: string }) => t.k === "kpi-strip");
      expect(kpi.w).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("coerces a non-string `timeframe` to the 'YTD' default at load time (M-0127)", () => {
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        tiles: [{ k: "kpi-strip", w: 4 }],
        timeframe: null, // non-string — was silently passed through pre-fix
        layoutVersion: LAYOUT_VERSION,
      }),
    );

    const { result } = renderHook(() => useDashboardConfigV2());

    expect(result.current.config.timeframe).toBe("YTD");
  });
});
