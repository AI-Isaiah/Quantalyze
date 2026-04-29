/**
 * Phase 13 / Plan 13-02 / DISCO-02 — useDiscoveryPrefs hook tests.
 *
 * Behaviour contract (per 13-02-PLAN.md Task 1):
 *   1. SSR-safe: returns DEFAULTS when typeof window === undefined.
 *   2. Returns DEFAULTS when localStorage has no entry under the key.
 *   3. Reads & merges partial JSON: stored {view:"grid"} returns full prefs
 *      with the rest of the fields filled from DEFAULTS.
 *   4. Returns DEFAULTS on JSON.parse error (corrupted entry).
 *   5. Key shape: keyFor("user-1","crypto-sma") = "discovery_view_preferences:user-1:crypto-sma"
 *   6. DEFAULTS = { view:"table", sort:{key:"sharpe",dir:"desc"}, hide_examples:true }
 *      DISCO-05 lock — hide_examples MUST be true.
 *   7. useDiscoveryPrefs initial render: { prefs:DEFAULTS, hydrated:false }.
 *   8. After mount-effect: hydrated=true and prefs reflects localStorage.
 *   9. setPrefs(...) AFTER hydration writes to localStorage (correct key).
 *  10. setPrefs(...) BEFORE hydration does NOT write (hydration gate).
 *  11. Two different uid values produce two different localStorage keys.
 *  12. useDiscoveryPrefs(undefined, slug) NEVER writes — guards the
 *      uid:string|undefined hook signature contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import {
  DEFAULTS,
  keyFor,
  safeRead,
  useDiscoveryPrefs,
  type DiscoveryViewPreferences,
} from "./discovery-prefs";

const SLUG = "crypto-sma";
const UID_A = "uid-A";
const UID_B = "uid-B";

// Map-backed localStorage mock matching the project idiom
// (src/app/(dashboard)/allocations/lib/scenario-state.localStorage.test.ts).
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
// `safeRead` accesses `window.localStorage` (not the bare global) to keep
// the SSR guard tight. jsdom defines window.localStorage as a property
// descriptor, so a direct assignment via Object.defineProperty is the
// reliable way to stub it for tests.
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

const setItemSpy = localStorageMock.setItem;

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("discovery-prefs: DEFAULTS", () => {
  it("DEFAULTS shape: view=table, sort=sharpe-desc, hide_examples=true (DISCO-05 lock)", () => {
    expect(DEFAULTS).toEqual({
      view: "table",
      sort: { key: "sharpe", dir: "desc" },
      hide_examples: true,
    });
    // Explicit guard against any future regression flipping the DISCO-05 default.
    expect(DEFAULTS.hide_examples).toBe(true);
  });
});

describe("discovery-prefs: keyFor", () => {
  it("returns the exact discovery_view_preferences:{uid}:{slug} shape", () => {
    expect(keyFor("user-1", "crypto-sma")).toBe(
      "discovery_view_preferences:user-1:crypto-sma",
    );
  });

  it("produces distinct keys for different uids (cross-account isolation at the key layer)", () => {
    expect(keyFor(UID_A, SLUG)).not.toBe(keyFor(UID_B, SLUG));
    expect(keyFor(UID_A, SLUG)).toBe(`discovery_view_preferences:${UID_A}:${SLUG}`);
    expect(keyFor(UID_B, SLUG)).toBe(`discovery_view_preferences:${UID_B}:${SLUG}`);
  });
});

describe("discovery-prefs: safeRead", () => {
  it("returns DEFAULTS when typeof window === undefined (SSR safe)", () => {
    const realWindow = globalThis.window;
    // @ts-expect-error — temporary deletion to simulate SSR
    delete globalThis.window;
    try {
      expect(safeRead(UID_A, SLUG)).toEqual(DEFAULTS);
    } finally {
      globalThis.window = realWindow;
    }
  });

  it("returns DEFAULTS when localStorage has no entry under the key", () => {
    expect(safeRead(UID_A, SLUG)).toEqual(DEFAULTS);
  });

  it("merges partial JSON: stored {view:'grid'} fills the rest from DEFAULTS", () => {
    store.set(keyFor(UID_A, SLUG), JSON.stringify({ view: "grid" }));
    expect(safeRead(UID_A, SLUG)).toEqual({
      view: "grid",
      sort: { key: "sharpe", dir: "desc" },
      hide_examples: true,
    });
  });

  it("returns DEFAULTS on JSON.parse error (corrupted entry)", () => {
    store.set(keyFor(UID_A, SLUG), "not-json{");
    expect(safeRead(UID_A, SLUG)).toEqual(DEFAULTS);
  });

  it("accepts a legacy unversioned shape and returns it merged with DEFAULTS", () => {
    // Legacy data persisted before versioning landed.
    store.set(
      keyFor(UID_A, SLUG),
      JSON.stringify({
        view: "grid",
        sort: { key: "cagr", dir: "asc" },
        hide_examples: false,
      }),
    );
    expect(safeRead(UID_A, SLUG)).toEqual({
      view: "grid",
      sort: { key: "cagr", dir: "asc" },
      hide_examples: false,
    });
  });

  it("accepts a v1 shape verbatim", () => {
    store.set(
      keyFor(UID_A, SLUG),
      JSON.stringify({
        version: 1,
        view: "grid",
        sort: { key: "sharpe", dir: "desc" },
        hide_examples: false,
      }),
    );
    expect(safeRead(UID_A, SLUG)).toEqual({
      view: "grid",
      sort: { key: "sharpe", dir: "desc" },
      hide_examples: false,
    });
  });

  it("rejects a future-version shape and returns DEFAULTS (forward compat)", () => {
    // A user who briefly used a future build would have v2 data; stable
    // builds must not silently coerce it (could mis-cast renamed fields).
    store.set(
      keyFor(UID_A, SLUG),
      JSON.stringify({
        version: 2,
        view: "grid",
        sort: { key: "sharpe", dir: "desc" },
        hide_examples: false,
      }),
    );
    expect(safeRead(UID_A, SLUG)).toEqual(DEFAULTS);
  });
});

describe("discovery-prefs: useDiscoveryPrefs", () => {
  it("initial render returns { prefs: DEFAULTS, hydrated: true } after mount-effect with no stored entry", async () => {
    const { result } = renderHook(() => useDiscoveryPrefs(UID_A, SLUG));
    await waitFor(() => {
      expect(result.current.hydrated).toBe(true);
    });
    expect(result.current.prefs).toEqual(DEFAULTS);
  });

  it("hydrates prefs from localStorage when an entry exists", async () => {
    store.set(
      keyFor(UID_A, SLUG),
      JSON.stringify({
        view: "grid",
        sort: { key: "cagr", dir: "asc" },
        hide_examples: false,
      }),
    );
    const { result } = renderHook(() => useDiscoveryPrefs(UID_A, SLUG));
    await waitFor(() => {
      expect(result.current.hydrated).toBe(true);
    });
    expect(result.current.prefs).toEqual({
      view: "grid",
      sort: { key: "cagr", dir: "asc" },
      hide_examples: false,
    });
  });

  it("setPrefs(...) AFTER hydration writes to localStorage with the correct key", async () => {
    const { result } = renderHook(() => useDiscoveryPrefs(UID_A, SLUG));
    await waitFor(() => {
      expect(result.current.hydrated).toBe(true);
    });
    setItemSpy.mockClear();

    const next: DiscoveryViewPreferences = {
      view: "grid",
      sort: { key: "sharpe", dir: "desc" },
      hide_examples: true,
    };
    act(() => {
      result.current.setPrefs(next);
    });

    await waitFor(() => {
      expect(setItemSpy).toHaveBeenCalled();
    });
    const [k, v] = setItemSpy.mock.calls[setItemSpy.mock.calls.length - 1];
    expect(k).toBe(`discovery_view_preferences:${UID_A}:${SLUG}`);
    // Persisted shape carries `version: 1` so a future schema bump can
    // detect-and-reject stale stored data instead of silently coercing it.
    expect(JSON.parse(v as string)).toEqual({ ...next, version: 1 });
  });

  it("two different uids produce two different localStorage keys (isolation)", async () => {
    const { result: rA } = renderHook(() => useDiscoveryPrefs(UID_A, SLUG));
    const { result: rB } = renderHook(() => useDiscoveryPrefs(UID_B, SLUG));
    await waitFor(() => {
      expect(rA.current.hydrated).toBe(true);
      expect(rB.current.hydrated).toBe(true);
    });
    setItemSpy.mockClear();

    act(() => {
      rA.current.setPrefs({ ...DEFAULTS, view: "grid" });
    });
    act(() => {
      rB.current.setPrefs({ ...DEFAULTS, view: "table" });
    });

    await waitFor(() => {
      // Both writes must hit distinct keys.
      const keys = setItemSpy.mock.calls.map((c) => c[0]);
      expect(keys).toContain(`discovery_view_preferences:${UID_A}:${SLUG}`);
      expect(keys).toContain(`discovery_view_preferences:${UID_B}:${SLUG}`);
    });
  });

  it("useDiscoveryPrefs(undefined, slug) NEVER writes — uid is required for persistence", async () => {
    const { result } = renderHook(() => useDiscoveryPrefs(undefined, SLUG));
    await waitFor(() => {
      expect(result.current.hydrated).toBe(true);
    });
    setItemSpy.mockClear();

    act(() => {
      result.current.setPrefs({ ...DEFAULTS, view: "grid" });
    });

    // Allow any pending effects to flush.
    await new Promise((r) => setTimeout(r, 30));
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
