"use client";

import { useMemo } from "react";
import type { WidgetProps } from "../../lib/types";
import { normalizeDailyReturns, compound } from "@/lib/portfolio-math-utils";
import { computeAlphaBeta } from "@/lib/portfolio-stats";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface StrategyRow {
  strategy_id: string;
  current_weight: number | null;
  strategy: {
    strategy_analytics: {
      daily_returns: unknown;
    } | null;
  };
}

/**
 * Alpha/Beta Decomposition — decomposes portfolio returns into
 * Alpha (skill), Beta contribution (market), and Residual.
 *
 * Uses computeAlphaBeta() with portfolio daily returns vs an
 * equal-weight benchmark of all strategies.
 */
export default function AlphaBetaDecomposition({ data }: WidgetProps) {
  const result = useMemo(() => {
    const strategies = data?.strategies as StrategyRow[] | undefined;
    if (!strategies?.length) return null;

    // Gather daily returns per strategy
    const allDailys = strategies.map((s) =>
      normalizeDailyReturns(s.strategy?.strategy_analytics?.daily_returns),
    );
    const nonEmpty = allDailys.filter((dr) => dr.length > 0);
    if (nonEmpty.length < 2) return null;

    // Build common date set
    const dateSet = new Set<string>();
    for (const dr of nonEmpty) {
      for (const d of dr) dateSet.add(d.date);
    }
    const dates = Array.from(dateSet).sort();
    if (dates.length < 10) return null;

    // Build date->index maps for fast lookup
    const dateMaps = nonEmpty.map((dr) => {
      const m = new Map<string, number>();
      for (const d of dr) m.set(d.date, d.value);
      return m;
    });

    // Portfolio weighted returns (using current_weight) and equal-weight benchmark
    const portfolioReturns: number[] = [];
    const benchmarkReturns: number[] = [];

    for (const date of dates) {
      let portSum = 0;
      let portWeight = 0;
      let benchSum = 0;
      let benchCount = 0;

      for (let i = 0; i < nonEmpty.length; i++) {
        const stratIdx = allDailys.indexOf(nonEmpty[i]);
        const val = dateMaps[i].get(date);
        if (val === undefined) continue;

        const w = strategies[stratIdx]?.current_weight ?? (1 / nonEmpty.length);
        portSum += val * w;
        portWeight += w;
        benchSum += val;
        benchCount++;
      }

      if (portWeight > 0 && benchCount > 0) {
        portfolioReturns.push(portSum / portWeight);
        benchmarkReturns.push(benchSum / benchCount);
      }
    }

    if (portfolioReturns.length < 10) return null;

    const { alpha, beta } = computeAlphaBeta(portfolioReturns, benchmarkReturns);
    const totalReturn = compound(portfolioReturns);
    const benchmarkReturn = compound(benchmarkReturns);
    const betaContribution = beta * benchmarkReturn;
    const residual = totalReturn - alpha - betaContribution;

    return {
      alpha,
      beta,
      totalReturn,
      betaContribution,
      residual,
      chartData: [
        {
          name: "Return Decomposition",
          Beta: betaContribution,
          Alpha: alpha,
          Residual: residual,
        },
      ],
    };
  }, [data]);

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Insufficient data for alpha/beta decomposition.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Alpha callout */}
      <div className="mb-3 flex items-baseline gap-2 px-3 pt-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Alpha
        </span>
        <span
          className={`text-2xl font-metric tabular-nums font-bold ${
            result.alpha >= 0 ? "text-positive" : "text-negative"
          }`}
        >
          {result.alpha >= 0 ? "+" : ""}
          {(result.alpha * 100).toFixed(1)}%
        </span>
        <span className="text-xs text-text-muted">annualized</span>
      </div>

      {/* Stacked bar chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={result.chartData}
            margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
            layout="vertical"
          >
            <XAxis
              type="number"
              tick={{
                fontSize: 11,
                fill: "#718096",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
              tickLine={false}
              axisLine={{ stroke: "#E2E8F0" }}
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: "#718096" }}
              tickLine={false}
              axisLine={false}
              width={0}
            />
            <Tooltip
              formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`]}
              contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="square"
              iconSize={10}
            />
            <Bar dataKey="Beta" stackId="decomp" fill="#94A3B8" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Alpha" stackId="decomp" fill="#16A34A" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Residual" stackId="decomp" fill="#E2E8F0" radius={[2, 2, 2, 2]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
