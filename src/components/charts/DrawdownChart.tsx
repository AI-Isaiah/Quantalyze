"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  CHART_ACCENT,
  CHART_AXIS_TICK,
  CHART_BORDER,
  CHART_FONT_MONO,
} from "./chart-tokens";

interface DrawdownChartProps {
  data: { date: string; value: number }[];
}

export function DrawdownChart({ data }: DrawdownChartProps) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <defs>
          <linearGradient id="drawdown-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_ACCENT} stopOpacity={0.2} />
            <stop offset="100%" stopColor={CHART_ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
          tickLine={false}
          axisLine={{ stroke: CHART_BORDER }}
          tickFormatter={(d: string) => d.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          domain={["dataMin", 0]}
        />
        <Tooltip
          formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Drawdown"]}
          contentStyle={{ fontSize: 12, borderColor: CHART_BORDER }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={CHART_ACCENT}
          strokeWidth={1.5}
          fill="url(#drawdown-fill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
