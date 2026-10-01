/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";

/**
 * 169.1 review MD-01 — a brush drag derives the windowed view ONCE, on release.
 *
 * Every pointer move of a brush drag calls `setXRange`. Before MD-01 each new range
 * re-ran `deriveSeriesBundle` on the slice for the strip and the rail, and the
 * bundle's 2000-resample bootstrap dominates it (measured ~257 of ~292 ms at 3000
 * observations), so a drag on a long record ran at a few frames per second. The
 * MasterBrush now holds the windowed view on the range the drag started on, and
 * releases it on pointer up / cancel / lost capture / unmount.
 *
 * Why each assertion matters:
 *   - zero derives during the drag is the performance fix itself;
 *   - exactly one derive after release, equal to `windowView` of the final range,
 *     proves the settled figures are the ones a drag-free zoom shows (the bootstrap
 *     point still equals the strip Sharpe, plan 169.1-07);
 *   - the held `scope` stays the start range, so the "Selected range" eyebrow
 *     never names a range its figures do not describe (WR-01's rule);
 *   - an unmount mid-drag releases the hold: a hold that never ends would freeze
 *     the strip silently.
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
import { MasterBrush } from "./MasterBrush";

const lsStore = new Map<string, string>();
const VB_W = 1100;
const PAD_LEFT = 6;
const PLOT_W = VB_W - 12;

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
  // jsdom has no layout and no pointer capture: a 1100px-wide box makes a
  // clientX equal to its viewBox x, so the brush's index math runs unchanged.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: VB_W, bottom: 60, width: VB_W, height: 60, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  (Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
});
afterEach(() => {
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
      id: "s-169-1-md01-gesture",
      name: "Gesture Strategy",
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

function Consumer({ sink, payload }: { sink: Read[]; payload: FactsheetPayload }) {
  sink.push(useWindowedView(payload));
  return null;
}

function Harness({ payload }: { payload: FactsheetPayload }) {
  const { xRange, setXRange } = useXRange();
  ranges.push(xRange);
  const [brush, setBrush] = useState(true);
  return (
    <>
      <button data-testid="zoom" onClick={() => setXRange([100, 199])}>zoom</button>
      <button data-testid="unmount-brush" onClick={() => setBrush(false)}>unmount</button>
      <Consumer sink={strip} payload={payload} />
      <Consumer sink={rail} payload={payload} />
      {brush && <MasterBrush />}
    </>
  );
}

function mount(payload: FactsheetPayload) {
  strip.length = 0;
  rail.length = 0;
  ranges.length = 0;
  const r = render(
    <FactsheetProvider payload={payload} persist={false}>
      <BasisProvider>
        <Harness payload={payload} />
      </BasisProvider>
    </FactsheetProvider>,
  );
  const svg = r.container.querySelector('svg[aria-label^="Master brush"]') as SVGSVGElement;
  if (!svg) throw new Error("brush svg not found");
  return { ...r, svg };
}

const idxToX = (i: number, n: number) => PAD_LEFT + (i / (n - 1)) * PLOT_W;
const last = (xs: Read[]) => xs[xs.length - 1];

async function zoomTo100to199(getByTestId: (id: string) => HTMLElement) {
  await act(async () => {
    fireEvent.click(getByTestId("zoom"));
  });
}

describe("MasterBrush drag holds the windowed view and derives once on release (169.1 review MD-01)", () => {
  it("a 6-move pan runs no derive while dragging and exactly one on release, equal to windowView of the final range", async () => {
    const payload = build400();
    const n = payload.dates.length;
    const { svg, getByTestId } = mount(payload);
    await zoomTo100to199(getByTestId);
    expect(last(strip).scope).toMatchObject({ kind: "selected", startIdx: 100, endIdx: 199 });

    const before = bootCalls.n;
    const x0 = idxToX(150, n);
    await act(async () => {
      fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: x0 });
    });
    for (let k = 1; k <= 6; k++) {
      await act(async () => {
        fireEvent.pointerMove(svg, { pointerId: 1, clientX: x0 + k * 15 });
      });
      // The charts follow the live range (it moved) ...
      expect(live()[0], `move ${k}`).toBeGreaterThan(100);
      // ... while the strip and the rail stay on the start range and its figures.
      expect(last(strip).scope, `move ${k}`).toMatchObject({ startIdx: 100, endIdx: 199 });
      expect(last(rail).scope, `move ${k}`).toMatchObject({ startIdx: 100, endIdx: 199 });
    }
    expect(bootCalls.n - before, "derives during the drag").toBe(0);

    await act(async () => {
      fireEvent.pointerUp(svg, { pointerId: 1, clientX: x0 + 90 });
    });
    const [s, e] = live();
    expect(s).toBeGreaterThan(100);
    expect(bootCalls.n - before, "derives after release (strip and rail share one)").toBe(1);
    for (const sink of [strip, rail]) {
      expect(last(sink).scope).toMatchObject({ kind: "selected", startIdx: s, endIdx: e });
    }
    // The settled figures are exactly a drag-free derive of the final range.
    const want = windowView(payload, s, e);
    expect(last(strip).view.strategyMetrics).toEqual(want.strategyMetrics);
    expect(last(strip).view.bootstrapCI).toEqual(want.bootstrapCI);
    expect(last(strip).view.strategyWorst10).toEqual(want.strategyWorst10);
    expect(last(rail).view).toBe(last(strip).view);
  });

  it("a pointer cancel ends the hold like a pointer up", async () => {
    const payload = build400();
    const n = payload.dates.length;
    const { svg, getByTestId } = mount(payload);
    await zoomTo100to199(getByTestId);
    const x0 = idxToX(150, n);
    await act(async () => {
      fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: x0 });
    });
    await act(async () => {
      fireEvent.pointerMove(svg, { pointerId: 1, clientX: x0 + 40 });
    });
    expect(last(strip).scope).toMatchObject({ startIdx: 100, endIdx: 199 });
    await act(async () => {
      fireEvent.pointerCancel(svg, { pointerId: 1 });
    });
    expect(last(strip).scope).toMatchObject({ startIdx: live()[0], endIdx: live()[1] });
    expect(live()[0]).toBeGreaterThan(100);
  });

  it("unmounting the brush mid-drag releases the hold, so the strip never freezes", async () => {
    const payload = build400();
    const n = payload.dates.length;
    const { svg, getByTestId } = mount(payload);
    await zoomTo100to199(getByTestId);
    const x0 = idxToX(150, n);
    await act(async () => {
      fireEvent.pointerDown(svg, { button: 0, pointerId: 1, clientX: x0 });
    });
    await act(async () => {
      fireEvent.pointerMove(svg, { pointerId: 1, clientX: x0 + 40 });
    });
    expect(last(strip).scope).toMatchObject({ startIdx: 100, endIdx: 199 });
    await act(async () => {
      fireEvent.click(getByTestId("unmount-brush"));
    });
    expect(last(strip).scope).toMatchObject({ startIdx: live()[0], endIdx: live()[1] });
    expect(live()[0]).toBeGreaterThan(100);
  });

  it("a range set outside a gesture (a button, a chart, the URL) still derives at once", async () => {
    const payload = build400();
    const { getByTestId } = mount(payload);
    const before = bootCalls.n;
    await zoomTo100to199(getByTestId);
    expect(last(strip).scope).toMatchObject({ kind: "selected", startIdx: 100, endIdx: 199 });
    expect(bootCalls.n - before).toBe(1);
  });
});
