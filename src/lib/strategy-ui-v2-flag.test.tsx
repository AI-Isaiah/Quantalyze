import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import {
  isStrategyUiV2Enabled,
  isStrategyUiV2EnabledClient,
  STRATEGY_UI_V2_STORAGE_KEY,
  STRATEGY_UI_V2_URL_OVERRIDE,
} from "./strategy-ui-v2-flag";

/**
 * Phase 14b / KPI-23b — Unit tests for the strategy.ui_v2 feature-flag reader.
 *
 * Phase 14a default = OFF (legacy). Phase 14b default = ON (browser-side only).
 * Grok B-05 SSR-safety: SSR branch keeps returning `false` so server-rendered
 * HTML matches the v1 path; browser useEffect upgrades to v2 if the flag
 * resolves true post-hydration. Mirrors the canonical pattern from
 * `src/lib/widget-state-flag.ts` (Phase 11).
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

  it("constants match Phase 14a/b CONTEXT.md", () => {
    expect(STRATEGY_UI_V2_STORAGE_KEY).toBe("strategy.ui_v2");
    expect(STRATEGY_UI_V2_URL_OVERRIDE).toBe("strategy_v2");
  });

  // Test 1 (Grok B-05) — SSR returns false (NOT true) to keep server-rendered
  // HTML on the v1 path. Consumers do a two-pass mount via useEffect to
  // upgrade to v2 in the browser, eliminating hydration mismatches for
  // legacy users with localStorage["strategy.ui_v2"]="false".
  it("SSR returns false (Grok B-05 SSR-safety invariant)", () => {
    const originalWindow = globalThis.window;
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(isStrategyUiV2Enabled({ search: "" })).toBe(false);
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  // Test 2 (NEW Phase 14b default) — In a browser context with no URL params
  // and no localStorage entry, the flag returns TRUE. This is the flip.
  it("Phase 14b default (browser, no URL, no localStorage) returns true", () => {
    expect(isStrategyUiV2Enabled({ search: "" })).toBe(true);
  });

  // Test 3 — URL override ON
  it("URL ?strategy_v2=on returns true", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=on" })).toBe(true);
  });

  it("URL ?strategy_v2=true returns true", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=true" })).toBe(true);
  });

  it("URL ?strategy_v2=v2 returns true", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=v2" })).toBe(true);
  });

  // Test 4 (regression critical) — URL override OFF wins over default-on +
  // localStorage true. This is the canonical opt-out for users who hit
  // issues post-flip.
  it("URL ?strategy_v2=off returns false even if localStorage has \"true\"", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "true");
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=off" })).toBe(false);
  });

  it("URL ?strategy_v2=false returns false", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=false" })).toBe(false);
  });

  // Test 5 — localStorage explicit ON
  it("localStorage \"true\" with no URL returns true", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "true");
    expect(isStrategyUiV2Enabled({ search: "" })).toBe(true);
  });

  // Test 6 (Grok B-05 critical) — Legacy users who manually opted out keep
  // their preference. SSR returns false → client also returns false → no
  // hydration mismatch.
  it("localStorage \"false\" with no URL returns false (legacy opt-out persists)", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "false");
    expect(isStrategyUiV2Enabled({ search: "" })).toBe(false);
  });

  // Test 7 — URL beats localStorage
  it("URL ?strategy_v2=on wins over localStorage \"false\"", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "false");
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=on" })).toBe(true);
  });

  // Test 8 — Malformed URL value falls through to localStorage; if absent,
  // returns the new browser default (true).
  it("URL ?strategy_v2=banana falls through to default true", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=banana" })).toBe(
      true,
    );
  });

  it("URL ?strategy_v2=banana falls through to localStorage \"false\"", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "false");
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=banana" })).toBe(
      false,
    );
  });

  // Test 9 — localStorage exception (private mode) returns the new default
  // (true).
  it("localStorage exception returns the new default true", () => {
    const original = localStorageMock.getItem;
    localStorageMock.getItem = vi.fn(() => {
      throw new Error("private mode");
    });
    try {
      expect(isStrategyUiV2Enabled({ search: "" })).toBe(true);
    } finally {
      localStorageMock.getItem = original;
    }
  });

  // Test 10 — isStrategyUiV2EnabledClient is a thin wrapper that throws in
  // SSR contexts and forwards to isStrategyUiV2Enabled in browsers.
  describe("isStrategyUiV2EnabledClient (browser-only convenience wrapper)", () => {
    it("throws when called in SSR context (typeof window === undefined)", () => {
      const originalWindow = globalThis.window;
      delete (globalThis as { window?: unknown }).window;
      try {
        expect(() => isStrategyUiV2EnabledClient({ search: "" })).toThrow(
          /server/i,
        );
      } finally {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    });

    it("forwards to isStrategyUiV2Enabled in browser context", () => {
      expect(isStrategyUiV2EnabledClient({ search: "?strategy_v2=off" })).toBe(
        false,
      );
      expect(isStrategyUiV2EnabledClient({ search: "" })).toBe(true);
    });
  });

  // Test 11 (Grok B-05 — hydration-safety integration test) — A consumer
  // that reads the flag in useEffect renders the SSR-safe v1 path on initial
  // mount, then upgrades to v2 post-hydration if the flag resolves true.
  // The two-pass shape is what eliminates hydration mismatches.
  describe("hydration-safety two-pass mount (Grok B-05)", () => {
    function FlagConsumer({ search }: { search: string }) {
      // SSR-safe initial state. Initial render is always "v1" — matching what
      // the server emits — so React can hydrate without mismatch warnings.
      const [isV2, setIsV2] = useState<boolean>(false);
      useEffect(() => {
        // The setState-in-effect is intentional and bounded: this is the
        // canonical Grok B-05 two-pass mount shape — initial render uses the
        // SSR-safe default (false → v1), useEffect upgrades to whatever the
        // browser flag resolves to. Mirrors AllocationsTabs.tsx:235-243.
        /* eslint-disable react-hooks/set-state-in-effect */
        setIsV2(isStrategyUiV2Enabled({ search }));
        /* eslint-enable react-hooks/set-state-in-effect */
      }, [search]);
      return <div data-testid="path">{isV2 ? "v2" : "v1"}</div>;
    }

    it("fresh user (no localStorage) — initial v1, post-hydration upgrades to v2", async () => {
      // No localStorage entry → fresh user. Initial render must be v1 (SSR
      // safe), useEffect upgrades to v2 (new Phase 14b default).
      const { rerender } = render(<FlagConsumer search="" />);
      // Wait for useEffect to flush.
      await waitFor(() => {
        expect(screen.getByTestId("path").textContent).toBe("v2");
      });
      // No console.error about hydration mismatch — testing-library's
      // render uses createRoot which doesn't emit hydration warnings unless
      // the tree changed during hydration. The initial paint matched, so
      // post-hydration upgrade is the expected client-side state change.
      rerender(<FlagConsumer search="" />);
      expect(screen.getByTestId("path").textContent).toBe("v2");
    });

    it("legacy opt-out user (localStorage=\"false\") — v1 stays v1 with no flip", async () => {
      // Grok B-05's flagged scenario: SSR returns false → client also returns
      // false → useEffect sets state to false → no flicker, no flip.
      localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "false");
      render(<FlagConsumer search="" />);
      // Initial render is v1 (SSR-safe default).
      expect(screen.getByTestId("path").textContent).toBe("v1");
      // Allow useEffect to flush; expect state to remain v1 (matches the
      // localStorage opt-out).
      await waitFor(() => {
        expect(screen.getByTestId("path").textContent).toBe("v1");
      });
    });

    it("URL override off — v1 stays v1 with no flip", async () => {
      // URL ?strategy_v2=off forces v1 even with no localStorage entry.
      render(<FlagConsumer search="?strategy_v2=off" />);
      expect(screen.getByTestId("path").textContent).toBe("v1");
      await waitFor(() => {
        expect(screen.getByTestId("path").textContent).toBe("v1");
      });
    });
  });
});
