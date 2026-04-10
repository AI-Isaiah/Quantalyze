"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { WidgetProps } from "../../lib/types";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import { mean } from "@/lib/portfolio-math-utils";
import { computeRiskDecomposition } from "@/lib/portfolio-stats";

// ---------------------------------------------------------------------------
// Risk Decomposition Widget
//
// Computes per-strategy contribution to total portfolio risk using the
// covariance matrix and current weights. Renders a horizontal bar chart
// with strategy names as Y-axis labels.
// ---------------------------------------------------------------------------

/** Compute the covariance matrix from aligned daily returns. */
function buildCovMatrix(
  returnArrays: number[][],
  dates: string[],
  dateMaps: Map<string, number>[],
): number[][] {
  const n = returnArrays.length;
  // Align on common dates
  const aligned: number[][] = Array.from({ length: n }, () => []);

  for (const d of dates) {
    const vals: (number | undefined)[] = dateMaps.map((m) => m.get(d));
    if (vals.every((v) => v !== undefined)) {
      for (let i = 0; i < n; i++) {
        aligned[i].push(vals[i]!);
      }
    }
  }

  const len = aligned[0]?.length ?? 0;
  if (len < 2) {
    return Array.from({ length: n }, () => Array(n).fill(0));
  }

  const means = aligned.map((a) => mean(a));
  const cov: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < len; k++) {
        sum += (aligned[i][k] - means[i]) * (aligned[j][k] - means[j]);
      }
      const c = sum / (len - 1);
      cov[i][j] = c;
      cov[j][i] = c;
    }
  }

  return cov;
}

interface StrategyData {
  name: string;
  weight: number;
  dateMap: Map<string, number>;
  returns: number[];
}

export function RiskDecomposition({ data }: WidgetProps) {
  const chartData = useMemo(() => {
    const strategies: StrategyData[] = [];
    if (data?.strategies && Array.isArray(data.strategies)) {
      for (const s of data.strategies) {
        const dr = normalizeDailyReturns(
          s?.strategy?.strategy_analytics?.daily_returns,
        );
        if (dr.length === 0) continue;

        const name = (
          s?.alias ??
          s?.strategy?.codename ??
          s?.strategy?.name ??
          "?"
        ).slice(0, 12);
        const weight = s?.current_weight ?? 0;
        const dateMap = new Map<string, number>();
        for (const d of dr) dateMap.set(d.date, d.value);

        strategies.push({
          name,
          weight,
          dateMap,
          returns: dr.map((d: { value: number }) => d.value),
        });
      }
    }

    if (strategies.length === 0) return [];

    // Normalize weights
    const totalWeight = strategies.reduce((s, st) => s + st.weight, 0);
    const weights =
      totalWeight > 0
        ? strategies.map((s) => s.weight / totalWeight)
        : strategies.map(() => 1 / strategies.length);

    // Collect all dates
    const allDates = new Set<string>();
    for (const s of strategies) {
      for (const d of s.dateMap.keys()) allDates.add(d);
    }
    const dates = [...allDates].sort();

    const covMatrix = buildCovMatrix(
      strategies.map((s) => s.returns),
      dates,
      strategies.map((s) => s.dateMap),
    );

    const decomp = computeRiskDecomposition(weights, covMatrix);

    return decomp.map((d, i) => ({
      name: strategies[i].name,
      contribution: Math.round(d.percentage * 10) / 10,
    }));
  }, [data]);

  if (chartData.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "#718096" }}
      >
        No strategy data for risk decomposition
      </div>
    );
  }

  return (
    <div data-testid="risk-decomposition" className="h-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 20, bottom: 5, left: 5 }}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: "#718096" }}
            tickLine={false}
            axisLine={{ stroke: "#E2E8F0" }}
            tickFormatter={(v: number) => `${v}%`}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: "#4A5568" }}
            tickLine={false}
            axisLine={false}
            width={80}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderColor: "#E2E8F0",
              borderRadius: 6,
            }}
            formatter={(v) => [`${Number(v).toFixed(1)}%`, "Risk Contribution"]}
          />
          <Bar dataKey="contribution" radius={[0, 3, 3, 0]} maxBarSize={20}>
            {chartData.map((entry, i) => (
              <Cell
                key={`cell-${i}`}
                fill={entry.contribution >= 0 ? "#1B6B5A" : "#DC2626"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
