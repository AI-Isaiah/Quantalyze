import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import { estLabelWidth } from "@/lib/chart-ticks";
import { EquityChart, rightAxisPad, thinXTicks } from "./EquityChart";

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

const PAD = { l: 8, r: 64 };
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("thinXTicks (D-01, C-2)", () => {
  it("keeps at most max(2, floor(chartW / 64)) ticks below 400 px and always the newest", () => {
    // width 334 -> chartW 262 -> 4 ticks; width 319 -> chartW 247 -> 3 ticks.
    const five = range(5);
    const at334 = thinXTicks(five, 334, PAD);
    expect(at334.length).toBeLessThanOrEqual(4);
    expect(at334[at334.length - 1]).toBe(4);
    const at319 = thinXTicks(five, 319, PAD);
    expect(at319.length).toBeLessThanOrEqual(3);
    expect(at319[at319.length - 1]).toBe(4);
  });

  it("never drops below two ticks, however narrow", () => {
    const out = thinXTicks(range(9), 200, PAD);
    expect(out.length).toBe(2);
    expect(out[out.length - 1]).toBe(8);
  });

  it("keeps every k-th tick counted back from the newest, k = ceil(len / maxTicks)", () => {
    // 10 ticks, maxTicks 4 -> k 3 -> indices 9, 6, 3, 0.
    expect(thinXTicks(range(10), 334, PAD)).toEqual([0, 3, 6, 9]);
  });

  it("returns the list unchanged at 400 px and above, so desktop does not move (D-04)", () => {
    const ticks = range(12);
    expect(thinXTicks(ticks, 400, PAD)).toBe(ticks);
    expect(thinXTicks(ticks, 960, PAD)).toBe(ticks);
  });
});

describe("rightAxisPad (D-02, C-3)", () => {
  it("stays 64 while every label's estimated width is at most 60 px", () => {
    expect(rightAxisPad(["+12.5%", "0%", "-3.5%"], 12)).toBe(64);
    // 8 characters at 12 px is 57.6 px, still inside the 60 px room.
    expect(rightAxisPad(["+12345%x"], 12)).toBe(64);
  });

  it("grows to ceil(widest) + 8, rounded up to a multiple of 4, when a label needs it", () => {
    // 10 characters -> 72 -> 80; 11 characters -> 79.2 -> 80 + 8 = 88.
    expect(rightAxisPad(["+1234567%x"], 12)).toBe(80);
    expect(rightAxisPad(["+1234567%xy"], 12)).toBe(88);
    // 9 characters -> 64.8 -> ceil 65 + 8 = 73 -> 76.
    expect(rightAxisPad(["+123456%x"], 12)).toBe(76);
  });
});

describe("EquityChart narrow render (D-01, D-02)", () => {
  /** The x-axis labels, selected by the svg attribute the chart sets on them only. */
  function xLabels(svg: Element) {
    return Array.from(svg.querySelectorAll('text[font-family="var(--font-sans)"]')).map((t) => ({
      text: (t.textContent ?? "").trim(),
      x: Number(t.getAttribute("x")),
      anchor: t.getAttribute("text-anchor"),
    }));
  }

  it("draws at most four x labels at width 334 and keeps the newest date", () => {
    const { svg } = renderAt(334, 7);
    const labels = xLabels(svg);
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(labels.length).toBeLessThanOrEqual(4);
    expect(labels[labels.length - 1].text).toBe("Jan 7");
  });

  it("draws the unthinned list at width 960, where the 7-day series has one label per day", () => {
    const { svg } = renderAt(960, 7);
    expect(xLabels(svg).length).toBe(7);
  });

  it("anchors a label start or end exactly when its estimated centred box crosses the svg", () => {
    const width = 334;
    const { svg } = renderAt(width, 7);
    const labels = xLabels(svg);
    for (const l of labels) {
      const w = estLabelWidth(l.text, 12);
      const expected = l.x - w / 2 < 0 ? "start" : l.x + w / 2 > width ? "end" : "middle";
      expect(l.anchor, `${l.text} at x=${l.x}`).toBe(expected);
    }
    // The oldest label sits at pad.l = 8: centred it would cross the left edge.
    expect(labels[0].text).toBe("Jan 1");
    expect(labels[0].anchor).toBe("start");
  });

  it("keeps the right-axis labels at width - 64 + 4 while every label fits the gutter", () => {
    const width = 334;
    const { svg } = renderAt(width, 200);
    const yLabelXs = Array.from(svg.querySelectorAll('text[font-family^="var(--font-mono)"]'))
      .filter((t) => t.getAttribute("text-anchor") === "start")
      .map((t) => Number(t.getAttribute("x")));
    expect(yLabelXs.length).toBeGreaterThan(0);
    for (const x of yLabelXs) expect(x).toBe(width - 64 + 4);
  });
});
