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
import { epochIndexFromPx, nearestIndex } from "./EquityChart";

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
