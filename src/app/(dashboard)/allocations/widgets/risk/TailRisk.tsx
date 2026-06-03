"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildCompositeReturns } from "../lib/composite-returns";
import { withWidgetBoundary, type BaseWidgetProps } from "../lib/widget-boundary";
import { riskWidgetDataSchema, type RiskWidgetData } from "../lib/widget-data";

// ---------------------------------------------------------------------------
// Tail Risk Widget
//
// Filters daily returns below -2% to focus on extreme losses. Renders a
// histogram of these tail events with red fill and reference lines at the
// 5th and 1st percentile thresholds.
// ---------------------------------------------------------------------------

const TAIL_THRESHOLD = -0.02; // -2%
const BINS = 15;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = q * (sorted.length - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (pos - lower) * (sorted[upper] - sorted[lower]);
}

function TailRiskInner({ data }: { data: RiskWidgetData } & BaseWidgetProps) {
  const { histogram, p5, p1, tailCount } = useMemo(() => {
    // Use weighted composite returns instead of unweighted concatenation
    const composite: DailyPoint[] = data.compositeReturns ?? buildCompositeReturns(data.strategies);
    const allReturns = composite.map((d) => d.value);

    // Filter to tail events (below -2%)
    const tail = allReturns.filter((r) => r < TAIL_THRESHOLD);
    if (tail.length < 3) {
      return { histogram: [], p5: 0, p1: 0, tailCount: 0 };
    }

    const sorted = [...tail].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;
    const binWidth = range / BINS;

    // Compute percentiles from the full return distribution
    const allSorted = [...allReturns].sort((a, b) => a - b);
    const p5val = quantile(allSorted, 0.05);
    const p1val = quantile(allSorted, 0.01);

    const bins = Array.from({ length: BINS }, (_, i) => {
      const low = min + i * binWidth;
      const high = low + binWidth;
      const count = tail.filter(
        (r) => r >= low && (i === BINS - 1 ? r <= high : r < high),
      ).length;
      return {
        label: `${(low * 100).toFixed(1)}%`,
        midpoint: low + binWidth / 2,
        count,
      };
    });

    return { histogram: bins, p5: p5val, p1: p1val, tailCount: tail.length };
  }, [data]);

  if (histogram.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "#64748B" }}
      >
        No extreme loss events detected (below -2%)
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2" data-testid="tail-risk">
      <div className="flex items-center justify-between px-1">
        <span
          className="font-sans text-[11px] font-medium"
          style={{ color: "#4A5568" }}
        >
          Extreme losses (below -2%)
        </span>
        {/* M-0218: P5/P1 percentile thresholds. Previously drawn as
            <ReferenceLine x={…}> on a CATEGORY axis, where recharts maps a
            continuous percentile string to `undefined` and discards the line —
            so the guides never rendered. Surface them as honest header text. */}
        <div className="flex items-center gap-2">
          <span
            className="font-metric text-[10px] tabular-nums"
            style={{ color: "#CA8A04" }}
          >
            P5 {(p5 * 100).toFixed(1)}%
          </span>
          <span
            className="font-metric text-[10px] tabular-nums"
            style={{ color: "#DC2626" }}
          >
            P1 {(p1 * 100).toFixed(1)}%
          </span>
          <span
            className="rounded bg-red-50 px-1.5 py-0.5 font-metric text-[10px] tabular-nums"
            style={{ color: "#DC2626" }}
          >
            {tailCount} events
          </span>
        </div>
      </div>

      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 100, height: 100 }}>
          <BarChart
            accessibilityLayer={false}
            data={histogram}
            margin={{ top: 5, right: 10, bottom: 5, left: 0 }}
          >
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: "#64748B" }}
              tickLine={false}
              axisLine={{ stroke: "#E2E8F0" }}
              interval={2}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#64748B" }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                fontSize: 12,
                borderColor: "#E2E8F0",
                borderRadius: 6,
              }}
              formatter={(v) => [Number(v), "Count"]}
            />
            <Bar
              dataKey="count"
              fill="#DC2626"
              fillOpacity={0.8}
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// B21: validate `data` against the shared risk-widget contract and contain any
// render throw before it reaches the tab. The registry imports `m.TailRisk`,
// which is now the boundaried component.
export const TailRisk = withWidgetBoundary(riskWidgetDataSchema, TailRiskInner, {
  area: "tail-risk",
});
