"use client";

import { useId } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import type { AsofGap, NetExposurePoint } from "@/lib/portfolio-exposure";
import { Card } from "@/components/ui/Card";
import { TouchTooltip } from "@/components/charts/TouchTooltip";
import {
  CHART_ACCENT,
  CHART_BORDER,
  CHART_REFERENCE_DASH,
  CHART_TEXT_MUTED,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_STYLE,
} from "@/components/charts/chart-tokens";
import { formatCurrency } from "@/lib/utils";
import {
  asofToUtcMs,
  gapXDomain,
  makeDateTickFormatter,
  renderGapAreas,
  toGapBands,
  type GapBand,
} from "../lib/chart-gaps";

/** One row of the ComposedChart data — a real observation OR a null gap sentinel. */
interface NetChartRow {
  asofMs: number;
  netUsd: number | null;
  grossUsd: number | null;
}

/**
 * Pure chart-data builder (unit-testable without rendering). Maps observed
 * points to numeric-x rows, injects ONE all-null sentinel row per gap at the
 * band midpoint (so, with connect-nulls disabled on BOTH the Area and the Line,
 * recharts visibly breaks each path across the gap — a gap can never masquerade
 * as observed data), sorts by asofMs, and
 * derives the gap-aware x-domain. Observed `{net:0,gross:0}` days pass through
 * as REAL 0 rows (a flat book is a fact, not a gap).
 */
export function buildNetChartData(
  points: NetExposurePoint[],
  gaps: AsofGap[],
): { rows: NetChartRow[]; bands: GapBand[]; domain: [number, number] } {
  const bands = toGapBands(gaps);
  const observed: NetChartRow[] = points.map((p) => ({
    asofMs: asofToUtcMs(p.asof),
    netUsd: p.netUsd,
    grossUsd: p.grossUsd,
  }));
  const sentinels: NetChartRow[] = bands.map((b) => ({
    asofMs: b.midMs,
    netUsd: null,
    grossUsd: null,
  }));
  const rows = [...observed, ...sentinels].sort((a, b) => a.asofMs - b.asofMs);
  const domain = gapXDomain(observed.map((r) => r.asofMs), bands);
  return { rows, bands, domain };
}

/** A single inline legend chip (swatch + label) rendered above the chart. */
function LegendChip({ label, filled }: { label: string; filled: boolean }) {
  return (
    <span className="flex items-center gap-1 text-caption text-text-secondary">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ backgroundColor: CHART_ACCENT, opacity: filled ? 0.2 : 1 }}
      />
      {label}
    </span>
  );
}

/**
 * PI-02 — "Net exposure over time". A recharts ComposedChart binding
 * `getNetExposureSeries` output: gross as a filled Area AND net as a Line (net
 * alone hides a hedged book — the gross band IS the leverage/hedging story), a
 * dashed zero reference line, compact-USD axes, and marked gap bands from the
 * shared `chart-gaps` contract. Receives serializable props — it never fetches,
 * never traps read errors (they propagate to allocations/error.tsx).
 */
export function NetExposureChart({
  points,
  gaps,
}: {
  points: NetExposurePoint[];
  gaps: AsofGap[];
}) {
  const rawPatternId = useId();
  // useId embeds ":" — invalid in an SVG url(#…) fragment ref; strip for a
  // collision-free, instance-unique pattern id.
  const patternId = `gap${rawPatternId.replace(/:/g, "")}`;

  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center">
        <p className="text-small text-text-muted">No exposure history yet.</p>
        <p className="text-caption text-text-muted">
          The series builds as daily position snapshots accrue.
        </p>
      </div>
    );
  }

  const { rows, bands, domain } = buildNetChartData(points, gaps);
  const tickFormatter = makeDateTickFormatter(domain);

  return (
    <Card padding="sm">
      <div className="flex items-baseline justify-between">
        <h4 className="text-small font-semibold text-text-primary">Net exposure over time</h4>
        <span className="text-caption font-metric text-text-muted">
          as of {points.at(-1)!.asof}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-4">
        <LegendChip label="Net" filled={false} />
        <LegendChip label="Gross" filled={true} />
      </div>
      <div
        className="mt-2"
        role="img"
        aria-label="Net and gross exposure over time in US dollars"
      >
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart
            accessibilityLayer={false}
            data={rows}
            margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
          >
            {renderGapAreas(bands, patternId)}
            <ReferenceLine
              y={0}
              stroke={CHART_TEXT_MUTED}
              strokeDasharray={CHART_REFERENCE_DASH}
            />
            <Area
              type="monotone"
              dataKey="grossUsd"
              name="Gross"
              fill={CHART_ACCENT}
              fillOpacity={0.2}
              stroke="none"
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="netUsd"
              name="Net"
              stroke={CHART_ACCENT}
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
            />
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
              tick={CHART_TICK_STYLE}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatCurrency(v)}
            />
            <TouchTooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              labelFormatter={(ms) => new Date(Number(ms)).toISOString().slice(0, 10)}
              formatter={(v, name) => [formatCurrency(Number(v)), String(name)]}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
