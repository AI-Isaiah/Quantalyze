"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { CHART_BORDER, CHART_NEGATIVE, CHART_POSITIVE, CHART_TICK_STYLE } from "./chart-tokens";

interface YearlyReturnsProps {
  monthlyReturns: Record<string, Record<string, number>>;
}

/**
 * Yearly Returns bar chart for the Returns Distribution panel.
 *
 * Identity tokens: positive bars use CHART_POSITIVE / negative use
 * CHART_NEGATIVE; axis ticks spread CHART_TICK_STYLE; tooltip border +
 * axis line use the CHART_BORDER token.
 */
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
          tick={CHART_TICK_STYLE}
          tickLine={false}
          axisLine={{ stroke: CHART_BORDER }}
        />
        <YAxis
          tick={CHART_TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
        />
        <Tooltip
          formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Annual Return"]}
          contentStyle={{ fontSize: 12, borderColor: CHART_BORDER }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40}>
          {yearly.map((entry, i) => (
            <Cell key={i} fill={entry.value >= 0 ? CHART_POSITIVE : CHART_NEGATIVE} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
