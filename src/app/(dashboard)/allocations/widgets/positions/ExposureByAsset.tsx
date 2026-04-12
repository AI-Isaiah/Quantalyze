"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
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
} from "@/components/charts/chart-tokens";

interface ExposureRow {
  symbol: string;
  sizeUsd: number;
  absUsd: number;
}

export default function ExposureByAsset({ data }: WidgetProps) {
  const rows = useMemo<ExposureRow[]>(() => {
    const snapshots: PositionSnapshot[] = data?.positionSnapshots ?? [];
    if (snapshots.length === 0) return [];

    // Latest snapshot per (strategy, symbol)
    const latest = new Map<string, PositionSnapshot>();
    for (const s of snapshots) {
      const key = `${s.strategy_id}|${s.symbol}`;
      const existing = latest.get(key);
      if (!existing || s.snapshot_date > existing.snapshot_date) {
        latest.set(key, s);
      }
    }

    // Aggregate by symbol
    const bySymbol = new Map<string, number>();
    for (const s of latest.values()) {
      const usd = s.size_usd ?? 0;
      bySymbol.set(s.symbol, (bySymbol.get(s.symbol) ?? 0) + usd);
    }

    return Array.from(bySymbol.entries())
      .map(([symbol, sizeUsd]) => ({
        symbol,
        sizeUsd,
        absUsd: Math.abs(sizeUsd),
      }))
      .sort((a, b) => b.absUsd - a.absUsd)
      .slice(0, 20);
  }, [data]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: "#718096" }}>
        No position data available.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_BORDER} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
          tickLine={false}
          axisLine={{ stroke: CHART_BORDER }}
          tickFormatter={(v: number) =>
            `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)}`
          }
        />
        <YAxis
          type="category"
          dataKey="symbol"
          tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
          tickLine={false}
          axisLine={false}
          width={80}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            fontFamily: CHART_FONT_MONO,
            borderColor: CHART_BORDER,
            borderRadius: 6,
          }}
          formatter={(value) => [
            `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            "Exposure",
          ]}
        />
        <Bar dataKey="sizeUsd" fill={CHART_ACCENT} radius={[0, 2, 2, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
