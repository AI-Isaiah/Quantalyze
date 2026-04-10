import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTimeframe, VALID_TIMEFRAMES } from "./useTimeframe";

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
    const { result } = renderHook(() => useTimeframe("YTD"));
    expect(result.current[0]).toBe("YTD");
  });

  it("uses a valid localStorage value", () => {
    store.set(STORAGE_KEY, "1MTD");
    const { result } = renderHook(() => useTimeframe("YTD"));
    expect(result.current[0]).toBe("1MTD");
  });

  it("defaults to initial when localStorage is empty", () => {
    const { result } = renderHook(() => useTimeframe("ALL"));
    expect(result.current[0]).toBe("ALL");
  });

  it("persists to localStorage on change", () => {
    const { result } = renderHook(() => useTimeframe("YTD"));

    act(() => {
      result.current[1]("3YTD");
    });

    expect(result.current[0]).toBe("3YTD");
    expect(store.get(STORAGE_KEY)).toBe("3YTD");
  });

  it("VALID_TIMEFRAMES contains all TimeframeSelector keys", () => {
    const expected = ["1DTD", "1WTD", "1MTD", "1QTD", "1YTD", "3YTD", "ALL"];
    for (const key of expected) {
      expect(VALID_TIMEFRAMES.has(key)).toBe(true);
    }
  });
});
