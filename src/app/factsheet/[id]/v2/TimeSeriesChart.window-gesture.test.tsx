/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";

/**
 * 169.1 review MD-01, review-fix D: a chart pan, x-pull or wheel zoom derives the
 * windowed view ONCE, when the gesture ends.
 *
 * Topic B gave the MasterBrush a drag hold (`useRangeGesture`). The time-series
 * charts' own gestures still called `setXRange` on every pointer move and wheel
 * tick with no hold, so each event re-ran `deriveSeriesBundle` for the KPI strip
 * and the rail (~292 ms at 3000 observations, the bootstrap being most of it).
 *
 * Why each assertion matters:
 *   - zero derives during the gesture is the performance fix itself, and the
 *     live range moving on every event proves the chart still follows the
 *     gesture (only the windowed derive is held);
 *   - exactly one derive after release, equal to `windowView` of the final range,
 *     proves the settled figures are what a drag-free zoom shows;
 *   - the wheel has no end event, so it settles after `WHEEL_SETTLE_MS` of idle:
 *     a burst of ticks derives once, after the settle;
 *   - a cancel, a lost capture and an unmount mid-drag each release the hold: a
 *     hold that never ends freezes the strip silently;
 *   - a chart that took no hold does not release another chart's hold when it
 *     unmounts (the hold is shared across the page).
 *
 * The chart is mounted WITHOUT the MasterBrush, so the brush's own hold cannot
 * stand in for a missing one here.
 */

const bootCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/factsheet/bootstrap", async (orig) => {
  const mod = await orig<typeof import("@/lib/factsheet/bootstrap")>();
  return {
    ...mod,
    bootstrapCI: (...args: Parameters<typeof mod.bootstrapCI>) => {
      bootCalls.n += 1;
      return mod.bootstrapCI(...args);
    },
  };
});
vi.mock("@/hooks/useBreakpoint", () => ({ useBreakpoint: vi.fn(() => "desktop" as const) }));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import { FactsheetProvider, useXRange } from "./factsheet-context";
import { BasisProvider, useWindowedView, windowView, type RangeScope, type WindowedView } from "./basis-context";
import { TimeSeriesChart, WHEEL_SETTLE_MS } from "./TimeSeriesChart";
import { CHART_CONFIGS } from "./chart-configs";

const CONFIG = CHART_CONFIGS.find((c) => c.key === "cumulative") ?? CHART_CONFIGS[0];
const CONFIG_B = CHART_CONFIGS.find((c) => c.key !== CONFIG.key && !c.comparatorAsPrimary) ?? CHART_CONFIGS[1];
// The chart's viewBox: 880 wide, `config.height ?? 280` tall, padding 20/30/24/50.
const VB_W = 880;
const VB_H = CONFIG.height ?? 280;
const PLOT_Y = 100; // inside the plot: a pan
const XAXIS_Y = VB_H - 10; // below PAD.top + plotH: an x-axis pull
const PLOT_X = 400;

const lsStore = new Map<string, string>();

beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, v),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
    key: () => null,
    length: 0,
  });
  // jsdom has no layout: a box the size of the viewBox makes a client coordinate
  // equal to its viewBox coordinate, so the chart's gesture math runs unchanged.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: VB_W, bottom: VB_H, width: VB_W, height: VB_H, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  (Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

function build400(): FactsheetPayload {
  const rows: DailyReturn[] = Array.from({ length: 400 }, (_, i) => ({
    date: addDays("2024-01-01", i),
    value: 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004,
  }));
  const p = buildFactsheetPayload(
    {
      id: "s-169-1-fixd-chart-gesture",
      name: "Chart Gesture Strategy",
      types: ["quant"],
      markets: ["crypto"],
      computedAt: "2026-10-01T00:00:00Z",
      trustTier: null,
      assetClass: "crypto",
      ingestSource: "api",
    },
    rows,
    { benchmarkPrices: { unavailable: true } },
  );
  if (!p) throw new Error("fixture must build a payload");
  return p;
}

type Read = { view: WindowedView; scope: RangeScope };
const strip: Read[] = [];
const rail: Read[] = [];
const ranges: Array<readonly [number, number]> = [];
const live = () => ranges[ranges.length - 1];
const last = (xs: Read[]) => xs[xs.length - 1];

