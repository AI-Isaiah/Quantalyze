import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useCrossTabStorage,
  consumeStorageRecoveryFlag,
  type StorageCodec,
  type DecodeOutcome,
} from "./cross-tab";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

/**
 * B7 cross-tab primitive spec — the generic mechanics extracted from the
 * useDashboardConfigV2 reference: hydration modes, debounced persist + final
 * flush, cross-tab sync (adopt-ok / ignore-reset / flush-before-adopt /
 * readonly-gate / no-op), and recovery-flag emission.
 */

const KEY = "allocations.crosstab-test";
const REC_KEY = "crosstab.recovered";

const lsStore = new Map<string, string>();
const ssStore = new Map<string, string>();
const mockStorage = (store: Map<string, string>) => ({
  getItem: vi.fn((k: string) => store.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => void store.set(k, v)),
  removeItem: vi.fn((k: string) => void store.delete(k)),
  clear: vi.fn(() => store.clear()),
  key: vi.fn(() => null),
  length: 0,
});
const localStorageMock = mockStorage(lsStore);
const sessionStorageMock = mockStorage(ssStore);
vi.stubGlobal("localStorage", localStorageMock);
vi.stubGlobal("sessionStorage", sessionStorageMock);
Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });
Object.defineProperty(window, "sessionStorage", { value: sessionStorageMock, configurable: true });

beforeEach(() => {
  lsStore.clear();
  ssStore.clear();
  for (const m of [localStorageMock, sessionStorageMock]) {
    m.getItem.mockClear();
    m.setItem.mockClear();
    m.removeItem.mockClear();
  }
});
afterEach(() => {
  vi.useRealTimers();
});

type Box = { v: string };

/** Test codec: value is `{v}`. A stored blob may carry `__outcome`/`__reason`
 *  markers so tests can drive the primitive's reset/readonly branches. */
const codec: StorageCodec<Box> = {
  decode(raw) {
    if (raw == null) return { value: { v: "default" }, outcome: "ok", reason: null };
    try {
      const p = JSON.parse(raw) as { v: string; __outcome?: DecodeOutcome; __reason?: string };
      if (p.__outcome && p.__outcome !== "ok") {
        return {
          value: p.__outcome === "readonly" ? { v: p.v } : { v: "default" },
          outcome: p.__outcome,
          reason: p.__reason ?? null,
        };
      }
      return { value: { v: p.v }, outcome: "ok", reason: null };
    } catch {
      return { value: { v: "default" }, outcome: "reset", reason: "parse_failed" };
    }
  },
  encode: (value) => JSON.stringify(value),
};

const opts = (over?: Partial<Parameters<typeof useCrossTabStorage<Box>>[0]>) => ({
  key: KEY,
  initial: { v: "default" } as Box,
  codec,
  recoveryKey: REC_KEY,
  ...over,
});

function fireStorage(key: string, newValue: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
  });
}

describe("useCrossTabStorage — hydration", () => {
  it("deferred (default): renders initial, then loads persisted post-mount", () => {
    lsStore.set(KEY, JSON.stringify({ v: "persisted" }));
    const { result } = renderHook(() => useCrossTabStorage(opts()));
    // Effects run inside renderHook's act, so the deferred load has completed.
    expect(result.current.value).toEqual({ v: "persisted" });
    expect(result.current.isHydrated).toBe(true);
  });

  it("lazy: reads localStorage synchronously at mount", () => {
    lsStore.set(KEY, JSON.stringify({ v: "persisted" }));
    const { result } = renderHook(() => useCrossTabStorage(opts({ hydration: "lazy" })));
    expect(result.current.value).toEqual({ v: "persisted" });
    expect(result.current.isHydrated).toBe(true);
  });

  it("empty storage hydrates to the initial value", () => {
    const { result } = renderHook(() => useCrossTabStorage(opts()));
    expect(result.current.value).toEqual({ v: "default" });
  });
});

describe("useCrossTabStorage — persist + debounce", () => {
  it("debounces writes and coalesces rapid mutations into one", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCrossTabStorage(opts({ debounceMs: 150 })));
    act(() => {
      result.current.setValue({ v: "a" });
      result.current.setValue({ v: "b" });
      result.current.setValue({ v: "c" });
    });
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(150));
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
    expect(lsStore.get(KEY)).toBe(JSON.stringify({ v: "c" }));
  });

  it("observe-without-write: mounting against a persisted blob does not rewrite it", () => {
    lsStore.set(KEY, JSON.stringify({ v: "persisted" }));
    renderHook(() => useCrossTabStorage(opts()));
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("debounceMs:0 writes synchronously inside the persist effect", () => {
    const { result } = renderHook(() => useCrossTabStorage(opts({ debounceMs: 0 })));
    act(() => result.current.setValue({ v: "now" }));
    expect(lsStore.get(KEY)).toBe(JSON.stringify({ v: "now" }));
  });
});

