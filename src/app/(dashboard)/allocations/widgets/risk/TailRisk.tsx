"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { WidgetProps } from "../../lib/types";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";

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

export function TailRisk({ data }: WidgetProps) {
  const { histogram, p5, p1, tailCount } = useMemo(() => {
    const allReturns: number[] = [];
    if (data?.strategies && Array.isArray(data.strategies)) {
      for (const s of data.strategies) {
        const dr = normalizeDailyReturns(
          s?.strategy?.strategy_analytics?.daily_returns,
        );
        for (const d of dr) allReturns.push(d.value);
      }
    }

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
        style={{ color: "#718096" }}
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
        <span
          className="rounded bg-red-50 px-1.5 py-0.5 font-metric text-[10px] tabular-nums"
          style={{ color: "#DC2626" }}
        >
          {tailCount} events
        </span>
      </div>

      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={histogram}
            margin={{ top: 5, right: 10, bottom: 5, left: 0 }}
          >
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: "#718096" }}
              tickLine={false}
              axisLine={{ stroke: "#E2E8F0" }}
              interval={2}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#718096" }}
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
            {/* 5th percentile line */}
            <ReferenceLine
              x={`${(p5 * 100).toFixed(1)}%`}
              stroke="#CA8A04"
              strokeDasharray="4 3"
              label={{
                value: "P5",
                position: "top",
                fill: "#CA8A04",
                fontSize: 10,
              }}
            />
            {/* 1st percentile line */}
            <ReferenceLine
              x={`${(p1 * 100).toFixed(1)}%`}
              stroke="#DC2626"
              strokeDasharray="4 3"
              label={{
                value: "P1",
                position: "top",
                fill: "#DC2626",
                fontSize: 10,
              }}
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
