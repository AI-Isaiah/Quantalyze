"use client";

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { WidgetProps } from "../../lib/types";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import { mean } from "@/lib/portfolio-math-utils";

// ---------------------------------------------------------------------------
// Correlation Over Time Widget
//
// Computes rolling 90-day Pearson correlation for each strategy pair using
// daily returns, then shows the top 3 pairs (by absolute mean correlation)
// as Recharts LineChart lines over time.
// ---------------------------------------------------------------------------

const ROLLING_WINDOW = 90;
const TOP_PAIRS = 3;

const PAIR_COLORS = ["#1B6B5A", "#DC2626", "#2563EB"];

/** Pearson correlation for two same-length arrays. */
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  return denom > 0 ? cov / denom : 0;
}

interface StrategyReturns {
  name: string;
  dateMap: Map<string, number>;
}

export function CorrelationOverTime({ data }: WidgetProps) {
  const { chartData, pairNames } = useMemo(() => {
    const strategies: StrategyReturns[] = [];
    if (data?.strategies && Array.isArray(data.strategies)) {
      for (const s of data.strategies) {
        const dr = normalizeDailyReturns(
          s?.strategy?.strategy_analytics?.daily_returns,
        );
        if (dr.length > 0) {
          const name = (
            s?.alias ??
            s?.strategy?.codename ??
            s?.strategy?.name ??
            "?"
          ).slice(0, 10);
          const dateMap = new Map<string, number>();
          for (const d of dr) dateMap.set(d.date, d.value);
          strategies.push({ name, dateMap });
        }
      }
    }

    if (strategies.length < 2) return { chartData: [], pairNames: [] };

    // Collect all dates sorted
    const allDates = new Set<string>();
    for (const s of strategies) {
      for (const d of s.dateMap.keys()) allDates.add(d);
    }
    const dates = [...allDates].sort();

    // Generate all pairs
    const pairs: { nameA: string; nameB: string; label: string; idxA: number; idxB: number }[] = [];
    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        pairs.push({
          nameA: strategies[i].name,
          nameB: strategies[j].name,
          label: `${strategies[i].name}/${strategies[j].name}`,
          idxA: i,
          idxB: j,
        });
      }
    }

    // Compute rolling correlation for each pair, rank by avg |corr|
    const pairSeries: { label: string; points: { date: string; corr: number }[]; avgAbs: number }[] = [];

    for (const pair of pairs) {
      const sA = strategies[pair.idxA];
      const sB = strategies[pair.idxB];

      // Align on common dates
      const aligned: { date: string; a: number; b: number }[] = [];
      for (const d of dates) {
        const va = sA.dateMap.get(d);
        const vb = sB.dateMap.get(d);
        if (va !== undefined && vb !== undefined) {
          aligned.push({ date: d, a: va, b: vb });
        }
      }

      if (aligned.length < ROLLING_WINDOW) continue;

      const points: { date: string; corr: number }[] = [];
      for (let i = ROLLING_WINDOW - 1; i < aligned.length; i++) {
        const windowA = aligned.slice(i - ROLLING_WINDOW + 1, i + 1).map((x) => x.a);
        const windowB = aligned.slice(i - ROLLING_WINDOW + 1, i + 1).map((x) => x.b);
        points.push({ date: aligned[i].date, corr: pearson(windowA, windowB) });
      }

      const avgAbs =
        points.length > 0
          ? points.reduce((s, p) => s + Math.abs(p.corr), 0) / points.length
          : 0;

      pairSeries.push({ label: pair.label, points, avgAbs });
    }

    // Pick top N by average absolute correlation
    pairSeries.sort((a, b) => b.avgAbs - a.avgAbs);
    const topPairs = pairSeries.slice(0, TOP_PAIRS);

    if (topPairs.length === 0) return { chartData: [], pairNames: [] };

    // Merge into chart data keyed by date
    const dateMap = new Map<string, Record<string, number>>();
    for (const pair of topPairs) {
      for (const pt of pair.points) {
        let entry = dateMap.get(pt.date);
        if (!entry) {
          entry = {};
          dateMap.set(pt.date, entry);
        }
        entry[pair.label] = pt.corr;
      }
    }

    const result = [...dateMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, ...vals }));

    return {
      chartData: result,
      pairNames: topPairs.map((p) => p.label),
    };
  }, [data]);

  if (chartData.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "#718096" }}
      >
        Insufficient data for rolling correlation (need {ROLLING_WINDOW}+ days,
        2+ strategies)
      </div>
    );
  }

  return (
    <div data-testid="correlation-over-time" className="h-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 5, right: 10, bottom: 5, left: 0 }}
        >
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#718096" }}
            tickLine={false}
            axisLine={{ stroke: "#E2E8F0" }}
            interval="preserveStartEnd"
            tickFormatter={(v: string) => v.slice(5)} // MM-DD
          />
          <YAxis
            domain={[-1, 1]}
            tick={{ fontSize: 10, fill: "#718096" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderColor: "#E2E8F0",
              borderRadius: 6,
            }}
            formatter={(v) => [Number(v).toFixed(3), ""]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            iconType="line"
          />
          {pairNames.map((name, idx) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={PAIR_COLORS[idx % PAIR_COLORS.length]}
              dot={false}
              strokeWidth={1.5}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
