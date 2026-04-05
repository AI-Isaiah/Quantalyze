"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";

interface YearlyReturnsProps {
  monthlyReturns: Record<string, Record<string, number>>;
}

export function YearlyReturns({ monthlyReturns }: YearlyReturnsProps) {
  if (!monthlyReturns) return null;

  const yearly = Object.entries(monthlyReturns).map(([year, months]) => {
    const annualReturn = Object.values(months).reduce((acc, m) => acc * (1 + m), 1) - 1;
    return { year, value: annualReturn };
  });

  if (yearly.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={yearly} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <XAxis
          dataKey="year"
          tick={{ fontSize: 12, fill: "#64748B" }}
          tickLine={false}
          axisLine={{ stroke: "#E2E8F0" }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#64748B", fontFamily: "'JetBrains Mono', monospace" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
        />
        <Tooltip
          formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Annual Return"]}
          contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40}>
          {yearly.map((entry, i) => (
            <Cell key={i} fill={entry.value >= 0 ? "#059669" : "#DC2626"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
