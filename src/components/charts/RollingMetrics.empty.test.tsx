import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { RollingMetrics } from "./RollingMetrics";

// Phase 170.1.3 NARROWCHARTS, round-3 HI-01. UNMOCKED recharts on purpose: RollingMetrics.test.tsx
// stubs both layout hooks to `undefined`, so the branch that runs once the plot area is known never
// ran in a unit test, and an empty series threw there ("Cannot read properties of undefined").
// analytics-service sends `{sharpe_30d: [], sharpe_90d: [], sharpe_365d: []}` for a strategy with
// fewer than 30 return days, and the strategy page mounts RollingMetrics for it.

/** Report a real size to ResponsiveContainer's observer, as the browser does after hydration. */
function stubObservedSize(width: number, height: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe() {
        this.cb(
          [{ contentRect: { width, height } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("RollingMetrics with an empty series, real recharts in a sized container", () => {
  it("renders the chart without throwing", () => {
    stubObservedSize(858, 250);
    const { container } = render(
      <RollingMetrics data={{ sharpe_30d: [], sharpe_90d: [], sharpe_365d: [] }} />,
    );
    // The chart really laid out (a sized svg), so the plot-area branch ran.
    expect(container.querySelector("svg.recharts-surface")).not.toBeNull();
  });
});
