"use client";

import type { WidgetProps } from "../../lib/types";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import { computeAnnualReturns } from "@/lib/portfolio-stats";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function AnnualReturns({ data }: WidgetProps) {
  const annualData = useMemo(() => {
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

    const compositeDaily = Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, val]) => ({ date, value: val / totalWeight }));

    return computeAnnualReturns(compositeDaily);
  }, [data]);

  if (annualData.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        No annual return data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={annualData} margin={{ top: 8, right: 8, bottom: 20, left: 8 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#718096" }}
          tickLine={false}
          axisLine={{ stroke: "#E2E8F0" }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#718096", fontFamily: "var(--font-geist-mono), monospace" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
        />
        <Tooltip
          formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Return"]}
          contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
        />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {annualData.map((entry) => (
            <Cell
              key={entry.date}
              fill={entry.value >= 0 ? "#1B6B5A" : "#DC2626"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
