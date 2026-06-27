/** @vitest-environment jsdom */
/**
 * Phase 44 / A11Y-02 — useBreakpoint SSR-safe breakpoint hook.
 *
 * useBreakpoint is a thin wrapper over useMediaQuery (src/hooks/useMediaQuery.ts)
 * that returns a 'mobile' | 'tablet' | 'desktop' breakpoint name. It uses the
 * INVERSE-query (max-width) shape so the all-false server snapshot maps to
 * 'desktop' for free (RESEARCH Pattern 1, option 1) — mirroring useMediaQuery's
 * getServerSnapshot=false and the strategy.ui_v2 desktop-first SSR convention.
 *
 * Test plan (4 cases, every branch covered so the coverage ratchet holds):
 *  1. SSR / no-window equivalence — both inverse reads false → 'desktop'
 *     (the server snapshot path; asserts string equality with 'desktop',
 *     NOT 'mobile').
 *  2. Client narrow (<640px) — (max-width: 639px) matches → 'mobile'.
 *  3. Client medium (≥640px, <1024px) — (max-width: 1023px) matches but
 *     (max-width: 639px) does not → 'tablet'.
 *  4. Client wide (≥1024px) — neither inverse query matches → 'desktop'.
 *
 * Both inverse queries are mocked PER query string so each branch is
 * exercised deterministically (the hook issues two distinct matchMedia
 * queries).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBreakpoint } from "./useBreakpoint";

type MqlListener = (e: MediaQueryListEvent) => void;

/**
 * Install a matchMedia stub that returns `matches` based on a per-query map.
 * Any query not in the map defaults to `false` — which mirrors the server
 * snapshot (getServerSnapshot returns false for every query), so passing an
 * empty map is the "SSR / no narrow viewport" case.
 */
function installMatchMedia(matchesByQuery: Record<string, boolean>) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => {
      const matches = matchesByQuery[query] ?? false;
      const listeners = new Set<MqlListener>();
      return {
        matches,
        media: query,
        addEventListener: (_: string, cb: MqlListener) => listeners.add(cb),
        removeEventListener: (_: string, cb: MqlListener) => listeners.delete(cb),
        addListener: (cb: MqlListener) => listeners.add(cb),
        removeListener: (cb: MqlListener) => listeners.delete(cb),
        dispatchEvent: () => true,
        onchange: null,
      };
    }),
  });
}

describe("[A11Y-02] useBreakpoint — SSR-safe breakpoint resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves to 'desktop' on the SSR snapshot (every inverse read false)", () => {
    // Empty map → every matchMedia query reports false, identical to the
    // server snapshot where getServerSnapshot returns false for every query.
    installMatchMedia({});
    const { result } = renderHook(() => useBreakpoint());
    // The inverse-query shape MUST fall through to 'desktop', NOT 'mobile'.
    expect(result.current).toBe("desktop");
  });

  it("resolves to 'mobile' when the narrow (max-width: 639px) query matches", () => {
    installMatchMedia({
      "(max-width: 639px)": true,
      "(max-width: 1023px)": true,
    });
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("mobile");
  });

  it("resolves to 'tablet' when only the (max-width: 1023px) query matches", () => {
    installMatchMedia({
      "(max-width: 639px)": false,
      "(max-width: 1023px)": true,
    });
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("tablet");
  });

  it("resolves to 'desktop' when neither inverse query matches", () => {
    installMatchMedia({
      "(max-width: 639px)": false,
      "(max-width: 1023px)": false,
    });
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("desktop");
  });
});
