"use client";

import { useMemo } from "react";
import type { WidgetProps } from "../../lib/types";
import { computeWeightDrift } from "@/lib/portfolio-stats";
import { formatPercent } from "@/lib/utils";
import { displayName } from "@/lib/allocation-helpers";

interface StrategyRow {
  strategy_id: string;
  current_weight: number | null;
  alias: string | null;
  strategy: { name: string; codename: string | null; disclosure_tier: string };
}

function driftColor(drift: number): string {
  const abs = Math.abs(drift);
  if (abs <= 0.02) return "text-positive";  // green: within +/-2%
  if (abs <= 0.05) return "text-[#D97706]"; // yellow: 2-5%
  return "text-negative";                    // red: >5%
}

/**
 * Weight Drift Monitor — shows how current weights have drifted
 * from their initial/target allocations.
 *
 * Target weight is taken as the initial weight (current_weight at setup).
 * In a real system, targets would be stored separately; for now we use
 * an equal-weight baseline as the target when all current_weights are
 * identical, or the current_weights themselves as initial targets.
 */
export default function WeightDriftMonitor({ data }: WidgetProps) {
  const rows = useMemo(() => {
    const strategies = data?.strategies as StrategyRow[] | undefined;
    if (!strategies?.length) return [];

    const currentWeights = strategies.map((s) => s.current_weight ?? 0);
    // Use equal-weight as target (initial allocation target)
    const n = strategies.length;
    const targetWeights = strategies.map(() => 1 / n);
    const drifts = computeWeightDrift(currentWeights, targetWeights);

    return strategies.map((s, i) => ({
      name: displayName(s),
      target: targetWeights[i],
      current: currentWeights[i],
      drift: drifts[i],
    }));
  }, [data]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        No strategy data available.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm" data-testid="weight-drift-table">
        <thead>
          <tr className="border-b border-[#E2E8F0]">
            <th className="py-2 pl-3 pr-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Strategy
            </th>
            <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Target
            </th>
            <th className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Current
            </th>
            <th className="py-2 pl-2 pr-3 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Drift
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.name}
              className="border-b border-[#E2E8F0] last:border-b-0 hover:bg-[#F8F9FA] transition-colors"
            >
              <td className="py-2.5 pl-3 pr-2 text-text-primary font-medium truncate max-w-[180px]">
                {row.name}
              </td>
              <td className="px-2 py-2.5 text-right font-metric tabular-nums text-text-secondary">
                {formatPercent(row.target)}
              </td>
              <td className="px-2 py-2.5 text-right font-metric tabular-nums text-text-secondary">
                {formatPercent(row.current)}
              </td>
              <td className={`py-2.5 pl-2 pr-3 text-right font-metric tabular-nums font-semibold ${driftColor(row.drift)}`}>
                {formatPercent(row.drift)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
