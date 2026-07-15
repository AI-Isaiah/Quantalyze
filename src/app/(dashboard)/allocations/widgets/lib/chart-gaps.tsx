/**
 * Shared gap-rendering library for the Phase-99 time-series widgets (PI-02
 * NetExposureChart + PI-03 AllocationOverTime). This is the SINGLE SOURCE both
 * charts consume — a divergence between the two would break the coverage-mask
 * honesty contract on the demo-hero surface, so the null-sentinel + proportional
 * hatched band + label rule + x-domain live here once and are imported, never
 * reimplemented.
 *
 * ── DESIGN ADAPTATION — FLAGGED FOR design-review ──────────────────────────
 * The public factsheet (`src/app/factsheet/[id]/v2/TimeSeriesChart.tsx`) renders
 * a gap as a ZERO-WIDTH hatched SEAM because its x-axis is INDEX-based: gap days
 * are absent from the axis, so a gap has no temporal width there
 * (TimeSeriesChart.tsx:285-289). These widgets use a CALENDAR-LINEAR numeric
 * x-axis (epoch-ms), where a gap has TRUE temporal width — so the honest
 * equivalent of the seam is a PROPORTIONAL hatched band spanning the gap's real
 * duration. The texture, color, opacity, and label copy are byte-IDENTICAL to
 * the factsheet seam (pattern: userSpaceOnUse 6×6 rotate(45), stroke
 * var(--color-text-muted) opacity 0.15 width 3; label "{days}d — no data";
 * title "No data {start} → {end} ({days} days)"). Only the geometry adapts to
 * the axis model — the convention's language does not. An index-based axis was
 * rejected: it would compress a 90-day outage to the same width as a 1-day hole,
 * understating missing coverage (the opposite of "honest"). This geometric
 * adaptation is the ONE documented deviation from the factsheet gap convention
 * and is explicitly surfaced for design-review (do not hide it).
 * ───────────────────────────────────────────────────────────────────────────
 */

import { ReferenceArea } from "recharts";
import type { ReactElement } from "react";

import type { AsofGap } from "@/lib/portfolio-exposure";

/** Half a calendar day in ms — the ±pad that gives a 1-day gap visible width. */
export const HALF_DAY_MS = 43_200_000;

/**
 * Parse a plain "YYYY-MM-DD" DATE to a UTC epoch-ms at midnight. Mirrors the
 * private `utcMs` in portfolio-exposure.ts — split("-") + Date.UTC, NEVER a
 * `new Date("YYYY-MM-DD")` local parse (which drifts by the host TZ offset).
 */
export function asofToUtcMs(asof: string): number {
  const [y, m, d] = asof.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Format a UTC epoch-ms back to a plain "YYYY-MM-DD" DATE (tick formatting). */
function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface GapBand {
  /** Padded left edge (data coord) — utc(start) − 12h. */
  x1: number;
  /** Padded right edge (data coord) — utc(end) + 12h. */
  x2: number;
  /** Midpoint of the UNPADDED edges — the null-sentinel x for the line break. */
  midMs: number;
  days: number;
  start: string;
  end: string;
}

/**
 * Map coverage gaps to padded bands. The ±HALF_DAY_MS pad gives even a 1-day
 * gap a visible 24h-wide band at daily grain; `midMs` is the midpoint of the
 * UNPADDED edges (the x at which the null sentinel breaks the line/stack).
 */
export function toGapBands(gaps: AsofGap[]): GapBand[] {
  return gaps.map((g) => {
    const startMs = asofToUtcMs(g.start);
    const endMs = asofToUtcMs(g.end);
    return {
      x1: startMs - HALF_DAY_MS,
      x2: endMs + HALF_DAY_MS,
      midMs: (startMs + endMs) / 2,
      days: g.days,
      start: g.start,
      end: g.end,
    };
  });
}

/**
 * Gap-aware x-domain: [min(points ∪ bands.x1), max(points ∪ bands.x2)] so a
 * leading/trailing gap band is never clipped (F-2 boundary support). With no
 * gaps this collapses to [firstPoint, lastPoint].
 */
export function gapXDomain(pointMs: number[], bands: GapBand[]): [number, number] {
  const lows = [...pointMs, ...bands.map((b) => b.x1)];
  const highs = [...pointMs, ...bands.map((b) => b.x2)];
  return [Math.min(...lows), Math.max(...highs)];
}

/**
 * Custom ReferenceArea `shape` — recharts injects x/y/width/height (the mapped
 * band rect). Renders the factsheet hatch texture + an always-present SVG
 * <title>, plus the "{days}d — no data" label ONLY at days ≥ 5 (below that the
 * band is too narrow to hold the label at daily grain — deterministic and
 * testable). fontSize is a numeric SVG prop, not a Tailwind class, per the
 * existing chart idiom (lint-clean under no-raw-font-px).
 */
function GapBandShape(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  band: GapBand;
  patternId: string;
}): ReactElement {
  const { x = 0, y = 0, width = 0, height = 0, band, patternId } = props;
  return (
    <g pointerEvents="none">
      <title>{`No data ${band.start} → ${band.end} (${band.days} days)`}</title>
      <rect x={x} y={y} width={width} height={height} fill={`url(#${patternId})`} />
      {band.days >= 5 && (
        <text
          x={x + width / 2}
          y={y + 11}
          textAnchor="middle"
          fontSize={10}
          fontFamily="var(--font-mono)"
          fill="var(--color-text-muted)"
        >
          {band.days}d — no data
        </text>
      )}
    </g>
  );
}

/**
 * The gap layer both charts splice directly into a recharts chart's children:
 * a single <defs> holding the factsheet hatch <pattern> (byte-matched to
 * TimeSeriesChart.tsx:299-310), followed by one <ReferenceArea> per band using
 * GapBandShape. `patternId` is caller-supplied (React useId per instance) so
 * multiple chart instances never collide in the shared <defs> namespace.
 */
export function renderGapAreas(bands: GapBand[], patternId: string): ReactElement[] {
  return [
    <defs key="gap-defs">
      <pattern
        id={patternId}
        patternUnits="userSpaceOnUse"
        width="6"
        height="6"
        patternTransform="rotate(45)"
      >
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-text-muted)" strokeOpacity="0.15" strokeWidth="3" />
      </pattern>
    </defs>,
    ...bands.map((b) => (
      <ReferenceArea
        key={`gap-${b.start}-${b.end}`}
        x1={b.x1}
        x2={b.x2}
        ifOverflow="visible"
        zIndex={0}
        shape={<GapBandShape band={b} patternId={patternId} />}
      />
    )),
  ];
}

/**
 * A tick formatter for the numeric epoch-ms x-axis: "MM-DD" when the domain's
 * start and end share a UTC year, else "YY-MM-DD" so a multi-year window shows
 * the year. UTC-pure (via toIsoDate) so ticks are TZ-stable.
 */
export function makeDateTickFormatter(domain: [number, number]): (ms: number) => string {
  const sameYear = toIsoDate(domain[0]).slice(0, 4) === toIsoDate(domain[1]).slice(0, 4);
  return (ms: number) => (sameYear ? toIsoDate(ms).slice(5) : toIsoDate(ms).slice(2));
}
