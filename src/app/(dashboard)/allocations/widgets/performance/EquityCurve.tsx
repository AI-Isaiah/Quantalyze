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

/**
 * Phase 07 / 07-03 / VOICES-ACCEPTED f7 — parallel-prop widget-local
 * extension to WidgetProps. When `equityDailyPoints` is PRESENT
 * (including empty []), the widget renders from that prop and does NOT
 * compute the strategies-derived composite. When ABSENT (undefined),
 * the widget falls back to the existing strategies path so Bridge
 * allocators keep their composite curve post-Phase-09.
 *
 * The prop is converted from `value = cumulative wealth multiplier`
 * (snapshot series) → composite = DailyPoint[] in the same shape the
 * MultiLineEquityChart already consumes. Snapshot values are USD
 * totals, so we normalise to a cumulative-wealth curve anchored to the
 * first point (i.e. value = value_usd[i] / value_usd[0]) so the chart
 * axis stays percent-of-inception and aligns with the strategies path.
 */
interface EquityCurveProps extends WidgetProps {
  equityDailyPoints?: DailyPoint[];
}

export default function EquityCurve({ data, equityDailyPoints }: EquityCurveProps) {
  const { composite, strategies } = useMemo(() => {
    // Parallel-prop: prefer snapshot-derived points when explicitly
    // provided (including empty []). Only fall back to strategies-
    // derived compute when the prop is undefined.
    if (equityDailyPoints !== undefined) {
      if (equityDailyPoints.length === 0) {
        return { composite: [] as DailyPoint[], strategies: [] as StrategySeries[] };
      }
      // Skip leading 0 / negative points before anchoring. A derivative
      // margin-below-zero first day would otherwise either (a) divide by
      // <=0 and fall through to raw USD values, or (b) anchor the whole
      // series to a non-positive base — either way producing a mixed-
      // scale chart where wealth multipliers and absolute dollars share
      // an axis. Re-anchor from the first positive value instead.
      const firstPositiveIdx = equityDailyPoints.findIndex((p) => p.value > 0);
      if (firstPositiveIdx < 0) {
        return { composite: [] as DailyPoint[], strategies: [] as StrategySeries[] };
      }
      const anchored = equityDailyPoints.slice(firstPositiveIdx);
      const base = anchored[0].value;
      const comp: DailyPoint[] = anchored.map((p) => ({
        date: p.date,
        value: Number((p.value / base).toFixed(6)),
      }));
      return { composite: comp, strategies: [] as StrategySeries[] };
    }

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
  }, [data, equityDailyPoints]);

  return (
    <MultiLineEquityChart
      composite={composite}
      strategies={strategies}
      emptyMessage="No equity curve data available"
    />
  );
}
