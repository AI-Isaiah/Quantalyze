"use client";

import { formatPercent } from "@/lib/utils";
import { CHART_ACCENT, CHART_BORDER, CHART_AXIS_TICK } from "@/components/charts/chart-tokens";
import { ResponsiveChartFrame } from "@/components/ResponsiveChartFrame";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import type { MonteCarloBandPoint } from "../lib/scenario-montecarlo";

/**
 * Plan 27-02 — the forward confidence-band chart (the "fan").
 *
 * A dedicated lightweight SVG chart — deliberately NOT a Recharts mount and NOT
 * an edit to the 1500-line `EquityChart`. It mirrors EquityChart's token family
 * (chart-strategy stroke, hairline axis, Geist-Mono ticks) so it reads as the
 * same chart family, and renders ONLY data: a shaded outer (p5–p95) + inner
 * (p25–p75) band (solid low-opacity `CHART_ACCENT`, NOT a gradient — DESIGN.md
 * "no gradients") and a median (p50) line. Cumulative-RETURN form: the y origin
 * is 0 (today), so the zero baseline anchors the fan.
 *
 * The chart is `role="img"` with a text alt — NOT an interactive/`tabIndex`
 * element, so it never becomes an empty keyboard focus stop (the Recharts
 * accessibilityLayer regression DESIGN.md pins against). The same numbers are
 * also surfaced as text in the section's terminal summary.
 */

// Fixed width axis (unchanged at every breakpoint). Desktop viewBox height +
// tick font are today's literals (240, 12); CHART-02/03 select a taller mobile
// viewBox + a bumped tick font so the chart is legible at 320px while the
// desktop SSR arm keeps today's literals (server snapshot is "desktop"). NB the
// svg wrapper is now ResponsiveChartFrame, so only these literals + the
// band/median path data are unchanged — the wrapper markup itself is not
// byte-identical to the pre-phase-47 bare <svg>. Not on a parity-golden route.
const W = 600;
const H_DESKTOP = 240;
const H_MOBILE = 320;
const PAD_L = 48;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 24;
const PLOT_W = W - PAD_L - PAD_R;
// At 320px against VB_W=600 a 12px tick lands at ~5.8px effective (the WCAG
// 1.4.4 downscale trap, RESEARCH legibility math); the mobile arm bumps it to
// clear the ~12px effective floor.
const TICK_FONT_DESKTOP = 12;
const TICK_FONT_MOBILE = 20;

// The default quantile band edges this chart renders. The section always runs
// the engine with the default quantile set (MC_QUANTILES_DEFAULT), so all five
// keys are ASSUMED PRESENT on every point per that engine contract. (No
// per-key guard here: an absent key would make `y(undefined)` → NaN and emit a
// malformed `L<x>,NaN` path, not skip the band — so a future quantile-set
// change must keep these keys, or add a guard at that time. YAGNI for v1.)
const OUTER_LO = "p5";
const INNER_LO = "p25";
const MEDIAN = "p50";
const INNER_HI = "p75";
const OUTER_HI = "p95";

interface MonteCarloBandChartProps {
  bands: MonteCarloBandPoint[];
}

