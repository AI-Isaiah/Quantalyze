"use client";

import { useMemo } from "react";
import type { WidgetProps } from "../../lib/types";
import type { AttributionRow } from "@/lib/types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";

interface WaterfallBar {
  name: string;
  value: number;
  start: number;
  fill: string;
}

/**
 * Attribution Waterfall — Recharts BarChart in waterfall style.
 *
 * Shows a "Prior" start bar, per-strategy contribution bars
 * (green up / red down), and a "Current" end bar. Uses stacked
 * bars with an invisible base to simulate waterfall positioning.
 */
export default function AttributionWaterfall({ data }: WidgetProps) {
  const bars = useMemo<WaterfallBar[]>(() => {
    const breakdown = data?.analytics?.attribution_breakdown as AttributionRow[] | null | undefined;
    if (!breakdown?.length) return [];

    // Prior value is arbitrary baseline (0%)
    const prior = 0;
    const result: WaterfallBar[] = [
      { name: "Prior", value: prior, start: 0, fill: "#94A3B8" },
    ];

    let running = prior;
    for (const row of breakdown) {
      const contrib = row.contribution ?? 0;
      result.push({
        name: row.strategy_name,
        value: contrib,
        start: running,
        fill: contrib >= 0 ? "#16A34A" : "#DC2626",
      });
      running += contrib;
    }

    result.push({
      name: "Current",
      value: running,
      start: 0,
      fill: "#1B6B5A",
    });

    return result;
  }, [data]);

  if (bars.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Attribution data not available
      </div>
    );
  }

  // For waterfall: each bar has an invisible "base" portion + visible portion.
  // "Prior" and "Current" are absolute bars (start from 0).
  // Contribution bars start from the running total.
  const chartData = bars.map((b) => {
    const isEndpoint = b.name === "Prior" || b.name === "Current";
    if (isEndpoint) {
      return {
        name: b.name,
        base: 0,
        value: b.value,
        fill: b.fill,
      };
    }
    // Contribution: invisible base from start, visible segment is the contribution
    const base = b.value >= 0 ? b.start : b.start + b.value;
    const visible = Math.abs(b.value);
    return {
      name: b.name,
      base,
      value: visible,
      fill: b.fill,
    };
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        margin={{ top: 8, right: 8, bottom: 20, left: 8 }}
      >
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "#718096" }}
          tickLine={false}
          axisLine={{ stroke: "#E2E8F0" }}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={50}
        />
        <YAxis
          tick={{
            fontSize: 11,
            fill: "#718096",
            fontFamily: "var(--font-geist-mono), monospace",
          }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
        />
        <Tooltip
          formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Contribution"]}
          contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
        />
        <ReferenceLine y={0} stroke="#E2E8F0" />
        {/* Invisible base bar */}
        <Bar dataKey="base" stackId="waterfall" fill="transparent" />
        {/* Visible contribution bar */}
        <Bar dataKey="value" stackId="waterfall" radius={[2, 2, 0, 0]}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
