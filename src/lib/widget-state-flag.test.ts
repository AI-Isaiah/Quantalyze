import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
 * The reader takes an explicit `search` argument so tests don't have
 * to plumb through window.location.search. In production the caller
 * passes `window.location.search` (or omits the option, in which
 * case the function reads from window.location.search itself).
 */
describe("isWidgetStateV2Enabled (RISK-1 feature-flag reader)", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(WIDGET_STATE_V2_STORAGE_KEY);
    }
  });

  afterEach(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(WIDGET_STATE_V2_STORAGE_KEY);
    }
  });

  it("Test 10: empty localStorage + empty search → false (default OFF — RISK-1)", () => {
    expect(isWidgetStateV2Enabled({ search: "" })).toBe(false);
  });

  it("Test 11: localStorage='true' + empty search → true", () => {
    window.localStorage.setItem(WIDGET_STATE_V2_STORAGE_KEY, "true");
    expect(isWidgetStateV2Enabled({ search: "" })).toBe(true);
  });

  it("Test 12: localStorage='false' + empty search → false", () => {
    window.localStorage.setItem(WIDGET_STATE_V2_STORAGE_KEY, "false");
    expect(isWidgetStateV2Enabled({ search: "" })).toBe(false);
  });

  it("Test 13: localStorage missing + search='?widget_state=v2' → true (URL override forces ON)", () => {
    expect(isWidgetStateV2Enabled({ search: "?widget_state=v2" })).toBe(true);
  });

  it("Test 14: localStorage='true' + search='?widget_state=off' → false (URL override can also force OFF)", () => {
    window.localStorage.setItem(WIDGET_STATE_V2_STORAGE_KEY, "true");
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
