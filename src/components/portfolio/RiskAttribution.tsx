"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { TouchTooltip } from "@/components/charts/TouchTooltip";
import { formatPercent, STRATEGY_PALETTE } from "@/lib/utils";

interface RiskAttributionProps {
  /**
   * 169 D-49 (2026-09-27): `marginal_risk_pct` and `weight_pct` arrive in
   * PERCENT, 0 to 100, from the producer (`compute_risk_decomposition` /
   * `routers/portfolio.py`), passed through unchanged by the adapter. This
   * component converts them to a fraction ONCE (`percentToFraction`) before
   * `formatPercent`, which takes fractions. `standalone_vol` is already a
   * fraction and is not converted.
   *
   * Sign (169 review round 1 IN-05, 2026-09-29): weights are unsigned, but a
   * risk share is NOT. It is negative for a strategy that offsets the book's
   * risk (a hedge), and the shares still sum to 100, so the others then exceed
   * it. `formatPercent(..., { signed: false })` only drops the "+" and keeps
   * the minus, which is what a hedge's share needs.
   */
  data: {
    strategy_id: string;
    strategy_name: string;
    /** null = no risk share exists (the portfolio carries no risk); shown "—". */
    marginal_risk_pct: number | null;
    /** null = the producer sent no weight (169 review SFH M-5); shown "—". */
    weight_pct: number | null;
    standalone_vol: number;
  }[] | null;
}

/** The producer's percent (0 to 100) as `formatPercent`'s fraction; null stays null. */
function percentToFraction(pct: number | null): number | null {
  return pct === null ? null : pct / 100;
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
  // 169 D-49: the bar plots the same fraction the table formats, and the
  // tooltip's x100 reads the table's percent. The shares sum to the whole
  // portfolio risk, so with no hedge they fill the fraction domain [0, 1].
  // 169 review round 1 IN-05 (2026-09-29): a hedge's share is negative, and
  // then the positive shares sum past 1 and the negative one lies left of 0,
  // outside this fixed domain. How the bar should draw that is an open
  // rendering decision (SFH L-4), recorded, not settled here.
  const chartData = [
    data.reduce(
      (acc, d) => {
        const share = percentToFraction(d.marginal_risk_pct);
        return share === null ? acc : { ...acc, [d.strategy_name]: share };
      },
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
              // 169 D-49: the compare stays percent against percent (both raw).
              // 169 review SFH M-5 (2026-09-29): with no weight there is
              // nothing to compare the share against, so no assessment either.
              // 169 review round 2 WR-R2-02 (SFH L-4): a negative share is a
              // hedge taking risk out of the book; "Balanced" would claim its
              // risk and capital are in proportion. No assessment until a word
              // for a hedge is chosen.
              const share = d.marginal_risk_pct;
              const weight = d.weight_pct;
              const assessable = share !== null && weight !== null && share >= 0;
              const overweight = assessable && share > weight * 1.3;
              return (
                <tr key={d.strategy_id} className="border-b border-border/50 hover:bg-page/50 transition-colors">
                  <td className="py-2 pr-4 flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: STRATEGY_PALETTE[i % STRATEGY_PALETTE.length] }} />
                    <span className="text-text-primary">{d.strategy_name}</span>
                  </td>
                  <td className="py-2 pr-4 text-right font-metric">{formatPercent(percentToFraction(d.weight_pct), 1, { signed: false })}</td>
                  <td className="py-2 pr-4 text-right font-metric">{formatPercent(percentToFraction(d.marginal_risk_pct), 1, { signed: false })}</td>
                  <td className="py-2 pr-4 text-right font-metric">{formatPercent(d.standalone_vol)}</td>
                  <td className="py-2 text-right">
                    {!assessable ? (
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
