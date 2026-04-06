"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPercent } from "@/lib/utils";

const PALETTE = ["#1B6B5A", "#2563EB", "#D97706", "#7C3AED", "#DC2626", "#059669", "#DB2777", "#4338CA"];

interface RiskAttributionProps {
  data: {
    strategy_id: string;
    strategy_name: string;
    marginal_risk_pct: number;
    weight_pct: number;
    standalone_vol: number;
  }[] | null;
}

export function RiskAttribution({ data }: RiskAttributionProps) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
        No risk attribution data available.
      </div>
    );
  }

  const chartData = [
    data.reduce(
      (acc, d, i) => ({ ...acc, [d.strategy_name]: d.marginal_risk_pct }),
      { label: "Risk %" } as Record<string, string | number>,
    ),
  ];

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={48}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
          <XAxis type="number" hide domain={[0, 1]} />
          <YAxis type="category" dataKey="label" hide />
          <Tooltip
            formatter={(v, name) => [`${(Number(v) * 100).toFixed(1)}%`, name]}
            contentStyle={{ fontSize: 12, borderColor: "#E2E8F0", borderRadius: 6 }}
          />
          {data.map((d, i) => (
            <Bar key={d.strategy_id} dataKey={d.strategy_name} stackId="risk" fill={PALETTE[i % PALETTE.length]} radius={0} />
          ))}
        </BarChart>
      </ResponsiveContainer>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted uppercase tracking-wider">
              <th className="py-2 pr-4">Strategy</th>
              <th className="py-2 pr-4 text-right font-metric">Weight %</th>
              <th className="py-2 pr-4 text-right font-metric">Risk %</th>
              <th className="py-2 pr-4 text-right font-metric">Standalone Vol</th>
              <th className="py-2 text-right">Assessment</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => {
              const overweight = d.marginal_risk_pct > d.weight_pct * 1.3;
              return (
                <tr key={d.strategy_id} className="border-b border-border/50 hover:bg-page/50 transition-colors">
                  <td className="py-2 pr-4 flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                    <span className="text-text-primary">{d.strategy_name}</span>
                  </td>
                  <td className="py-2 pr-4 text-right font-metric">{formatPercent(d.weight_pct)}</td>
                  <td className="py-2 pr-4 text-right font-metric">{formatPercent(d.marginal_risk_pct)}</td>
                  <td className="py-2 pr-4 text-right font-metric">{formatPercent(d.standalone_vol)}</td>
                  <td className="py-2 text-right">
                    <span className={`text-xs font-medium ${overweight ? "text-negative" : "text-positive"}`}>
                      {overweight ? "Overweight risk" : "Balanced"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
