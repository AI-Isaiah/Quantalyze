"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";

interface MonthlyReturnsBarProps {
  data: Record<string, Record<string, number>>;
}

export function MonthlyReturnsBar({ data }: MonthlyReturnsBarProps) {
  const flat = Object.entries(data).flatMap(([year, months]) =>
    Object.entries(months).map(([month, value]) => ({
      label: `${month} ${year.slice(2)}`,
      value,
    }))
  );

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={flat} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#64748B" }}
          tickLine={false}
          axisLine={{ stroke: "#E2E8F0" }}
          interval={2}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#64748B", fontFamily: "'JetBrains Mono', monospace" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
        />
        <Tooltip
          formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Return"]}
          contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
        />
        <Bar dataKey="value" radius={[2, 2, 0, 0]}>
          {flat.map((entry, i) => (
            <Cell key={i} fill={entry.value >= 0 ? "#059669" : "#DC2626"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
