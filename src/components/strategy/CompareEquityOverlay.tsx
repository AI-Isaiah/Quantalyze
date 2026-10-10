"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { TouchTooltip } from "@/components/charts/TouchTooltip";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { formatPercent } from "@/lib/utils";
import { curveMethodFromFlags } from "@/lib/factsheet/resolve-series";
import {
  CHART_BORDER,
  CHART_AXIS_TICK,
  CHART_FONT_MONO,
  CHART_TOOLTIP_STYLE,
} from "@/components/charts/chart-tokens";

const LINE_COLORS = ["#1B6B5A", "#3B82F6", "#8B5CF6", "#F97316"];

/**
 * Phase 170.2 (SC-3, D-07). Why a chain-broken row's covered-from date is or is
 * not on the item, kept apart because the reader's contract is that an outage is
 * never rendered as "the span cannot be named":
 *   - "dated":       `headlineCoversFrom` names the first day of the span.
 *   - "undatable":   the stored series names no such day (a missing row, or a
 *                    densify convention that echoes no gap).
 *   - "read_failed": the read itself failed.
 */
export type HeadlineCoversFromStatus = "dated" | "undatable" | "read_failed";

interface CompareItem {
  strategy: Strategy;
  analytics: StrategyAnalytics;
  /** First day of the span the headline cumulative return compounds. Chain-broken rows only. */
  headlineCoversFrom?: string | null;
  headlineCoversFromStatus?: HeadlineCoversFromStatus;
}

interface CurvePoint {
  date: string;
  [key: string]: number | string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * `Mar 4, 2025` (UTC), the factsheet's `isoToMonthDay` contract. Copied rather
 * than imported: that function lives in `MetricsColumn.tsx`, a client module
 * that pulls the whole factsheet metrics rail into the /compare bundle for a
 * four-line formatter. Source of truth for the format:
 * `src/app/factsheet/[id]/v2/MetricsColumn.tsx :: isoToMonthDay`.
 */
function formatSpanDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

type Point = { date: string; cumRet: number };

/** Why a row draws no line; each maps to one note (UI-SPEC C-5). */
type NoLine = "no_series" | "undatable" | "read_failed";

type Resolved =
  | { line: Point[]; measuredSince: string | null }
  | { line: null; why: NoLine };

/**
 * One row's line, read off the STORED equity levels (base 1.0, both producers),
 * never compounded from them: `returns_series` is a curve, not daily returns.
 *
 * Clean row: the whole series, `(level - 1) * 100`. Chain-broken row (D-07): only
 * days on or after `headlineCoversFrom`, rebased on `openingLevel`, the stored
 * level on the last stored day before it: `(level / openingLevel - 1) * 100`
 * (geometric) or `(level - openingLevel) * 100` (`cumulative_method` simple). On
 * both the last point equals the stored `cumulative_return * 100`. A chain-broken
 * row whose span cannot be located draws NOTHING: no bridged curve, no guessed
 * start (D-07). A non-finite level is dropped, never plotted as 0.
 */
function resolveLine(item: CompareItem): Resolved {
  const levels: Point[] = [];
  for (const p of item.analytics.returns_series ?? []) {
    if (typeof p.date === "string" && Number.isFinite(p.value)) {
      levels.push({ date: p.date, cumRet: p.value });
    }
  }
  if (levels.length === 0) return { line: null, why: "no_series" };

  const rebase = (opening: number, method: "geometric" | "simple") => (p: Point): Point => ({
    date: p.date,
    cumRet: (method === "simple" ? p.cumRet - opening : p.cumRet / opening - 1) * 100,
  });

  if (item.analytics.twr_chain_broken !== "true") {
    return { line: levels.map(rebase(1, "geometric")), measuredSince: null };
  }

  if (item.headlineCoversFromStatus === "read_failed") return { line: null, why: "read_failed" };
  const from = item.headlineCoversFrom;
  if (typeof from !== "string") return { line: null, why: "undatable" };

  const span = levels.filter((p) => p.date >= from);
  if (span.length === 0) return { line: null, why: "undatable" };

  // The stored level on the last stored day before the span.
  let opening: Point | null = null;
  for (const p of levels) {
    if (p.date < from && (opening === null || p.date > opening.date)) opening = p;
  }
  // No stored day precedes the span: it IS the whole series, a clean row's shape.
  if (opening === null) return { line: span.map(rebase(1, "geometric")), measuredSince: null };

  const method = curveMethodFromFlags({ cumulative_method: item.analytics.cumulative_method });
  if (method === "geometric" && !(opening.cumRet > 0)) return { line: null, why: "undatable" };
  return { line: span.map(rebase(opening.cumRet, method)), measuredSince: from };
}

export function CompareEquityOverlay({ items }: { items: CompareItem[] }) {
  const { data, keys, notes } = useMemo(() => {
    const seriesMap = new Map<string, Point[]>();
    const seriesKeys: { key: string; name: string; color: string }[] = [];
    // One note per row that needs one, in legend (item) order (UI-SPEC C-5).
    const noteLines: string[] = [];

    items.forEach((item, i) => {
      const name = item.strategy.name;
      const resolved = resolveLine(item);
      if (resolved.line === null) {
        noteLines.push(
          resolved.why === "no_series"
            ? `${name}: no return series yet.`
            : resolved.why === "read_failed"
              ? `${name}: its measured span could not be loaded, so no curve is drawn.`
              : `${name}: the span of its cumulative return cannot be dated, so no curve is drawn.`,
        );
        return;
      }

      const key = `s${i}`;
      seriesKeys.push({ key, name, color: LINE_COLORS[i % LINE_COLORS.length] });
      seriesMap.set(key, resolved.line);
      if (resolved.measuredSince !== null) {
        noteLines.push(`Measured since ${formatSpanDate(resolved.measuredSince)} (${name})`);
      }
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

    return { data: chartData, keys: seriesKeys, notes: noteLines };
  }, [items]);

  // Notes explain every row that has no line, or a line over a shorter span
  // (UI-SPEC C-5). Nothing renders when there is none.
  const notesBlock =
    notes.length > 0 ? (
      <div className="mb-3 grid gap-1">
        {notes.map((n, i) => (
          <p key={`${i}-${n}`} className="text-caption text-text-secondary">
            {n}
          </p>
        ))}
      </div>
    ) : null;

  if (keys.length === 0) {
    return (
      <div>
        <div
          className="flex items-center justify-center py-12 text-sm"
          style={{ color: "#64748B" }}
        >
          No return series data available for overlay.
        </div>
        {notesBlock}
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

      {notesBlock}

      {/* Chart */}
      <ResponsiveContainer width="100%" height={320}>
        <LineChart accessibilityLayer={false} data={data}>
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
          <TouchTooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(value, name) => {
              const label = keys.find((k) => k.key === name)?.name ?? String(name);
              return [formatPercent(Number(value) / 100), label];
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
