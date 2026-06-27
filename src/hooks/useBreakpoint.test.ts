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
 * Test plan (5 cases, every branch covered so the coverage ratchet holds):
 *  1. Real SSR render — drives useSyncExternalStore's getServerSnapshot via
 *     react-dom/server renderToStaticMarkup (independent of jsdom's window),
 *     proving the documented server default is 'desktop', NOT 'mobile'.
 *  2. Client all-false snapshot — both inverse reads false on the client
 *     getSnapshot path → 'desktop' (the no-matching-media client case).
 *  3. Client narrow (<640px) — (max-width: 639px) matches → 'mobile'.
 *  4. Client medium (≥640px, <1024px) — (max-width: 1023px) matches but
 *     (max-width: 639px) does not → 'tablet'.
 *  5. Client wide (≥1024px) — neither inverse query matches → 'desktop'.
 *
 * Both inverse queries are mocked PER query string so each branch is
 * exercised deterministically (the hook issues two distinct matchMedia
 * queries).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

  it("resolves to 'desktop' on the real SSR render (getServerSnapshot path)", () => {
    // Drive the ACTUAL server-snapshot path: renderToStaticMarkup performs a
    // server render, so useSyncExternalStore reads getServerSnapshot (which
    // returns false for every query) regardless of jsdom's window. This proves
    // the documented SSR default is 'desktop', NOT 'mobile' — the hydration-safe
    // invariant the whole inverse-query shape exists to guarantee.
    const Probe = () => createElement("span", null, useBreakpoint());
    const html = renderToStaticMarkup(createElement(Probe));
    expect(html).toBe("<span>desktop</span>");
  });

  it("resolves to 'desktop' on the client all-false snapshot (no matching media)", () => {
    // Empty map → every matchMedia query reports false on the client
    // getSnapshot path. The inverse-query shape MUST fall through to 'desktop',
    // NOT 'mobile' (matches the SSR default above → no hydration mismatch).
    installMatchMedia({});
    const { result } = renderHook(() => useBreakpoint());
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
