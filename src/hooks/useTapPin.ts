"use client";

import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

/**
 * Phase 47 / CHART-01a — the shared tap-vs-drag + pin-toggle gesture core.
 *
 * Extracted verbatim from the reference `TimeSeriesChart`'s touch tap-to-pin
 * recipe (src/app/factsheet/[id]/v2/TimeSeriesChart.tsx:44–379) so the
 * hand-rolled SVG charts that have a desktop value-reveal (StreakDistribution,
 * DailyReturnsHeatmap, DailyHeatmap) can offer the SAME touch affordance —
 * a tap reveals (and pins) the value hover gives on desktop — WITHOUT each
 * chart re-implementing the slop/time/touch-only/re-tap-toggle/leave-survival
 * semantics (the locked DRY decision).
 *
 * This hook owns ONLY the gesture core. It deliberately EXCLUDES the
 * line-chart-specific navigation machinery (drag-to-scroll, scale-on-scroll,
 * scroll-range, deferred-tooltip rendering) — that stays in TimeSeriesChart
 * (which is NOT refactored to consume this hook; its parity behaviour must
 * stay byte-identical).
 *
 * The consuming chart supplies a `pointerToIndex(clientX, clientY, rect)`
 * callback that maps the pointer position to a chart-specific selectable index
 * (a heatmap cell, a bar, a period column …) or `null` when the pointer is
 * outside the selectable region. The hook returns `selectedIdx` / `pinned`;
 * the chart renders its OWN value reveal from `selectedIdx`, reading the value
 * out of its precomputed payload (NEVER recomputing it).
 */

/**
 * Tap slop, squared (8px² = 64). A gesture that moves more than 8px from the
 * pointerdown origin is a drag, not a tap. Squared so the comparison avoids a
 * sqrt — verbatim from TimeSeriesChart.tsx:229.
 */
export const TAP_SLOP_SQ = 64;

/**
 * Max tap duration in ms. A pointer held longer than this is a press/drag, not
 * a tap — verbatim from TimeSeriesChart.tsx:359.
 */
export const TAP_MAX_MS = 350;

/**
 * Re-tap proximity threshold (in index units). Tapping within this many indices
 * of the current pin toggles the pin OFF; tapping further away moves it —
 * verbatim from TimeSeriesChart.tsx:372.
 */
export const RETAP_THRESHOLD = 3;

export interface UseTapPinOptions {
  /** Number of selectable indices; `selectedIdx` is clamped to `[0, count-1]`. */
  count: number;
  /**
   * Map a pointer position to a (possibly fractional) selectable index, or
   * `null` when the pointer is outside the selectable region. The hook clamps
   * and rounds the result; a `null` clears + un-pins the current selection.
   */
  pointerToIndex: (
    clientX: number,
    clientY: number,
    rect: DOMRect,
  ) => number | null;
}

export interface UseTapPin {
  /** The currently selected index, or `null` when nothing is selected. */
  selectedIdx: number | null;
  /** Whether the current selection is pinned (survives `pointerleave`). */
  pinned: boolean;
  /** Attach to the consuming `<svg>` so the hook can read its bounding rect. */
  svgRef: RefObject<SVGSVGElement | null>;
  onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<SVGSVGElement>) => void;
}

export function useTapPin(opts: UseTapPinOptions): UseTapPin {
  const { count, pointerToIndex } = opts;

  // selectedIdx is the generalised `crossIdx` from the reference chart.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  // When the user taps on touch, the selection "pins" — it stays visible after
  // pointerup so they can read the value without keeping a finger on the chart.
  // pointerleave clears UNPINNED selections only.
  const [pinned, setPinned] = useState(false);
  // Tap-detection bookkeeping: if the pointer never moved beyond TAP_SLOP and
  // the gesture lasted < TAP_MAX_MS, treat it as a tap rather than a drag.
  const tapInfoRef = useRef<{
    x: number;
    y: number;
    t: number;
    type: string;
  } | null>(null);
  const movedRef = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      // Record tap-start for the touch tap-to-pin detection in onPointerUp.
      tapInfoRef.current = {
        x: e.clientX,
        y: e.clientY,
        t: Date.now(),
        type: e.pointerType,
      };
      movedRef.current = false;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* setPointerCapture may throw if the pointer is no longer active */
      }
    },
    [],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    // Flip movedRef once the gesture exceeds the tap slop. Reading movedRef in
    // onPointerUp distinguishes a tap from a drag.
    if (tapInfoRef.current) {
      const dx = e.clientX - tapInfoRef.current.x;
      const dy = e.clientY - tapInfoRef.current.y;
      if (dx * dx + dy * dy > TAP_SLOP_SQ) movedRef.current = true;
    }
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
      // Tap-to-pin: a touch gesture that never moved beyond TAP_SLOP and lasted
      // < TAP_MAX_MS is a tap, not a drag. Pin the selection at the tap point so
      // the value stays visible after the finger lifts. A pinned tap that
      // re-taps within RETAP_THRESHOLD (toggling) clears the pin instead.
      const ti = tapInfoRef.current;
      tapInfoRef.current = null;
      if (!ti || ti.type !== "touch" || movedRef.current) return;
      if (Date.now() - ti.t > TAP_MAX_MS) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const idxF = pointerToIndex(e.clientX, e.clientY, rect);
      if (idxF == null) {
        // Tap outside the selectable region — clear any existing pin.
        setPinned(false);
        setSelectedIdx(null);
        return;
      }
      const idx = Math.max(0, Math.min(count - 1, Math.round(idxF)));
      // Re-tap near an existing pinned point → un-pin.
      if (pinned && selectedIdx != null && Math.abs(idx - selectedIdx) < RETAP_THRESHOLD) {
        setPinned(false);
        setSelectedIdx(null);
      } else {
        setSelectedIdx(idx);
        setPinned(true);
      }
    },
    [pointerToIndex, count, pinned, selectedIdx],
  );

  const onPointerLeave = useCallback(() => {
    // Pinned selection survives pointerleave (touch users lift their finger and
    // still want to read the value). Unpinned selections clear.
    if (!pinned) setSelectedIdx(null);
  }, [pinned]);

  return {
    selectedIdx,
    pinned,
    svgRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
  };
}
