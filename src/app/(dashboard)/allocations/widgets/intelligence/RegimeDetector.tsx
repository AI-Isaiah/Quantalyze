"use client";

import { useMemo } from "react";
import type { WidgetProps } from "../../lib/types";
import { detectRegimeChanges } from "@/lib/portfolio-stats";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";

interface StrategyRow {
  strategy: {
    strategy_analytics: {
      daily_returns: unknown;
    } | null;
  };
}

const REGIME_CONFIG = {
  bullish: { label: "Bull Market", color: "#16A34A", bg: "rgba(22,163,74,0.08)" },
  bearish: { label: "Bear Market", color: "#DC2626", bg: "rgba(220,38,38,0.08)" },
  neutral: { label: "Range-bound", color: "#D97706", bg: "rgba(217,119,6,0.08)" },
} as const;

function daysBetween(a: string, b: string): number {
  return Math.floor(
    (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000,
  );
}

export function RegimeDetector({ data }: WidgetProps) {
  const regime = useMemo(() => {
    const strategies: StrategyRow[] = data?.strategies ?? [];

    // Build composite daily returns from all strategies
    const allReturnsMap = new Map<string, { sum: number; count: number }>();
    for (const row of strategies) {
      const dr = normalizeDailyReturns(
        row.strategy?.strategy_analytics?.daily_returns,
      );
      for (const point of dr) {
        const existing = allReturnsMap.get(point.date);
        if (existing) {
          existing.sum += point.value;
          existing.count += 1;
        } else {
          allReturnsMap.set(point.date, { sum: point.value, count: 1 });
        }
      }
    }

    const composite = Array.from(allReturnsMap.entries())
      .map(([date, { sum, count }]) => ({ date, value: sum / count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (composite.length < 200) return null;

    const crossovers = detectRegimeChanges(composite);

    if (crossovers.length === 0) {
      // No crossovers: determine direction from MA relationship
      return {
        direction: "neutral" as const,
        startDate: composite[199].date,
        endDate: composite[composite.length - 1].date,
      };
    }

    const last = crossovers[crossovers.length - 1];
    return {
      direction: last.direction,
      startDate: last.date,
      endDate: composite[composite.length - 1].date,
    };
  }, [data?.strategies]);

  if (!regime) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm" style={{ color: "#718096" }}>
          Insufficient data for regime detection (need 200+ days)
        </span>
      </div>
    );
  }

  const cfg =
    regime.direction === "bullish"
      ? REGIME_CONFIG.bullish
      : regime.direction === "bearish"
        ? REGIME_CONFIG.bearish
        : REGIME_CONFIG.neutral;

  const duration = daysBetween(regime.startDate, regime.endDate);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div
        className="rounded-lg px-6 py-3 text-center"
        style={{ backgroundColor: cfg.bg }}
      >
        <span
          className="text-xl font-semibold"
          style={{ color: cfg.color }}
        >
          {cfg.label}
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs" style={{ color: "#718096" }}>
        <span>
          Since{" "}
          <span className="font-mono tabular-nums">
            {new Date(regime.startDate + "T00:00:00Z").toLocaleDateString(
              "en-US",
              { month: "short", day: "numeric", year: "numeric" },
            )}
          </span>
        </span>
        <span className="text-[#E2E8F0]">|</span>
        <span>
          <span className="font-mono tabular-nums">{duration}</span> days
        </span>
      </div>
    </div>
  );
}