describe("useCrossTabStorage — final flush", () => {
  it("flushes a pending debounced write on beforeunload", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCrossTabStorage(opts({ debounceMs: 150 })));
    act(() => result.current.setValue({ v: "pending" }));
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    act(() => void window.dispatchEvent(new Event("beforeunload")));
    expect(lsStore.get(KEY)).toBe(JSON.stringify({ v: "pending" }));
  });

  it("flushes on pagehide (iOS Safari / bfcache)", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCrossTabStorage(opts({ debounceMs: 150 })));
    act(() => result.current.setValue({ v: "ph" }));
    act(() => void window.dispatchEvent(new Event("pagehide")));
    expect(lsStore.get(KEY)).toBe(JSON.stringify({ v: "ph" }));
  });

  it("flushes a pending write on unmount", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useCrossTabStorage(opts({ debounceMs: 150 })));
    act(() => result.current.setValue({ v: "onunmount" }));
    act(() => unmount());
    expect(lsStore.get(KEY)).toBe(JSON.stringify({ v: "onunmount" }));
  });
});

describe("useCrossTabStorage — cross-tab sync", () => {
  it("adopts a clean foreign write for the same key", () => {
    const { result } = renderHook(() => useCrossTabStorage(opts()));
    fireStorage(KEY, JSON.stringify({ v: "from-tab-b" }));
    expect(result.current.value).toEqual({ v: "from-tab-b" });
  });

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => useCrossTabStorage(opts()));
    fireStorage("some.other.key", JSON.stringify({ v: "nope" }));
    expect(result.current.value).toEqual({ v: "default" });
  });

  it("ignores a clear (newValue null)", () => {
    const { result } = renderHook(() => useCrossTabStorage(opts()));
    act(() => result.current.setValue({ v: "local" }));
    fireStorage(KEY, null);
    expect(result.current.value).toEqual({ v: "local" });
  });

  it("does NOT adopt a foreign blob that decodes as reset", () => {
    const { result } = renderHook(() => useCrossTabStorage(opts()));
    act(() => result.current.setValue({ v: "local" }));
    fireStorage(KEY, JSON.stringify({ v: "x", __outcome: "reset", __reason: "version_mismatch" }));
    expect(result.current.value).toEqual({ v: "local" });
  });

  it("does NOT adopt a foreign blob that decodes as readonly", () => {
    const { result } = renderHook(() => useCrossTabStorage(opts()));
    act(() => result.current.setValue({ v: "local" }));
    fireStorage(KEY, JSON.stringify({ v: "future", __outcome: "readonly" }));
    expect(result.current.value).toEqual({ v: "local" });
  });

  it("flush-before-adopt: a pending local write wins the race; foreign value is NOT adopted", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCrossTabStorage(opts({ debounceMs: 150 })));
    act(() => result.current.setValue({ v: "local-pending" }));
    // Foreign event arrives while our debounce timer is still armed.
    fireStorage(KEY, JSON.stringify({ v: "foreign" }));
    // Our pending write was flushed (now authoritative) and we did NOT adopt foreign.
    expect(lsStore.get(KEY)).toBe(JSON.stringify({ v: "local-pending" }));
    expect(result.current.value).toEqual({ v: "local-pending" });
  });

  it("a readOnly tab ignores cross-tab storage events entirely", () => {
    lsStore.set(KEY, JSON.stringify({ v: "newer", __outcome: "readonly" }));
    const { result } = renderHook(() => useCrossTabStorage(opts()));
    expect(result.current.readOnly).toBe(true);
    fireStorage(KEY, JSON.stringify({ v: "from-old-tab" }));
    expect(result.current.value).toEqual({ v: "newer" });
  });
});

describe("useCrossTabStorage — readOnly", () => {
  it("suppresses writes when a forward-compat blob is loaded", () => {
    vi.useFakeTimers();
    lsStore.set(KEY, JSON.stringify({ v: "newer", __outcome: "readonly" }));
    const { result } = renderHook(() => useCrossTabStorage(opts({ debounceMs: 150 })));
    expect(result.current.readOnly).toBe(true);
    act(() => result.current.setValue({ v: "attempt" }));
    act(() => void vi.advanceTimersByTime(150));
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(result.current.value).toEqual({ v: "newer" });
  });
});

