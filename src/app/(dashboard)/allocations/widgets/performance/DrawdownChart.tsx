"use client";

import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { deriveSnapshotDrawdowns } from "../../lib/drawdown";
import { buildCompositeReturns } from "../lib/composite-returns";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Phase 07 / 07-03 / VOICES-ACCEPTED f7 — parallel-prop extension to
 * WidgetProps. Snapshot-derived DailyPoint[] expresses a cumulative USD
 * value series (not daily returns); compute drawdown from running-peak
 * directly. When the prop is ABSENT (undefined), fall back to the existing
 * compositeReturns / buildCompositeReturns path so Bridge allocators keep
 * their strategy-composite drawdown curve post-Phase-09.
 */
interface DrawdownChartProps extends WidgetProps {
  equityDailyPoints?: DailyPoint[];
  /**
   * Phase 10 / 10-04 D-14. Optional scenario equity series, in cumulative
   * wealth × scenario AUM form (USD-scaled values that
   * `deriveSnapshotDrawdowns` can consume directly).
   *
   * **Caller contract (Pitfall 1 + Pattern 6 in 10-RESEARCH.md):**
   * `computeScenario().equity_curve` values are cumulative RETURN. The
   * caller (Plan 06 ScenarioComposer) MUST convert via
   * `(point.value + 1) * scenarioAUM` before passing here so the helper
   * sees a USD curve and computes meaningful drawdowns. Empty array
   * `[]` and `null` both hide the toggle and skip the second Area.
   */
  scenarioDailyPoints?: DailyPoint[] | null;
}

/**
 * Phase 10 / 10-04. 3-state visibility toggle mirrors EquityChart's
 * VisibilityMode — Live / Scenario / Both. Default "both" so the
 * comparison is the first-render story.
 */
type VisibilityMode = "live" | "scenario" | "both";

// Phase 07 / WR-01 — derive drawdown series from a cumulative USD snapshot
// series. Re-export from the server-safe `../../lib/drawdown` module so
// existing import sites (ScenarioComposer, tests, this file) keep working
// while server-side queries.ts can import directly from drawdown.ts
// without crossing the "use client" boundary.
export { deriveSnapshotDrawdowns };

export default function DrawdownChart({
  data,
  equityDailyPoints,
  scenarioDailyPoints = null,
}: DrawdownChartProps) {
  // Phase 10 / 10-04. Visibility state for the scenario overlay.
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>("both");

  const liveDrawdownData = useMemo(() => {
    // Parallel-prop: prefer snapshot-derived points when explicitly
    // provided (including empty []). Only fall back to strategies-
    // derived compute when the prop is undefined.
    if (equityDailyPoints !== undefined) {
      return deriveSnapshotDrawdowns(equityDailyPoints);
    }

    const composite: DailyPoint[] = data?.compositeReturns ?? buildCompositeReturns(data?.strategies ?? []);
    if (composite.length === 0) return [];

    // Compute cumulative equity, then drawdown from peak
    let cumulative = 1;
    let peak = 1;
    const result: { date: string; value: number }[] = [];

    for (const d of composite) {
      cumulative *= 1 + d.value;
      if (cumulative > peak) peak = cumulative;
      const dd = (cumulative - peak) / peak;
      result.push({ date: d.date, value: dd });
    }

    return result;
  }, [data, equityDailyPoints]);

  // Phase 10 / 10-04. Scenario drawdown — reuse the same
  // deriveSnapshotDrawdowns helper to guarantee identical peak-anchoring
  // semantics between the two series (Plan 10-04 L3 invariant).
  const scenarioDrawdownData = useMemo(
    () =>
      scenarioDailyPoints && scenarioDailyPoints.length > 0
        ? deriveSnapshotDrawdowns(scenarioDailyPoints)
        : [],
    [scenarioDailyPoints],
  );
  const hasScenario = scenarioDrawdownData.length > 0;

  // Date-merged chart data — Recharts canonical multi-series idiom: one
  // data array, multiple <Area dataKey=...> components reading different
  // keys. Days that exist in only one series surface as undefined for
  // the other series's dataKey, which Recharts naturally drops from the
  // path.
  const chartData = useMemo(() => {
    type Row = {
      date: string;
      liveDrawdown?: number;
      scenarioDrawdown?: number;
    };
    const byDate = new Map<string, Row>();
    for (const p of liveDrawdownData) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row.liveDrawdown = p.value;
      byDate.set(p.date, row);
    }
    for (const p of scenarioDrawdownData) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row.scenarioDrawdown = p.value;
      byDate.set(p.date, row);
    }
    return [...byDate.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }, [liveDrawdownData, scenarioDrawdownData]);

  if (liveDrawdownData.length === 0 && !hasScenario) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        No drawdown data available
      </div>
    );
  }

  // Phase 10 / 10-04. When the scenario overlay is supplied, the live
  // Area switches to muted slate (var(--color-chart-benchmark)) so it
  // reads as the comparison baseline alongside the accent-teal scenario
  // Area. Without scenarioDailyPoints, the existing red drawdown rendering
  // is preserved verbatim — Phase 09.1 / Performance-tab visual contract
  // intact.
  const liveStroke = hasScenario ? "var(--color-chart-benchmark)" : "#DC2626";
  const liveFillId = hasScenario ? "dd-fill-live-slate" : "dd-fill";
  const scenarioStroke = "var(--color-chart-strategy)";

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      {hasScenario && (
        <div
          role="radiogroup"
          aria-label="Drawdown series visibility"
          style={{
            display: "flex",
            gap: 2,
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "2px 4px 4px",
          }}
        >
          {(["live", "scenario", "both"] as const).map((m) => {
            const active = visibilityMode === m;
            const label =
              m === "live" ? "Live" : m === "scenario" ? "Scenario" : "Both";
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setVisibilityMode(m)}
                style={{
                  padding: "3px 8px",
                  fontSize: 11,
                  fontWeight: 500,
                  fontFamily: "var(--font-mono, 'Geist Mono', monospace)",
                  background: active
                    ? "color-mix(in srgb, var(--color-accent) 8%, transparent)"
                    : "transparent",
                  color: active
                    ? "var(--color-accent)"
                    : "var(--color-text-muted)",
                  border: "none",
                  borderRadius: 3,
                  cursor: "pointer",
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "0.04em",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 100, height: 100 }}>
          <AreaChart accessibilityLayer={false} data={chartData} margin={{ top: 8, right: 8, bottom: 20, left: 8 }}>
            <defs>
              <linearGradient id="dd-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#DC2626" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#DC2626" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="dd-fill-live-slate" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-benchmark)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--color-chart-benchmark)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="dd-fill-scenario" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-strategy)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--color-chart-strategy)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#64748B" }}
              tickLine={false}
              axisLine={{ stroke: "#E2E8F0" }}
              tickFormatter={(d: string) => d.slice(5)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#64748B", fontFamily: "var(--font-geist-mono), monospace" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              domain={["dataMin", 0]}
            />
            <Tooltip
              formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Drawdown"]}
              contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
            />
            {visibilityMode !== "scenario" && liveDrawdownData.length > 0 && (
              <Area
                type="monotone"
                dataKey="liveDrawdown"
                stroke={liveStroke}
                strokeWidth={1.5}
                fill={`url(#${liveFillId})`}
                isAnimationActive={false}
              />
            )}
            {hasScenario && visibilityMode !== "live" && (
              <Area
                type="monotone"
                dataKey="scenarioDrawdown"
                stroke={scenarioStroke}
                strokeWidth={1.5}
                fill="url(#dd-fill-scenario)"
                isAnimationActive={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
