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
import type { WidgetProps } from "../../lib/types";
import type { PositionSnapshot } from "@/lib/types";
import {
  CHART_ACCENT,
  CHART_BORDER,
  CHART_AXIS_TICK,
  CHART_FONT_MONO,
  CHART_TOOLTIP_STYLE,
} from "@/components/charts/chart-tokens";

interface NetPoint {
  date: string;
  netUsd: number;
}

export default function NetExposure({ data }: WidgetProps) {
  const chartData = useMemo<NetPoint[]>(() => {
    const snapshots: PositionSnapshot[] = data?.positionSnapshots ?? [];
    if (snapshots.length === 0) return [];

    // Sum signed size_usd per snapshot_date
    const byDate = new Map<string, number>();
    for (const s of snapshots) {
      const usd = s.size_usd ?? 0;
      byDate.set(s.snapshot_date, (byDate.get(s.snapshot_date) ?? 0) + usd);
    }

    return Array.from(byDate.entries())
      .map(([date, netUsd]) => ({ date, netUsd }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: "#718096" }}>
        No position history available.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData}>
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
          tickFormatter={(v: number) =>
            `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)}`
          }
          width={52}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          formatter={(value) => [
            `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            "Net Exposure",
          ]}
        />
        <Line
          type="monotone"
          dataKey="netUsd"
          stroke={CHART_ACCENT}
          strokeWidth={1.5}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
