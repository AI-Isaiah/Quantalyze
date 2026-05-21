import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExcludedKeyIds } from "./useExcludedKeyIds";

/**
 * useExcludedKeyIds — per-allocator localStorage hook for per-API-key
 * include/exclude state on the Overview tab. Tests pin:
 *   - SSR-safe seed (empty set) before hydration
 *   - toggle / setExcluded / clear semantics
 *   - per-allocator scoping (allocator A's exclusions don't leak to B)
 *   - persistence + hydration round-trip
 *   - corrupt-JSON fallback
 *   - non-string entries dropped
 */

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => {
    lsStore.clear();
  }),
  key: vi.fn(() => null),
  length: 0,
};
vi.stubGlobal("localStorage", localStorageMock);

beforeEach(() => {
  lsStore.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
});

const ALLOCATOR_A = "11111111-1111-1111-1111-111111111111";
const ALLOCATOR_B = "22222222-2222-2222-2222-222222222222";
const KEY_X = "key-x";
const KEY_Y = "key-y";

describe("useExcludedKeyIds — defaults + toggle", () => {
  it("hydrates to an empty set when localStorage has no entry", () => {
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    expect(result.current.excluded.size).toBe(0);
    expect(result.current.isExcluded(KEY_X)).toBe(false);
  });

  it("toggle flips a key into / out of the excluded set and persists", () => {
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    act(() => {
      result.current.toggle(KEY_X);
    });
    expect(result.current.isExcluded(KEY_X)).toBe(true);
    expect(lsStore.get(`allocations.excludedKeyIds.${ALLOCATOR_A}`)).toBe(
      JSON.stringify([KEY_X]),
    );
    act(() => {
      result.current.toggle(KEY_X);
    });
    expect(result.current.isExcluded(KEY_X)).toBe(false);
    expect(lsStore.get(`allocations.excludedKeyIds.${ALLOCATOR_A}`)).toBe(
      JSON.stringify([]),
    );
  });

  it("setExcluded(false) on a non-member is a no-op (no re-render)", () => {
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    const before = result.current.excluded;
    act(() => {
      result.current.setExcluded(KEY_X, false);
    });
    // Hook returns the same Set instance when the change is a no-op so
    // memoized consumers don't re-render.
    expect(result.current.excluded).toBe(before);
  });

  it("clear resets the set", () => {
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    act(() => {
      result.current.toggle(KEY_X);
      result.current.toggle(KEY_Y);
    });
    expect(result.current.excluded.size).toBe(2);
    act(() => {
      result.current.clear();
    });
    expect(result.current.excluded.size).toBe(0);
  });
});

describe("useExcludedKeyIds — per-allocator scoping", () => {
  it("allocator A's exclusions don't bleed into allocator B's set", () => {
    lsStore.set(
      `allocations.excludedKeyIds.${ALLOCATOR_A}`,
      JSON.stringify([KEY_X]),
    );
    const { result: a } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    const { result: b } = renderHook(() => useExcludedKeyIds(ALLOCATOR_B));
    expect(a.current.isExcluded(KEY_X)).toBe(true);
    expect(b.current.isExcluded(KEY_X)).toBe(false);
  });

  it("hydrates from persisted state on mount", () => {
    lsStore.set(
      `allocations.excludedKeyIds.${ALLOCATOR_A}`,
      JSON.stringify([KEY_X, KEY_Y]),
    );
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    expect(result.current.isExcluded(KEY_X)).toBe(true);
    expect(result.current.isExcluded(KEY_Y)).toBe(true);
  });
});

describe("useExcludedKeyIds — corrupt input", () => {
  it("falls back to empty set on malformed JSON", () => {
    lsStore.set(`allocations.excludedKeyIds.${ALLOCATOR_A}`, "not-json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    expect(result.current.excluded.size).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops non-string entries from the persisted array", () => {
    lsStore.set(
      `allocations.excludedKeyIds.${ALLOCATOR_A}`,
      JSON.stringify([KEY_X, 42, null, "", KEY_Y]),
    );
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    expect(Array.from(result.current.excluded).sort()).toEqual(
      [KEY_X, KEY_Y].sort(),
    );
  });

  it("drops a non-array root", () => {
    lsStore.set(
      `allocations.excludedKeyIds.${ALLOCATOR_A}`,
      JSON.stringify({ "key-x": true }),
    );
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    expect(result.current.excluded.size).toBe(0);
  });
});

describe("useExcludedKeyIds — empty allocator id", () => {
  it("does NOT touch localStorage when allocatorId is empty", () => {
    const { result } = renderHook(() => useExcludedKeyIds(""));
    act(() => {
      result.current.toggle(KEY_X);
    });
    // The in-memory state updates so the UI doesn't appear frozen, but the
    // persist effect bails out — no `allocations.excludedKeyIds.` key
    // gets written (the prefix-only key is a footgun we explicitly avoid).
    expect(result.current.isExcluded(KEY_X)).toBe(true);
    expect(lsStore.has("allocations.excludedKeyIds.")).toBe(false);
  });
});
