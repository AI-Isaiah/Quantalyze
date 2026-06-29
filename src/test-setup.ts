import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// PR #266 red-team — the universal approval gate added to withAuth (and
// every inline-auth API route) hits `supabase.from("profiles").select(...)
// .eq(...).maybeSingle()` on every authenticated request. Existing route
// tests mock supabase as a partial query builder that does NOT include
// the `profiles` chain, so adding the gate would force a churn across
// ~18 test files to extend each mock. Instead: stub the helper here so
// the gate behaves as a no-op in tests by default. Tests that specifically
// assert the gate (`src/lib/api/withAuth.approval-gate.test.ts`) re-import
// the real implementation via `vi.importActual` and re-mock with the
// desired per-case behaviour.
vi.mock("@/lib/api/approval-gate", () => ({
  assertProfileApproved: vi.fn().mockResolvedValue(null),
}));

// React Testing Library only auto-cleans when the test runner registers
// `globals: true`, which we don't (vitest.config.ts uses imported helpers).
// Wire cleanup explicitly so each test starts with an empty DOM.
afterEach(() => {
  cleanup();
});

// jsdom does not implement ResizeObserver. lightweight-charts (used by
// PortfolioEquityCurve and the wired charts on /portfolios/[id]) instantiates
// one in useEffect, which throws under vitest+jsdom. Stub it for the test
// environment so chart components can render in component tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom does not implement IntersectionObserver. The
// `useLazyPanelMetrics` hook (and related component tests) instantiate one
// in the ref-callback path, which throws under vitest+jsdom without a
// stub. Mirror the ResizeObserver pattern above so all component tests
// inherit a no-op observer. Tests that need real intersect behavior can
// override per-test.
class IntersectionObserverStub {
  constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
}
(globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
  IntersectionObserverStub as unknown as typeof IntersectionObserver;

// jsdom does not implement the pointer-capture API or `scrollIntoView`, which
// `@radix-ui/react-tabs` (the Phase-50 Tabs primitive) touches when a trigger is
// activated via pointer/keyboard — Radix calls `hasPointerCapture` on pointerdown
// and `scrollIntoView` when moving the active trigger into view. Without these,
// `@testing-library/user-event` (which dispatches real pointer + keyboard events,
// unlike bare `fireEvent`) throws "not a function" the moment it drives a Radix
// tab. Stub them as additive no-ops so every component test that mounts a Radix
// widget can be driven by user-event. These are universally safe no-ops for the
// rest of the suite (nothing asserts on their side effects).
if (typeof Element !== "undefined") {
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }
  if (typeof Element.prototype.hasPointerCapture !== "function") {
    Element.prototype.hasPointerCapture = function hasPointerCapture() {
      return false;
    };
  }
  if (typeof Element.prototype.setPointerCapture !== "function") {
    Element.prototype.setPointerCapture = function setPointerCapture() {};
  }
  if (typeof Element.prototype.releasePointerCapture !== "function") {
    Element.prototype.releasePointerCapture =
      function releasePointerCapture() {};
  }
}

// jsdom does not implement matchMedia. `useMediaQuery` / `useBreakpoint` (the
// Phase-44 SSR-safe breakpoint primitives) call `window.matchMedia(query)` in
// their `useSyncExternalStore` getSnapshot, which throws under vitest+jsdom
// without a stub. Phase 47 wires `useBreakpoint` into the factsheet SVG panels
// (legibility/portrait), so the existing factsheet render tests (FactsheetBody
// degenerate-matrix, etc.) now mount a breakpoint consumer. Mirror the
// observer stubs above with a no-op `matches:false` default — that resolves
// `useBreakpoint` to "desktop" (the same all-false server snapshot the hook
// documents), so tests that don't explicitly drive the viewport get the
// byte-identical desktop branch. Tests that need a specific breakpoint override
// per-test via `installMatchMedia({...})` (useBreakpoint.test.ts) or by mocking
// the hook directly.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {}, // deprecated, kept for older consumers
    removeListener() {}, // deprecated
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  })) as unknown as typeof window.matchMedia;
}
