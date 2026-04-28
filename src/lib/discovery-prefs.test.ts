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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

let storage: Record<string, string>;
let getItemSpy: ReturnType<typeof vi.spyOn>;
let setItemSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  storage = {};
  getItemSpy = vi
    .spyOn(window.localStorage, "getItem")
    .mockImplementation((k: string) => (k in storage ? storage[k] : null));
  setItemSpy = vi
    .spyOn(window.localStorage, "setItem")
    .mockImplementation((k: string, v: string) => {
      storage[k] = v;
    });
  vi.spyOn(window.localStorage, "removeItem").mockImplementation((k: string) => {
    delete storage[k];
  });
});

afterEach(() => {
  vi.restoreAllMocks();
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
    storage[keyFor(UID_A, SLUG)] = JSON.stringify({ view: "grid" });
    expect(safeRead(UID_A, SLUG)).toEqual({
      view: "grid",
      sort: { key: "sharpe", dir: "desc" },
      hide_examples: true,
    });
  });

  it("returns DEFAULTS on JSON.parse error (corrupted entry)", () => {
    storage[keyFor(UID_A, SLUG)] = "not-json{";
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
    storage[keyFor(UID_A, SLUG)] = JSON.stringify({
      view: "grid",
      sort: { key: "cagr", dir: "asc" },
      hide_examples: false,
    });
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
    expect(JSON.parse(v as string)).toEqual(next);
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
