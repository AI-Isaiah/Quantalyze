"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";

interface ReturnHistogramProps {
  returns: { date: string; value: number }[];
  bins?: number;
}

export function ReturnHistogram({ returns, bins = 20 }: ReturnHistogramProps) {
  if (!returns || returns.length < 10) return null;

  // Compute daily returns from cumulative equity: (equity[i+1] / equity[i]) - 1
  const cumulative = returns.map((r) => r.value);
  const dailyReturns = cumulative.slice(1).map((v, i) =>
    cumulative[i] !== 0 ? (v / cumulative[i]) - 1 : 0
  );

  const min = Math.min(...dailyReturns);
  const max = Math.max(...dailyReturns);
  if (max === min) return null; // All identical returns, nothing to show
  const binWidth = (max - min) / bins;

  const histogram = Array.from({ length: bins }, (_, i) => {
    const low = min + i * binWidth;
    const high = low + binWidth;
    const count = dailyReturns.filter((r) => r >= low && (i === bins - 1 ? r <= high : r < high)).length;
    return {
      label: `${(low * 100).toFixed(1)}%`,
      value: low + binWidth / 2,
      count,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={histogram} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#64748B" }}
          tickLine={false}
          axisLine={{ stroke: "#E2E8F0" }}
          interval={3}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#64748B" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={(v) => [Number(v), "Count"]}
          contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
        />
        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
          {histogram.map((entry, i) => (
            <Cell key={i} fill={entry.value >= 0 ? "#059669" : "#DC2626"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
