"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Cell } from "recharts";
import { TouchTooltip } from "./TouchTooltip";
import {
  CHART_BORDER,
  CHART_NEGATIVE,
  CHART_POSITIVE,
  CHART_TEXT_MUTED,
  CHART_TICK_STYLE,
} from "./chart-tokens";
import { formatUnsignedPercent, signTone } from "@/lib/factsheet/display-sign";

interface YearlyReturnsProps {
  monthlyReturns: Record<string, Record<string, number>>;
}

/**
 * Bar fill from the sign of the year's return ROUNDED to the 2 dp its tooltip prints (D-03):
 * a year that prints 0.00% is muted, not red or green.
 */
function barFill(value: number): string {
  const tone = signTone(value, 2, 100);
  return tone === "positive" ? CHART_POSITIVE : tone === "negative" ? CHART_NEGATIVE : CHART_TEXT_MUTED;
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
      <BarChart accessibilityLayer={false} data={yearly} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
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
          tickFormatter={(v: number) => formatUnsignedPercent(v, 0)}
        />
        <TouchTooltip
          formatter={(v) => [formatUnsignedPercent(Number(v), 2), "Annual Return"]}
          contentStyle={{ fontSize: 12, borderColor: CHART_BORDER }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40}>
          {yearly.map((entry, i) => (
            <Cell key={i} fill={barFill(entry.value)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
