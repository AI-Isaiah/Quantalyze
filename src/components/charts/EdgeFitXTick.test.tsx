import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { LineChart, Line, XAxis, YAxis } from "recharts";
import { EdgeFitXTick } from "./EdgeFitXTick";
import { CHART_AXIS_TICK, CHART_FONT_MONO, CHART_TICK_STYLE } from "./chart-tokens";
import { estLabelWidth } from "@/lib/chart-ticks";
import { RollingVolatilityChart } from "./RollingVolatilityChart";
import { RollingSortinoChart } from "./RollingSortinoChart";
import { RollingMetrics } from "./RollingMetrics";

/**
 * Phase 170.1.3 NARROWCHARTS plan 03 (D-02, D-03b) — real-Recharts pins for the shared x-axis
 * tick renderer and for the rolling charts that mount it. Nothing in Recharts is mocked except
 * ResponsiveContainer, which has no measured size in jsdom: the mock hands its chart an explicit
 * width and a height of 250, so the real axis, tick layout and tick renderer all run.
 *
 * The expected anchors are typed by hand ("end" for the last tick, "middle" for the rest); none is
 * computed by the code under test. The one derived expectation (the 1280 case) recomputes the
 * rule's own inequality from the rendered tick x, so it pins "the anchor follows the box", not a
 * number copied from the implementation.
 */

const sizing = vi.hoisted(() => ({ width: 390 }));

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: sizing.width, height: 250 } as object),
  };
});

vi.mock("./TouchTooltip", () => ({ TouchTooltip: () => null }));

