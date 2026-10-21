import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import { EquityChart } from "./EquityChart";

// ---------------------------------------------------------------------------
// Phase 170.1.3 NARROWCHARTS (D-01, D-02, C-1..C-3) — the Overview equity
// chart follows its card on a phone.
//
// The chart sizes its <svg> from a ResizeObserver on its wrapper. A floor of
// 400 px there made a 334 px card clip a 400 px svg and hide the right-hand
// axis. These tests drive the observed width through a stubbed
// ResizeObserver, the same way the browser reports it after hydration.
// ---------------------------------------------------------------------------

function makeSeries(n: number): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  let cumulative = 1.0;
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: cumulative });
    cumulative *= 1 + Math.sin(i * 0.3) * 0.01;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

/** Report `contentRect.width = width` to the chart's observer as soon as it observes. */
function stubObservedWidth(width: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe() {
        this.cb(
          [{ contentRect: { width } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

function renderAt(width: number, n = 200) {
  stubObservedWidth(width);
  let utils!: ReturnType<typeof render>;
  act(() => {
    utils = render(<EquityChart equityDailyPoints={makeSeries(n)} />);
  });
  const svg = utils.container.querySelector('svg[aria-label="Equity chart"]');
  if (!svg) throw new Error("Equity chart svg did not render");
  return { ...utils, svg };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EquityChart width follows the observed card (D-01, C-1)", () => {
  it("is exactly the observed content width below 400 px, not floored to 400", () => {
    const { svg } = renderAt(334);
    expect(svg.getAttribute("width")).toBe("334");
  });

  it("is exactly the observed content width at desktop width", () => {
    const { svg } = renderAt(1280);
    expect(svg.getAttribute("width")).toBe("1280");
  });

  it("renders no NaN geometry when the wrapper reports width 0 (a hidden tab)", () => {
    const { svg } = renderAt(0);
    const bad: string[] = [];
    for (const el of Array.from(svg.querySelectorAll("*")).concat(svg)) {
      for (const attr of ["x", "x1", "x2", "width"]) {
        const v = el.getAttribute(attr);
        if (v !== null && v.includes("NaN")) bad.push(`${el.tagName}[${attr}]=${v}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
