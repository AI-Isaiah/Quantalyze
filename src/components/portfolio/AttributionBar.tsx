"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { TouchTooltip } from "@/components/charts/TouchTooltip";
import { CHART_TEXT_MUTED } from "@/components/charts/chart-tokens";
import { formatFixedSigned, signTone } from "@/lib/factsheet/display-sign";

interface AttributionBarProps {
  data: { strategy_id: string; strategy_name: string; contribution: number }[] | null;
}

/** Axis tick label (1 dp). Lifted out of the JSX so jsdom can read it (170.6); a rounded zero prints unsigned (D-02). */
export const formatAttributionTick = (v: number): string =>
  formatFixedSigned(v, { dp: 1, scale: 100, suffix: "%", plus: true });

/** Tooltip value (2 dp). */
export const formatAttributionTooltip = (v: number): string =>
  formatFixedSigned(v, { dp: 2, scale: 100, suffix: "%", plus: true });

/**
 * Bar fill for a contribution, from the sign of the value as the tooltip PRINTS it (2 dp percent,
 * D-03): green above zero, red below, muted at a rounded zero. A bar is a chart mark that carries
 * a printed value, so it follows the rule (unlike the heatmap FILLS, D-06).
 */
export const attributionFill = (contribution: number): string => {
  const tone = signTone(contribution, 2, 100);
  return tone === "positive" ? "#15803D" : tone === "negative" ? "#DC2626" : CHART_TEXT_MUTED;
};

export function AttributionBar({ data }: AttributionBarProps) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-small">
        No attribution data available.
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.contribution - a.contribution);

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, sorted.length * 36)}>
      <BarChart accessibilityLayer={false} data={sorted} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }}>
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "#64748B", fontFamily: "'Geist Mono', monospace" }}
          tickFormatter={formatAttributionTick}
          tickLine={false}
          axisLine={{ stroke: "#E2E8F0" }}
        />
        <YAxis
          type="category"
          dataKey="strategy_name"
          tick={{ fontSize: 12, fill: "#4A5568" }}
          tickLine={false}
          axisLine={false}
          width={120}
        />
        <TouchTooltip
          formatter={(v) => [formatAttributionTooltip(Number(v)), "Contribution"]}
          contentStyle={{ fontSize: 12, borderColor: "#E2E8F0", borderRadius: 6 }}
        />
        <Bar dataKey="contribution" radius={[0, 3, 3, 0]} barSize={20}>
          {sorted.map((entry) => (
            <Cell key={entry.strategy_id} fill={attributionFill(entry.contribution)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
