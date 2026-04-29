import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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

// jsdom does not implement IntersectionObserver. Phase 14a's
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
