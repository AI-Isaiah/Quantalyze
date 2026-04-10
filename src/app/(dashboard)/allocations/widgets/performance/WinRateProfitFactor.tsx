"use client";

import type { WidgetProps } from "../../lib/types";
import { normalizeDailyReturns, mean } from "@/lib/portfolio-math-utils";
import { computeWinRate } from "@/lib/portfolio-stats";
import { useMemo } from "react";

export default function WinRateProfitFactor({ data }: WidgetProps) {
  const metrics = useMemo(() => {
    if (!data?.strategies?.length) return null;

    const strats = data.strategies as Array<{
      strategy: { strategy_analytics: { daily_returns: unknown } };
      weight: number;
    }>;

    const dateMap = new Map<string, number>();
    let totalWeight = 0;
    for (const s of strats) {
      const dr = normalizeDailyReturns(s.strategy?.strategy_analytics?.daily_returns);
      const w = s.weight ?? 1;
      totalWeight += w;
      for (const d of dr) {
        dateMap.set(d.date, (dateMap.get(d.date) ?? 0) + d.value * w);
      }
    }
    if (totalWeight === 0) return null;

    const returns = Array.from(dateMap.values()).map((v) => v / totalWeight);
    if (returns.length === 0) return null;

    const wr = computeWinRate(returns);
    const wins = returns.filter((r) => r > 0);
    const losses = returns.filter((r) => r < 0);
    const avgWin = wins.length > 0 ? mean(wins) : 0;
    const avgLoss = losses.length > 0 ? mean(losses) : 0;
    // Expectancy = (winRate * avgWin) + ((1 - winRate) * avgLoss)
    const expectancy = wr.winRate * avgWin + (1 - wr.winRate) * avgLoss;

    return { ...wr, avgWin, avgLoss, expectancy };
  }, [data]);

  if (!metrics) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        No win rate data available
      </div>
    );
  }

  const pf = metrics.profitFactor === Infinity ? "---" : metrics.profitFactor.toFixed(2);

  return (
    <div className="flex h-full flex-col justify-center gap-4 px-4 py-3">
      {/* Win Rate */}
      <div>
        <p className="text-xs text-text-muted mb-1">Win Rate</p>
        <p
          className="text-2xl font-semibold text-text-primary"
          style={{ fontFamily: "var(--font-geist-mono), monospace" }}
        >
          {(metrics.winRate * 100).toFixed(1)}%
        </p>
        <div className="mt-1.5 h-2 w-full rounded-full bg-border">
          <div
            className="h-2 rounded-full transition-all"
            style={{
              width: `${(metrics.winRate * 100).toFixed(0)}%`,
              backgroundColor: "#1B6B5A",
            }}
          />
        </div>
      </div>

      {/* Profit Factor */}
      <div>
        <p className="text-xs text-text-muted mb-1">Profit Factor</p>
        <p
          className="text-2xl font-semibold text-text-primary"
          style={{ fontFamily: "var(--font-geist-mono), monospace" }}
        >
          {pf}
        </p>
      </div>

      {/* Sub-metrics */}
      <div className="grid grid-cols-3 gap-3 border-t border-border pt-3">
        <div>
          <p className="text-[11px] text-text-muted">Avg Win</p>
          <p
            className="text-sm"
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              color: "#16A34A",
            }}
          >
            {(metrics.avgWin * 100).toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-[11px] text-text-muted">Avg Loss</p>
          <p
            className="text-sm"
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              color: "#DC2626",
            }}
          >
            {(metrics.avgLoss * 100).toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-[11px] text-text-muted">Expectancy</p>
          <p
            className="text-sm"
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              color: metrics.expectancy >= 0 ? "#16A34A" : "#DC2626",
            }}
          >
            {(metrics.expectancy * 100).toFixed(3)}%
          </p>
        </div>
      </div>
    </div>
  );
}