function Consumer({ sink, payload }: { sink: Read[]; payload: FactsheetPayload }) {
  sink.push(useWindowedView(payload));
  return null;
}

function Harness({ payload }: { payload: FactsheetPayload }) {
  const { xRange, setXRange } = useXRange();
  ranges.push(xRange);
  const [chartA, setChartA] = useState(true);
  const [chartB, setChartB] = useState(true);
  return (
    <>
      <button data-testid="zoom" onClick={() => setXRange([100, 199])}>zoom</button>
      <button data-testid="unmount-a" onClick={() => setChartA(false)}>unmount a</button>
      <button data-testid="unmount-b" onClick={() => setChartB(false)}>unmount b</button>
      <Consumer sink={strip} payload={payload} />
      <Consumer sink={rail} payload={payload} />
      {chartA && <div data-testid="chart-a"><TimeSeriesChart config={CONFIG} /></div>}
      {chartB && <div data-testid="chart-b"><TimeSeriesChart config={CONFIG_B} /></div>}
    </>
  );
}

async function mountZoomed() {
  strip.length = 0;
  rail.length = 0;
  ranges.length = 0;
  const payload = build400();
  const r = render(
    <FactsheetProvider payload={payload} persist={false}>
      <BasisProvider>
        <Harness payload={payload} />
      </BasisProvider>
    </FactsheetProvider>,
  );
  const svg = r.getByTestId("chart-a").querySelector("svg") as SVGSVGElement;
  if (!svg) throw new Error("chart svg not found");
  // Zoom first: at full history a pan clamps back to [0, n-1] and the full-history
  // arm is the base view by reference, so "0 derives" would pass vacuously.
  await act(async () => {
    fireEvent.click(r.getByTestId("zoom"));
  });
  expect(last(strip).scope).toMatchObject({ kind: "selected", startIdx: 100, endIdx: 199 });
  return { ...r, svg, payload };
}

const ev = async (fn: () => void) => {
  await act(async () => {
    fn();
  });
};

function expectHeldOnStart(tag: string) {
  expect(last(strip).scope, tag).toMatchObject({ startIdx: 100, endIdx: 199 });
  expect(last(rail).scope, tag).toMatchObject({ startIdx: 100, endIdx: 199 });
}

function expectSettledOnLive(payload: FactsheetPayload) {
  const [s, e] = live();
  expect([s, e]).not.toEqual([100, 199]);
  for (const sink of [strip, rail]) {
    expect(last(sink).scope).toMatchObject({ kind: "selected", startIdx: s, endIdx: e });
  }
  const want = windowView(payload, s, e);
  expect(last(strip).view.strategyMetrics).toEqual(want.strategyMetrics);
  expect(last(strip).view.bootstrapCI).toEqual(want.bootstrapCI);
  expect(last(rail).view).toBe(last(strip).view);
}

