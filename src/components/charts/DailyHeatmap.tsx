"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import {
  CHART_BORDER,
  CHART_AXIS_TICK,
  CHART_TEXT_MUTED,
  CHART_FONT_MONO,
  CHART_NEGATIVE_100,
  CHART_NEGATIVE_300,
  CHART_NEGATIVE_700,
  CHART_NEGATIVE_800,
  CHART_NEUTRAL,
  CHART_POSITIVE_100,
  CHART_POSITIVE_300,
  CHART_POSITIVE_700,
  CHART_POSITIVE_800,
} from "./chart-tokens";

/**
 * DailyHeatmap dual SVG/Canvas renderer.
 *
 * SVG branch (≤365 cells): one <rect> per day with the 9-step diverging color
 * scale anchored at 0. SVG <title> child carries the screen-reader narration.
 *
 * Canvas branch (>365 cells): single <canvas> with a year-row × day-of-year
 * column grid using 2px-wide cells that fit the 730px canvas width exactly.
 * An offscreen <table> mirror provides screen-reader access since <canvas>
 * contents are opaque to AT.
 *
 * Performance budget: <300ms first paint on a 5y fixture (1825 cells),
 * measured via `performance.measure('panel-4-paint', 'panel-4-mount-start',
 * 'panel-4-mount-end')`. Asserted by `tests/e2e/strategy-v2-chart-parity.spec.ts`.
 */

export const SVG_THRESHOLD_CELLS = 365;

export interface DailyHeatmapDataPoint {
  /** ISO YYYY-MM-DD */
  date: string;
  /** Daily return as decimal, e.g. 0.0123 = 1.23% */
  value: number;
}

interface DailyHeatmapProps {
  data: DailyHeatmapDataPoint[];
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * 9-step diverging color scale anchored at 0. Tints are baked into the hex
 * (no `fillOpacity` / `globalAlpha`) because per-shape alpha blends through
 * to the surface beneath, collapsing contrast far below WCAG AA — the same
 * regression PR #108 fixed in MonthlyHeatmap. Colors mirror the canonical
 * ramp in chart-tokens.ts.
 */
function cellFill(v: number): string {
  if (v >= 0.1) return CHART_POSITIVE_800;
  if (v >= 0.05) return CHART_POSITIVE_700;
  if (v >= 0.02) return CHART_POSITIVE_300;
  if (v > 0) return CHART_POSITIVE_100;
  if (v === 0) return CHART_NEUTRAL;
  if (v > -0.02) return CHART_NEGATIVE_100;
  if (v > -0.05) return CHART_NEGATIVE_300;
  if (v > -0.1) return CHART_NEGATIVE_700;
  return CHART_NEGATIVE_800;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Month start day-of-year offsets (0-indexed). Used by dayOfYear() and SVG month labels. */
const MONTH_DOY_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** 0-based day-of-year, clamped to [0, 364] to match the 365-column layout. */
function dayOfYear(dateStr: string): number {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7)); // 1-12
  const day = Number(dateStr.slice(8, 10)); // 1-31
  let doy = MONTH_DOY_START[month - 1] + (day - 1);
  if (month >= 3 && isLeapYear(year)) doy += 1;
  if (doy > 364) doy = 364;
  if (doy < 0) doy = 0;
  return doy;
}

interface YearRow {
  year: string;
  days: DailyHeatmapDataPoint[];
}

function groupByYear(data: DailyHeatmapDataPoint[]): YearRow[] {
  const map = new Map<string, DailyHeatmapDataPoint[]>();
  for (const d of data) {
    const yr = d.date.slice(0, 4);
    const arr = map.get(yr);
    if (arr) arr.push(d);
    else map.set(yr, [d]);
  }
  return Array.from(map.keys())
    .sort()
    .map((yr) => ({ year: yr, days: map.get(yr)! }));
}

/**
 * SVG branch geometry — mirrors the Canvas branch: year-row × day-of-year
 * column layout, 2px-wide cells, 365 columns.
 *
 * Uses dayOfYear()-based x-positions identical to the Canvas branch, so
 * all 365 possible positions fit within the viewBox. (Earlier prototype
 * versions used `cols = Math.min(12, cellCount)` — a monthly-grid intent
 * that clipped raw daily data starting from day 13.)
 */
