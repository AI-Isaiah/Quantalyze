"use client";

import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildCompositeReturns } from "../lib/composite-returns";
import { computeReturnDistribution } from "@/lib/portfolio-stats";
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

const NUM_BINS = 30;

export default function ReturnDistribution({ data }: WidgetProps) {
  const histogramData = useMemo(() => {
    const compositeDaily: DailyPoint[] = data?.compositeReturns ?? buildCompositeReturns(data?.strategies ?? []);
    if (compositeDaily.length === 0) return [];

    const returns = compositeDaily.map((d) => d.value);
    const bins = computeReturnDistribution(returns, NUM_BINS);

    return bins.map((bin) => ({
      label: `${(bin.min * 100).toFixed(1)}%`,
      midpoint: (bin.min + bin.max) / 2,
      count: bin.count,
      isNegative: (bin.min + bin.max) / 2 < 0,
    }));
  }, [data]);

  if (histogramData.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        No return distribution data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={histogramData} margin={{ top: 8, right: 8, bottom: 20, left: 8 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#718096" }}
          tickLine={false}
          axisLine={{ stroke: "#E2E8F0" }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#718096", fontFamily: "var(--font-geist-mono), monospace" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
          formatter={(v, _name, props) => {
            const mid = props.payload?.midpoint as number | undefined;
            const pct = mid !== undefined ? `${(mid * 100).toFixed(2)}%` : "";
            return [v, `Return ${pct}`];
          }}
          labelFormatter={() => ""}
        />
        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
          {histogramData.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.isNegative ? "#DC2626" : "#1B6B5A"}
              fillOpacity={0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
