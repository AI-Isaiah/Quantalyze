/** @vitest-environment jsdom */
/**
 * Phase 48 / CHART-01b — EquityChart touch-path parity test.
 *
 * Wave 0 SCAFFOLD (pending) — plan 03 wires useTapPin onto EquityChart's
 * existing <svg> (additive pointer path; the desktop onMouseMove/handleMove
 * mouse path stays BYTE-IDENTICAL) and SATISFIES this test. Until then the
 * single parity assertion is `.todo` so it neither fails nor false-passes.
 *
 * What plan 03 must prove (the parity contract): a tap's pointerToIndex maps a
 * client X coordinate to the SAME data index the desktop hover's handleMove
 * computes — so tapping pins exactly what hovering shows. The mapping chain to
 * mirror, byte-for-byte, from handleMove (EquityChart.tsx:1142-1159):
 *
 *   px         = clientX - rect.left
 *   clampedPx  = Math.max(pad.l, Math.min(pad.l + chartW, px))   // clamp to chart area
 *   targetEpoch= firstEpochX + ((clampedPx - pad.l) / chartW) * totalMs
 *   index      = nearestIndex(visibleEpochs, targetEpoch)        // O(log n) binary-search
 *
 * useTapPin({ count: n, pointerToIndex }) must reuse this EXACT chain (RESEARCH
 * Pattern 2) so `nearestIndex(visibleEpochs, targetEpoch)` returns the index
 * handleMove sets on hoverIdx for the same coordinate. Edge arms plan 03 covers:
 *   - n === 0 → null (no selection)
 *   - n === 1 → 0
 *   - off-grid / out-of-bounds px → clamped, never an impossible epoch
 *
 * Implementation note for plan 03: prefer extracting pointerToIndex as a pure
 * fn (clientX, rect) => number | null so it is unit-testable WITHOUT mounting
 * the 2277-LOC chart, then assert it returns the same index handleMove's chain
 * yields for a set of coordinates. Do NOT add selectedIdx/pinned to the
 * projection useMemo deps (Pitfall 7) and do NOT touch the ResizeObserver
 * measured-width path (verify-only).
 */
import { describe, it } from "vitest";

describe("[CHART-01b] EquityChart touch path — pointerToIndex parity", () => {
  // Pending until plan 03 wires useTapPin + extracts pointerToIndex. A .todo
  // test reports as pending (0 failures) and is a visible TODO in the runner,
  // unlike a silent .skip — it keeps the parity contract on the radar.
  it.todo(
    "pointerToIndex maps px->nearestIndex identically to handleMove (plan 03)",
  );
});