const SVG_DOY_CELL_W = 2; // 365 * 2 = 730px — matches Canvas CANVAS_WIDTH
const SVG_CELL_H = 16;
const SVG_LEFT_GUTTER = 56; // room for the year label
const SVG_TOP_GUTTER = 24; // room for the month label

const SvgRenderer = memo(function SvgRenderer({ data }: { data: DailyHeatmapDataPoint[] }) {
  const rows = useMemo(() => groupByYear(data), [data]);

  // Width spans all 365 day-of-year columns at 2px each (+ left gutter).
  const width = SVG_LEFT_GUTTER + 365 * SVG_DOY_CELL_W;
  const height = SVG_TOP_GUTTER + rows.length * SVG_CELL_H + 8;

  return (
    <div className="w-full" style={{ minHeight: 280 }}>
      <svg
        role="img"
        aria-label="Daily returns heatmap"
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
      >
        {/* X-axis month labels — positioned at each month's day-of-year start */}
        {MONTHS.map((m, i) => (
          <text
            key={m}
            data-axis="month"
            x={SVG_LEFT_GUTTER + MONTH_DOY_START[i] * SVG_DOY_CELL_W}
            y={SVG_TOP_GUTTER - 8}
            fontSize={12}
            fill={CHART_AXIS_TICK}
            textAnchor="start"
          >
            {m}
          </text>
        ))}

        {rows.map((row, rowIdx) => (
          <g key={row.year}>
            {/* Y-axis year label — Geist Mono via CHART_FONT_MONO */}
            <text
              data-axis="year"
              x={SVG_LEFT_GUTTER - 8}
              y={SVG_TOP_GUTTER + rowIdx * SVG_CELL_H + SVG_CELL_H / 2 + 4}
              fontFamily={CHART_FONT_MONO}
              fontSize={12}
              fill={CHART_TEXT_MUTED}
              textAnchor="end"
            >
              {row.year}
            </text>
            {row.days.map((d) => {
              const fill = cellFill(d.value);
              // Use day-of-year for x — consistent with Canvas branch.
              const x = SVG_LEFT_GUTTER + dayOfYear(d.date) * SVG_DOY_CELL_W;
              const y = SVG_TOP_GUTTER + rowIdx * SVG_CELL_H;
              return (
                <rect
                  key={d.date}
                  data-cell={d.date}
                  x={x}
                  y={y}
                  width={SVG_DOY_CELL_W}
                  height={SVG_CELL_H}
                  fill={fill}
                  stroke={CHART_BORDER}
                  strokeWidth={0.5}
                >
                  <title>{`${d.date}: ${(d.value * 100).toFixed(2)}%`}</title>
                </rect>
              );
            })}
          </g>
        ))}

        {/* Hover-state stroke value is reachable via CSS but the test asserts
         * the static stroke = CHART_BORDER. CHART_AXIS_TICK is referenced
         * here to keep the import alive for future hover styling without
         * tripping noUnusedLocals. */}
        <desc data-hover-stroke={CHART_AXIS_TICK} />
      </svg>
    </div>
  );
});

/* Canvas branch geometry: row=year, col=day-of-year, 2px cells. */
const CELL_W = 2;
const CELL_H = 80;
const CANVAS_WIDTH = 730; // = 365 * 2
// Canvas height is computed dynamically from year count at render time so
// strategies with 6+ years of data are not silently clipped.