export function MonteCarloBandChart({ bands }: MonteCarloBandChartProps) {
  // CHART-02/03: a narrow viewport gets a taller viewBox + bumped tick font so
  // the chart is legible at 320px. Desktop returns today's exact literals
  // (H=240, fontSize=12) so the svg content stays unchanged (the wrapper is now
  // ResponsiveChartFrame). This chart is
  // `role="img"` by DESIGN (deliberately non-interactive — see header) and stays
  // so at every breakpoint: NO tabIndex / pointer handlers are ever added.
  const isMobile = useBreakpoint() === "mobile";
  const H = isMobile ? H_MOBILE : H_DESKTOP;
  const PLOT_H = H - PAD_T - PAD_B;
  const tickFont = isMobile ? TICK_FONT_MOBILE : TICK_FONT_DESKTOP;

  if (bands.length === 0) return null;

  const n = bands.length;
  // y-domain: include 0 (the baseline) plus the outer band extremes.
  let yMin = 0;
  let yMax = 0;
  for (const b of bands) {
    const lo = b.q[OUTER_LO];
    const hi = b.q[OUTER_HI];
    if (Number.isFinite(lo) && lo < yMin) yMin = lo;
    if (Number.isFinite(hi) && hi > yMax) yMax = hi;
  }
  // Guard a degenerate flat domain (shouldn't happen above the floor, but never
  // divide by zero) — give it a tiny symmetric pad.
  if (yMax - yMin < 1e-9) {
    yMax += 0.01;
    yMin -= 0.01;
  }

  const x = (i: number) => PAD_L + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = (v: number) => PAD_T + ((yMax - v) / (yMax - yMin)) * PLOT_H;

  /** Closed band polygon between a lower-quantile key and an upper-quantile key. */
  const bandPath = (loKey: string, hiKey: string): string => {
    const top = bands.map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(b.q[hiKey]).toFixed(2)}`).join(" ");
    const bottom = bands
      .slice()
      .reverse()
      .map((b, j) => `L${x(n - 1 - j).toFixed(2)},${y(b.q[loKey]).toFixed(2)}`)
      .join(" ");
    return `${top} ${bottom} Z`;
  };

  const medianPath = bands
    .map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(b.q[MEDIAN]).toFixed(2)}`)
    .join(" ");

  const last = bands[n - 1].q;
  const ariaLabel = `Forward confidence bands over ${n} trading days. Median terminal return ${formatPercent(
    last[MEDIAN],
  )}, with a 5 to 95 percent interval of ${formatPercent(last[OUTER_LO])} to ${formatPercent(last[OUTER_HI])}.`;

  const yZero = y(0);

  return (
    <ResponsiveChartFrame
      width={W}
      height={H}
      role="img"
      aria-label={ariaLabel}
      data-testid="montecarlo-band-chart"
      className="overflow-visible"
    >
      {/* zero baseline (today = 0% cumulative return) */}
      <line x1={PAD_L} y1={yZero} x2={W - PAD_R} y2={yZero} stroke={CHART_BORDER} strokeWidth={1} />
      {/* outer band p5–p95 (lightest) */}
      <path d={bandPath(OUTER_LO, OUTER_HI)} fill={CHART_ACCENT} fillOpacity={0.12} stroke="none" data-testid="mc-band-outer" />
      {/* inner band p25–p75 (slightly stronger) */}
      <path d={bandPath(INNER_LO, INNER_HI)} fill={CHART_ACCENT} fillOpacity={0.2} stroke="none" data-testid="mc-band-inner" />
      {/* median line */}
      <path d={medianPath} fill="none" stroke={CHART_ACCENT} strokeWidth={1.5} data-testid="mc-median" />
      {/* y ticks: min / 0 / max */}
      {[yMin, 0, yMax].map((v, i) => (
        <text
          key={i}
          x={PAD_L - 6}
          y={y(v) + 3}
          textAnchor="end"
          fontFamily="var(--font-mono), monospace"
          fontSize={tickFont}
          fill={CHART_AXIS_TICK}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {formatPercent(v)}
        </text>
      ))}
      {/* x ticks: today / horizon */}
      <text x={PAD_L} y={H - 6} textAnchor="start" fontFamily="var(--font-mono), monospace" fontSize={tickFont} fill={CHART_AXIS_TICK}>
        Today
      </text>
      <text x={W - PAD_R} y={H - 6} textAnchor="end" fontFamily="var(--font-mono), monospace" fontSize={tickFont} fill={CHART_AXIS_TICK} style={{ fontVariantNumeric: "tabular-nums" }}>
        {n}d
      </text>
    </ResponsiveChartFrame>
  );
}
