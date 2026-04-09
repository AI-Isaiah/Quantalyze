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
