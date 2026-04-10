"use client";

import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildCompositeReturns } from "../lib/composite-returns";
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
    const compositeDaily: DailyPoint[] = data?.compositeReturns ?? buildCompositeReturns(data?.strategies ?? []);
    if (compositeDaily.length === 0) return [];
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
