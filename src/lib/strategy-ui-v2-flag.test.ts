import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isStrategyUiV2Enabled,
  STRATEGY_UI_V2_STORAGE_KEY,
  STRATEGY_UI_V2_URL_OVERRIDE,
} from "./strategy-ui-v2-flag";

/**
 * Phase 14a / KPI-01 — Unit tests for the strategy.ui_v2 feature-flag reader.
 * Mirrors the widget-state-flag.test.ts contract: 3-tier precedence
 * (URL > localStorage > SSR-safe default OFF). Phase 14a default = OFF.
 *
 * Module-level Map-backed localStorage stub matches the project idiom
 * established by `src/lib/widget-state-flag.test.ts` and
 * `src/app/(dashboard)/allocations/lib/scenario-state.localStorage.test.ts`.
 * This is needed because jsdom's built-in `window.localStorage` doesn't
 * expose a working `.clear()` in the project's vitest+jsdom environment.
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

describe("strategy-ui-v2-flag", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    store.clear();
  });

  it("constants match Phase 14a CONTEXT.md", () => {
    expect(STRATEGY_UI_V2_STORAGE_KEY).toBe("strategy.ui_v2");
    expect(STRATEGY_UI_V2_URL_OVERRIDE).toBe("strategy_v2");
  });

  it("returns false on the server (typeof window === undefined)", () => {
    // Simulate SSR by stubbing globalThis.window to undefined.
    const originalWindow = globalThis.window;
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(isStrategyUiV2Enabled({ search: "" })).toBe(false);
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("URL ?strategy_v2=on returns true", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=on" })).toBe(true);
  });

  it("URL ?strategy_v2=true returns true", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=true" })).toBe(true);
  });

  it("URL ?strategy_v2=v2 returns true", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=v2" })).toBe(true);
  });

  it("URL ?strategy_v2=off returns false even if localStorage has \"true\"", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "true");
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=off" })).toBe(false);
  });

  it("URL ?strategy_v2=false returns false", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=false" })).toBe(false);
  });

  it("URL ?strategy_v2=garbage falls through to localStorage", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "true");
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=garbage" })).toBe(true);
  });

  it("localStorage \"true\" with no URL returns true", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "true");
    expect(isStrategyUiV2Enabled({ search: "" })).toBe(true);
  });

  it("Phase 14a default (no URL, no localStorage) returns false", () => {
    expect(isStrategyUiV2Enabled({ search: "" })).toBe(false);
  });
});
