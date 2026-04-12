"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { WidgetProps } from "../../lib/types";
import type { WeightSnapshot } from "@/lib/types";
import {
  CHART_BORDER,
  CHART_AXIS_TICK,
  CHART_FONT_MONO,
  CHART_TOOLTIP_STYLE,
} from "@/components/charts/chart-tokens";

const PALETTE = ["#1B6B5A", "#3B82F6", "#8B5CF6", "#F97316", "#06B6D4"];

export default function AllocationOverTime({ data }: WidgetProps) {
  const { chartData, strategyKeys } = useMemo(() => {
    const snapshots: WeightSnapshot[] = data?.weightSnapshots ?? [];
    if (snapshots.length === 0) return { chartData: [], strategyKeys: [] };

    // Collect unique strategy IDs
    const stratIds = Array.from(new Set(snapshots.map((s) => s.strategy_id)));

    // Build name map from data.strategies if available
    const nameMap: Record<string, string> = {};
    const strategies = data?.strategies as Array<{ strategy_id: string; strategy: { name: string } }> | undefined;
    if (strategies) {
      for (const s of strategies) {
        nameMap[s.strategy_id] = s.strategy?.name ?? s.strategy_id.slice(0, 8);
      }
    }

    const keys = stratIds.map((id, i) => ({
      key: id,
      name: nameMap[id] ?? id.slice(0, 8),
      color: PALETTE[i % PALETTE.length],
    }));

    // Group by snapshot_date
    const byDate = new Map<string, Record<string, number>>();
    for (const s of snapshots) {
      const d = s.snapshot_date;
      if (!byDate.has(d)) byDate.set(d, {});
      const row = byDate.get(d)!;
      row[s.strategy_id] = (s.actual_weight ?? s.target_weight ?? 0) * 100;
    }

    const sorted = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, ...vals }));

    return { chartData: sorted, strategyKeys: keys };
  }, [data]);

  if (chartData.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center p-6 text-sm"
        style={{ color: "#718096" }}
      >
        No weight history yet. History builds automatically as positions are tracked.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_BORDER} vertical={false} />
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
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
          width={40}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          formatter={(value, name) => {
            const label = strategyKeys.find((k) => k.key === name)?.name ?? String(name);
            return [`${Number(value).toFixed(1)}%`, label];
          }}
        />
        {strategyKeys.map((k) => (
          <Area
            key={k.key}
            type="monotone"
            dataKey={k.key}
            stackId="1"
            fill={k.color}
            stroke={k.color}
            fillOpacity={0.6}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
