import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTimeframe } from "./useTimeframe";

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

const STORAGE_KEY = "quantalyze-timeframe";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTimeframe", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("falls back to default when localStorage has an invalid value", () => {
    store.set(STORAGE_KEY, "INVALID_TIMEFRAME");
    const { result } = renderHook(() => useTimeframe("1YTD"));
    expect(result.current[0]).toBe("1YTD");
  });

  it("uses a valid localStorage value", () => {
    store.set(STORAGE_KEY, "1MTD");
    const { result } = renderHook(() => useTimeframe("1YTD"));
    expect(result.current[0]).toBe("1MTD");
  });

  it("defaults to initial when localStorage is empty", () => {
    const { result } = renderHook(() => useTimeframe("ALL"));
    expect(result.current[0]).toBe("ALL");
  });

  it("persists to localStorage on change", () => {
    const { result } = renderHook(() => useTimeframe("1YTD"));

    act(() => {
      result.current[1]("3YTD");
    });

    expect(result.current[0]).toBe("3YTD");
    expect(store.get(STORAGE_KEY)).toBe("3YTD");
  });

  // audit-2026-05-07 H-0147 + M-1093 — pre-narrowing the hook returned
  // `string`, so older builds persisted the LABEL "YTD" rather than the
  // canonical key "1YTD". On read the hook now normalises legacy values to
  // their canonical key so the returned union stays sound.
  it("normalises the legacy 'YTD' label in localStorage to '1YTD'", () => {
    store.set(STORAGE_KEY, "YTD");
    const { result } = renderHook(() => useTimeframe("ALL"));
    expect(result.current[0]).toBe("1YTD");
  });
});
