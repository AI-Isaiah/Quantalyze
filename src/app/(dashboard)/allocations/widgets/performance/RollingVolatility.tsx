"use client";

import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildCompositeReturns } from "../lib/composite-returns";
import { computeRollingMetric } from "@/lib/portfolio-stats";
import { useMemo } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const WINDOWS = [
  { key: "vol_30d", window: 30, label: "30d", width: 1.5, color: "#94A3B8" },
  { key: "vol_90d", window: 90, label: "90d", width: 2, color: "#1B6B5A" },
] as const;

export default function RollingVolatility({ data }: WidgetProps) {
  const merged = useMemo(() => {
    const compositeDaily: DailyPoint[] = data?.compositeReturns ?? buildCompositeReturns(data?.strategies ?? []);
    if (compositeDaily.length === 0) return [];

    const series: Record<string, { date: string; value: number }[]> = {};
    for (const w of WINDOWS) {
      series[w.key] = computeRollingMetric(compositeDaily, w.window, "volatility");
    }

    const mergedMap = new Map<string, Record<string, string | number>>();
    for (const w of WINDOWS) {
      for (const point of series[w.key]) {
        if (!mergedMap.has(point.date)) mergedMap.set(point.date, { date: point.date });
        mergedMap.get(point.date)![w.key] = point.value;
      }
    }

    return Array.from(mergedMap.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }, [data]);

  if (merged.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Insufficient data for rolling volatility
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={merged} margin={{ top: 8, right: 8, bottom: 20, left: 8 }}>
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
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
          formatter={(v, name) => {
            const label = WINDOWS.find((w) => w.key === name)?.label ?? name;
            return [`${(Number(v) * 100).toFixed(1)}%`, label];
          }}
        />
        {WINDOWS.map((w) => (
          <Line
            key={w.key}
            type="monotone"
            dataKey={w.key}
            stroke={w.color}
            strokeWidth={w.width}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