describe("useCrossTabStorage — recovery flag", () => {
  it("emits a recovery breadcrumb on a reset decode (deferred)", () => {
    lsStore.set(KEY, "corrupt-json{");
    renderHook(() => useCrossTabStorage(opts()));
    expect(ssStore.get(REC_KEY)).toBe("parse_failed");
  });

  it("emits a recovery breadcrumb on a reset decode (lazy)", () => {
    lsStore.set(KEY, "corrupt-json{");
    renderHook(() => useCrossTabStorage(opts({ hydration: "lazy" })));
    expect(ssStore.get(REC_KEY)).toBe("parse_failed");
  });

  it("consumeStorageRecoveryFlag drains the breadcrumb exactly once", () => {
    ssStore.set(REC_KEY, "version_mismatch");
    expect(consumeStorageRecoveryFlag(REC_KEY)).toBe("version_mismatch");
    expect(consumeStorageRecoveryFlag(REC_KEY)).toBeNull();
  });

  it("does not emit a breadcrumb on a clean load", () => {
    lsStore.set(KEY, JSON.stringify({ v: "fine" }));
    renderHook(() => useCrossTabStorage(opts()));
    expect(ssStore.get(REC_KEY)).toBeUndefined();
  });
});

describe("useCrossTabStorage — disabled (scope id not ready)", () => {
  it("never reads or writes localStorage when enabled is false", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useCrossTabStorage(opts({ enabled: false, debounceMs: 150 })),
    );
    expect(result.current.isHydrated).toBe(true);
    expect(localStorageMock.getItem).not.toHaveBeenCalled();
    // In-memory mutation still works (UI doesn't appear frozen)...
    act(() => result.current.setValue({ v: "memory-only" }));
    expect(result.current.value).toEqual({ v: "memory-only" });
    // ...but nothing is persisted.
    act(() => void vi.advanceTimersByTime(150));
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("does not adopt cross-tab events when disabled", () => {
    const { result } = renderHook(() => useCrossTabStorage(opts({ enabled: false })));
    fireStorage(KEY, JSON.stringify({ v: "foreign" }));
    expect(result.current.value).toEqual({ v: "default" });
  });
});

describe("useCrossTabStorage — key change (per-allocator hot path)", () => {
  it("re-hydrates when the key prop changes", () => {
    lsStore.set("scoped.k1", JSON.stringify({ v: "a" }));
    lsStore.set("scoped.k2", JSON.stringify({ v: "b" }));
    const { result, rerender } = renderHook(
      ({ k }) => useCrossTabStorage(opts({ key: k })),
      { initialProps: { k: "scoped.k1" } },
    );
    expect(result.current.value).toEqual({ v: "a" });
    rerender({ k: "scoped.k2" });
    expect(result.current.value).toEqual({ v: "b" });
  });

  it("a pending debounced write lands on its ORIGINAL key after a key flip (no cross-scope corruption)", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ k }) => useCrossTabStorage(opts({ key: k, debounceMs: 150 })),
      { initialProps: { k: "scoped.kA" } },
    );
    act(() => result.current.setValue({ v: "edit-for-A" })); // schedules write for kA
    rerender({ k: "scoped.kB" }); // key flips + kB hydrates before the timer fires
    act(() => void vi.advanceTimersByTime(150));
    // The pending edit persists to kA (where it was made), NOT kB.
    expect(lsStore.get("scoped.kA")).toBe(JSON.stringify({ v: "edit-for-A" }));
    expect(lsStore.get("scoped.kB")).toBeUndefined();
  });
});

describe("useCrossTabStorage — no-op setValue (observe-without-rewrite)", () => {
  it("a no-op setValue does not stick dirtyRef → a later cross-tab adoption is not re-persisted", () => {
    vi.useFakeTimers();
    lsStore.set(KEY, JSON.stringify({ v: "init" }));
    const { result } = renderHook(() => useCrossTabStorage(opts({ debounceMs: 150 })));
    localStorageMock.setItem.mockClear();
    // No-op: the updater returns the same reference.
    act(() => result.current.setValue((prev) => prev));
    act(() => void vi.advanceTimersByTime(150));
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    // A cross-tab adoption now arrives; it must NOT trigger a re-persist
    // (which is exactly what a stuck dirtyRef from the no-op would cause).
    fireStorage(KEY, JSON.stringify({ v: "from-b" }));
    expect(result.current.value).toEqual({ v: "from-b" });
    act(() => void vi.advanceTimersByTime(150));
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });
});

describe("useCrossTabStorage — removeStored", () => {
  it("removes the key and resets in-memory without re-persisting", () => {
    vi.useFakeTimers();
    lsStore.set(KEY, JSON.stringify({ v: "persisted" }));
    const { result } = renderHook(() => useCrossTabStorage(opts({ debounceMs: 150 })));
    act(() => result.current.removeStored({ v: "default" }));
    expect(lsStore.has(KEY)).toBe(false);
    expect(result.current.value).toEqual({ v: "default" });
    // No rewrite of the just-removed key.
    act(() => void vi.advanceTimersByTime(150));
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });
});
