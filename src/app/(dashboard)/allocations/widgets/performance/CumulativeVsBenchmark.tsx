"use client";

import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildCompositeReturns } from "../lib/composite-returns";
import { useMemo } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function CumulativeVsBenchmark({ data }: WidgetProps) {
  const cumulativeData = useMemo(() => {
    const composite: DailyPoint[] = data?.compositeReturns ?? buildCompositeReturns(data?.strategies ?? []);
    if (composite.length === 0) return [];

    let cumulative = 1;
    const result: { date: string; portfolio: number }[] = [];

    for (const d of composite) {
      cumulative *= 1 + d.value;
      result.push({ date: d.date, portfolio: cumulative - 1 });
    }

    return result;
  }, [data]);

  if (cumulativeData.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        No cumulative return data available
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={cumulativeData} margin={{ top: 8, right: 8, bottom: 20, left: 8 }}>
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
            formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Portfolio"]}
            contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
          />
          <Line
            type="monotone"
            dataKey="portfolio"
            stroke="#1B6B5A"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-[11px] text-text-muted">
        Benchmark comparison coming soon
      </p>
    </div>
  );
}
