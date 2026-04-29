"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_ACCENT, CHART_AXIS_TICK, CHART_BORDER, CHART_FONT_MONO } from "./chart-tokens";

interface RiskOfRuinProps {
  data: { loss_pct: number; probability: number }[] | null;
}

export function RiskOfRuin({ data }: RiskOfRuinProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] text-sm text-text-muted">
        Insufficient data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    loss_pct: d.loss_pct,
    probability: d.probability * 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <defs>
          <linearGradient id="risk-of-ruin-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_ACCENT} stopOpacity={0.2} />
            <stop offset="100%" stopColor={CHART_ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="loss_pct"
          tick={{ fontSize: 11, fill: CHART_AXIS_TICK }}
          tickLine={false}
          axisLine={{ stroke: CHART_BORDER }}
          tickFormatter={(v: number) => `${v}%`}
          type="number"
          domain={[0, 100]}
        />
        <YAxis
          tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          domain={[0, 100]}
        />
        <Tooltip
          formatter={(v) => [`${Number(v).toFixed(2)}%`, "Probability"]}
          labelFormatter={(label) => `Loss level: ${label}%`}
          contentStyle={{ fontSize: 12, borderColor: CHART_BORDER }}
        />
        <Area
          type="monotone"
          dataKey="probability"
          stroke={CHART_ACCENT}
          strokeWidth={1.5}
          fill="url(#risk-of-ruin-fill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
