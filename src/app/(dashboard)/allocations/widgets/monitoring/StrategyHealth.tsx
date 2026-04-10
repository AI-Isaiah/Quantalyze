"use client";

import type { WidgetProps } from "../../lib/types";

interface StrategyRow {
  strategy_id: string;
  strategy: {
    name: string;
    codename: string | null;
    strategy_analytics: {
      computed_at?: string | null;
      cagr?: number | null;
      sharpe?: number | null;
    } | null;
  };
}

function computeHealth(analytics: StrategyRow["strategy"]["strategy_analytics"]): {
  score: number;
  color: string;
  label: string;
} {
  if (!analytics) {
    return { score: 0, color: "#DC2626", label: "No data" };
  }

  const hasMetrics = analytics.cagr != null || analytics.sharpe != null;
  if (!hasMetrics) {
    return { score: 0, color: "#DC2626", label: "No data" };
  }

  // Check freshness via computed_at
  if (analytics.computed_at) {
    const age = Date.now() - new Date(analytics.computed_at).getTime();
    const oneDay = 86_400_000;
    if (age > 7 * oneDay) {
      return { score: 50, color: "#D97706", label: "Stale" };
    }
  }

  return { score: 80, color: "#16A34A", label: "Healthy" };
}

export function StrategyHealth({ data }: WidgetProps) {
  const strategies: StrategyRow[] = data?.strategies ?? [];

  if (strategies.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm" style={{ color: "#718096" }}>
          No strategies to monitor
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {strategies.map((row) => {
        const health = computeHealth(row.strategy.strategy_analytics);
        const name = row.strategy.codename ?? row.strategy.name;
        return (
          <div key={row.strategy_id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span
                className="text-sm truncate flex-1"
                style={{ color: "#1A1A2E" }}
              >
                {name}
              </span>
              <span
                className="text-xs font-medium ml-2"
                style={{ color: health.color }}
              >
                {health.label}
              </span>
            </div>
            <div
              className="h-1.5 w-full rounded-full overflow-hidden"
              style={{ backgroundColor: "#E2E8F0" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${health.score}%`,
                  backgroundColor: health.color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
