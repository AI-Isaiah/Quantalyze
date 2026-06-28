"use client";

import { useMemo } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis, Legend } from "recharts";
import { TouchTooltip } from "./TouchTooltip";
import {
  CHART_ACCENT,
  CHART_BORDER,
  CHART_REFERENCE_DASH,
  CHART_TEXT_MUTED,
  CHART_TEXT_SECONDARY,
  CHART_TICK_STYLE,
} from "./chart-tokens";
import {
  ROLLING_SHARPE_MIN_DAYS,
  insufficientHistoryMessage,
} from "@/lib/min-history";

interface RollingMetricsProps {
  data: Record<string, { date: string; value: number }[]>;
  /**
   * Overall (all-time) Sharpe ratio for this strategy. When provided,
   * renders as a dashed horizontal reference line labeled "avg" so
   * allocators can see whether the recent rolling window is above or
   * below the strategy's long-run average.
   *
   * Tri-state semantics:
   *   - finite number   → render dashed avg ReferenceLine (subject to
   *                       the min-history gate below).
   *   - NaN / Infinity  → caller intended to show an avg but the value
   *                       is unavailable for this strategy. Suppress the
   *                       line and surface a small caption so allocators
   *                       know the absence is signal, not noise (P71).
   *   - null/undefined  → caller did not request the avg line at all.
   *                       Stay silent — we cannot distinguish "feature
   *                       off" from "data error" here.
   */
  overallSharpe?: number | null;
  /**
   * Days of usable daily history for this strategy. When provided and
   * below {@link ROLLING_SHARPE_MIN_DAYS}, the dashed avg ReferenceLine
   * is suppressed in favour of a caption that mirrors the
   * `WorstDrawdowns`/`CorrelationWithBenchmark` insufficient-history
   * pattern (P69). Optional: when omitted, the gate is skipped (the
   * caller is asserting "we don't know history; trust the chart"), but
   * `PerformanceReport` always passes it.
   */
  daysOfHistory?: number;
  /**
   * Optional per-series label override for the visible Legend + Tooltip text,
   * keyed by the same data key used in {@link data}. Decouples the
   * stroke-resolution key (which {@link STROKE_BY_KEY} maps to a color) from
   * the user-visible label.
   *
   * Phase 30 (WR-01): the blend Rolling-Sharpe series is keyed `sharpe_365d`
   * so it resolves the {@link CHART_ACCENT} stroke, but its actual rolling
   * window is allocator-selectable (63/126/252 days). Without this override the
   * default {@link LABELS} lookup would mislabel a 3M/6M window line as "365d",
   * contradicting the panel's own window disclosure. Callers pass the true
   * window label here; the accent stroke is unaffected.
   *
   * Falls back to {@link LABELS} (then the raw key) for any series not present
   * in this map, so existing callers that omit it are unchanged.
   */
  seriesLabels?: Record<string, string>;
}

const STROKE_BY_KEY: Record<string, string> = {
  sharpe_30d: CHART_TEXT_MUTED,
  sharpe_90d: CHART_TEXT_SECONDARY,
  sharpe_365d: CHART_ACCENT,
};

const LABELS: Record<string, string> = {
  sharpe_30d: "30d",
  sharpe_90d: "90d",
  sharpe_365d: "365d",
};

export function RollingMetrics({
  data,
  overallSharpe,
  daysOfHistory,
  seriesLabels,
}: RollingMetricsProps) {
  // WR-01: resolve the visible label from the optional override first, then
  // the default LABELS map, then the raw key — keeping the STROKE_BY_KEY accent
  // resolution (below) entirely independent of the displayed text.
  const labelFor = (name: string) =>
    seriesLabels?.[name] ?? LABELS[name] ?? name;
  // Merge by date key (series have different lengths due to window sizes).
  // Memoized so the O(N·K) merge+sort runs once per `data` reference change
  // rather than on every parent render.
  const merged = useMemo(() => {
    const keys = Object.keys(data);
    if (keys.length === 0) return [];
    const dateMap = new Map<string, Record<string, string | number>>();
    for (const key of keys) {
      for (const point of data[key]) {
        if (!dateMap.has(point.date)) dateMap.set(point.date, { date: point.date });
        dateMap.get(point.date)![key] = point.value;
      }
    }
    return Array.from(dateMap.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    );
  }, [data]);

  const keys = Object.keys(data);
  if (keys.length === 0) return null;

  const sharpeProvided = typeof overallSharpe === "number";
  const sharpeFinite = sharpeProvided && Number.isFinite(overallSharpe);
  // P71: caller asked for the avg line but the value is mathematically
  // unavailable (NaN / Infinity). Surface a caption rather than silently
  // dropping the line.
  const sharpeUnavailable = sharpeProvided && !sharpeFinite;

  // P69: even when the value is finite, the long-run average is
  // statistically meaningless on thin history. Gate the ReferenceLine on
  // a one-year history floor; below threshold, swap the line for the
  // same caption pattern.
  const historyBelowFloor =
    typeof daysOfHistory === "number" && daysOfHistory < ROLLING_SHARPE_MIN_DAYS;
  const historyKnown = typeof daysOfHistory === "number";

  const renderReferenceLine =
    sharpeFinite && (!historyKnown || !historyBelowFloor);

  let caption: string | null = null;
  if (sharpeUnavailable) {
    caption = "Long-run Sharpe unavailable for this strategy";
  } else if (sharpeFinite && historyBelowFloor) {
    caption = insufficientHistoryMessage(
      "long-run Sharpe reference",
      ROLLING_SHARPE_MIN_DAYS,
      daysOfHistory ?? 0,
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart accessibilityLayer={false} data={merged} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="date"
            tick={CHART_TICK_STYLE}
            tickLine={false}
            axisLine={{ stroke: CHART_BORDER }}
            tickFormatter={(d: string) => d.slice(5)}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={CHART_TICK_STYLE}
            tickLine={false}
            axisLine={false}
          />
          <TouchTooltip
            contentStyle={{ fontSize: 12, borderColor: CHART_BORDER }}
            formatter={(v, name) => [Number(v).toFixed(2), labelFor(String(name))]}
          />
          <Legend formatter={(name: string) => labelFor(name)} />
          {renderReferenceLine && (
            <ReferenceLine
              y={overallSharpe as number}
              stroke={CHART_TEXT_MUTED}
              strokeDasharray={CHART_REFERENCE_DASH}
              label={{
                value: "avg",
                position: "right",
                fontSize: 12,
                fill: CHART_TEXT_SECONDARY,
              }}
            />
          )}
          {keys.map((key) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={STROKE_BY_KEY[key] ?? CHART_TEXT_MUTED}
              strokeWidth={1.5}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {caption && (
        <p className="mt-2 px-4 pb-2 text-xs text-text-muted">
          {caption}
        </p>
      )}
    </div>
  );
}
