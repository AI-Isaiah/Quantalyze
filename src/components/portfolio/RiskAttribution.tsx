"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { TouchTooltip } from "@/components/charts/TouchTooltip";
import { formatPercent, STRATEGY_PALETTE } from "@/lib/utils";

interface RiskAttributionProps {
  data: {
    strategy_id: string;
    strategy_name: string;
    /** null = no risk share exists (the portfolio carries no risk); shown "—". */
    marginal_risk_pct: number | null;
    weight_pct: number;
    standalone_vol: number;
  }[] | null;
}

export function RiskAttribution({ data }: RiskAttributionProps) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-small">
        No risk attribution data available.
      </div>
    );
  }

  // 166.1 D7: a null risk share is left out of the stacked bar (a gap), never
  // plotted as a 0-width segment that reads as "no risk".
  const chartData = [
    data.reduce(
      (acc, d) =>
        d.marginal_risk_pct === null ? acc : { ...acc, [d.strategy_name]: d.marginal_risk_pct },
      { label: "Risk %" } as Record<string, string | number>,
    ),
  ];

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={48}>
        <BarChart accessibilityLayer={false} data={chartData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
          <XAxis type="number" hide domain={[0, 1]} />
          <YAxis type="category" dataKey="label" hide />
          <TouchTooltip
            formatter={(v, name) => [`${(Number(v) * 100).toFixed(1)}%`, name]}
            contentStyle={{ fontSize: 12, borderColor: "#E2E8F0", borderRadius: 6 }}
          />
          {data.map((d, i) => (
            <Bar key={d.strategy_id} dataKey={d.strategy_name} stackId="risk" fill={STRATEGY_PALETTE[i % STRATEGY_PALETTE.length]} radius={0} />
          ))}
        </BarChart>
      </ResponsiveContainer>

      <div className="overflow-x-auto">
        <table className="w-full text-small">
          <thead>
            <tr className="border-b border-border text-left text-caption text-text-muted uppercase tracking-wider">
              <th className="py-2 pr-4">Strategy</th>
              <th className="py-2 pr-4 text-right font-metric">Weight %</th>
              <th className="py-2 pr-4 text-right font-metric">Risk %</th>
              <th className="py-2 pr-4 text-right font-metric">Standalone Vol</th>
              <th className="py-2 text-right">Assessment</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => {
              // 166.1 D7 (founder 2026-09-26): with no risk share there is no
              // assessment either — "Balanced" would be a claim about a split
              // that does not exist. The cell is a colorless "—".
              const share = d.marginal_risk_pct;
              const overweight = share !== null && share > d.weight_pct * 1.3;
              return (
                <tr key={d.strategy_id} className="border-b border-border/50 hover:bg-page/50 transition-colors">
                  <td className="py-2 pr-4 flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: STRATEGY_PALETTE[i % STRATEGY_PALETTE.length] }} />
                    <span className="text-text-primary">{d.strategy_name}</span>
                  </td>
                  <td className="py-2 pr-4 text-right font-metric">{formatPercent(d.weight_pct)}</td>
                  <td className="py-2 pr-4 text-right font-metric">{formatPercent(d.marginal_risk_pct)}</td>
                  <td className="py-2 pr-4 text-right font-metric">{formatPercent(d.standalone_vol)}</td>
                  <td className="py-2 text-right">
                    {share === null ? (
                      <span className="text-caption text-text-muted">—</span>
                    ) : (
                      <span className={`text-caption font-medium ${overweight ? "text-negative" : "text-positive"}`}>
                        {overweight ? "Overweight risk" : "Balanced"}
                      </span>
                    )}
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
