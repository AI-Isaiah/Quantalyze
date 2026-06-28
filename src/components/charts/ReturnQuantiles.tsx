"use client";

import {
  CHART_ACCENT,
  CHART_AXIS_TICK,
  CHART_FONT_MONO,
  CHART_TEXT_MUTED,
} from "./chart-tokens";
import { ResponsiveChartFrame } from "@/components/ResponsiveChartFrame";
import { useBreakpoint } from "@/hooks/useBreakpoint";

interface ReturnQuantilesProps {
  data: Record<string, number[]>;
}

// Fixed width axis (unchanged at every breakpoint). Desktop viewBox height is
// today's literal (200); CHART-03 portrait selects a taller mobile viewBox so
// the box bodies + labels breathe at 320px while the desktop SSR arm keeps
// today's literals (server snapshot is "desktop"). NB the svg wrapper is now
// ResponsiveChartFrame, so only these literals + the box/whisker geometry are
// unchanged — the wrapper markup itself is not byte-identical to the old <svg>.
const VB_W = 600;
const VB_H_DESKTOP = 200;
const VB_H_MOBILE = 280;
// Desktop tick/label fonts = today's literals (10 y-tick, 11 period label).
// At 320px against VB_W=600 a 10px label lands at ~4.8px effective (the WCAG
// 1.4.4 downscale trap, RESEARCH legibility math); the mobile arm bumps both
// to clear the ~12px effective floor.
const Y_FONT_DESKTOP = 10;
const Y_FONT_MOBILE = 22;
const PERIOD_FONT_DESKTOP = 11;
const PERIOD_FONT_MOBILE = 22;
// Desktop draws 5 y-gridlines (today); mobile reduces to 3 so each bumped
// label has room and does not collide at 320px.
const Y_FRACS_DESKTOP = [0, 0.25, 0.5, 0.75, 1];
const Y_FRACS_MOBILE = [0, 0.5, 1];

/**
 * Return Quantiles box plot for the Returns Distribution panel.
 *
 * Identity tokens:
 *   - Box stroke + fill + median line: CHART_ACCENT (#1B6B5A)
 *   - Whisker strokes: CHART_TEXT_MUTED (#94A3B8) — strokes, not text
 *     fills, so the muted-as-text accessibility rule does not apply
 *   - Y-axis tick text uses CHART_FONT_MONO and CHART_AXIS_TICK fill
 *
 * Phase 47 / CHART-02 + CHART-03: wrapped in ResponsiveChartFrame; a
 * `useBreakpoint` mobile branch bumps the axis/period fonts + reduces the
 * y-gridline density + raises the viewBox height so the chart is legible at
 * 320px. The DESKTOP branch returns today's exact literals (viewBox 600×200,
 * fontSize 10/11, 5 gridlines) so the desktop svg content is unchanged (the
 * wrapper itself is now ResponsiveChartFrame, not the old bare <svg>). This
 * chart has NO desktop hover, so it gets legibility + portrait ONLY — no
 * tap-reveal / tabIndex / pointer handlers (parity-only rule).
 */
export function ReturnQuantiles({ data }: ReturnQuantilesProps) {
  const isMobile = useBreakpoint() === "mobile";
  const periods = Object.keys(data);
  if (periods.length === 0) return null;

  const allValues = Object.values(data).flat();
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const width = VB_W;
  const height = isMobile ? VB_H_MOBILE : VB_H_DESKTOP;
  const yFont = isMobile ? Y_FONT_MOBILE : Y_FONT_DESKTOP;
  const periodFont = isMobile ? PERIOD_FONT_MOBILE : PERIOD_FONT_DESKTOP;
  const yFracs = isMobile ? Y_FRACS_MOBILE : Y_FRACS_DESKTOP;
  const padding = { top: 20, right: 40, bottom: 30, left: 60 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  function yScale(v: number) {
    return padding.top + plotH - ((v - min) / range) * plotH;
  }

  const boxWidth = Math.min(60, plotW / periods.length / 2);

  return (
    <ResponsiveChartFrame
      width={width}
      height={height}
      role="img"
      aria-label={`Return quantiles box plot across ${periods.length} period${periods.length === 1 ? "" : "s"} (${periods.join(", ")}).`}
    >
      {/* Y axis grid lines */}
      {yFracs.map((frac) => {
        const val = min + frac * range;
        const y = yScale(val);
        return (
          <g key={frac}>
            <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#F1F5F9" />
            <text
              x={padding.left - 8}
              y={y + 4}
              textAnchor="end"
              fontSize={yFont}
              fill={CHART_AXIS_TICK}
              fontFamily={CHART_FONT_MONO}
            >
              {(val * 100).toFixed(1)}%
            </text>
          </g>
        );
      })}

      {periods.map((period, i) => {
        const [q0, q25, q50, q75, q100] = data[period];
        const cx = padding.left + ((i + 0.5) / periods.length) * plotW;
        const halfBox = boxWidth / 2;

        return (
          <g key={period}>
            {/* Whisker (strokes, not text fill) */}
            <line x1={cx} x2={cx} y1={yScale(q0)} y2={yScale(q100)} stroke={CHART_TEXT_MUTED} strokeWidth={1} />
            <line x1={cx - halfBox / 2} x2={cx + halfBox / 2} y1={yScale(q0)} y2={yScale(q0)} stroke={CHART_TEXT_MUTED} strokeWidth={1} />
            <line x1={cx - halfBox / 2} x2={cx + halfBox / 2} y1={yScale(q100)} y2={yScale(q100)} stroke={CHART_TEXT_MUTED} strokeWidth={1} />
            {/* Box */}
            <rect
              x={cx - halfBox}
              y={yScale(q75)}
              width={boxWidth}
              height={yScale(q25) - yScale(q75)}
              fill={CHART_ACCENT}
              opacity={0.15}
              stroke={CHART_ACCENT}
              strokeWidth={1}
              rx={2}
            />
            {/* Median */}
            <line x1={cx - halfBox} x2={cx + halfBox} y1={yScale(q50)} y2={yScale(q50)} stroke={CHART_ACCENT} strokeWidth={2} />
            {/* Period label */}
            <text x={cx} y={height - 8} textAnchor="middle" fontSize={periodFont} fill={CHART_AXIS_TICK}>
              {period}
            </text>
          </g>
        );
      })}
    </ResponsiveChartFrame>
  );
}
