"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { usePayload, useXRange } from "./factsheet-context";

/**
 * Master brush — a mini equity-curve overview pinned above the chart stack.
 *
 * Behavior:
 *   - Renders the full-history strategy equity in a 60px tall sparkline.
 *   - A draggable translucent window overlays the current xRange.
 *   - Drag inside the window → pan xRange.
 *   - Drag a left/right edge handle → resize xRange.
 *   - Click outside the window → re-anchor the window at click point,
 *     preserving its current width.
 *   - Double-click anywhere → reset to full range.
 *
 * Bidirectional: any chart that changes xRange via context re-paints the
 * brush window without a round-trip, since context is the single source of
 * truth for the visible window.
 */

const VB_W = 1100;
const VB_H = 60;
const PAD = { top: 6, right: 6, bottom: 16, left: 6 };
const PLOT_W = VB_W - PAD.left - PAD.right;
const PLOT_H = VB_H - PAD.top - PAD.bottom;
const HANDLE_W = 8; // px in viewBox space — visible handle width
// Hit-test radius for handles, in viewBox px. Wider than the visible handle so
// touch users get a 44+px tap target without the UI looking chunky. The
// onPointerDown check uses HANDLE_HIT_W; the visible <rect>s keep HANDLE_W.
const HANDLE_HIT_W = 28;
const MIN_VISIBLE = 5;

