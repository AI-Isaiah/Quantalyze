"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { CHART_BORDER, CHART_NEGATIVE, CHART_POSITIVE, CHART_TICK_STYLE } from "./chart-tokens";

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
          tick={CHART_TICK_STYLE}
          tickLine={false}
          axisLine={{ stroke: CHART_BORDER }}
          interval={2}
        />
        <YAxis
          tick={CHART_TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
        />
        <Tooltip
          formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Return"]}
          contentStyle={{ fontSize: 12, borderColor: CHART_BORDER }}
        />
        <Bar dataKey="value" radius={[2, 2, 0, 0]}>
          {flat.map((entry, i) => (
            <Cell key={i} fill={entry.value >= 0 ? CHART_POSITIVE : CHART_NEGATIVE} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
