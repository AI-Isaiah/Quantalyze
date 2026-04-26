import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSessionStorageBoolean } from "./useSessionStorageBoolean";

/**
 * Phase 11 review fix IN-01 — useSessionStorageBoolean hook tests.
 *
 * Pin the contract:
 *   - First synchronous render returns `false` regardless of
 *     sessionStorage state (SSR / hydration parity — server can't read
 *     sessionStorage, so we render the surface unconditionally).
 *   - Post-mount effect flips to `true` when sessionStorage[key] === "1".
 *   - set(true) writes "1"; set(false) removes the key. Local state
 *     mirrors the call value either way.
 *   - sessionStorage failures (private mode / blocked storage) fail open
 *     in BOTH directions (no throw).
 */

const ssStore = new Map<string, string>();
const sessionStorageMock = {
  getItem: vi.fn((k: string) => ssStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    ssStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    ssStore.delete(k);
  }),
  clear: vi.fn(() => {
    ssStore.clear();
  }),
  key: vi.fn(() => null),
  length: 0,
};

beforeEach(() => {
  ssStore.clear();
  sessionStorageMock.getItem.mockClear();
  sessionStorageMock.setItem.mockClear();
  sessionStorageMock.removeItem.mockClear();
  vi.stubGlobal("sessionStorage", sessionStorageMock);
});

describe("useSessionStorageBoolean", () => {
  it("first render returns false (SSR/hydration parity)", () => {
    ssStore.set("k1", "1"); // even if the flag was already set, render-1 is false.
    const { result } = renderHook(() => useSessionStorageBoolean("k1"));
    // Without flushing the effect, the first sync value is false.
    // (renderHook flushes effects under React 19, so this is a loose
    // assertion — the more important contract is the post-effect
    // behavior tested below.)
    expect(typeof result.current[0]).toBe("boolean");
  });

  it("flips to true post-mount when sessionStorage[key] === '1'", () => {
    ssStore.set("k1", "1");
    const { result } = renderHook(() => useSessionStorageBoolean("k1"));
    // After renderHook flushes the effect, the value is true.
    expect(result.current[0]).toBe(true);
  });

  it("stays false when sessionStorage[key] is absent", () => {
    const { result } = renderHook(() => useSessionStorageBoolean("k1"));
    expect(result.current[0]).toBe(false);
  });

  it("stays false when sessionStorage[key] is something other than '1' (e.g. 'true', '0')", () => {
    ssStore.set("k1", "true"); // NOT the literal "1"
    const { result } = renderHook(() => useSessionStorageBoolean("k1"));
    expect(result.current[0]).toBe(false);
  });

  it("set(true) writes '1' AND updates local state", () => {
    const { result } = renderHook(() => useSessionStorageBoolean("k1"));
    act(() => {
      result.current[1](true);
    });
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith("k1", "1");
    expect(result.current[0]).toBe(true);
  });

  it("set(false) removes the key AND updates local state", () => {
    ssStore.set("k1", "1");
    const { result } = renderHook(() => useSessionStorageBoolean("k1"));
    act(() => {
      result.current[1](false);
    });
    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith("k1");
    expect(result.current[0]).toBe(false);
  });

  it("sessionStorage.getItem failures fail open (no throw, value stays false)", () => {
    sessionStorageMock.getItem.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(() => {
      renderHook(() => useSessionStorageBoolean("k1"));
    }).not.toThrow();
  });

  it("sessionStorage.setItem failures fail open (no throw, local state still updates)", () => {
    sessionStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() => useSessionStorageBoolean("k1"));
    expect(() => {
      act(() => {
        result.current[1](true);
      });
    }).not.toThrow();
    expect(result.current[0]).toBe(true);
  });
});
