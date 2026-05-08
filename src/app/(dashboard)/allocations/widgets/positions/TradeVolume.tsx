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
  const [hasFills, setHasFills] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        if (!res.ok) throw new Error(`fetch failed (${res.status})`);
        const json = await res.json();
        if (!cancelled) {
          setVolumeByDay(json.volumeByDay ?? []);
          setHasFills(json.has_fills === true);
          setError(null);
        }
      } catch (err) {
        // audit-2026-05-07 G12.G.2: previously silent — allocator saw the
        // empty state ("No trade volume data yet.") on transient 500s,
        // RLS rejections, network blips, or fetch aborts, indistinguishable
        // from a genuinely empty trade history. Surface the failure so the
        // user knows to refresh and operators can detect spikes via console
        // diagnostics.
        console.error(
          "[TradeVolume] portfolio activity fetch failed:",
          err,
        );
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not load trade volume.",
          );
        }
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
      <div className="flex h-full items-center justify-center text-xs" style={{ color: "#64748B" }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center px-4 text-center text-sm"
        style={{ color: "#991B1B" }}
      >
        <span>Couldn&apos;t load trade volume.</span>
        <span className="text-xs" style={{ color: "#64748B" }}>
          Try refreshing. ({error})
        </span>
      </div>
    );
  }

  if (volumeByDay.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: "#64748B" }}>
        No trade volume data yet.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 100, height: 100 }}>
          <BarChart accessibilityLayer={false} data={volumeByDay}>
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
                  fill={entry.pnlUsd >= 0 ? "#15803D" : "#DC2626"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {!hasFills && (
        <p className="px-3 py-1 text-xs" style={{ color: "#64748B", fontSize: 12 }}>
          Daily P&amp;L aggregated from exchange account history. Trade-level granularity coming in a future sprint.
        </p>
      )}
    </div>
  );
}
