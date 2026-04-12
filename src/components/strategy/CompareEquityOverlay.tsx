"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import {
  CHART_BORDER,
  CHART_AXIS_TICK,
  CHART_FONT_MONO,
  CHART_TOOLTIP_STYLE,
} from "@/components/charts/chart-tokens";

const LINE_COLORS = ["#1B6B5A", "#3B82F6", "#8B5CF6", "#F97316"];

interface CompareItem {
  strategy: Strategy;
  analytics: StrategyAnalytics;
}

interface CurvePoint {
  date: string;
  [key: string]: number | string;
}

export function CompareEquityOverlay({ items }: { items: CompareItem[] }) {
  const { data, keys } = useMemo(() => {
    // Build cumulative return series for each strategy
    const seriesMap = new Map<string, { date: string; cumRet: number }[]>();
    const seriesKeys: { key: string; name: string; color: string }[] = [];

    items.forEach((item, i) => {
      const rs = item.analytics.returns_series;
      if (!rs || rs.length === 0) return;

      const key = `s${i}`;
      seriesKeys.push({
        key,
        name: item.strategy.name,
        color: LINE_COLORS[i % LINE_COLORS.length],
      });

      let cum = 1;
      const points: { date: string; cumRet: number }[] = [];
      for (const p of rs) {
        cum *= 1 + p.value;
        points.push({ date: p.date, cumRet: (cum - 1) * 100 });
      }
      seriesMap.set(key, points);
    });

    // Merge all dates into a single aligned dataset
    const allDates = new Set<string>();
    for (const pts of seriesMap.values()) {
      for (const p of pts) allDates.add(p.date);
    }
    const sortedDates = Array.from(allDates).sort();

    // Build index maps for fast lookup
    const indexMaps = new Map<string, Map<string, number>>();
    for (const [key, pts] of seriesMap) {
      const m = new Map<string, number>();
      for (const p of pts) m.set(p.date, p.cumRet);
      indexMaps.set(key, m);
    }

    const chartData: CurvePoint[] = sortedDates.map((date) => {
      const point: CurvePoint = { date };
      for (const sk of seriesKeys) {
        const val = indexMaps.get(sk.key)?.get(date);
        if (val !== undefined) point[sk.key] = val;
      }
      return point;
    });

    return { data: chartData, keys: seriesKeys };
  }, [items]);

  if (keys.length === 0) {
    return (
      <div
        className="flex items-center justify-center py-12 text-sm"
        style={{ color: "#718096" }}
      >
        No return series data available for overlay.
      </div>
    );
  }

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-3">
        {keys.map((k) => (
          <div key={k.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: k.color }}
            />
            <span className="text-xs" style={{ color: "#4A5568" }}>
              {k.name}
            </span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={CHART_BORDER}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
            tickLine={false}
            axisLine={{ stroke: CHART_BORDER }}
            interval="preserveStartEnd"
            minTickGap={60}
          />
          <YAxis
            tick={{ fontSize: 10, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            width={48}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(value, name) => {
              const label = keys.find((k) => k.key === name)?.name ?? String(name);
              return [`${Number(value).toFixed(2)}%`, label];
            }}
          />
          {keys.map((k) => (
            <Line
              key={k.key}
              type="monotone"
              dataKey={k.key}
              stroke={k.color}
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