export function MasterBrush() {
  const payload = usePayload();
  const { xRange, setXRange, resetXRange } = useXRange();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<
    | { mode: "pan" | "left" | "right" | "select"; startVbX: number; startRange: readonly [number, number] }
    | null
  >(null);
  // isDragging mirrors dragRef as React state so the cursor swap actually
  // re-renders — ref mutation alone never triggers React. (H3 fix)
  const [isDragging, setIsDragging] = useState(false);

  const n = payload.dates.length;
  const eq = payload.strategyEquity;

  // Sparkline path on log y-scale — equity growth is multiplicative so log
  // keeps early-period detail visible alongside late-period gains.
  const path = useMemo(() => {
    if (eq.length < 2) return "";
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of eq) {
      if (!Number.isFinite(v) || v <= 0) continue;
      const lv = Math.log(v);
      if (lv < lo) lo = lv;
      if (lv > hi) hi = lv;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
      lo = 0;
      hi = 1;
    }
    const parts: string[] = [];
    for (let i = 0; i < eq.length; i++) {
      const v = eq[i];
      if (!Number.isFinite(v) || v <= 0) continue;
      const x = PAD.left + (i / (eq.length - 1)) * PLOT_W;
      const y = PAD.top + (1 - (Math.log(v) - lo) / (hi - lo)) * PLOT_H;
      parts.push(`${parts.length === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return parts.join(" ");
  }, [eq]);

  const idxToX = useCallback(
    (i: number) => PAD.left + (n > 1 ? i / (n - 1) : 0) * PLOT_W,
    [n],
  );
  const xToIdx = useCallback(
    (vbX: number) => {
      if (n < 2) return 0;
      const t = (vbX - PAD.left) / PLOT_W;
      return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
    },
    [n],
  );

  const [xs, xe] = xRange;
  const winLeftPx = idxToX(xs);
  const winRightPx = idxToX(xe);
  const winWidthPx = Math.max(2, winRightPx - winLeftPx);

  const clientToVbX = (clientX: number, rect: DOMRect): number =>
    ((clientX - rect.left) / rect.width) * VB_W;

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const vbX = clientToVbX(e.clientX, rect);
      e.currentTarget.setPointerCapture(e.pointerId);
      // Hit-test handles first, then window body, then plot background.
      if (Math.abs(vbX - winLeftPx) <= HANDLE_HIT_W) {
        dragRef.current = { mode: "left", startVbX: vbX, startRange: xRange };
      } else if (Math.abs(vbX - winRightPx) <= HANDLE_HIT_W) {
        dragRef.current = { mode: "right", startVbX: vbX, startRange: xRange };
      } else if (vbX > winLeftPx && vbX < winRightPx) {
        dragRef.current = { mode: "pan", startVbX: vbX, startRange: xRange };
      } else {
        // Outside the window: re-anchor a NEW selection of the same width
        // centred on the click point. Single-click jump, no drag required.
        const span = xe - xs;
        const center = xToIdx(vbX);
        let s = Math.max(0, center - Math.floor(span / 2));
        let eN = Math.min(n - 1, s + span);
        if (eN === n - 1) s = Math.max(0, eN - span);
        setXRange([s, eN]);
        dragRef.current = { mode: "select", startVbX: vbX, startRange: [s, eN] as const };
      }
      setIsDragging(true);
    },
    [winLeftPx, winRightPx, xRange, xs, xe, n, setXRange, xToIdx],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (!dragRef.current) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const vbX = clientToVbX(e.clientX, rect);
      const dVb = vbX - dragRef.current.startVbX;
      const dIdx = Math.round((dVb / PLOT_W) * (n - 1));
      const [s0, e0] = dragRef.current.startRange;
      let s = s0;
      let eN = e0;
      switch (dragRef.current.mode) {
        case "pan": {
          s = s0 + dIdx;
          eN = e0 + dIdx;
          if (s < 0) { eN -= s; s = 0; }
          if (eN > n - 1) { s -= eN - (n - 1); eN = n - 1; }
          break;
        }
        case "left": {
          s = Math.max(0, Math.min(e0 - (MIN_VISIBLE - 1), s0 + dIdx));
          break;
        }
        case "right": {
          eN = Math.min(n - 1, Math.max(s0 + (MIN_VISIBLE - 1), e0 + dIdx));
          break;
        }
        case "select": {
          // Re-anchor: window grows/shrinks around the original click point.
          const center = xToIdx(dragRef.current.startVbX);
          const half = Math.max(MIN_VISIBLE, Math.abs(dIdx));
          s = Math.max(0, center - half);
          eN = Math.min(n - 1, center + half);
          break;
        }
      }
      setXRange([s, eN]);
    },
    [n, setXRange, xToIdx],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      dragRef.current = null;
      setIsDragging(false);
    }
  }, []);

  const onDoubleClick = useCallback(() => {
    resetXRange();
  }, [resetXRange]);

  // Date labels at the brush window edges so the user always sees the absolute
  // boundaries of what's selected, not just the relative slider position.
  const startDate = payload.dates[xs] ?? "—";
  const endDate = payload.dates[xe] ?? "—";

  return (
    <section
      className="mt-6 border border-border bg-surface p-2"
      aria-label="Master timeline brush"
    >
      <div className="flex items-baseline justify-between px-1 pb-1 text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted">
        <span>Timeline</span>
        <span className="normal-case tracking-normal text-text-2">
          {startDate} → {endDate}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        // Brush is wide + short; meet preserves the natural aspect so the
        // sparkline doesn't squish horizontally on narrow viewports. Tooltip
        // and drag math use rect.width / VB_W ratio, so meet is safe here.
        preserveAspectRatio="xMidYMid meet"
        className="block w-full select-none"
        style={{ aspectRatio: `${VB_W} / ${VB_H}`, maxHeight: VB_H, width: "100%", height: "auto", cursor: isDragging ? "grabbing" : "default" }}
        role="img"
        aria-label="Master brush — full timeline equity overview"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {/* Plot background */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={PLOT_W}
          height={PLOT_H}
          fill="var(--color-surface-subtle, #FBFCFD)"
        />
        {/* Sparkline */}
        <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={1.4} strokeLinejoin="round" />
        {/* Unselected dimming on the left + right of the window */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={Math.max(0, winLeftPx - PAD.left)}
          height={PLOT_H}
          fill="var(--color-text)"
          fillOpacity={0.08}
        />
        <rect
          x={winRightPx}
          y={PAD.top}
          width={Math.max(0, PAD.left + PLOT_W - winRightPx)}
          height={PLOT_H}
          fill="var(--color-text)"
          fillOpacity={0.08}
        />
        {/* Window outline */}
        <rect
          x={winLeftPx}
          y={PAD.top}
          width={winWidthPx}
          height={PLOT_H}
          fill="var(--color-accent)"
          fillOpacity={0.06}
          stroke="var(--color-accent)"
          strokeWidth={1}
          style={{ cursor: "grab" }}
        />
        {/* Left handle */}
        <rect
          x={winLeftPx - 1}
          y={PAD.top}
          width={2}
          height={PLOT_H}
          fill="var(--color-accent)"
        />
        <rect
          x={winLeftPx - HANDLE_W / 2}
          y={PAD.top + PLOT_H / 2 - 8}
          width={HANDLE_W}
          height={16}
          rx={1}
          fill="var(--color-accent)"
          style={{ cursor: "ew-resize" }}
        />
        {/* Right handle */}
        <rect
          x={winRightPx - 1}
          y={PAD.top}
          width={2}
          height={PLOT_H}
          fill="var(--color-accent)"
        />
        <rect
          x={winRightPx - HANDLE_W / 2}
          y={PAD.top + PLOT_H / 2 - 8}
          width={HANDLE_W}
          height={16}
          rx={1}
          fill="var(--color-accent)"
          style={{ cursor: "ew-resize" }}
        />
        {/* X-axis baseline + sparse year ticks */}
        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={PAD.top + PLOT_H}
          y2={PAD.top + PLOT_H}
          stroke="var(--color-text)"
          strokeWidth={1}
        />
        {yearTicks(payload.dates).map(t => (
          <g key={`y-${t.idx}`}>
            <line
              x1={idxToX(t.idx)}
              x2={idxToX(t.idx)}
              y1={PAD.top + PLOT_H}
              y2={PAD.top + PLOT_H + 3}
              stroke="var(--color-text-muted)"
              strokeWidth={1}
            />
            <text
              x={idxToX(t.idx)}
              y={PAD.top + PLOT_H + 12}
              textAnchor="middle"
              fontSize={9}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-muted)"
            >
              {t.label}
            </text>
          </g>
        ))}
      </svg>
    </section>
  );
}

function yearTicks(dates: string[]): { idx: number; label: string }[] {
  if (dates.length === 0) return [];
  const out: { idx: number; label: string }[] = [];
  let lastYr = "";
  for (let i = 0; i < dates.length; i++) {
    const yr = dates[i].slice(0, 4);
    if (yr !== lastYr) {
      out.push({ idx: i, label: yr });
      lastYr = yr;
    }
  }
  return out;
}
