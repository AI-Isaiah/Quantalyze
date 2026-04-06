"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface AttributionBarProps {
  data: { strategy_id: string; strategy_name: string; contribution: number }[] | null;
}

export function AttributionBar({ data }: AttributionBarProps) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
        No attribution data available.
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.contribution - a.contribution);

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 36)}>
      <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "#718096", fontFamily: "'Geist Mono', monospace" }}
          tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`}
          tickLine={false}
          axisLine={{ stroke: "#E2E8F0" }}
        />
        <YAxis
          type="category"
          dataKey="strategy_name"
          tick={{ fontSize: 12, fill: "#4A5568" }}
          tickLine={false}
          axisLine={false}
          width={120}
        />
        <Tooltip
          formatter={(v) => [`${Number(v) >= 0 ? "+" : ""}${(Number(v) * 100).toFixed(2)}%`, "Contribution"]}
          contentStyle={{ fontSize: 12, borderColor: "#E2E8F0", borderRadius: 6 }}
        />
        <Bar dataKey="contribution" radius={[0, 3, 3, 0]} barSize={20}>
          {sorted.map((entry) => (
            <Cell key={entry.strategy_id} fill={entry.contribution >= 0 ? "#16A34A" : "#DC2626"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
