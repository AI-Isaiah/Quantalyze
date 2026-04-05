"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
            <stop offset="0%" stopColor="#0D9488" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#0D9488" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="loss_pct"
          tick={{ fontSize: 11, fill: "#64748B" }}
          tickLine={false}
          axisLine={{ stroke: "#E2E8F0" }}
          tickFormatter={(v: number) => `${v}%`}
          type="number"
          domain={[0, 100]}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#64748B", fontFamily: "'JetBrains Mono', monospace" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          domain={[0, 100]}
        />
        <Tooltip
          formatter={(v) => [`${Number(v).toFixed(2)}%`, "Probability"]}
          labelFormatter={(label) => `Loss level: ${label}%`}
          contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
        />
        <Area
          type="monotone"
          dataKey="probability"
          stroke="#0D9488"
          strokeWidth={1.5}
          fill="url(#risk-of-ruin-fill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
