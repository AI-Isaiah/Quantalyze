"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WheelEvent as ReactWheelEvent } from "react";
import { usePayload, useXRange, useActiveComparator } from "./factsheet-context";

const VB_W = 880;
const VB_H = 200;
const PAD = { top: 20, right: 30, bottom: 32, left: 50 };
const PLOT_W = VB_W - PAD.left - PAD.right;
const PLOT_H = VB_H - PAD.top - PAD.bottom;
const DEFAULT_BIN_COUNT = 40;
const MIN_SPAN = 0.0005; // 5bps — finest meaningful daily-return bin
/** Quantile of the STRATEGY's |daily return| used as the default visible range.
 *  Caps the natural range to the strategy distribution's bulk so heavy-tailed
 *  benchmarks don't squish strategy bars into a single central bin. Benchmark
 *  outliers beyond this range still count — they get pinned to the edge bin
 *  rather than fabricating extra empty space. */
const STRAT_NATURAL_QUANTILE = 0.99;

/**
 * Visible-window daily-returns histogram. Strategy bars in accent; optional
 * comparator overlay at lower opacity. Two layers of zoom:
 *
 *   1. xRange (shared with the line charts) — narrowing the window shrinks
 *      the sample set, so the distribution reflects only that regime.
 *   2. zoomOverride (local, wheel-driven) — narrows the [lo, hi] bin range
 *      around the cursor and re-bins, exposing detail in the body of the
 *      distribution without losing the symmetric-around-zero framing.
 *
 * Double-click clears the local zoom; full-window samples always set the
 * outer bound so a zoomed-out histogram still shows the natural data extent.
 */
