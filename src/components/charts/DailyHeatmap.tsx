"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import {
  CHART_BORDER,
  CHART_AXIS_TICK,
  CHART_TEXT_MUTED,
  CHART_FONT_MONO,
  CHART_POSITIVE,
  CHART_NEGATIVE,
  CHART_NEUTRAL,
} from "./chart-tokens";

/**
 * Phase 14b / KPI-07 — DailyHeatmap dual SVG/Canvas renderer.
 *
 * SVG branch (≤365 cells): one <rect> per day with the 9-step diverging color
 * scale anchored at 0. SVG <title> child carries the screen-reader narration.
 *
 * Canvas branch (>365 cells): single <canvas> with a year-row × day-of-year
 * column grid (Grok B-02 fix — 2px-wide cells fit the 730px canvas width
 * exactly). An offscreen <table> mirror provides screen-reader access since
 * <canvas> contents are opaque to AT.
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

/** 9-step diverging color scale anchored at 0 — UI-SPEC §3.5. */
function cellFill(v: number): { fill: string; opacity: number } {
  if (v >= 0.1) return { fill: CHART_POSITIVE, opacity: 1 };
  if (v >= 0.05) return { fill: CHART_POSITIVE, opacity: 0.7 };
  if (v >= 0.02) return { fill: CHART_POSITIVE, opacity: 0.4 };
  if (v > 0) return { fill: CHART_POSITIVE, opacity: 0.15 };
  if (v === 0) return { fill: CHART_NEUTRAL, opacity: 1 };
  if (v > -0.02) return { fill: CHART_NEGATIVE, opacity: 0.15 };
  if (v > -0.05) return { fill: CHART_NEGATIVE, opacity: 0.4 };
  if (v > -0.1) return { fill: CHART_NEGATIVE, opacity: 0.7 };
  return { fill: CHART_NEGATIVE, opacity: 1 };
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
 * CR-01 fix: the original layout used `cols = Math.min(12, cellCount)` (a
 * monthly intent) which clipped raw daily data starting from day 13. The SVG
 * branch now uses dayOfYear()-based x-positions identical to the Canvas
 * branch, so all 365 possible positions fit within the viewBox.
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
              const { fill, opacity } = cellFill(d.value);
              // Use day-of-year for x — consistent with Canvas branch (CR-01 fix).
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
                  fillOpacity={opacity}
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

/* Canvas branch — Grok B-02 geometry (row=year, col=day-of-year, 2px cells) */
const CELL_W = 2;
const CELL_H = 80;
const CANVAS_WIDTH = 730; // = 365 * 2
// WR-01: canvas height is computed dynamically from year count at render time
// so strategies with 6+ years of data are not silently clipped.

const CanvasRenderer = memo(function CanvasRenderer({
  data,
}: {
  data: DailyHeatmapDataPoint[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const rowsByYear = useMemo(() => groupByYear(data), [data]);
  const yearOrder = useMemo(() => rowsByYear.map((r) => r.year), [rowsByYear]);

  // WR-01: dynamic height — grows with the actual number of distinct years.
  const canvasHeight = Math.max(CELL_H, rowsByYear.length * CELL_H);

  useEffect(() => {
    performance.mark("panel-4-mount-start");
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx) {
      for (const point of data) {
        const yr = point.date.slice(0, 4);
        const yearIdx = yearOrder.indexOf(yr);
        if (yearIdx < 0) continue;
        const doy = dayOfYear(point.date);
        const x = doy * CELL_W;
        const y = yearIdx * CELL_H;
        const { fill, opacity } = cellFill(point.value);
        ctx.fillStyle = fill;
        ctx.globalAlpha = opacity;
        ctx.fillRect(x, y, CELL_W, CELL_H);
      }
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
  }, [data, yearOrder]);

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
 * Phase 14b-02 / Grok W-01: the public symbol `DailyHeatmap` is the
 * memoized version of `DailyHeatmapInner`. React.memo's default shallow
 * compare on the `data` prop is the contract; consumers (notably
 * `ReturnsDistributionPanel`) MUST stabilize the data prop reference via
 * `useMemo` so panel-level status transitions don't re-paint the Canvas.
 */
function DailyHeatmapInner({ data }: DailyHeatmapProps) {
  if (data.length === 0) return <div data-empty="true" />;
  if (data.length <= SVG_THRESHOLD_CELLS) return <SvgRenderer data={data} />;
  return <CanvasRenderer data={data} />;
}

export const DailyHeatmap = memo(DailyHeatmapInner);
