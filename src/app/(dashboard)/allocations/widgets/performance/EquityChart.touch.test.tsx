/** @vitest-environment jsdom */
/**
 * Phase 48 / CHART-01b — EquityChart touch-path parity test.
 *
 * Plan 03 wires the Phase-47 `useTapPin` hook onto EquityChart's existing
 * `<svg>` (an ADDITIVE pointer path; the desktop onMouseMove/handleMove mouse
 * path stays BYTE-IDENTICAL). The falsifiable proof that a tap pins exactly
 * what hover shows is that `pointerToIndex` and `handleMove` route through ONE
 * shared pure helper — `epochIndexFromPx` — so parity is STRUCTURAL, not
 * asserted-by-coincidence.
 *
 * The mapping chain (mirrored from handleMove, EquityChart.tsx:1142-1159):
 *
 *   px         = clientX - rect.left
 *   clampedPx  = Math.max(pad.l, Math.min(pad.l + chartW, px))   // clamp to chart area
 *   targetEpoch= firstEpochX + ((clampedPx - pad.l) / chartW) * totalMs
 *   index      = nearestIndex(visibleEpochs, targetEpoch)        // O(log n) binary-search
 *
 * Edge arms (handleMove's own early returns, folded into the helper):
 *   - n === 0 → null (no selectable index)
 *   - n === 1 → 0
 *   - px left of pad.l   → clamps to the first index
 *   - px right of pad.l+chartW → clamps to the last index
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { EquityChart, epochIndexFromPx, nearestIndex } from "./EquityChart";

// A simple monotonic series — enough points that the projection is non-null and
// the chart renders its <svg> (mirrors EquityChart.test.tsx's makeSeries).
function makeRenderSeries(n: number): DailyPoint[] {
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

// A small, fixed geometry mirroring the projection's coordinate space. pad.l=8
// and chartW=888 reproduce the production padding (pad = {t,r,b,l}, l=8; chartW
// = width - pad.l - pad.r = 960 - 8 - 64 = 888 at the default 960px width).
const PAD_L = 8;
const CHART_W = 888;

// A uniformly-spaced 10-day window (epoch ms, UTC midnights). firstEpochX is the
// first epoch; totalMs spans the whole window. visibleEpochs is sorted ascending
// by construction (the chart's invariant).
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST = Date.UTC(2024, 0, 1);
function makeEpochs(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(FIRST + i * DAY_MS);
  return out;
}

// The reference computation — a literal transcription of handleMove's body
// (EquityChart.tsx:1142-1159) for a given px. The test asserts the extracted
// helper produces the SAME index for the same px, so the production helper and
// handleMove cannot drift (they share `epochIndexFromPx` by construction; this
// reference is the independent oracle that the shared helper is correct).
function handleMoveReference(
  px: number,
  geom: {
    padL: number;
    chartW: number;
    firstEpochX: number;
    totalMs: number;
    visibleEpochs: number[];
    n: number;
  },
): number | null {
  const { padL, chartW, firstEpochX, totalMs, visibleEpochs, n } = geom;
  if (n === 0) return null;
  if (n === 1) return 0;
  const clampedPx = Math.max(padL, Math.min(padL + chartW, px));
  const targetEpoch = firstEpochX + ((clampedPx - padL) / chartW) * totalMs;
  return nearestIndex(visibleEpochs, targetEpoch);
}

describe("[CHART-01b] EquityChart touch path — pointerToIndex parity", () => {
  it("epochIndexFromPx maps px->nearestIndex identically to handleMove across the window", () => {
    const visibleEpochs = makeEpochs(10);
    const n = visibleEpochs.length;
    const firstEpochX = visibleEpochs[0];
    const totalMs = visibleEpochs[n - 1] - firstEpochX;
    const geom = { padL: PAD_L, chartW: CHART_W, firstEpochX, totalMs, visibleEpochs, n };

    // Sweep px across the chart area (and a little past each edge) — at every
    // sample the extracted helper must equal handleMove's chain. This is the
    // load-bearing assertion: tap pins exactly what hover reveals.
    for (let px = PAD_L - 30; px <= PAD_L + CHART_W + 30; px += 7) {
      expect(epochIndexFromPx(px, geom)).toBe(handleMoveReference(px, geom));
    }
  });

  it("n === 0 → epochIndexFromPx returns null (no selectable index)", () => {
    const geom = {
      padL: PAD_L,
      chartW: CHART_W,
      firstEpochX: 0,
      totalMs: 0,
      visibleEpochs: [] as number[],
      n: 0,
    };
    // Any px is meaningless when there is nothing to select.
    expect(epochIndexFromPx(PAD_L + 100, geom)).toBeNull();
    expect(epochIndexFromPx(0, geom)).toBeNull();
    // Parity with handleMove's `if (n === 0) return;` (no hover set → null here).
    expect(epochIndexFromPx(PAD_L + 100, geom)).toBe(
      handleMoveReference(PAD_L + 100, geom),
    );
  });

  it("n === 1 → epochIndexFromPx returns 0 for any px", () => {
    const visibleEpochs = makeEpochs(1);
    const geom = {
      padL: PAD_L,
      chartW: CHART_W,
      firstEpochX: visibleEpochs[0],
      totalMs: 0,
      visibleEpochs,
      n: 1,
    };
    // handleMove sets hoverIdx(0) unconditionally for a single-point window.
    expect(epochIndexFromPx(PAD_L - 50, geom)).toBe(0);
    expect(epochIndexFromPx(PAD_L + CHART_W / 2, geom)).toBe(0);
    expect(epochIndexFromPx(PAD_L + CHART_W + 50, geom)).toBe(0);
    expect(epochIndexFromPx(PAD_L + 100, geom)).toBe(
      handleMoveReference(PAD_L + 100, geom),
    );
  });

  it("px left of pad.l clamps to the first index; px right of pad.l+chartW clamps to the last", () => {
    const visibleEpochs = makeEpochs(10);
    const n = visibleEpochs.length;
    const firstEpochX = visibleEpochs[0];
    const totalMs = visibleEpochs[n - 1] - firstEpochX;
    const geom = { padL: PAD_L, chartW: CHART_W, firstEpochX, totalMs, visibleEpochs, n };

    // Far left of the chart area → clamps to index 0 (same clamp as handleMove).
    expect(epochIndexFromPx(PAD_L - 1000, geom)).toBe(0);
    expect(epochIndexFromPx(PAD_L - 1000, geom)).toBe(
      handleMoveReference(PAD_L - 1000, geom),
    );
    // Far right of the chart area → clamps to the last index.
    expect(epochIndexFromPx(PAD_L + CHART_W + 1000, geom)).toBe(n - 1);
    expect(epochIndexFromPx(PAD_L + CHART_W + 1000, geom)).toBe(
      handleMoveReference(PAD_L + CHART_W + 1000, geom),
    );
  });

  it("pointerToIndex(clientX, _y, rect) subtracts rect.left then routes through epochIndexFromPx", () => {
    // pointerToIndex is the useTapPin adapter: px = clientX - rect.left, then the
    // SAME helper. Proven here against the helper directly (the production
    // pointerToIndex closure reuses epochIndexFromPx with px = clientX-rect.left).
    const visibleEpochs = makeEpochs(10);
    const n = visibleEpochs.length;
    const firstEpochX = visibleEpochs[0];
    const totalMs = visibleEpochs[n - 1] - firstEpochX;
    const geom = { padL: PAD_L, chartW: CHART_W, firstEpochX, totalMs, visibleEpochs, n };

    const rectLeft = 120;
    const clientX = rectLeft + PAD_L + CHART_W * 0.5; // pointer at the window centre
    const px = clientX - rectLeft;
    expect(epochIndexFromPx(px, geom)).toBe(handleMoveReference(px, geom));
  });
});

// WR-02 (code review): the parity test above exercises only the pure helper.
// This render-level test proves the WIRING — that the rendered <svg> actually
// carries useTapPin's `setChartEl` ref + `onPointer*` handlers and a `count`
// that pins, and that the `reveal` pipeline renders from a tap. A dropped
// onPointer prop, a wrong `count`, or a broken setChartEl ref would all leave
// the crosshair absent after a tap and fail here (the unit-helper test would
// not catch any of them).
describe("[CHART-01b] EquityChart touch path — rendered wiring (WR-02)", () => {
  // The reveal crosshair is the only <line> drawn with a "2 2" dasharray
  // (EquityChart.tsx:1689); it renders ONLY when `reveal != null`.
  const crosshairCount = (container: HTMLElement) =>
    container.querySelectorAll('svg line[stroke-dasharray="2 2"]').length;

  it("a touch tap on the <svg> pins the reveal crosshair (full setChartEl + onPointer wiring)", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={makeRenderSeries(200)} initialPeriod="ALL" />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // Nothing pinned/hovered yet → no reveal crosshair.
    expect(crosshairCount(container)).toBe(0);

    // A touch tap: pointerdown→pointerup at the same point, pointerType "touch",
    // matching pointerId, synchronous (well under TAP_MAX_MS), zero movement.
    fireEvent.pointerDown(svg!, {
      pointerId: 1,
      clientX: 400,
      clientY: 120,
      pointerType: "touch",
    });
    fireEvent.pointerUp(svg!, {
      pointerId: 1,
      clientX: 400,
      clientY: 120,
      pointerType: "touch",
    });

    // The tap pinned a value → the reveal crosshair is now drawn.
    expect(crosshairCount(container)).toBeGreaterThan(0);
  });

  it("a hover at a DIFFERENT point does not move a tap-pin (pin-first precedence, WR-01 guard)", () => {
    const { container } = render(
      <EquityChart equityDailyPoints={makeRenderSeries(200)} initialPeriod="ALL" />,
    );
    const svg = container.querySelector("svg")!;
    // Pin via a touch tap on the RIGHT side of the chart.
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 600, clientY: 120, pointerType: "touch" });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 600, clientY: 120, pointerType: "touch" });
    const crosshair = () =>
      container.querySelector('svg line[stroke-dasharray="2 2"]');
    const pinnedX = crosshair()?.getAttribute("x1");
    expect(pinnedX).toBeTruthy();

    // Now hover the mouse FAR to the left — handleMove sets `hoverIdx` to a
    // different index. With pin-first `reveal = tap.selectedIdx ?? hoverIdx`,
    // the crosshair MUST stay at the pinned x. Under the inverted (buggy)
    // `hoverIdx ?? tap.selectedIdx`, the stray hover would move it → this fails.
    fireEvent.mouseMove(svg, { clientX: 60, clientY: 120 });
    expect(crosshair()?.getAttribute("x1")).toBe(pinnedX);
  });
});
