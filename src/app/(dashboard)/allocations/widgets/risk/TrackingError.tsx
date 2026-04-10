"use client";

import { useMemo } from "react";
import type { WidgetProps } from "../../lib/types";
import { normalizeDailyReturns, mean } from "@/lib/portfolio-math-utils";
import { computeTrackingError } from "@/lib/portfolio-stats";
import { formatPercent } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tracking Error Widget
//
// Computes annualized tracking error of the portfolio vs an equal-weight
// benchmark (average of all strategy returns per day). Renders a large
// number with context about the benchmark methodology.
// ---------------------------------------------------------------------------

function teInterpretation(te: number): { label: string; color: string } {
  const pct = te * 100;
  if (pct < 2) return { label: "Low", color: "#16A34A" };
  if (pct < 5) return { label: "Moderate", color: "#CA8A04" };
  return { label: "High", color: "#DC2626" };
}

export function TrackingError({ data }: WidgetProps) {
  const { te, interpretation } = useMemo(() => {
    // Collect per-strategy daily returns keyed by date
    const strategyDateMaps: Map<string, number>[] = [];
    if (data?.strategies && Array.isArray(data.strategies)) {
      for (const s of data.strategies) {
        const dr = normalizeDailyReturns(
          s?.strategy?.strategy_analytics?.daily_returns,
        );
        if (dr.length > 0) {
          const dateMap = new Map<string, number>();
          for (const d of dr) dateMap.set(d.date, d.value);
          strategyDateMaps.push(dateMap);
        }
      }
    }

    if (strategyDateMaps.length < 2) {
      return { te: 0, interpretation: teInterpretation(0) };
    }

    // Collect all dates
    const allDates = new Set<string>();
    for (const m of strategyDateMaps) {
      for (const d of m.keys()) allDates.add(d);
    }
    const dates = [...allDates].sort();

    // For each date, compute weighted portfolio return and equal-weight benchmark
    const portfolioReturns: number[] = [];
    const benchmarkReturns: number[] = [];

    // Get weights from data
    const weights: number[] = [];
    if (data?.strategies && Array.isArray(data.strategies)) {
      for (const s of data.strategies) {
        const dr = normalizeDailyReturns(
          s?.strategy?.strategy_analytics?.daily_returns,
        );
        if (dr.length > 0) {
          weights.push(s?.current_weight ?? 0);
        }
      }
    }

    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const normWeights =
      totalWeight > 0
        ? weights.map((w) => w / totalWeight)
        : weights.map(() => 1 / weights.length);

    for (const d of dates) {
      const vals: number[] = [];
      for (const m of strategyDateMaps) {
        const v = m.get(d);
        if (v !== undefined) vals.push(v);
        else vals.push(0);
      }

      // Check all strategies have data for this date
      const available = strategyDateMaps.filter((m) => m.has(d)).length;
      if (available < strategyDateMaps.length) continue;

      // Weighted portfolio return
      let portRet = 0;
      for (let i = 0; i < vals.length; i++) {
        portRet += vals[i] * normWeights[i];
      }
      portfolioReturns.push(portRet);

      // Equal-weight benchmark
      benchmarkReturns.push(mean(vals));
    }

    if (portfolioReturns.length < 10) {
      return { te: 0, interpretation: teInterpretation(0) };
    }

    const teVal = computeTrackingError(portfolioReturns, benchmarkReturns);
    return { te: teVal, interpretation: teInterpretation(teVal) };
  }, [data]);

  if (te === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm"
        style={{ color: "#718096" }}
      >
        Insufficient data for tracking error (need 2+ strategies)
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3"
      data-testid="tracking-error"
    >
      {/* Large number */}
      <div className="text-center">
        <div
          className="font-metric text-3xl tabular-nums"
          style={{ color: interpretation.color }}
        >
          {formatPercent(te)}
        </div>
        <div
          className="mt-1 font-sans text-xs font-semibold uppercase tracking-wider"
          style={{ color: "#718096" }}
        >
          Annualized Tracking Error
        </div>
      </div>

      {/* Interpretation badge */}
      <div
        className="rounded-full px-3 py-1 font-sans text-[11px] font-semibold"
        style={{
          color: interpretation.color,
          backgroundColor: `${interpretation.color}14`,
        }}
      >
        {interpretation.label} deviation from benchmark
      </div>

      {/* Note */}
      <div
        className="text-center font-sans text-[10px] leading-relaxed"
        style={{ color: "#718096" }}
      >
        vs. equal-weight benchmark
        <br />
        (average of all strategy returns)
      </div>
    </div>
  );
}
