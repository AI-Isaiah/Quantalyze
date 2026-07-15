"use client";

import { memo, useDeferredValue, useMemo, useRef, useState, useCallback, useEffect } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { usePayload, useXRange, useActiveComparator, useRegimes } from "./factsheet-context";
import { useBasisSeriesView } from "./basis-context";
import { resolveSeries, type ChartConfig, type ChartValueFormat, type ResolvedSeries } from "./chart-configs";
import { trackFactsheetEvent } from "./factsheet-analytics";
import { ResponsiveChartFrame } from "@/components/ResponsiveChartFrame";

const VB_W = 880;
const PAD = { top: 20, right: 30, bottom: 24, left: 50 };
const MIN_VISIBLE = 5;

/** Binary search: exact ordinal index of `target` in ascending ISO-date
 *  `dates`, or -1 if absent. ISO YYYY-MM-DD strings sort lexicographically =
 *  chronologically, so plain string compare is correct. (FS-01 boundary lookup) */
function indexOfDate(dates: readonly string[], target: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = dates[mid];
    if (d === target) return mid;
    if (d < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** First index whose date sorts strictly AFTER `target` (insertion point past
 *  it). Gap days are absent from `dates` (FS-02 / CONTEXT D4), so a gap collapses
 *  to a zero-width seam at the first present index following the hole's end. */
function firstIndexAfter(dates: readonly string[], target: string): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Generic comparator-reactive time series chart. Replaces the single-purpose
 * CumulativeChart from slice 1. Driven by a `ChartConfig` describing which
 * strategy/comparator series feed it, what numeric format the values use,
 * and whether log/linear toggle + warmup band apply.
 *
 * Each instance subscribes to the FactsheetProvider — picker swaps trigger a
 * re-resolution of the comparator series, the rest of the chart re-renders
 * automatically.
 */
/**
 * Memoized: identity-stable `config` (from constant CHART_CONFIGS) + reference-
 * stable context values mean React.memo's default shallow check is correct here.
 * Cuts re-renders during pan/zoom on charts that don't depend on the changed
 * comparator slice.
 */
export const TimeSeriesChart = memo(TimeSeriesChartInner);

function TimeSeriesChartInner({ config }: { config: ChartConfig }) {
  // Phase 103 (MTM-04): every series/dates/marker/worst-10/comparator read goes
  // through the active-basis view — under mark_to_market with a bundle it is the
  // MTM merge ({...payload, ...seriesByBasis.mark_to_market}); under cash or an
  // absent bundle it is the original payload by reference (byte-identical render).
  const view = useBasisSeriesView(usePayload());
  const { xRange, setXRange, resetXRange } = useXRange();
  const regimes = useRegimes();
  // The comparator KEY is picker state (frozen context); the comparator BLOCK
  // must come from the VIEW so the MTM axis and the comparator arrays share ONE
  // coherent date axis (Pitfall-1). Under cash view.comparators === cash top-level.
  const { key: cmpKey } = useActiveComparator();
  const cmp = view.comparators[cmpKey];

  const height = config.height ?? 280;
  const plotW = VB_W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const [scale, setScale] = useState<"log" | "linear">(config.defaultScale);
  const [muted, setMuted] = useState<Set<number>>(() => new Set());
  const [crossIdx, setCrossIdx] = useState<number | null>(null);
  // When the user taps on touch the crosshair "pins" — stays visible after
  // pointerup so they can read the value without keeping a finger on the
  // chart. pointerleave clears unpinned crosshairs only.
  const [pinned, setPinned] = useState(false);
  // Tap-detection bookkeeping: if pointer never moved beyond TAP_SLOP and the
  // gesture lasted < TAP_MS, treat as a tap rather than a drag.
  const tapInfoRef = useRef<{ x: number; y: number; t: number; type: string } | null>(null);
  const movedRef = useRef(false);
  // useDeferredValue: mousemove fires 60+/sec and re-renders the heavy tooltip
  // structure. Deferring it lets React prioritize the crosshair line update
  // (cheap) over the per-series value strings (expensive on series with 1000+
  // points) so dragging feels smooth even on slower machines.
  const deferredCrossIdx = useDeferredValue(crossIdx);
  // Y-axis pull/zoom: when the user drags in the left axis gutter (or pinches),
  // override the auto-fit yDomain. Cleared on double-click reset.
  const [yOverride, setYOverride] = useState<[number, number] | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<{ startX: number; startRange: readonly [number, number] } | null>(null);
  // y-drag mode: anchor the cursor's data value and scale the domain around it
  // as the user drags up/down. dy in pixels → multiplicative scale factor.
  const yDragRef = useRef<{ startY: number; startDomain: [number, number]; anchor: number } | null>(null);
  // x-drag mode: vertical drag in the bottom X-axis gutter scales the x-range
  // around the cursor's index anchor. Drag UP compresses the span (zoom in);
  // drag DOWN expands it (zoom out). Symmetric to the Y-gutter pull.
  const xDragRef = useRef<{ startY: number; startRange: readonly [number, number]; anchor: number } | null>(null);

  // Rebase-on-zoom requires xStart so resolveSeries can divide by series[xStart].
  const series = useMemo<ResolvedSeries[]>(
    () => resolveSeries(config, view, cmp, xRange[0]),
    [config, view, cmp, xRange],
  );

  // Regime segmentation from the comparator's rolling Sharpe sign. Bull when
  // positive, bear when negative. Cheap walk through the array. Empty unless
  // the regimes toggle is on AND a comparator is active AND its rolling
  // Sharpe series exists. Recomputed only when those inputs change.
  const regimeSegments = useMemo<{ start: number; end: number; bull: boolean }[]>(() => {
    if (!regimes || cmpKey === "none" || !cmp.rollingSharpe) return [];
    const segs: { start: number; end: number; bull: boolean }[] = [];
    let curStart = -1;
    let curBull: boolean | null = null;
    for (let i = 0; i < cmp.rollingSharpe.length; i++) {
      const v = cmp.rollingSharpe[i];
      if (v == null || !Number.isFinite(v)) continue;
      const bull = v > 0;
      if (curBull == null) {
        curStart = i;
        curBull = bull;
      } else if (bull !== curBull) {
        segs.push({ start: curStart, end: i - 1, bull: curBull });
        curStart = i;
        curBull = bull;
      }
    }
    if (curBull != null && curStart !== -1) {
      segs.push({ start: curStart, end: cmp.rollingSharpe.length - 1, bull: curBull });
    }
    return segs;
  }, [regimes, cmpKey, cmp.rollingSharpe]);

  // Y domain auto-fits to the currently visible x-range so zoom-in reveals
  // sub-window detail instead of staying squished against the full-range axes.
  // When the user has dragged the Y-axis gutter, yOverride takes precedence
  // until reset.
  const yDomain = useMemo<[number, number]>(() => {
    if (yOverride) return yOverride;
    let lo = Infinity;
    let hi = -Infinity;
    const useLog = config.scalable && scale === "log";
    const [s0, s1] = xRange;
    series.forEach((s, idx) => {
      if (muted.has(idx)) return;
      for (let i = s0; i <= s1; i++) {
        const v = s.values[i];
        if (v == null || !Number.isFinite(v)) continue;
        if (useLog && v <= 0) continue;
        const tv = useLog ? Math.log(v) : v;
        if (tv < lo) lo = tv;
        if (tv > hi) hi = tv;
      }
    });
    if (config.baseline != null) {
      const b = useLog && config.baseline > 0 ? Math.log(config.baseline) : config.baseline;
      if (!useLog || config.baseline > 0) {
        if (b < lo) lo = b;
        if (b > hi) hi = b;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
      lo = 0;
      hi = 1;
    }
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }, [series, muted, scale, config.baseline, config.scalable, xRange, yOverride]);

  const n = view.dates.length;
  // Defensive clamp (T-103-08): the frozen xRange is maintained in cash-index
  // space (context length = cash dates). Under a SHORTER MTM axis the persisted
  // window end can exceed the MTM series bounds for the render BEFORE the
  // basis-change resetXRange effect (FactsheetView) settles — clamp so no chart
  // geometry ever indexes past view.dates, and so the MTM series fills the plot
  // width. A no-op under cash (xRange is already ≤ the cash length).
  //
  // FIX E (IN — the MTM-LONGER-than-cash edge): the clamp only shrinks (Math.min).
  // When the MTM axis is LONGER than the cash-index xRange (rare — MTM usually ≤
  // cash), xEnd stays at the shorter cash-window end (< maxIdx), so this frame
  // renders only the cash-length window and the MTM tail is briefly off-plot until
  // the SAME resetXRange effect settles the basis change (identical one-frame
  // transient to the shorter case). This is intentional and OOB-safe: xStart/xEnd
  // are always in [0, maxIdx] and every series index is computed defensively (paths
  // outside the window clip naturally), so no geometry ever indexes past view.dates
  // regardless of which axis is longer. We deliberately do NOT widen the window here
  // — distinguishing a stale cash-space range from a user zoom is the reset effect's
  // job, not this render-time clamp's.
  const maxIdx = Math.max(0, n - 1);
  const xStart = Math.min(xRange[0], maxIdx);
  const xEnd = Math.min(xRange[1], maxIdx);
  const xSpan = Math.max(1, xEnd - xStart);
  // X maps an index into the visible window onto plot pixels. Indices outside
  // [xStart, xEnd] still get computed (so paths clip naturally) but are off-plot.
  const X = useCallback(
    (i: number) => PAD.left + ((i - xStart) / xSpan) * plotW,
    [xStart, xSpan, plotW],
  );
  const Y = useCallback(
    (v: number) => {
      const useLog = config.scalable && scale === "log";
      if (useLog && v <= 0) return PAD.top + plotH;
      const tv = useLog ? Math.log(v) : v;
      return PAD.top + (1 - (tv - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotH;
    },
    [yDomain, scale, config.scalable, plotH],
  );

  // Warmup band SVG subtree — memoized to avoid rebuilding the <defs><pattern>
  // every pan frame. Hidden once the visible window starts past the warmup boundary.
  const warmupBand = useMemo(() => {
    if (!config.warmup || config.warmup <= 1 || config.warmup >= n) return null;
    const warmupEndIdx = config.warmup - 1;
    if (warmupEndIdx < xStart) return null;
    const xEndPx = Math.min(PAD.left + plotW, X(warmupEndIdx));
    const width = xEndPx - PAD.left;
    if (width <= 0) return null;
    return (
      <g pointerEvents="none">
        <defs>
          <pattern
            id={`warmup-${config.key}`}
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-text-muted)" strokeOpacity="0.15" strokeWidth="3" />
          </pattern>
        </defs>
        <rect x={PAD.left} y={PAD.top} width={width} height={plotH} fill={`url(#warmup-${config.key})`} />
        <text
          x={xEndPx - 4}
          y={PAD.top + 12}
          textAnchor="end"
          fontSize={10}
          fontStyle="italic"
          fontFamily="var(--font-mono)"
          fill="var(--color-text-muted)"
        >
          N&lt;{config.warmup} — noisy
        </text>
      </g>
    );
  }, [config.warmup, config.key, n, xStart, plotW, plotH, X]);

  // FS-01/FS-02 composite seam overlay — memoized so the <defs><pattern>
  // subtrees don't rebuild every pan frame (warmupBand idiom). One
  // <g pointerEvents="none"> holding the per-key boundary markers
  // (payload.segmentBoundaries) + gap seams (payload.missingSegments), rendered
  // only on the cumulative track (config.segmentMarkers) and only when the
  // optional payload fields are present. Both fields absent → returns null, so
  // single-key / non-composite emits a byte-identical SVG (GUARD-02).
  const segmentMarkers = useMemo(() => {
    if (!config.segmentMarkers) return null;
    const boundaries = view.segmentBoundaries ?? [];
    const gaps = view.missingSegments ?? [];
    if (boundaries.length === 0 && gaps.length === 0) return null;

    const dates = view.dates;
    const plotRight = PAD.left + plotW;
    const plotBottom = PAD.top + plotH;

    // Boundary (FS-01): dashed neutral vertical line + mono seq label at the
    // boundary date's index. Skip if the date is absent or off the visible
    // [xStart, xEnd] window; clamp x to the plot (ddHighlights idiom, pan/zoom safe).
    const boundaryNodes = boundaries.flatMap((b, i) => {
      // L-1: a member's `first_day` can be a guard/NaN day that is ABSENT from
      // the present series → `indexOfDate` misses. Fall back to the first PRESENT
      // day at or after the boundary date (`firstIndexAfter`, the gap-seam idiom)
      // so the seam renders at the key's real first visible day instead of
      // silently vanishing — otherwise the sr-only summary claims a handoff that
      // has no marker.
      const exact = indexOfDate(dates, b.date);
      const idx = exact >= 0 ? exact : firstIndexAfter(dates, b.date);
      if (idx >= dates.length || idx < xStart || idx > xEnd) return [];
      const x = Math.max(PAD.left, Math.min(plotRight, X(idx)));
      return [
        <g key={`seg-bound-${i}`} data-idx={idx}>
          <title>{`Key ${b.seq} track begins ${b.date}`}</title>
          <line
            x1={x}
            x2={x}
            y1={PAD.top}
            y2={plotBottom}
            stroke="var(--color-text-muted)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
          <text
            x={x + 3}
            y={PAD.top + 11}
            textAnchor="start"
            fontSize={10}
            fontFamily="var(--font-mono)"
            fill="var(--color-text-muted)"
          >
            {b.seq}
          </text>
        </g>,
      ];
    });

    // Gap seam (FS-02): gap days are ABSENT from `dates`, so the gap collapses
    // to a zero-width seam at the FIRST present index after the gap's end
    // (firstIndexAfter insertion point) — never a proportional band, never a
    // flat-zero line. Hatched sliver + neutral "{days}d — no data" label.
    const gapNodes = gaps.flatMap((g, i) => {
      const seamIdx = firstIndexAfter(dates, g.end);
      if (seamIdx >= dates.length || seamIdx < xStart || seamIdx > xEnd) return [];
      const x = Math.max(PAD.left, Math.min(plotRight, X(seamIdx)));
      // Unique pattern id per config key + segment index avoids <defs> collisions.
      const patternId = `gap-${config.key}-${i}`;
      const sliver = 6;
      const x0 = Math.max(PAD.left, x - sliver / 2);
      const w = Math.min(plotRight, x + sliver / 2) - x0;
      return [
        <g key={`seg-gap-${i}`}>
          <title>{`No data ${g.start} → ${g.end} (${g.days} days)`}</title>
          <defs>
            <pattern
              id={patternId}
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-text-muted)" strokeOpacity="0.15" strokeWidth="3" />
            </pattern>
          </defs>
          <rect x={x0} y={PAD.top} width={Math.max(0, w)} height={plotH} fill={`url(#${patternId})`} />
          <text
            x={x}
            y={PAD.top + 11}
            textAnchor="middle"
            fontSize={10}
            fontFamily="var(--font-mono)"
            fill="var(--color-text-muted)"
          >
            {g.days}d — no data
          </text>
        </g>,
      ];
    });

    if (boundaryNodes.length === 0 && gapNodes.length === 0) return null;
    return (
      <g pointerEvents="none">
        {boundaryNodes}
        {gapNodes}
      </g>
    );
  }, [
    config.segmentMarkers,
    config.key,
    view.segmentBoundaries,
    view.missingSegments,
    view.dates,
    xStart,
    xEnd,
    plotW,
    plotH,
    X,
  ]);

  const yTicks = useMemo(
    () => makeYTicks(yDomain, config.scalable && scale === "log", config.valueFormat),
    [yDomain, scale, config.scalable, config.valueFormat],
  );
  const xTicks = useMemo(
    () => makeXTicks(view.dates, xStart, xEnd),
    [view.dates, xStart, xEnd],
  );

  // Translate a mouse pixel offset into a fractional x-index in the visible window.
  const pixelToIdx = useCallback(
    (clientX: number, rect: DOMRect): number | null => {
      const px = ((clientX - rect.left) / rect.width) * VB_W;
      const plotPx = px - PAD.left;
      if (plotPx < 0 || plotPx > plotW) return null;
      const t = plotPx / plotW;
      return xStart + t * xSpan;
    },
    [plotW, xStart, xSpan],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      // Flip movedRef once the gesture exceeds the tap slop. Reading
      // movedRef in onPointerUp distinguishes a tap from a drag.
      if (tapInfoRef.current) {
        const dx = e.clientX - tapInfoRef.current.x;
        const dy = e.clientY - tapInfoRef.current.y;
        if (dx * dx + dy * dy > 64 /* 8px slop */) movedRef.current = true;
      }

      // X-axis pull mode: vertical drag in the bottom gutter scales the x-range
      // around the cursor's index anchor. Drag UP compresses (zoom in); drag
      // DOWN expands (zoom out). Mirrors the Y-pull pattern below.
      if (xDragRef.current) {
        const dy = e.clientY - xDragRef.current.startY;
        const dyVb = (dy / rect.height) * height;
        const factor = Math.exp(dyVb * 0.008);
        const [s0, e0] = xDragRef.current.startRange;
        const anchor = xDragRef.current.anchor;
        const leftSpan = anchor - s0;
        const rightSpan = e0 - anchor;
        let s = Math.round(anchor - leftSpan * factor);
        let eN = Math.round(anchor + rightSpan * factor);
        if (s < 0) s = 0;
        if (eN > n - 1) eN = n - 1;
        if (eN - s >= MIN_VISIBLE - 1) setXRange([s, eN]);
        return;
      }

      // Y-axis pull mode: scale the y-domain around the cursor's anchor data value.
      // Drag DOWN expands the domain (zoom out); drag UP compresses (zoom in).
      if (yDragRef.current) {
        const dy = e.clientY - yDragRef.current.startY;
        const dyVb = (dy / rect.height) * height;
        // 1 px ≈ 0.6% scale change. Clamped so an over-drag stays sane.
        const factor = Math.exp(dyVb * 0.006);
        const [lo0, hi0] = yDragRef.current.startDomain;
        const anchor = yDragRef.current.anchor;
        const loDist = anchor - lo0;
        const hiDist = hi0 - anchor;
        const newLo = anchor - loDist * factor;
        const newHi = anchor + hiDist * factor;
        if (Number.isFinite(newLo) && Number.isFinite(newHi) && newHi > newLo) {
          setYOverride([newLo, newHi]);
        }
        return;
      }

      if (panRef.current) {
        const dxPx = e.clientX - panRef.current.startX;
        const dxIdx = -(dxPx / rect.width) * VB_W * (xSpan / plotW);
        const [s0, e0] = panRef.current.startRange;
        let s = Math.round(s0 + dxIdx);
        let eN = Math.round(e0 + dxIdx);
        if (s < 0) {
          eN -= s;
          s = 0;
        }
        if (eN > n - 1) {
          s -= eN - (n - 1);
          eN = n - 1;
        }
        setXRange([s, eN]);
        return;
      }

      const idxF = pixelToIdx(e.clientX, rect);
      if (idxF == null) {
        setCrossIdx(null);
        return;
      }
      const idx = Math.round(idxF);
      setCrossIdx(Math.max(0, Math.min(n - 1, idx)));
    },
    [n, plotW, pixelToIdx, setXRange, xSpan, height],
  );

  const onPointerLeave = useCallback(() => {
    // Pinned crosshair survives pointerleave (touch users) — they lift the
    // finger and still want to read the value. Mouse users get the clear.
    if (!pinned) setCrossIdx(null);
  }, [pinned]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      // Pixel-to-viewBox-x of the click. If inside the left axis gutter
      // (x < PAD.left), enter Y-pull mode instead of X-pan mode.
      const vbX = ((e.clientX - rect.left) / rect.width) * VB_W;
      const vbY = ((e.clientY - rect.top) / rect.height) * height;
      // Record tap-start for the touch tap-to-pin detection in onPointerUp.
      tapInfoRef.current = { x: e.clientX, y: e.clientY, t: Date.now(), type: e.pointerType };
      movedRef.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
      if (vbY > PAD.top + plotH) {
        // X-axis gutter: anchor the data index under the cursor (clamped to
        // plot bounds) and stretch the visible range around it on vertical drag.
        const ratio = Math.max(0, Math.min(1, (vbX - PAD.left) / plotW));
        xDragRef.current = {
          startY: e.clientY,
          startRange: xRange,
          anchor: xStart + ratio * xSpan,
        };
      } else if (vbX < PAD.left) {
        // Anchor the data value under the cursor and stretch around it.
        const ratio = 1 - (vbY - PAD.top) / plotH;
        const useLog = config.scalable && scale === "log";
        const v = yDomain[0] + ratio * (yDomain[1] - yDomain[0]);
        yDragRef.current = {
          startY: e.clientY,
          startDomain: [yDomain[0], yDomain[1]],
          anchor: useLog ? v : v, // domain is already in log/linear space
        };
      } else {
        panRef.current = { startX: e.clientX, startRange: xRange };
      }
    },
    [xRange, yDomain, plotH, plotW, scale, config.scalable, height, xStart, xSpan],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (panRef.current || yDragRef.current || xDragRef.current) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      panRef.current = null;
      yDragRef.current = null;
      xDragRef.current = null;
    }
    // Tap-to-pin: a touch gesture that never moved beyond TAP_SLOP and lasted
    // < 350ms is a tap, not a drag. Pin the crosshair at the tap point so the
    // value stays visible after the finger lifts. A pinned tap that re-taps
    // within 10px (toggling) clears the pin instead.
    const ti = tapInfoRef.current;
    tapInfoRef.current = null;
    if (!ti || ti.type !== "touch" || movedRef.current) return;
    if (Date.now() - ti.t > 350) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const idxF = pixelToIdx(e.clientX, rect);
    if (idxF == null) {
      // Tap outside the plot — clear any existing pin.
      setPinned(false);
      setCrossIdx(null);
      return;
    }
    const idx = Math.max(0, Math.min(n - 1, Math.round(idxF)));
    // Re-tap near an existing pinned point → un-pin.
    if (pinned && crossIdx != null && Math.abs(idx - crossIdx) < 3) {
      setPinned(false);
      setCrossIdx(null);
    } else {
      setCrossIdx(idx);
      setPinned(true);
    }
  }, [pixelToIdx, n, pinned, crossIdx]);

  const onWheel = useCallback(
    (e: ReactWheelEvent<SVGSVGElement>) => {
      if (e.deltaY === 0) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const idxF = pixelToIdx(e.clientX, rect);
      const anchor = idxF != null ? idxF : (xStart + xEnd) / 2;
      // deltaY > 0 → zoom out, < 0 → zoom in. Step 12% per wheel tick.
      const factor = Math.exp(e.deltaY * 0.0012);
      const leftSpan = anchor - xStart;
      const rightSpan = xEnd - anchor;
      let s = Math.round(anchor - leftSpan * factor);
      let eN = Math.round(anchor + rightSpan * factor);
      if (eN - s < MIN_VISIBLE - 1) {
        const c = Math.round((s + eN) / 2);
        s = Math.max(0, c - Math.floor((MIN_VISIBLE - 1) / 2));
        eN = Math.min(n - 1, s + MIN_VISIBLE - 1);
      }
      if (s < 0) s = 0;
      if (eN > n - 1) eN = n - 1;
      setXRange([s, eN]);
    },
    [pixelToIdx, xStart, xEnd, n, setXRange],
  );

  const onDoubleClick = useCallback(() => {
    resetXRange();
    setYOverride(null);
    setPinned(false);
    setCrossIdx(null);
  }, [resetXRange]);

  // Keyboard navigation: arrows pan, +/- zoom around centre, Home resets, Esc
  // also resets. Pressing the chart focuses it so screen reader users get
  // affordances; the role/aria-label on the SVG already carries the title.
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<SVGSVGElement>) => {
      const pan = (units: number) => {
        const delta = Math.max(1, Math.round((xSpan + 1) * units));
        let s = xStart + delta;
        let eN = xEnd + delta;
        if (s < 0) { eN -= s; s = 0; }
        if (eN > n - 1) { s -= eN - (n - 1); eN = n - 1; }
        setXRange([s, eN]);
      };
      const zoom = (factor: number) => {
        const c = Math.round((xStart + xEnd) / 2);
        const leftSpan = c - xStart;
        const rightSpan = xEnd - c;
        let s = Math.round(c - leftSpan * factor);
        let eN = Math.round(c + rightSpan * factor);
        if (eN - s < MIN_VISIBLE - 1) {
          s = Math.max(0, c - Math.floor((MIN_VISIBLE - 1) / 2));
          eN = Math.min(n - 1, s + MIN_VISIBLE - 1);
        }
        if (s < 0) s = 0;
        if (eN > n - 1) eN = n - 1;
        setXRange([s, eN]);
      };
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault(); pan(-0.1); break;
        case "ArrowRight":
          e.preventDefault(); pan(0.1); break;
        case "ArrowUp":
        case "+":
        case "=":
          e.preventDefault(); zoom(0.85); break;
        case "ArrowDown":
        case "-":
        case "_":
          e.preventDefault(); zoom(1.15); break;
        case "Home":
        case "0":
        case "Escape":
          e.preventDefault(); resetXRange(); setYOverride(null); break;
      }
    },
    [xStart, xEnd, xSpan, n, setXRange, resetXRange],
  );

  // Wheel listener attached non-passively so we can preventDefault on the SVG
  // (the React onWheel handler is passive in modern React, can't preventDefault).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (ev: WheelEvent) => { if (ev.cancelable) ev.preventDefault(); };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const toggleMute = (idx: number) => {
    setMuted(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // rendering-content-visibility: defer layout/paint when the chart is fully
  // offscreen. The intrinsic size reserves space so scroll anchoring doesn't
  // jump as charts come into view. Total page has 11+ stacked charts, so the
  // win compounds.
  const cvStyle = { contentVisibility: "auto", containIntrinsicSize: `auto ${height + 60}px` } as const;

  // Screen-reader-only operator hint — describes the keyboard interactions
  // available on the focused chart so AT users have parity with mouse users.
  const chartHelpId = `chart-help-${config.key}`;

  return (
    <figure className="flex flex-col gap-2" style={cvStyle}>
      <span id={chartHelpId} className="sr-only">
        Arrow keys pan the timeline. Plus and minus zoom around the center.
        Home or zero resets the view. Mouse wheel zooms toward the cursor.
        Drag inside the plot to pan; drag the left axis to scale Y; drag the
        bottom axis to scale X.
      </span>
      <header className="flex items-baseline justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
            {config.title}
          </h3>
          <p className="text-[11px] text-text-muted">
            {config.subtitle ?? subtitleFor(config, cmp.name)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {config.scalable && (
            <div className="flex gap-1" role="tablist" aria-label="Y-axis scale">
              {(["log", "linear"] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={scale === s}
                  onClick={() => setScale(s)}
                  className={
                    "px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm border " +
                    (scale === s
                      ? "bg-accent text-white border-accent"
                      : "bg-surface-subtle text-text-2 border-border hover:bg-surface")
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <ExportMenu
            config={config}
            svgRef={svgRef}
            series={series}
            dates={view.dates}
            xRange={[xStart, xEnd] as const}
          />
        </div>
      </header>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {series.map((s, i) => (
          <button
            key={`${s.name}-${i}`}
            type="button"
            onClick={() => toggleMute(i)}
            aria-pressed={!muted.has(i)}
            className={
              "inline-flex items-center gap-1.5 cursor-pointer transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm " +
              (muted.has(i) ? "opacity-40" : "opacity-100")
            }
            title="Click to toggle series visibility"
          >
            <span aria-hidden className="inline-block w-2.5 h-0.5" style={{ background: s.color }} />
            <span className="text-text-2">{s.name}</span>
            {deferredCrossIdx != null && (
              <span className="font-mono tabular-nums text-text-primary">
                {formatValue(s.values[deferredCrossIdx], config.valueFormat)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ResponsiveChartFrame supplies the shared responsive recipe verbatim:
          viewBox="0 0 880 280", preserveAspectRatio="xMidYMid meet", the leading
          `block w-full` className, and style aspectRatio/maxHeight/width/height.
          The output SVG DOM is byte-identical to the prior inline <svg> — only
          the chart-specific className tail + the ref/aria/handlers pass through
          here. `meet` preserves the chart's natural aspect (text + axis spacing
          stays proportional); paired with the CSS aspect-ratio the container
          height tracks width 1:1 with no letterbox at any viewport size. */}
      <ResponsiveChartFrame
        ref={svgRef}
        width={VB_W}
        height={height}
        role="img"
        aria-label={ariaLabel(config, view.strategyName, cmp.name, !!cmp.cumulative)}
        aria-describedby={`chart-help-${config.key}`}
        tabIndex={0}
        focusable="true"
        className="cursor-crosshair touch-pan-y select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        {/* Warmup band — striped overlay on the leading N samples where rolling stats are noisy.
            Memoized so the &lt;defs&gt;&lt;pattern&gt; subtree doesn't rebuild every pan frame. */}
        {warmupBand}

        {/* Regime bands — bull (positive comparator rolling-Sharpe) tinted teal,
            bear tinted red. Drawn behind everything else as a low-opacity wash. */}
        {regimeSegments.map((seg, i) => {
          const x0 = Math.max(PAD.left, X(seg.start));
          const x1 = Math.min(PAD.left + plotW, X(seg.end));
          const w = x1 - x0;
          if (w <= 0) return null;
          return (
            <rect
              key={`regime-${i}`}
              x={x0}
              y={PAD.top}
              width={w}
              height={plotH}
              fill={seg.bull ? "var(--color-positive)" : "var(--color-negative)"}
              fillOpacity={0.05}
              pointerEvents="none"
            />
          );
        })}

        {/* Composite seam overlay (FS-01 per-key boundaries + FS-02 gap seams) —
            inside the plot-clip and the ExportMenu-serialized <svg> so it stays
            pan/zoom-synced and export-safe. Null on single-key / non-cumulative. */}
        {segmentMarkers}

        {yTicks.map(t => {
          // The "natural zero" line (baseline = 0 for percent/ratio charts,
          // 1 for growth charts) is the breakeven reference and deserves
          // more visual weight than the other gridlines. Drawn as a solid
          // line in the muted text colour rather than the lighter border
          // hue, so the viewer can see at a glance whether the strategy is
          // above or below zero/par without squinting.
          const isBaseline = t.value === config.baseline;
          return (
            <g key={`y-${t.value}`}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={Y(t.value)}
                y2={Y(t.value)}
                stroke={isBaseline ? "var(--color-text-muted)" : "var(--color-border)"}
                strokeDasharray={isBaseline ? undefined : "2 3"}
                strokeOpacity={isBaseline ? 0.6 : 1}
                strokeWidth={isBaseline ? 1.2 : 1}
              />
              <text
                x={PAD.left - 6}
                y={Y(t.value) + 3}
                textAnchor="end"
                fontSize={10}
                fontFamily="var(--font-mono)"
                fill="var(--color-text-muted)"
              >
                {t.label}
              </text>
            </g>
          );
        })}

        {xTicks.map(t => (
          <g key={`x-${t.idx}`}>
            <line
              x1={X(t.idx)}
              x2={X(t.idx)}
              y1={PAD.top + plotH}
              y2={PAD.top + plotH + 4}
              stroke="var(--color-text-muted)"
              strokeWidth={1}
            />
            <text
              x={X(t.idx)}
              y={PAD.top + plotH + 16}
              textAnchor="middle"
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-muted)"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* Worst-N drawdown highlight bands — drawn behind the series line. */}
        {config.ddHighlights && view.strategyWorst10.map((p, i) => {
          const x0 = Math.max(PAD.left, X(p.start));
          const x1 = Math.min(PAD.left + plotW, X(p.recover));
          const w = x1 - x0;
          if (w <= 0) return null;
          return (
            <g key={`dd-${i}`} pointerEvents="none">
              <rect
                x={x0}
                y={PAD.top}
                width={w}
                height={plotH}
                fill="var(--color-negative)"
                opacity={i < 3 ? 0.12 : 0.06}
              />
              {p.trough >= xStart && p.trough <= xEnd && (
                <text
                  x={X(p.trough)}
                  y={PAD.top + 11}
                  textAnchor="middle"
                  fontSize={9}
                  fontFamily="var(--font-mono)"
                  fill="var(--color-negative)"
                  opacity={0.85}
                >
                  #{i + 1} {Number.isFinite(p.depth) ? `${(p.depth * 100).toFixed(1)}%` : "—"}
                </text>
              )}
            </g>
          );
        })}

        {/* Strategy-series average reference line — opt-in via cfg.showStratAverage
            (rolling vol/sharpe/sortino). Computed over the visible xRange so the
            "avg" the user reads matches what they're looking at. Suppressed
            when off-axis so it doesn't bleed into the y-axis labels gutter. */}
        {config.showStratAverage && series[0] && (() => {
          const values = series[0].values;
          let sum = 0;
          let count = 0;
          for (let i = xStart; i <= xEnd; i++) {
            const v = values[i];
            if (v != null && Number.isFinite(v)) { sum += v; count++; }
          }
          if (count === 0) return null;
          const avg = sum / count;
          const yAvg = Y(avg);
          if (!Number.isFinite(yAvg) || yAvg < PAD.top || yAvg > PAD.top + plotH) return null;
          return (
            <g pointerEvents="none">
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={yAvg}
                y2={yAvg}
                stroke={series[0].color}
                strokeOpacity={0.55}
                strokeDasharray="4 3"
                strokeWidth={1}
              />
              <text
                x={PAD.left + plotW - 4}
                y={yAvg - 3}
                textAnchor="end"
                fontSize={9}
                fontFamily="var(--font-mono)"
                fill={series[0].color}
                fillOpacity={0.75}
              >
                avg {(config.valueFormat === "percent" ? (avg * 100).toFixed(1) + "%" : avg.toFixed(2))}
              </text>
            </g>
          );
        })()}

        {/* Clip series paths to the plot rect so off-Y-range points don't leak
            outside as visible vertical streaks. */}
        <defs>
          <clipPath id={`plot-clip-${config.key}`}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        <g clipPath={`url(#plot-clip-${config.key})`}>
          {config.kind === "bars"
            ? series.map((s, sIdx) => {
                if (muted.has(sIdx)) return null;
                const baselineY = Y(config.baseline ?? 0);
                // Total slots = visible window count. Bar width = slot width * fill ratio.
                // For overlay series, narrow + center-offset so they don't overlap the primary.
                const slotW = plotW / Math.max(1, xSpan + 1);
                const fillRatio = sIdx === 0 ? 0.85 : 0.55;
                const barW = Math.max(0.6, slotW * fillRatio);
                const opacity = sIdx === 0 ? 1 : 0.55;
                const bars: React.ReactElement[] = [];
                for (let i = xStart; i <= xEnd; i++) {
                  const v = s.values[i];
                  if (v == null || !Number.isFinite(v)) continue;
                  const cx = X(i);
                  const yV = Y(v);
                  const top = Math.min(baselineY, yV);
                  const h = Math.abs(yV - baselineY);
                  if (h < 0.4) continue;
                  // Sign-based color: positive teal, negative red. Comparator bars
                  // stay muted-gray to keep the strategy as the visual focal point.
                  const fill = sIdx === 0
                    ? v >= 0
                      ? "var(--color-positive)"
                      : "var(--color-negative)"
                    : "var(--color-text-muted)";
                  bars.push(
                    <rect
                      key={`bar-${sIdx}-${i}`}
                      x={cx - barW / 2}
                      y={top}
                      width={barW}
                      height={h}
                      fill={fill}
                      fillOpacity={opacity}
                    />,
                  );
                }
                return <g key={`bars-${sIdx}`}>{bars}</g>;
              })
            : series.map((s, idx) => {
                if (muted.has(idx)) return null;
                const useLog = config.scalable && scale === "log";
                const d = buildPath(s.values, X, Y, useLog);
                if (s.fill && config.baseline != null) {
                  const baselineY = Y(config.baseline);
                  const filled = closePathToBaseline(d, X, baselineY, xStart, xEnd, s.values);
                  return (
                    <g key={`series-${idx}`}>
                      <path d={filled} fill={s.color} fillOpacity={0.18} stroke="none" />
                      <path
                        d={d}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={s.width}
                        strokeOpacity={s.opacity}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </g>
                  );
                }
                return (
                  <path
                    key={`series-${idx}`}
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={s.width}
                    strokeOpacity={s.opacity}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                );
              })}
        </g>

        {crossIdx != null && (
          <g pointerEvents="none">
            <line
              x1={X(crossIdx)}
              x2={X(crossIdx)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--color-text-muted)"
              strokeDasharray="2 2"
              strokeWidth={1}
            />
            {/* Per-series value dots at the crosshair index — visual anchor. */}
            {series.map((s, idx) => {
              if (muted.has(idx)) return null;
              const v = s.values[crossIdx];
              if (v == null || !Number.isFinite(v)) return null;
              return (
                <circle
                  key={`dot-${idx}`}
                  cx={X(crossIdx)}
                  cy={Y(v)}
                  r={3.5}
                  fill="var(--color-surface, #FFFFFF)"
                  stroke={s.color}
                  strokeWidth={1.6}
                />
              );
            })}
            <CrosshairTooltip
              x={X(crossIdx)}
              plotLeft={PAD.left}
              plotRight={PAD.left + plotW}
              plotTop={PAD.top}
              date={view.dates[crossIdx]}
              crossIdx={crossIdx}
              series={series}
              muted={muted}
              valueFormat={config.valueFormat}
            />
          </g>
        )}
      </ResponsiveChartFrame>
    </figure>
  );
}

/**
 * Per-chart export menu — CSV / SVG / PNG download.
 *
 *   - CSV: visible-window slice across the resolved series, ISO date column +
 *     one column per series with the chart's value format.
 *   - SVG: serialised <svg> element with width/height inlined so the file
 *     renders correctly in any viewer (not just our viewBox CSS).
 *   - PNG: SVG → blob URL → HTMLImageElement → canvas → toBlob(). 2× pixel
 *     density so the export looks crisp at presentation size.
 *
 * Implemented as a `<details>` popover so it's keyboard-accessible and
 * dismisses on outside-click via native browser behavior.
 */
function ExportMenu({
  config,
  svgRef,
  series,
  dates,
  xRange,
}: {
  config: ChartConfig;
  svgRef: React.RefObject<SVGSVGElement | null>;
  series: ResolvedSeries[];
  dates: string[];
  xRange: readonly [number, number];
}) {
  const filenameBase = `${config.key}-${dates[xRange[0]]}_to_${dates[xRange[1]]}`;

  const downloadCsv = () => {
    trackFactsheetEvent("factsheet_v2_chart_export", { chart: config.key, format: "csv" });
    const cols = ["date", ...series.map(s => s.name.replace(/,/g, " "))];
    const rows: string[] = [cols.join(",")];
    for (let i = xRange[0]; i <= xRange[1]; i++) {
      const cells = [dates[i] ?? ""];
      for (const s of series) {
        const v = s.values[i];
        cells.push(v == null || !Number.isFinite(v) ? "" : String(v));
      }
      rows.push(cells.join(","));
    }
    triggerDownload(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }), `${filenameBase}.csv`);
  };

  const serializedSvg = (): string | null => {
    const el = svgRef.current;
    if (!el) return null;
    const clone = el.cloneNode(true) as SVGSVGElement;
    // Inline width/height so off-canvas viewers don't shrink the SVG to nothing.
    const vb = clone.getAttribute("viewBox") || "0 0 880 280";
    const [, , wStr, hStr] = vb.split(/\s+/);
    clone.setAttribute("width", wStr);
    clone.setAttribute("height", hStr);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return new XMLSerializer().serializeToString(clone);
  };

  const downloadSvg = () => {
    trackFactsheetEvent("factsheet_v2_chart_export", { chart: config.key, format: "svg" });
    const s = serializedSvg();
    if (!s) return;
    triggerDownload(new Blob([s], { type: "image/svg+xml;charset=utf-8" }), `${filenameBase}.svg`);
  };

  const downloadPng = () => {
    trackFactsheetEvent("factsheet_v2_chart_export", { chart: config.key, format: "png" });
    const s = serializedSvg();
    if (!s) return;
    const el = svgRef.current;
    if (!el) return;
    const vb = (el.getAttribute("viewBox") || "0 0 880 280").split(/\s+/);
    const w = parseFloat(vb[2]);
    const h = parseFloat(vb[3]);
    const scale = 2;
    const url = URL.createObjectURL(new Blob([s], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); return; }
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(url);
        if (blob) triggerDownload(blob, `${filenameBase}.png`);
      }, "image/png");
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  return (
    <details className="relative">
      <summary
        className="cursor-pointer list-none px-2 py-0.5 pointer-coarse:px-3 pointer-coarse:py-2 pointer-coarse:min-h-[44px] inline-flex items-center text-[10px] font-mono uppercase tracking-wider rounded-sm border bg-surface-subtle text-text-2 border-border hover:bg-surface"
        title="Download chart data or image"
      >
        Export
      </summary>
      <div className="absolute right-0 top-full z-10 mt-1 min-w-[120px] bg-surface border border-border rounded-sm shadow-sm">
        <ExportItem onClick={downloadCsv}>CSV</ExportItem>
        <ExportItem onClick={downloadSvg}>SVG</ExportItem>
        <ExportItem onClick={downloadPng}>PNG</ExportItem>
      </div>
    </details>
  );
}

function ExportItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left px-3 py-1.5 pointer-coarse:py-3 text-[11px] font-mono text-text-primary hover:bg-surface-subtle"
    >
      {children}
    </button>
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * SVG-native crosshair tooltip. White card with hairline border, date in bold,
 * one line per visible series with its color swatch + name + value.
 *
 * Auto-flips horizontally so the card never overflows the plot's right edge.
 * Pinned vertically near the top of the plot — keeps the cursor's data
 * region unobstructed.
 *
 * Wrapped in React.memo with the default shallow check — `series` is stable
 * across mousemoves (parent memoizes it on comparator/xRange), so only
 * `x` and the deferred `date` change between frames, which is exactly what
 * we want re-rendering.
 */
const CrosshairTooltip = memo(CrosshairTooltipInner);

function CrosshairTooltipInner({
  x,
  plotLeft,
  plotRight,
  plotTop,
  date,
  series,
  muted,
  crossIdx,
  valueFormat,
}: {
  x: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  date: string;
  series: ResolvedSeries[];
  muted: Set<number>;
  crossIdx: number;
  valueFormat: ChartValueFormat;
}) {
  const visible = series
    .map((s, idx) => ({ name: s.name, color: s.color, value: s.values[crossIdx], idx }))
    .filter(s => !muted.has(s.idx));
  const rowH = 12;
  const headerH = 14;
  const padX = 8;
  const padY = 6;
  // Width: rough estimate from longest series name + value (mono font ≈ 6px/char).
  const maxRowChars = visible.reduce((m, s) => {
    const lbl = `${s.name}  ${formatValue(s.value, valueFormat)}`;
    return Math.max(m, lbl.length);
  }, 10);
  // Card width must fit inside the plot — on narrow viewports the estimated
  // width can exceed plot width entirely, so cap it before positioning.
  const estimatedW = Math.max(110, maxRowChars * 6 + padX * 2 + 14);
  const w = Math.min(estimatedW, Math.max(80, plotRight - plotLeft - 8));
  const h = headerH + visible.length * rowH + padY * 2 + 2;
  // Default: card to the right of crosshair. Flip if it would overflow the
  // right edge; clamp to left if still oversized after the flip.
  let tx = x + 10;
  if (tx + w > plotRight) tx = x - 10 - w;
  if (tx < plotLeft) tx = plotLeft + 2;
  if (tx + w > plotRight) tx = plotRight - w - 2;
  const ty = plotTop + 4;
  return (
    <g pointerEvents="none">
      <rect
        x={tx}
        y={ty}
        width={w}
        height={h}
        rx={4}
        fill="var(--color-surface, #FFFFFF)"
        stroke="var(--color-border)"
        strokeWidth={1}
        opacity={0.97}
      />
      <text
        x={tx + padX}
        y={ty + padY + 10}
        fontSize={10}
        fontFamily="var(--font-mono)"
        fontWeight={600}
        fill="var(--color-text-primary)"
      >
        {date}
      </text>
      {visible.map((s, i) => {
        const cy = ty + padY + headerH + i * rowH + 8;
        return (
          <g key={`tt-${i}-${s.name}`}>
            <rect x={tx + padX} y={cy - 6} width={8} height={2} fill={s.color} />
            <text
              x={tx + padX + 12}
              y={cy}
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-2)"
            >
              {truncate(s.name, 18)}
            </text>
            <text
              x={tx + w - padX}
              y={cy}
              fontSize={10}
              fontFamily="var(--font-mono)"
              textAnchor="end"
              fill="var(--color-text-primary)"
              fontWeight={600}
            >
              {formatValue(s.value, valueFormat)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function subtitleFor(cfg: ChartConfig, cmpName: string): string {
  if (cfg.comparatorAsPrimary && !cfg.stratField) return `${cmpName} comparator`;
  return cfg.comparatorField ? `vs ${cmpName}` : "";
}

function ariaLabel(cfg: ChartConfig, strategyName: string, cmpName: string, hasCmp: boolean): string {
  if (cfg.comparatorAsPrimary) return `${cfg.title}: ${strategyName} divided by ${cmpName}`;
  return `${cfg.title}: ${strategyName}${hasCmp ? ` vs ${cmpName}` : ""}`;
}

function buildPath(
  values: ReadonlyArray<number | null>,
  X: (i: number) => number,
  Y: (v: number) => number,
  useLog: boolean,
): string {
  const parts: string[] = [];
  let prevValid = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const skip = v == null || !Number.isFinite(v) || (useLog && v <= 0);
    if (skip) {
      prevValid = false;
      continue;
    }
    const x = X(i);
    const y = Y(v);
    parts.push(`${prevValid ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    prevValid = true;
  }
  return parts.join(" ");
}

/**
 * Close an existing line path to a horizontal baseline so the area between
 * the line and the baseline can be filled. Used by the Underwater chart
 * (baseline = 0, line is always ≤ 0).
 */
function closePathToBaseline(
  linePath: string,
  X: (i: number) => number,
  baselineY: number,
  xStart: number,
  xEnd: number,
  values: ReadonlyArray<number | null>,
): string {
  if (!linePath) return "";
  // Find first and last valid x coordinates by walking the values.
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = xStart; i <= xEnd && i < values.length; i++) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
    }
  }
  if (firstIdx === -1 || lastIdx === -1) return "";
  const xL = X(firstIdx).toFixed(1);
  const xR = X(lastIdx).toFixed(1);
  const yB = baselineY.toFixed(1);
  return `${linePath} L ${xR} ${yB} L ${xL} ${yB} Z`;
}

/**
 * Adaptive Y-axis tick generator. For log-scale charts, tries a richer mantissa
 * set than the default {1,2,5} so narrow log spans (which appear when the user
 * zooms in or pulls Y) still produce enough labels. Falls through to nice-step
 * linear ticks when log produces fewer than 4 candidates — that handles tight
 * windows where no round-log value lands at all.
 *
 * The fallback's tick values are computed in DISPLAY space (eLo..eHi, equity
 * units) but the chart's Y-domain is in log space, so we keep `value` in
 * display space — the Y() projection takes log() on the way in.
 */
function makeYTicks(domain: [number, number], log: boolean, format: ChartValueFormat) {
  const [lo, hi] = domain;
  if (log) {
    const candidates: number[] = [];
    const eLo = Math.exp(lo);
    const eHi = Math.exp(hi);
    const decadeLo = Math.floor(Math.log10(eLo));
    const decadeHi = Math.ceil(Math.log10(eHi));
    const mantissa = [1, 1.5, 2, 3, 5, 7];
    for (let d = decadeLo; d <= decadeHi; d++) {
      for (const m of mantissa) {
        const v = m * Math.pow(10, d);
        if (v >= eLo * 0.95 && v <= eHi * 1.05) candidates.push(v);
      }
    }
    candidates.sort((a, b) => a - b);
    if (candidates.length >= 4) {
      return candidates.slice(0, 10).map(v => ({ value: v, label: formatValue(v, format) }));
    }
    // Too few log ticks — fall through to nice-step linear in display space.
    return niceLinearTicks(eLo, eHi, format);
  }
  return niceLinearTicks(lo, hi, format);
}

/** Compute ~5 nicely-rounded ticks across [lo, hi]. */
function niceLinearTicks(lo: number, hi: number, format: ChartValueFormat): { value: number; label: string }[] {
  if (!(hi > lo)) return [{ value: lo, label: formatValue(lo, format) }];
  const span = hi - lo;
  const rough = span / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rough)) || 0));
  const normalized = rough / magnitude;
  let nice: number;
  if (normalized < 1.5) nice = 1;
  else if (normalized < 3) nice = 2;
  else if (normalized < 7) nice = 5;
  else nice = 10;
  const step = nice * magnitude;
  const start = Math.ceil(lo / step) * step;
  const out: { value: number; label: string }[] = [];
  for (let v = start; v <= hi + step * 0.001 && out.length < 12; v += step) {
    out.push({ value: v, label: formatValue(v, format) });
  }
  return out;
}

function makeXTicks(dates: string[], xStart: number, xEnd: number) {
  // Adaptive cadence: year ticks when the visible window spans ≥2 years, else
  // quarter ticks (≥6 months), else month ticks. Avoids tick spam on zoomed-in
  // narrow windows and tick scarcity on wide ones.
  const out: { idx: number; label: string }[] = [];
  const visStart = Math.max(0, xStart);
  const visEnd = Math.min(dates.length - 1, xEnd);
  if (visEnd <= visStart) return out;
  const spanDays = visEnd - visStart;

  if (spanDays >= 2 * 252) {
    let lastYear: string | null = null;
    for (let i = visStart; i <= visEnd; i++) {
      const yr = dates[i].slice(0, 4);
      if (yr !== lastYear) {
        out.push({ idx: i, label: yr });
        lastYear = yr;
      }
    }
  } else if (spanDays >= 0.5 * 252) {
    let lastQ: string | null = null;
    for (let i = visStart; i <= visEnd; i++) {
      const yr = dates[i].slice(0, 4);
      const m = parseInt(dates[i].slice(5, 7), 10);
      const q = `${yr}-Q${Math.floor((m - 1) / 3) + 1}`;
      if (q !== lastQ) {
        const label = q.endsWith("Q1") ? yr : `Q${q.slice(-1)} ${yr.slice(2)}`;
        out.push({ idx: i, label });
        lastQ = q;
      }
    }
  } else {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let lastM: string | null = null;
    for (let i = visStart; i <= visEnd; i++) {
      const key = dates[i].slice(0, 7);
      if (key !== lastM) {
        const m = parseInt(dates[i].slice(5, 7), 10);
        out.push({ idx: i, label: months[m - 1] });
        lastM = key;
      }
    }
  }
  return out;
}

function formatValue(v: number | null | undefined, format: ChartValueFormat): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (format === "growth") {
    const pct = (v - 1) * 100;
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}%`;
  }
  if (format === "percent") {
    const pct = v * 100;
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}%`;
  }
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}