export function HistogramChart() {
  const payload = usePayload();
  const { xRange } = useXRange();
  const { block: cmp } = useActiveComparator();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zoom, setZoom] = useState<{ lo: number; hi: number } | null>(null);

  const [xStart, xEnd] = xRange;

  // Step 1: pull the visible-window samples and compute the natural [lo, hi].
  // Default range is anchored to the STRATEGY's distribution (99th percentile
  // of |v|) so a heavy-tailed benchmark (BTC, ETH) doesn't squish strategy
  // bars into 1-2 central bins. Benchmark values beyond this range still
  // contribute — they pin to the edge bins. User can wheel-zoom-out for the
  // true joint extreme, or-in for tail detail.
  const { stratVals, benchVals, naturalLo, naturalHi, outerLo, outerHi } = useMemo(() => {
    const sv: number[] = [];
    const bv: number[] = [];
    for (let i = xStart; i <= xEnd; i++) {
      const s = payload.strategyReturns[i];
      if (Number.isFinite(s)) sv.push(s);
      const b = cmp.dailyReturns?.[i];
      if (b != null && Number.isFinite(b)) bv.push(b);
    }
    const stratAbs = sv.map(v => Math.abs(v)).sort((a, b) => a - b);
    const stratP99 = stratAbs.length > 0
      ? stratAbs[Math.min(stratAbs.length - 1, Math.floor(STRAT_NATURAL_QUANTILE * stratAbs.length))]
      : 0.005;
    const naturalAbs = Math.max(stratP99 * 1.1, 0.005);
    const all = sv.concat(bv);
    const outerAbs = all.reduce((a, x) => Math.max(a, Math.abs(x)), 0) || 0.01;
    return {
      stratVals: sv,
      benchVals: bv,
      naturalLo: -naturalAbs,
      naturalHi: naturalAbs,
      outerLo: -outerAbs * 1.05,
      outerHi: outerAbs * 1.05,
    };
  }, [payload.strategyReturns, cmp.dailyReturns, xStart, xEnd]);

  // Reset local zoom whenever xRange changes — the previous zoom anchored
  // against a different sample set is no longer meaningful.
  useEffect(() => { setZoom(null); }, [xStart, xEnd]);

  const lo = zoom?.lo ?? naturalLo;
  const hi = zoom?.hi ?? naturalHi;
  // More bins when zoomed in so the finer span resolves into similar visual
  // density (24 bins across 100% → 24 bins across 10% would look chunky).
  const binCount = useMemo(() => {
    const naturalSpan = naturalHi - naturalLo;
    const span = hi - lo;
    if (!Number.isFinite(span) || span <= 0 || naturalSpan <= 0) return DEFAULT_BIN_COUNT;
    const ratio = naturalSpan / span;
    const scaled = Math.round(DEFAULT_BIN_COUNT * Math.pow(ratio, 0.5));
    return Math.max(DEFAULT_BIN_COUNT, Math.min(80, scaled));
  }, [lo, hi, naturalLo, naturalHi]);

  const { strat, bench, maxCount, inWindowStrat, inWindowBench } = useMemo(() => {
    const span = hi - lo;
    const bin = (v: number): number | null => {
      if (v < lo || v > hi) return null;
      const t = (v - lo) / (span || 1);
      const idx = Math.floor(t * binCount);
      return Math.max(0, Math.min(binCount - 1, idx));
    };
    const sCounts = new Array(binCount).fill(0) as number[];
    let inS = 0;
    for (const v of stratVals) {
      const b = bin(v);
      if (b != null) { sCounts[b]++; inS++; }
    }
    let bCounts: number[] | null = null;
    let inB = 0;
    if (benchVals.length > 0) {
      bCounts = new Array(binCount).fill(0) as number[];
      for (const v of benchVals) {
        const b = bin(v);
        if (b != null) { bCounts[b]++; inB++; }
      }
    }
    const m = Math.max(0, ...sCounts, ...(bCounts ?? []));
    return { strat: sCounts, bench: bCounts, maxCount: m, inWindowStrat: inS, inWindowBench: inB };
  }, [stratVals, benchVals, lo, hi, binCount]);

  const barW = PLOT_W / binCount;
  const barH = (c: number) => (maxCount > 0 ? (c / maxCount) * PLOT_H : 0);

  // X-axis: lo, 0 (if in range), hi.
  const xTicks: { value: number; label: string }[] = [];
  xTicks.push({ value: lo, label: pctTick(lo) });
  if (lo < 0 && hi > 0) xTicks.push({ value: 0, label: "0%" });
  xTicks.push({ value: hi, label: pctTick(hi) });

  const xPos = (v: number) => PAD.left + ((v - lo) / (hi - lo || 1)) * PLOT_W;

  const onWheel = useCallback(
    (e: ReactWheelEvent<SVGSVGElement>) => {
      if (e.deltaY === 0) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const vbX = ((e.clientX - rect.left) / rect.width) * VB_W;
      const plotPx = vbX - PAD.left;
      if (plotPx < 0 || plotPx > PLOT_W) return;
      const t = plotPx / PLOT_W;
      const anchor = lo + t * (hi - lo);
      // deltaY > 0 → zoom out, < 0 → zoom in. 12% per wheel tick (matches lines).
      const factor = Math.exp(e.deltaY * 0.0012);
      const leftSpan = anchor - lo;
      const rightSpan = hi - anchor;
      let newLo = anchor - leftSpan * factor;
      let newHi = anchor + rightSpan * factor;
      // Outer bounds = full data extreme (max |v| across strategy + benchmark)
      // so the user CAN zoom out past the strategy-anchored natural range to
      // expose benchmark tails.
      if (newLo < outerLo) newLo = outerLo;
      if (newHi > outerHi) newHi = outerHi;
      if (newHi - newLo < MIN_SPAN) return;
      // Snap back to natural (strategy P99) if the zoomed range matches natural.
      const span = newHi - newLo;
      const naturalSpan = naturalHi - naturalLo;
      if (Math.abs(span - naturalSpan) < naturalSpan * 0.01 && Math.abs(newLo - naturalLo) < naturalSpan * 0.01) {
        setZoom(null);
      } else {
        setZoom({ lo: newLo, hi: newHi });
      }
    },
    [lo, hi, naturalLo, naturalHi, outerLo, outerHi],
  );

  const onDoubleClick = useCallback(() => setZoom(null), []);

  // Non-passive wheel listener so we can preventDefault (mirrors TimeSeriesChart).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (ev: WheelEvent) => { if (ev.cancelable) ev.preventDefault(); };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const totalStrat = stratVals.length;
  const totalBench = benchVals.length;
  const droppedStrat = totalStrat - inWindowStrat;
  const droppedBench = totalBench - inWindowBench;
  const droppedNote =
    droppedStrat + droppedBench > 0
      ? ` · ${droppedStrat > 0 ? `${droppedStrat} strategy` : ""}${droppedStrat > 0 && droppedBench > 0 ? " · " : ""}${droppedBench > 0 ? `${droppedBench} ${cmp.shortName}` : ""} outside range`
      : "";
  const zoomedHint = zoom
    ? ` · zoom ${pctTick(lo)} … ${pctTick(hi)} (${inWindowStrat.toLocaleString()} of ${totalStrat.toLocaleString()} in window)`
    : droppedNote;

  return (
    <figure
      className="flex flex-col gap-2"
      style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${VB_H + 80}px` }}
    >
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
            Distribution of Daily Returns
          </h3>
          <p className="text-[11px] text-text-muted">
            {totalStrat.toLocaleString()} samples in visible window
            {bench ? ` · overlay: ${cmp.name}` : ""}
            {zoomedHint}
          </p>
        </div>
        {zoom && (
          <button
            type="button"
            onClick={onDoubleClick}
            className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm border border-border bg-surface-subtle text-text-2 hover:bg-surface"
          >
            Reset zoom
          </button>
        )}
      </header>

      <div className="flex gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-2.5 h-2.5" style={{ background: "var(--color-accent)" }} />
          <span className="text-text-2">{payload.strategyName}</span>
        </span>
        {bench && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-2.5 h-2.5" style={{ background: "var(--color-text-muted)" }} />
            <span className="text-text-2">{cmp.name}{zoom ? ` · ${inWindowBench.toLocaleString()} of ${totalBench.toLocaleString()}` : ""}</span>
          </span>
        )}
        <span className="ml-auto text-[10px] italic text-text-muted">
          Wheel to zoom · double-click to reset
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Distribution of daily returns: ${payload.strategyName}${bench ? ` overlaid with ${cmp.name}` : ""}`}
        className="block w-full select-none"
        style={{ aspectRatio: `${VB_W} / ${VB_H}`, maxHeight: VB_H, width: "100%", height: "auto", cursor: zoom ? "zoom-out" : "zoom-in" }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      >
        <line
          x1={PAD.left}
          y1={PAD.top + PLOT_H}
          x2={PAD.left + PLOT_W}
          y2={PAD.top + PLOT_H}
          stroke="var(--color-text)"
          strokeWidth={1}
        />

        {/* Zero gridline — only meaningful when 0 sits inside the visible range. */}
        {lo < 0 && hi > 0 && (
          <line
            x1={xPos(0)}
            x2={xPos(0)}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke="var(--color-border)"
            strokeDasharray="4 2"
            strokeWidth={1}
          />
        )}

        {xTicks.map(t => (
          <g key={`x-${t.value}`}>
            <line
              x1={xPos(t.value)}
              x2={xPos(t.value)}
              y1={PAD.top + PLOT_H}
              y2={PAD.top + PLOT_H + 5}
              stroke="var(--color-text-muted)"
              strokeWidth={1}
            />
            <text
              x={xPos(t.value)}
              y={PAD.top + PLOT_H + 18}
              textAnchor="middle"
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill="var(--color-text-muted)"
            >
              {t.label}
            </text>
          </g>
        ))}

        {strat.map((c, i) => {
          if (c === 0) return null;
          const h = barH(c);
          const x = PAD.left + i * barW;
          return (
            <rect
              key={`s-${i}`}
              x={x + 0.5}
              y={PAD.top + PLOT_H - h}
              width={Math.max(0, barW - 1)}
              height={h}
              fill="var(--color-accent)"
              fillOpacity={0.85}
            />
          );
        })}

        {bench?.map((c, i) => {
          if (c === 0) return null;
          const h = barH(c);
          const x = PAD.left + i * barW;
          return (
            <rect
              key={`b-${i}`}
              x={x + 0.5}
              y={PAD.top + PLOT_H - h}
              width={Math.max(0, barW - 1)}
              height={h}
              fill="var(--color-text-muted)"
              fillOpacity={0.45}
            />
          );
        })}
      </svg>
    </figure>
  );
}

function pctTick(v: number): string {
  const sign = v > 0 ? "+" : "";
  const abs = Math.abs(v) * 100;
  const dp = abs < 1 ? 2 : abs < 10 ? 1 : 0;
  return `${sign}${(v * 100).toFixed(dp)}%`;
}
