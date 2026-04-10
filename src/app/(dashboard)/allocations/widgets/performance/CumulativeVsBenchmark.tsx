"use client";

import type { WidgetProps } from "../../lib/types";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
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
    if (!data?.strategies?.length) return [];

    const strats = data.strategies as Array<{
      strategy: { strategy_analytics: { daily_returns: unknown } };
      weight: number;
    }>;

    const dateMap = new Map<string, number>();
    let totalWeight = 0;
    for (const s of strats) {
      const dr = normalizeDailyReturns(s.strategy?.strategy_analytics?.daily_returns);
      const w = s.weight ?? 1;
      totalWeight += w;
      for (const d of dr) {
        dateMap.set(d.date, (dateMap.get(d.date) ?? 0) + d.value * w);
      }
    }
    if (totalWeight === 0) return [];

    const dates = Array.from(dateMap.keys()).sort();
    let cumulative = 1;
    const result: { date: string; portfolio: number }[] = [];

    for (const date of dates) {
      const dailyReturn = dateMap.get(date)! / totalWeight;
      cumulative *= 1 + dailyReturn;
      result.push({ date, portfolio: cumulative - 1 });
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
