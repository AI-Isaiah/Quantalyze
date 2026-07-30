import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeEach, vi } from "vitest";

// Phase 140 — `next/dist/server/app-render/async-local-storage.js` reads
// `globalThis.AsyncLocalStorage` EXACTLY ONCE, into a module-scope
// `maybeGlobalAsyncLocalStorage` const, and substitutes a `FakeAsyncLocalStorage`
// whose `run()`/`exit()`/`enterWith()` all throw the E504 invariant when it is
// absent. jsdom does not expose it. Any test that reaches a real Next boundary
// built on that storage — `unstable_cache` is the one in this repo — therefore
// depends on the global being installed BEFORE the first `next/*` module in the
// worker is evaluated.
//
// Installing it per-file from an ASYNC `vi.hoisted` block (the original shape in
// keys/[id]/permissions/route.seam.test.ts) is a RACE, not a fix: the block is
// hoisted above the imports, but its `await import("node:async_hooks")` resolves
// on a later microtask, so under worker contention the file's own imports can
// evaluate first and capture `undefined`. The symptom is nasty because it is
// silent — `unstable_cache` throws the invariant, the route's catch classifies
// it as a generic upstream failure, and every case in the file fails with a
// plausible-looking wrong status instead of an obvious harness error.
//
// Setup files are fully awaited before any test module is imported, so a static
// import here is deterministic for every file in every worker. Idempotent and
// inert for the ~700 files that never touch a Next async-storage boundary.
(globalThis as unknown as { AsyncLocalStorage: unknown }).AsyncLocalStorage =
  AsyncLocalStorage;

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

// Phase 140.5-01 / SEAMPROSE-04 — `process.env` does not travel.
//
// `vitest.config.ts` sets `unstubEnvs: true`, and that is NOT this. That option
// restores only what `vi.stubEnv()` recorded. 54 test files assign
// `process.env.X = "…"` DIRECTLY and 38 of them never restore; a direct
// assignment mutates real process state, which nothing in vitest tracks. That
// is DEF-16-1's other half — the reason a suite can be green on local Node 25
// and red on CI's Node 22, depending on which file the worker ran first.
//
// TWO SCOPES, because there are two leaks and they are not the same leak:
//
//   1. TEST → TEST. A write inside a test body must not reach the next test.
//      Restored against a baseline captured in `beforeEach`.
//   2. FILE → FILE. A write at module scope or in `beforeAll` must not reach
//      the next file in the worker. Restored against `INHERITED_ENV` in
//      `afterAll`.
//
// ⚠️ WHY NOT ONE `afterEach` RESTORING STRAIGHT TO `INHERITED_ENV`, which is
// the simpler shape and the one 140.5-01-PLAN.md specifies: MEASURED, it breaks
// correct code. It reverts a file's own module-scope and `beforeAll` env after
// that file's FIRST test, so every later test in the file runs unconfigured.
// The full suite named 5 such files, and `src/lib/dateday.test.ts` is the
// argument — it sets `process.env.TZ` in `beforeAll` and restores it in
// `afterAll`, i.e. it ALREADY does, by hand and correctly, exactly what scope 2
// does for everyone. Reverting it per-test would have forced a rewrite of
// correct code to satisfy the harness, and would have closed no leak that the
// two scopes above do not already close. Recorded as a deviation in
// 140.5-01-SUMMARY.md.
//
// Captured at setup-file scope, which for each test file runs BEFORE that
// file's own module-scope code — so this is the environment the file was
// handed, not the environment it made.
const INHERITED_ENV: NodeJS.ProcessEnv = { ...process.env };

/** The environment as it stood when the current test started. */
let testBaselineEnv: NodeJS.ProcessEnv = { ...process.env };

/**
 * Put `process.env` back to `target`: drop keys added since, restore keys that
 * were changed or deleted. Deliberately mutates the live object rather than
 * reassigning `process.env` — a reassignment is invisible to anything holding
 * the reference from module load, which is precisely the population most likely
 * to read a stale value.
 */
function restoreEnv(target: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in target)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(target)) {
    if (process.env[key] !== value) process.env[key] = value;
  }
}

beforeEach(() => {
  testBaselineEnv = { ...process.env };
});

// React Testing Library only auto-cleans when the test runner registers
// `globals: true`, which we don't (vitest.config.ts uses imported helpers).
// Wire cleanup explicitly so each test starts with an empty DOM.
//
// EXTENDED, not duplicated: one `afterEach` for the whole harness. A second
// registration would run in a hook order nobody states, and the ordering
// between DOM cleanup and env restore would then be an accident rather than a
// decision. (It is a decision: cleanup first, because an unmounting effect may
// still read the env its component was rendered under.)
afterEach(() => {
  cleanup();
  restoreEnv(testBaselineEnv);
});

afterAll(() => {
  restoreEnv(INHERITED_ENV);
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
