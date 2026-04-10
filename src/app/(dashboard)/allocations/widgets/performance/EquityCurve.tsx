"use client";

import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import {
  MultiLineEquityChart,
  type StrategySeries,
} from "@/components/portfolio/MultiLineEquityChart";
import { computeStrategyCurve, computeCompositeCurve } from "@/lib/scenario";
import { useMemo } from "react";

const STRATEGY_COLORS = [
  "#6366F1", "#F59E0B", "#EC4899", "#8B5CF6",
  "#14B8A6", "#EF4444", "#3B82F6", "#84CC16",
];

export default function EquityCurve({ data }: WidgetProps) {
  const { composite, strategies } = useMemo(() => {
    if (!data?.strategies?.length) {
      return { composite: [] as DailyPoint[], strategies: [] as StrategySeries[] };
    }

    const strats = data.strategies as Array<{
      strategy_id: string;
      strategy: {
        name: string;
        strategy_analytics: { daily_returns: unknown };
      };
      weight: number;
    }>;

    // Per-strategy curves
    const stratSeries: StrategySeries[] = [];
    const builderStrats = [];
    const weightsById: Record<string, number> = {};

    for (let i = 0; i < strats.length; i++) {
      const s = strats[i];
      const dr = normalizeDailyReturns(s.strategy?.strategy_analytics?.daily_returns);
      if (dr.length === 0) continue;

      const curve = computeStrategyCurve(dr);
      stratSeries.push({
        id: s.strategy_id,
        name: s.strategy?.name ?? `Strategy ${i + 1}`,
        color: STRATEGY_COLORS[i % STRATEGY_COLORS.length],
        points: curve,
      });

      builderStrats.push({
        id: s.strategy_id,
        name: s.strategy?.name ?? `Strategy ${i + 1}`,
        codename: null,
        disclosure_tier: "full",
        strategy_types: [],
        markets: [],
        start_date: dr[0]?.date ?? null,
        daily_returns: dr,
        cagr: null,
        sharpe: null,
        volatility: null,
        max_drawdown: null,
      });
      weightsById[s.strategy_id] = s.weight ?? 1;
    }

    // Composite curve
    const inception = data.portfolio?.created_at?.slice(0, 10) ?? "2022-01-01";
    const comp = computeCompositeCurve(builderStrats, weightsById, inception);

    return { composite: comp, strategies: stratSeries };
  }, [data]);

  return (
    <MultiLineEquityChart
      composite={composite}
      strategies={strategies}
      emptyMessage="No equity curve data available"
    />
  );
}
