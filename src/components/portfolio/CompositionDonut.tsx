"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

const PALETTE = ["#1B6B5A", "#2563EB", "#D97706", "#7C3AED", "#DC2626", "#059669", "#DB2777", "#4338CA"];

interface CompositionDonutProps {
  strategies: {
    id: string;
    name: string;
    weight: number;
    amount: number | null;
    twr: number | null;
    sharpe: number | null;
  }[];
}

export function CompositionDonut({ strategies }: CompositionDonutProps) {
  if (!strategies || strategies.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
        No composition data available.
      </div>
    );
  }

  const totalAUM = strategies.reduce((s, st) => s + (st.amount ?? 0), 0);
  const chartData = strategies.map((s) => ({ name: s.name, value: s.weight }));

  return (
    <div className="space-y-4">
      <div className="relative">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="85%"
              strokeWidth={1}
              stroke="#FFFFFF"
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v, name) => [`${(Number(v) * 100).toFixed(1)}%`, name]}
              contentStyle={{ fontSize: 12, borderColor: "#E2E8F0", borderRadius: 6 }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xs text-text-muted">Total AUM</span>
          <span className="text-lg font-semibold font-metric text-text-primary">{formatCurrency(totalAUM)}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted uppercase tracking-wider">
              <th className="py-2 pr-4">Strategy</th>
              <th className="py-2 pr-4 text-right font-metric">Amount</th>
              <th className="py-2 pr-4 text-right font-metric">Weight %</th>
              <th className="py-2 pr-4 text-right font-metric">TWR</th>
              <th className="py-2 text-right font-metric">Sharpe</th>
            </tr>
          </thead>
          <tbody>
            {strategies.map((s, i) => (
              <tr key={s.id} className="border-b border-border/50 hover:bg-page/50 transition-colors">
                <td className="py-2 pr-4 flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                  <span className="text-text-primary">{s.name}</span>
                </td>
                <td className="py-2 pr-4 text-right font-metric">{formatCurrency(s.amount)}</td>
                <td className="py-2 pr-4 text-right font-metric">{formatPercent(s.weight)}</td>
                <td className="py-2 pr-4 text-right font-metric">{formatPercent(s.twr)}</td>
                <td className="py-2 text-right font-metric">{formatNumber(s.sharpe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
