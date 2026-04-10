"use client";

import { useMemo } from "react";
import type { WidgetProps } from "../../lib/types";
import { computeRebalanceSuggestions } from "@/lib/portfolio-stats";
import { formatPercent } from "@/lib/utils";
import { displayName } from "@/lib/allocation-helpers";

interface StrategyRow {
  strategy_id: string;
  current_weight: number | null;
  alias: string | null;
  strategy: { name: string; codename: string | null; disclosure_tier: string };
}

/**
 * Rebalance Suggestions — shows what trades would bring the portfolio
 * back to equal-weight target allocation.
 */
export default function RebalanceSuggestions({ data }: WidgetProps) {
  const suggestions = useMemo(() => {
    const strategies = data?.strategies as StrategyRow[] | undefined;
    if (!strategies?.length) return [];

    const currentWeights = strategies.map((s) => s.current_weight ?? 0);
    const n = strategies.length;
    const targetWeights = strategies.map(() => 1 / n);
    const names = strategies.map((s) => displayName(s));

    return computeRebalanceSuggestions(currentWeights, targetWeights, names);
  }, [data]);

  if (suggestions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        No strategy data available.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm" data-testid="rebalance-table">
          <thead>
            <tr className="border-b border-[#E2E8F0]">
              <th className="py-2 pl-3 pr-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Strategy
              </th>
              <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Current
              </th>
              <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Suggested
              </th>
              <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Delta
              </th>
              <th className="py-2 pl-2 pr-3 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((s, i) => {
              const strategies = data.strategies as StrategyRow[];
              const currentWeight = strategies[i]?.current_weight ?? 0;
              const targetWeight = 1 / strategies.length;

              return (
                <tr
                  key={s.name}
                  className="border-b border-[#E2E8F0] last:border-b-0 hover:bg-[#F8F9FA] transition-colors"
                >
                  <td className="py-2.5 pl-3 pr-2 text-text-primary font-medium truncate max-w-[160px]">
                    {s.name}
                  </td>
                  <td className="px-2 py-2.5 text-right font-metric tabular-nums text-text-secondary">
                    {formatPercent(currentWeight)}
                  </td>
                  <td className="px-2 py-2.5 text-right font-metric tabular-nums text-text-secondary">
                    {formatPercent(targetWeight)}
                  </td>
                  <td className={`px-2 py-2.5 text-right font-metric tabular-nums font-semibold ${
                    s.drift > 0 ? "text-negative" : s.drift < 0 ? "text-positive" : "text-text-muted"
                  }`}>
                    {formatPercent(s.drift)}
                  </td>
                  <td className="py-2.5 pl-2 pr-3 text-right">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      s.direction === "buy"
                        ? "bg-[#DCFCE7] text-positive"
                        : s.direction === "sell"
                          ? "bg-[#FEE2E2] text-negative"
                          : "bg-[#F1F5F9] text-text-muted"
                    }`}>
                      {s.direction}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 border-t border-[#E2E8F0] px-3 py-2.5">
        <button
          type="button"
          disabled
          title="Coming soon"
          className="w-full rounded-md bg-[#1B6B5A] px-3 py-1.5 text-sm font-medium text-white opacity-50 cursor-not-allowed"
        >
          Apply All
        </button>
      </div>
    </div>
  );
}