describe("TimeSeriesChart gestures hold the windowed view and derive once (169.1 review MD-01, fix D)", () => {
  it("a 6-move pan runs no derive while dragging and exactly one on release", async () => {
    const { svg, payload } = await mountZoomed();
    const before = bootCalls.n;
    await ev(() => fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: PLOT_X, clientY: PLOT_Y }));
    let prev = live();
    for (let k = 1; k <= 6; k++) {
      await ev(() => fireEvent.pointerMove(svg, { pointerId: 1, clientX: PLOT_X + k * 15, clientY: PLOT_Y }));
      // The chart follows the gesture live ...
      expect(live(), `move ${k}`).not.toEqual(prev);
      prev = live();
      // ... while the strip and the rail stay on the start range.
      expectHeldOnStart(`move ${k}`);
    }
    expect(bootCalls.n - before, "derives during the pan").toBe(0);
    await ev(() => fireEvent.pointerUp(svg, { pointerId: 1, clientX: PLOT_X + 90, clientY: PLOT_Y }));
    expect(bootCalls.n - before, "derives after release (strip and rail share one)").toBe(1);
    expectSettledOnLive(payload);
  });

  it("a 6-move x-axis pull runs no derive while dragging and exactly one on release", async () => {
    const { svg, payload } = await mountZoomed();
    const before = bootCalls.n;
    await ev(() => fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: PLOT_X, clientY: XAXIS_Y }));
    let prev = live();
    for (let k = 1; k <= 6; k++) {
      await ev(() => fireEvent.pointerMove(svg, { pointerId: 1, clientX: PLOT_X, clientY: XAXIS_Y - k * 8 }));
      expect(live(), `move ${k}`).not.toEqual(prev);
      prev = live();
      expectHeldOnStart(`move ${k}`);
    }
    expect(bootCalls.n - before, "derives during the pull").toBe(0);
    await ev(() => fireEvent.pointerUp(svg, { pointerId: 1, clientX: PLOT_X, clientY: XAXIS_Y - 48 }));
    expect(bootCalls.n - before, "derives after release").toBe(1);
    expectSettledOnLive(payload);
  });

  it("a 6-tick wheel burst runs no derive while ticking and exactly one once the wheel settles", async () => {
    const { svg, payload } = await mountZoomed();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const before = bootCalls.n;
    let prev = live();
    for (let k = 1; k <= 6; k++) {
      await ev(() => fireEvent.wheel(svg, { deltaY: -100, clientX: PLOT_X, clientY: PLOT_Y }));
      expect(live(), `tick ${k}`).not.toEqual(prev);
      prev = live();
      expectHeldOnStart(`tick ${k}`);
      // Ticks closer together than the settle keep the hold.
      await ev(() => vi.advanceTimersByTime(WHEEL_SETTLE_MS - 10));
    }
    expect(bootCalls.n - before, "derives during the burst").toBe(0);
    await ev(() => vi.advanceTimersByTime(WHEEL_SETTLE_MS));
    expect(bootCalls.n - before, "derives after the wheel settles").toBe(1);
    expectSettledOnLive(payload);
  });

  for (const how of ["pointer cancel", "lost pointer capture", "unmount"] as const) {
    it(`a ${how} mid-drag releases the hold, so the strip never freezes`, async () => {
      const { svg, getByTestId } = await mountZoomed();
      await ev(() => fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: PLOT_X, clientY: PLOT_Y }));
      await ev(() => fireEvent.pointerMove(svg, { pointerId: 1, clientX: PLOT_X + 60, clientY: PLOT_Y }));
      expectHeldOnStart("mid-drag");
      await ev(() => {
        if (how === "pointer cancel") fireEvent.pointerCancel(svg, { pointerId: 1 });
        else if (how === "lost pointer capture") fireEvent.lostPointerCapture(svg, { pointerId: 1 });
        else fireEvent.click(getByTestId("unmount-a"));
      });
      expect(live()).not.toEqual([100, 199]);
      expect(last(strip).scope).toMatchObject({ startIdx: live()[0], endIdx: live()[1] });
    });
  }

  it("an unmount mid-wheel-burst releases the hold and leaves no settle timer behind", async () => {
    const { svg, getByTestId } = await mountZoomed();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await ev(() => fireEvent.wheel(svg, { deltaY: -100, clientX: PLOT_X, clientY: PLOT_Y }));
    expectHeldOnStart("mid-burst");
    await ev(() => fireEvent.click(getByTestId("unmount-a")));
    expect(last(strip).scope).toMatchObject({ startIdx: live()[0], endIdx: live()[1] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a chart that took no hold does not release another chart's hold when it unmounts", async () => {
    const { svg, getByTestId } = await mountZoomed();
    await ev(() => fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: PLOT_X, clientY: PLOT_Y }));
    await ev(() => fireEvent.pointerMove(svg, { pointerId: 1, clientX: PLOT_X + 60, clientY: PLOT_Y }));
    await ev(() => fireEvent.click(getByTestId("unmount-b")));
    expectHeldOnStart("after the other chart unmounted");
    await ev(() => fireEvent.pointerUp(svg, { pointerId: 1, clientX: PLOT_X + 60, clientY: PLOT_Y }));
    expect(last(strip).scope).toMatchObject({ startIdx: live()[0], endIdx: live()[1] });
  });
});
