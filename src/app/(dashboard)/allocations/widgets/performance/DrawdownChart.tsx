"use client";

import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildCompositeReturns } from "../lib/composite-returns";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Phase 07 / 07-03 / VOICES-ACCEPTED f7 — parallel-prop extension to
 * WidgetProps. Snapshot-derived DailyPoint[] expresses a cumulative USD
 * value series (not daily returns); compute drawdown from running-peak
 * directly. When the prop is ABSENT (undefined), fall back to the existing
 * compositeReturns / buildCompositeReturns path so Bridge allocators keep
 * their strategy-composite drawdown curve post-Phase-09.
 */
interface DrawdownChartProps extends WidgetProps {
  equityDailyPoints?: DailyPoint[];
}

/**
 * Phase 07 / WR-01 — derive drawdown series from a cumulative USD snapshot
 * series. Seeds peak at `max(first, 0)` so a leading 0 or negative value
 * (e.g. an allocator whose first reconstructed day has no priceable
 * holdings, or a derivative margin account below zero) does NOT emit
 * NaN/Infinity via (0-0)/0. Exported for direct unit testing.
 */
export function deriveSnapshotDrawdowns(
  points: DailyPoint[],
): { date: string; value: number }[] {
  if (points.length === 0) return [];
  let peak = Math.max(points[0].value, 0);
  const result: { date: string; value: number }[] = [];
  for (const d of points) {
    if (d.value > peak) peak = d.value;
    const dd = peak > 0 ? (d.value - peak) / peak : 0;
    result.push({ date: d.date, value: dd });
  }
  return result;
}

export default function DrawdownChart({ data, equityDailyPoints }: DrawdownChartProps) {
  const drawdownData = useMemo(() => {
    // Parallel-prop: prefer snapshot-derived points when explicitly
    // provided (including empty []). Only fall back to strategies-
    // derived compute when the prop is undefined.
    if (equityDailyPoints !== undefined) {
      return deriveSnapshotDrawdowns(equityDailyPoints);
    }

    const composite: DailyPoint[] = data?.compositeReturns ?? buildCompositeReturns(data?.strategies ?? []);
    if (composite.length === 0) return [];

    // Compute cumulative equity, then drawdown from peak
    let cumulative = 1;
    let peak = 1;
    const result: { date: string; value: number }[] = [];

    for (const d of composite) {
      cumulative *= 1 + d.value;
      if (cumulative > peak) peak = cumulative;
      const dd = (cumulative - peak) / peak;
      result.push({ date: d.date, value: dd });
    }

    return result;
  }, [data, equityDailyPoints]);

  if (drawdownData.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        No drawdown data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 100, height: 100 }}>
      <AreaChart data={drawdownData} margin={{ top: 8, right: 8, bottom: 20, left: 8 }}>
        <defs>
          <linearGradient id="dd-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#DC2626" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#DC2626" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#718096" }}
          tickLine={false}
          axisLine={{ stroke: "#E2E8F0" }}
          tickFormatter={(d: string) => d.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#718096", fontFamily: "var(--font-geist-mono), monospace" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          domain={["dataMin", 0]}
        />
        <Tooltip
          formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Drawdown"]}
          contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#DC2626"
          strokeWidth={1.5}
          fill="url(#dd-fill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
