import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExcludedKeyIds } from "./useExcludedKeyIds";
import { captureToSentry } from "@/lib/sentry-capture";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

/**
 * useExcludedKeyIds — per-allocator excluded-key state, B7-migrated onto the
 * useCrossTabStorage primitive. Tests pin:
 *   - SSR-safe seed (empty set) before hydration
 *   - toggle / setExcluded / clear semantics (versioned persisted shape)
 *   - per-allocator scoping
 *   - read-old-write-new migration of pre-B7 bare-array blobs
 *   - corrupt-JSON fallback emits a Sentry breadcrumb (fail-loud)
 *   - NEW-C26-01: cross-tab sync (a second tab no longer soft-locks this one)
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
Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });

beforeEach(() => {
  lsStore.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  vi.mocked(captureToSentry).mockClear();
});

const ALLOCATOR_A = "11111111-1111-1111-1111-111111111111";
const ALLOCATOR_B = "22222222-2222-2222-2222-222222222222";
const KEY_X = "key-x";
const KEY_Y = "key-y";
const keyFor = (id: string) => `allocations.excludedKeyIds.${id}`;
const versioned = (ids: string[]) => JSON.stringify({ ids, version: 1 });

describe("useExcludedKeyIds — defaults + toggle", () => {
  it("hydrates to an empty set when localStorage has no entry", () => {
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    expect(result.current.excluded.size).toBe(0);
    expect(result.current.isExcluded(KEY_X)).toBe(false);
  });

  it("toggle flips a key into / out of the excluded set and persists (versioned shape)", () => {
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    act(() => {
      result.current.toggle(KEY_X);
    });
    expect(result.current.isExcluded(KEY_X)).toBe(true);
    expect(lsStore.get(keyFor(ALLOCATOR_A))).toBe(versioned([KEY_X]));
    act(() => {
      result.current.toggle(KEY_X);
    });
    expect(result.current.isExcluded(KEY_X)).toBe(false);
    expect(lsStore.get(keyFor(ALLOCATOR_A))).toBe(versioned([]));
  });

  it("setExcluded(false) on a non-member is a no-op (stable Set identity)", () => {
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    const before = result.current.excluded;
    act(() => {
      result.current.setExcluded(KEY_X, false);
    });
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

describe("useExcludedKeyIds — per-allocator scoping + legacy migration", () => {
  it("allocator A's exclusions don't bleed into allocator B's set", () => {
    lsStore.set(keyFor(ALLOCATOR_A), versioned([KEY_X]));
    const { result: a } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    const { result: b } = renderHook(() => useExcludedKeyIds(ALLOCATOR_B));
    expect(a.current.isExcluded(KEY_X)).toBe(true);
    expect(b.current.isExcluded(KEY_X)).toBe(false);
  });

  it("read-old: migrates a pre-B7 bare-array blob, dropping non-string entries", () => {
    // Pre-B7 shape: a bare JSON array with no version field.
    lsStore.set(
      keyFor(ALLOCATOR_A),
      JSON.stringify([KEY_X, 42, null, "", KEY_Y]),
    );
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    expect(Array.from(result.current.excluded).sort()).toEqual([KEY_X, KEY_Y].sort());
  });

  it("hydrates from a versioned blob on mount", () => {
    lsStore.set(keyFor(ALLOCATOR_A), versioned([KEY_X, KEY_Y]));
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    expect(result.current.isExcluded(KEY_X)).toBe(true);
    expect(result.current.isExcluded(KEY_Y)).toBe(true);
  });
});

describe("useExcludedKeyIds — corrupt input (fail-loud)", () => {
  it("falls back to an empty set on malformed JSON and emits a Sentry breadcrumb", () => {
    lsStore.set(keyFor(ALLOCATOR_A), "not-json{");
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    expect(result.current.excluded.size).toBe(0);
    // Not a silent reset — the primitive captures a parse_failed breadcrumb.
    expect(captureToSentry).toHaveBeenCalled();
  });

  it("drops a non-array, non-object root and returns empty", () => {
    lsStore.set(keyFor(ALLOCATOR_A), JSON.stringify(42));
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    expect(result.current.excluded.size).toBe(0);
  });

  it("B7A1-01: a v1 blob with one malformed element keeps the VALID entries (no whole-set wipe)", () => {
    // Regression: a whole-array `.catch([])` would silently drop the entire
    // set on a single bad element. Per-element filtering keeps the good ones.
    lsStore.set(
      keyFor(ALLOCATOR_A),
      JSON.stringify({ version: 1, ids: [KEY_X, 42, "", null, KEY_Y] }),
    );
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    expect(Array.from(result.current.excluded).sort()).toEqual([KEY_X, KEY_Y].sort());
  });
});

describe("useExcludedKeyIds — empty allocator id", () => {
  it("does NOT touch localStorage when allocatorId is empty", () => {
    const { result } = renderHook(() => useExcludedKeyIds(""));
    act(() => {
      result.current.toggle(KEY_X);
    });
    // In-memory state updates so the UI isn't frozen, but no prefix-only key
    // gets written.
    expect(result.current.isExcluded(KEY_X)).toBe(true);
    expect(lsStore.has("allocations.excludedKeyIds.")).toBe(false);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });
});

describe("useExcludedKeyIds — NEW-C26-01 cross-tab sync", () => {
  it("adopts a second tab's write instead of silently clobbering it", () => {
    const key = keyFor(ALLOCATOR_A);
    const { result } = renderHook(() => useExcludedKeyIds(ALLOCATOR_A));
    // This tab excludes X.
    act(() => result.current.toggle(KEY_X));
    expect(result.current.isExcluded(KEY_X)).toBe(true);
    // Tab B excludes Y instead and persists; a storage event reaches this tab.
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue: versioned([KEY_Y]) }),
      );
    });
    // Pre-B7: this tab kept {X} in memory and would overwrite Tab B's {Y} on
    // its next write (the soft-lock). Now it adopts {Y}.
    expect(result.current.isExcluded(KEY_Y)).toBe(true);
    expect(result.current.isExcluded(KEY_X)).toBe(false);
  });
});