/** Daily dates ending 2026-10-20, oldest first. */
function dailyDates(n: number): string[] {
  const end = Date.UTC(2026, 9, 20);
  return Array.from({ length: n }, (_, i) =>
    new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

const DATES = dailyDates(120);
const POINTS = DATES.map((date, i) => ({ date, value: 0.2 + (i % 7) * 0.01 }));

interface TickRead {
  text: string;
  anchor: string | null;
  x: number;
  el: Element;
}

/** The x-axis tick texts, read from the layer Recharts draws them in (plan 01 deviation 1). */
function readXTicks(container: HTMLElement): TickRead[] {
  const els = Array.from(
    container.querySelectorAll(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value"),
  );
  // Precondition: a hollow render (no ticks) must not read as green.
  expect(els.length).toBeGreaterThanOrEqual(2);
  return els.map((el) => ({
    text: (el.textContent ?? "").trim(),
    anchor: el.getAttribute("text-anchor"),
    x: Number(el.getAttribute("x")),
    el,
  }));
}

/** A bare real LineChart at an explicit width, with the rolling charts' x-axis settings. */
/**
 * Real Recharts in jsdom does not measure text, so `interval="preserveStartEnd"` keeps every tick
 * and the last few sit inside the edge band. The rule is therefore pinned per tick: a tick whose
 * centred box (rendered x, estimated width) stays inside the chart keeps "middle"; one that
 * crosses the right edge is "end". The end-date tick is also pinned by hand-typed value.
 */
function expectEdgeRule(ticks: TickRead[], chartWidth: number) {
  for (const t of ticks) {
    const crosses = t.x + estLabelWidth(t.text, 12) / 2 > chartWidth;
    expect(t.anchor, `tick ${t.text} at x=${t.x}`).toBe(crosses ? "end" : "middle");
  }
}

function bareChart(width: number, tick: React.ReactElement | object) {
  return (
    <LineChart
      width={width}
      height={250}
      accessibilityLayer={false}
      data={POINTS}
      margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
    >
      <XAxis
        dataKey="date"
        tick={tick as never}
        tickLine={false}
        tickFormatter={(d: string) => d.slice(5)}
        interval="preserveStartEnd"
      />
      <YAxis tick={CHART_TICK_STYLE} tickLine={false} axisLine={false} />
      <Line type="monotone" dataKey="value" dot={false} isAnimationActive={false} />
    </LineChart>
  );
}

describe("EdgeFitXTick — the shared x-axis tick renderer (D-02, D-03b)", () => {
  beforeEach(() => {
    sizing.width = 390;
  });

  it("at 390 px anchors the end-date tick 'end' and every interior tick 'middle'", () => {
    const { container } = render(bareChart(390, <EdgeFitXTick {...CHART_TICK_STYLE} />));
    const ticks = readXTicks(container);
    const last = ticks[ticks.length - 1];
    expect(last.text).toBe("10-20");
    expect(last.anchor).toBe("end");
    expect(ticks[0].anchor).toBe("middle");
    expectEdgeRule(ticks, 390);
    // Style precedence is kept: the tick still draws the shared font and fill (T-170.1.3-08).
    expect(last.el.getAttribute("font-size")).toBe("12");
    expect(last.el.getAttribute("font-family")).toBe(CHART_FONT_MONO);
    expect(last.el.getAttribute("fill")).toBe(CHART_AXIS_TICK);
  });

  it("draws no font-variant-numeric style on the tick (unchanged from the plain-object path)", () => {
    const { container } = render(bareChart(390, <EdgeFitXTick {...CHART_TICK_STYLE} />));
    for (const t of readXTicks(container)) {
      expect(t.el.getAttribute("style") ?? "").not.toMatch(/font-variant-numeric/);
    }
  });

  it("at 1280 px changes no label and no interior anchor; only the last anchor may follow its box", () => {
    const wide = (tick: React.ReactElement | object) => bareChart(1280, tick);
    const control = readXTicks(render(wide(CHART_TICK_STYLE)).container);
    const fitted = readXTicks(render(wide(<EdgeFitXTick {...CHART_TICK_STYLE} />)).container);

    expect(fitted.map((t) => t.text)).toEqual(control.map((t) => t.text));
    // The control draws every tick "middle" at 1280, so any "end" in the fitted chart is a tick
    // whose box crosses the edge and nothing else moved.
    for (const t of control) expect(t.anchor).toBe("middle");
    for (let i = 0; i < fitted.length; i++) {
      const crosses = fitted[i].x + estLabelWidth(fitted[i].text, 12) / 2 > 1280;
      expect(fitted[i].anchor).toBe(crosses ? "end" : control[i].anchor);
    }
    expect(fitted[fitted.length - 1].anchor).toBe("end");
  });

  it("keeps the caller's anchor outside a chart context instead of throwing (T-170.1.3-07)", () => {
    const { container } = render(
      <svg>
        <EdgeFitXTick
          {...CHART_TICK_STYLE}
          x={5}
          y={5}
          index={0}
          textAnchor="middle"
          payload={{ value: "2026-10-20" }}
          tickFormatter={(d: string) => d.slice(5)}
        />
      </svg>,
    );
    const text = container.querySelector("text");
    expect(text?.textContent).toBe("10-20");
    expect(text?.getAttribute("text-anchor")).toBe("middle");
  });
});

describe("the rolling charts draw the end-date tick whole at 390 px (D-03b)", () => {
  const charts: [string, () => React.ReactElement][] = [
    ["RollingVolatilityChart", () => <RollingVolatilityChart data={POINTS} />],
    ["RollingSortinoChart", () => <RollingSortinoChart data={POINTS} />],
    ["RollingMetrics", () => <RollingMetrics data={{ sharpe_365d: POINTS }} />],
  ];
  it.each(charts)("%s anchors the last x tick '10-20' with text-anchor=end", (_name, make) => {
    sizing.width = 390;
    const { container } = render(make());
    const ticks = readXTicks(container);
    const last = ticks[ticks.length - 1];
    expect(last.text).toBe("10-20");
    expect(last.anchor).toBe("end");
    expect(ticks[0].anchor).toBe("middle");
    expectEdgeRule(ticks, 390);
  });
});
