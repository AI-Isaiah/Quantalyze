import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isWidgetStateV2Enabled,
  WIDGET_STATE_V2_STORAGE_KEY,
} from "./widget-state-flag";

/**
 * Phase 11 / Plan 04 / RISK-1 — Unit tests for the widget_state_v2
 * feature-flag reader. Default is OFF (the inverted form of the
 * existing allocations.ui_v2 precedent), and a URL override of
 * `?widget_state=v2` forces ON for ad-hoc QA — mirroring the
 * `?ui=v2` precedent on AllocationDashboardV2.
 *
 * Module-level Map-backed localStorage stub matches the project idiom
 * established by `src/app/(dashboard)/allocations/lib/scenario-state.localStorage.test.ts`.
 */

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

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("isWidgetStateV2Enabled (RISK-1 feature-flag reader)", () => {
  it("Test 10: empty localStorage + empty search → false (default OFF — RISK-1)", () => {
    expect(isWidgetStateV2Enabled({ search: "" })).toBe(false);
  });

  it("Test 11: localStorage='true' + empty search → true", () => {
    localStorage.setItem(WIDGET_STATE_V2_STORAGE_KEY, "true");
    expect(isWidgetStateV2Enabled({ search: "" })).toBe(true);
  });

  it("Test 12: localStorage='false' + empty search → false", () => {
    localStorage.setItem(WIDGET_STATE_V2_STORAGE_KEY, "false");
    expect(isWidgetStateV2Enabled({ search: "" })).toBe(false);
  });

  it("Test 13: localStorage missing + search='?widget_state=v2' → true (URL override forces ON)", () => {
    expect(isWidgetStateV2Enabled({ search: "?widget_state=v2" })).toBe(true);
  });

  it("Test 14: localStorage='true' + search='?widget_state=off' → false (URL override can also force OFF)", () => {
    localStorage.setItem(WIDGET_STATE_V2_STORAGE_KEY, "true");
    expect(isWidgetStateV2Enabled({ search: "?widget_state=off" })).toBe(false);
  });

  it("Test 15: server-side (no window) → false (SSR-safe default)", () => {
    // Stash + remove globalThis.window to simulate SSR. Restore in finally
    // so subsequent tests still have access to jsdom's window.
    const stash = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(isWidgetStateV2Enabled({ search: "" })).toBe(false);
    } finally {
      (globalThis as { window?: unknown }).window = stash;
    }
  });
});