const CanvasRenderer = memo(function CanvasRenderer({
  data,
}: {
  data: DailyHeatmapDataPoint[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const rowsByYear = useMemo(() => groupByYear(data), [data]);
  // O(1) year-index lookup folded directly off rowsByYear. Replaces an
  // O(n × y) indexOf inside the per-cell paint loop (1825 × 5 ≈ 9k string
  // comparisons on a 5-year strategy).
  const yearIndex = useMemo(
    () => new Map(rowsByYear.map((r, i) => [r.year, i] as const)),
    [rowsByYear],
  );

  // Dynamic height — grows with the actual number of distinct years.
  const canvasHeight = Math.max(CELL_H, rowsByYear.length * CELL_H);

  useEffect(() => {
    let cancelled = false;

    const paint = () => {
      if (cancelled) return;
      performance.mark("panel-4-mount-start");
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (ctx) {
        // Save/restore wraps the paint as defensive insulation against any
        // future code that mutates context state (alpha, transform, filter)
        // and forgets to reset it. Near-zero cost per paint.
        ctx.save();
        // Clear before paint — the canvas auto-clears when width/height attrs
        // change, but `canvasHeight` only changes on year-count change. When
        // `data` shrinks within the same year set (e.g., a refetch returns a
        // subset), stale pixels from the prior paint would otherwise remain.
        ctx.clearRect(0, 0, CANVAS_WIDTH, canvasHeight);
        for (const point of data) {
          const yr = point.date.slice(0, 4);
          const yearIdx = yearIndex.get(yr);
          if (yearIdx === undefined) continue;
          const doy = dayOfYear(point.date);
          const x = doy * CELL_W;
          const y = yearIdx * CELL_H;
          ctx.fillStyle = cellFill(point.value);
          ctx.fillRect(x, y, CELL_W, CELL_H);
        }
        ctx.restore();
      }
      performance.mark("panel-4-mount-end");
      try {
        performance.measure(
          "panel-4-paint",
          "panel-4-mount-start",
          "panel-4-mount-end",
        );
      } catch {
        // performance.measure can throw if the marks were cleared between
        // mount and effect — non-fatal for paint correctness.
      }
    };

    // Gate first paint on document.fonts.ready ONLY when fonts are
    // currently loading. The surrounding panel typography (Geist Mono
    // labels, year axis text) drives the canvas container's flow size on
    // cold loads — painting before fonts settle can race a layout reflow
    // and leave the cells visibly misaligned for a frame.
    //
    // The synchronous fast path matters for both warm renders (typical
    // post-hydration: fonts already settled, no microtask hop needed) and
    // for the test environment (jsdom / happy-dom report status="loaded"
    // immediately, so canvas spies see fillRect on the same tick as
    // render — the unit tests below depend on this). Both fulfillment and
    // rejection paths fall through to paint() — fonts.ready is spec'd
    // never to reject, but the dual-callback form is defensive against
    // partial DOM implementations.
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (fonts && fonts.status === "loading") {
      fonts.ready.then(paint, paint);
    } else {
      paint();
    }

    return () => {
      cancelled = true;
    };
  }, [data, yearIndex, canvasHeight]);

  return (
    <div className="relative w-full" style={{ minHeight: Math.max(360, rowsByYear.length * CELL_H) }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={canvasHeight}
        role="presentation"
        aria-hidden="true"
        className="w-full"
      />
      <table aria-label="Daily returns table" aria-hidden="false" className="sr-only">
        <tbody>
          {rowsByYear.map((row) => (
            <tr key={row.year}>
              <th scope="row">{row.year}</th>
              {row.days.map((d) => (
                <td key={d.date}>{`${d.date}: ${(d.value * 100).toFixed(2)}%`}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/**
 * DailyHeatmap — top-level branching component.
 *
 * - data.length === 0 → renders an empty placeholder div (no SVG / no canvas)
 * - data.length ≤ SVG_THRESHOLD_CELLS (365) → SVG renderer
 * - data.length > SVG_THRESHOLD_CELLS → Canvas renderer + offscreen <table>
 *
 * The public symbol `DailyHeatmap` is the memoized version of
 * `DailyHeatmapInner`. React.memo's default shallow compare on the `data`
 * prop is the contract — consumers (notably `ReturnsDistributionPanel`)
 * MUST stabilize the `data` prop via `useMemo` so panel-level status
 * transitions don't trigger an unnecessary Canvas repaint.
 */
function DailyHeatmapInner({ data }: DailyHeatmapProps) {
  if (data.length === 0) return <div data-empty="true" />;
  if (data.length <= SVG_THRESHOLD_CELLS) return <SvgRenderer data={data} />;
  return <CanvasRenderer data={data} />;
}

export const DailyHeatmap = memo(DailyHeatmapInner);
