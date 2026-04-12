"use client";

import { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import type { WidgetProps } from "../../lib/types";
import {
  CHART_BORDER,
  CHART_AXIS_TICK,
  CHART_FONT_MONO,
  CHART_TOOLTIP_STYLE,
} from "@/components/charts/chart-tokens";

interface VolumeDay {
  date: string;
  pnlUsd: number;
}

export default function TradeVolume({ data }: WidgetProps) {
  const portfolioId: string | undefined = data?.portfolio?.id;
  const [volumeByDay, setVolumeByDay] = useState<VolumeDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!portfolioId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/activity/portfolio?portfolio_id=${portfolioId}`,
        );
        if (!res.ok) throw new Error("fetch failed");
        const json = await res.json();
        if (!cancelled) setVolumeByDay(json.volumeByDay ?? []);
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portfolioId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs" style={{ color: "#718096" }}>
        Loading...
      </div>
    );
  }

  if (volumeByDay.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: "#718096" }}>
        No trade volume data yet.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={volumeByDay}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_BORDER} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
              tickLine={false}
              axisLine={{ stroke: CHART_BORDER }}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 10, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              width={52}
            />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(value) => [
                `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                "Daily PnL",
              ]}
            />
            <Bar dataKey="pnlUsd" radius={[2, 2, 0, 0]}>
              {volumeByDay.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.pnlUsd >= 0 ? "#16A34A" : "#DC2626"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="px-3 py-1 text-xs" style={{ color: "#718096", fontSize: 12 }}>
        Daily P&amp;L aggregated from exchange account history. Trade-level granularity coming in a future sprint.
      </p>
    </div>
  );
}
