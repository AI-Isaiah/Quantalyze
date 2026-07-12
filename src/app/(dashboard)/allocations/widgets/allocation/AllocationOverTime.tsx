"use client";

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import type { AllocationPoint, AsofGap } from "@/lib/portfolio-exposure";
import { Card } from "@/components/ui/Card";
import { TouchTooltip } from "@/components/charts/TouchTooltip";
import {
  CHART_BORDER,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_STYLE,
} from "@/components/charts/chart-tokens";
import { STRATEGY_PALETTE, formatCurrency } from "@/lib/utils";
import {
  asofToUtcMs,
  gapXDomain,
  makeDateTickFormatter,
  renderGapAreas,
  toGapBands,
  type GapBand,
} from "../lib/chart-gaps";

/**
 * One row of the stacked-area data: a numeric x plus one weight per venue. A
 * venue absent at an asof reads `0` (its true weight that day, D-P3); a gap
 * sentinel reads `null` for EVERY venue so recharts breaks the stack across it.
 */
interface AllocationRow {
  asofMs: number;
  [venue: string]: number | null;
}

/**
 * Pure pivot builder (unit-testable without rendering). Turns the per-asof
 * per-venue weight points into a wide stacked-area matrix:
 * - `venues`: distinct venues sorted by MEAN weight desc — the largest is
 *   rendered first, i.e. the BOTTOM of the recharts stack (a stable reading
 *   base), with a deterministic name tiebreak.
 * - `rows`: one row per observed asof `{ asofMs, [venue]: weight }`; a venue
 *   absent at an asof is `0` (the TRUE weight, not invented data). Plus ONE
 *   all-null sentinel row per gap at the band midpoint, so with
 *   `connectNulls={false}` recharts visibly breaks the stack over the gap.
 *   Sorted by asofMs so a leading/interior/trailing gap sits in place.
 * - `usdByAsofMs`: asofMs -> { venue: valueUsd } for the tooltip's gross line.
 * - `bands`/`domain` via the SHARED chart-gaps contract; the domain spans the
 *   padded gap edges (F-2) so a boundary gap band renders instead of clipping.
 */
export function buildAllocationChartData(
  points: AllocationPoint[],
  gaps: AsofGap[],
): {
  venues: string[];
  rows: AllocationRow[];
  usdByAsofMs: Map<number, Record<string, number>>;
  bands: GapBand[];
  domain: [number, number];
} {
  const bands = toGapBands(gaps);

  // Mean weight per venue = sum of its weights / point count. All venues share
  // the same denominator, so sorting by the summed weight equals sorting by the
  // mean — largest first (bottom of the stack).
  const weightSum = new Map<string, number>();
  for (const p of points) {
    for (const v of p.venues) {
      weightSum.set(v.venue, (weightSum.get(v.venue) ?? 0) + v.weight);
    }
  }
  const venues = [...weightSum.keys()].sort(
    (a, b) => (weightSum.get(b)! - weightSum.get(a)!) || a.localeCompare(b),
  );

  const usdByAsofMs = new Map<number, Record<string, number>>();
  const observed: AllocationRow[] = points.map((p) => {
    const asofMs = asofToUtcMs(p.asof);
    const row: AllocationRow = { asofMs };
    for (const venue of venues) row[venue] = 0; // true-zero baseline
    const usd: Record<string, number> = {};
    for (const v of p.venues) {
      row[v.venue] = v.weight;
      usd[v.venue] = v.valueUsd;
    }
    usdByAsofMs.set(asofMs, usd);
    return row;
  });

  const sentinels: AllocationRow[] = bands.map((b) => {
    const row: AllocationRow = { asofMs: b.midMs };
    for (const venue of venues) row[venue] = null; // stack break across the gap
    return row;
  });

  const rows = [...observed, ...sentinels].sort((a, b) => a.asofMs - b.asofMs);
  const domain = gapXDomain(observed.map((r) => r.asofMs), bands);
  return { venues, rows, usdByAsofMs, bands, domain };
}

/**
 * PI-03 — "Allocation over time". A recharts stacked AreaChart (NOT a
 * streamgraph) binding `getAllocationSeries` output: one `<Area stackId="alloc">`
 * per venue in STRATEGY_PALETTE order (largest at the bottom), white hairline
 * seams, a flat 0–100% ceiling (weights sum to 1 by construction, D-P3), and
 * marked hatched gap bands from the SHARED `chart-gaps` contract so boundary AND
 * interior zero-gross gaps render (F-2). Receives serializable props — it never
 * fetches, never traps read errors (they propagate to allocations/error.tsx).
 */
export function AllocationOverTime({
  points,
  gaps,
}: {
  points: AllocationPoint[];
  gaps: AsofGap[];
}) {
  const rawPatternId = useId();
  // useId embeds ":" — invalid in an SVG url(#…) fragment ref; strip for a
  // collision-free, instance-unique pattern id.
  const patternId = `gap${rawPatternId.replace(/:/g, "")}`;

  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
        <p className="text-small text-text-muted">No allocation history yet.</p>
        <p className="text-caption text-text-muted">
          Per-venue weights build as daily position snapshots accrue.
        </p>
      </div>
    );
  }

  const { venues, rows, usdByAsofMs, bands, domain } = buildAllocationChartData(points, gaps);
  const tickFormatter = makeDateTickFormatter(domain);

  return (
    <Card padding="sm">
      <div className="flex items-baseline justify-between">
        <h4 className="text-small font-semibold text-text-primary">Allocation over time</h4>
        <span className="text-caption font-metric text-text-muted">
          as of {points.at(-1)!.asof}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {venues.map((venue, i) => (
          <span
            key={venue}
            className="flex items-center gap-1 text-caption text-text-secondary"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: STRATEGY_PALETTE[i % STRATEGY_PALETTE.length] }}
            />
            {venue}
          </span>
        ))}
      </div>
      <div
        className="mt-2"
        role="img"
        aria-label="Per-venue allocation weights over time"
      >
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart
            accessibilityLayer={false}
            data={rows}
            margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
          >
            {renderGapAreas(bands, patternId)}
            {venues.map((venue, i) => (
              <Area
                key={venue}
                type="monotone"
                dataKey={venue}
                stackId="alloc"
                fill={STRATEGY_PALETTE[i % STRATEGY_PALETTE.length]}
                fillOpacity={0.85}
                stroke="#FFFFFF"
                strokeWidth={1}
                connectNulls={false}
              />
            ))}
            <XAxis
              dataKey="asofMs"
              type="number"
              domain={domain}
              tick={CHART_TICK_STYLE}
              tickLine={false}
              axisLine={{ stroke: CHART_BORDER }}
              tickFormatter={tickFormatter}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 1]}
              tick={CHART_TICK_STYLE}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            />
            <TouchTooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              itemSorter={(item) => -Number(item.value ?? 0)}
              labelFormatter={(ms) => new Date(Number(ms)).toISOString().slice(0, 10)}
              formatter={(v, name, item) => [
                `${(Number(v) * 100).toFixed(1)}% (${formatCurrency(
                  usdByAsofMs.get(item.payload.asofMs)?.[String(name)] ?? null,
                )})`,
                String(name),
              ]}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
