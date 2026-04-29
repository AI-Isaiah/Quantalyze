"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { CHART_AXIS_TICK, CHART_BORDER, CHART_FONT_MONO, CHART_NEGATIVE, CHART_POSITIVE } from "./chart-tokens";

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
          tick={{ fontSize: 10, fill: CHART_AXIS_TICK }}
          tickLine={false}
          axisLine={{ stroke: CHART_BORDER }}
          interval={2}
        />
        <YAxis
          tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
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
