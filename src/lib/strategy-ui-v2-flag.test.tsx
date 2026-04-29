import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import {
  isStrategyUiV2Enabled,
  isStrategyUiV2EnabledClient,
  STRATEGY_UI_V2_STORAGE_KEY,
  STRATEGY_UI_V2_LEGACY_STORAGE_KEY,
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

  it("constants match v0.17.1 versioned-key contract (F4)", () => {
    expect(STRATEGY_UI_V2_STORAGE_KEY).toBe("strategy.ui_v2.v17");
    expect(STRATEGY_UI_V2_LEGACY_STORAGE_KEY).toBe("strategy.ui_v2");
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
  // versioned-key true. Canonical opt-out for users who hit issues post-flip.
  it("URL ?strategy_v2=off returns false even if v17 key has \"true\"", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "true");
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=off" })).toBe(false);
  });

  it("URL ?strategy_v2=false returns false", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=false" })).toBe(false);
  });

  // Test 5 — versioned-key explicit ON
  it("v17 key \"true\" with no URL returns true", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "true");
    expect(isStrategyUiV2Enabled({ search: "" })).toBe(true);
  });

  // Test 6 — versioned-key explicit OFF (post-v0.17.1 opt-out is now keyed
  // on the v17 key, NOT the legacy "strategy.ui_v2").
  it("v17 key \"false\" with no URL returns false", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "false");
    expect(isStrategyUiV2Enabled({ search: "" })).toBe(false);
  });

  // Test 6b (F4 critical) — Legacy unversioned "false" opt-out is silently
  // retired at v0.17.1. Without this, the upcoming v1-route removal would
  // 404 anyone who had set strategy.ui_v2="false" during 14a opt-in.
  it("legacy strategy.ui_v2=\"false\" is IGNORED — returns default true (F4)", () => {
    localStorage.setItem(STRATEGY_UI_V2_LEGACY_STORAGE_KEY, "false");
    expect(isStrategyUiV2Enabled({ search: "" })).toBe(true);
  });

  // Test 6c (F4) — Conflicting values: v17 key wins over legacy.
  it("v17 \"false\" wins over legacy \"true\" (F4)", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "false");
    localStorage.setItem(STRATEGY_UI_V2_LEGACY_STORAGE_KEY, "true");
    expect(isStrategyUiV2Enabled({ search: "" })).toBe(false);
  });

  it("v17 \"true\" with legacy \"false\" returns true (F4)", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "true");
    localStorage.setItem(STRATEGY_UI_V2_LEGACY_STORAGE_KEY, "false");
    expect(isStrategyUiV2Enabled({ search: "" })).toBe(true);
  });

  // Test 7 — URL beats versioned-key
  it("URL ?strategy_v2=on wins over v17 key \"false\"", () => {
    localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "false");
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=on" })).toBe(true);
  });

  // Test 8 — Malformed URL value falls through to versioned-key; if absent,
  // returns the new browser default (true).
  it("URL ?strategy_v2=banana falls through to default true", () => {
    expect(isStrategyUiV2Enabled({ search: "?strategy_v2=banana" })).toBe(
      true,
    );
  });

  it("URL ?strategy_v2=banana falls through to v17 key \"false\"", () => {
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

    it("v17 opt-out user (v17 key=\"false\") — v1 stays v1 with no flip", async () => {
      // Post-v0.17.1 opt-outs target the versioned key. SSR returns false →
      // client also returns false → useEffect sets state to false → no flip.
      localStorage.setItem(STRATEGY_UI_V2_STORAGE_KEY, "false");
      render(<FlagConsumer search="" />);
      // Initial render is v1 (SSR-safe default).
      expect(screen.getByTestId("path").textContent).toBe("v1");
      await waitFor(() => {
        expect(screen.getByTestId("path").textContent).toBe("v1");
      });
    });

    it("F4: legacy unversioned \"false\" no longer pins to v1 — upgrades to v2 post-hydration", async () => {
      // F4 (v0.17.1) — the legacy "strategy.ui_v2" key is silently retired.
      // Users with a stale opt-out from Phase 14a now upgrade to v2 instead
      // of being trapped on a v1 route that the v0.17.1 cutover will remove.
      localStorage.setItem(STRATEGY_UI_V2_LEGACY_STORAGE_KEY, "false");
      render(<FlagConsumer search="" />);
      // Post-hydration must flip to v2 (legacy key ignored).
      await waitFor(() => {
        expect(screen.getByTestId("path").textContent).toBe("v2");
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
