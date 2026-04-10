"use client";

import { useMemo } from "react";
import type { WidgetProps } from "../../lib/types";
import { computeHerfindahlIndex } from "@/lib/portfolio-stats";

interface StrategyRow {
  current_weight: number | null;
  strategy: { name: string; codename: string | null };
}

function herfindahlColor(hhi: number): { color: string; label: string } {
  if (hhi < 0.15) return { color: "#16A34A", label: "Diversified" };
  if (hhi <= 0.25) return { color: "#D97706", label: "Moderate" };
  return { color: "#DC2626", label: "Concentrated" };
}

export function ConcentrationRisk({ data }: WidgetProps) {
  const result = useMemo(() => {
    const strategies: StrategyRow[] = data?.strategies ?? [];
    if (strategies.length === 0) return null;

    const weights = strategies.map((s) => s.current_weight ?? 0);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return null;

    // Normalize weights to sum to 1
    const normalized = weights.map((w) => w / totalWeight);
    const hhi = computeHerfindahlIndex(normalized);

    // Top 2 concentration
    const sorted = [...normalized].sort((a, b) => b - a);
    const top2Pct = ((sorted[0] ?? 0) + (sorted[1] ?? 0)) * 100;

    return { hhi, top2Pct };
  }, [data?.strategies]);

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm" style={{ color: "#718096" }}>
          No allocation data
        </span>
      </div>
    );
  }

  const { hhi, top2Pct } = result;
  const { color, label } = herfindahlColor(hhi);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="text-center">
        <span
          className="font-mono text-2xl tabular-nums font-semibold"
          style={{ color }}
        >
          {hhi.toFixed(3)}
        </span>
        <div className="mt-1">
          <span
            className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{ backgroundColor: `${color}14`, color }}
          >
            {label}
          </span>
        </div>
      </div>

      <span className="text-xs text-center" style={{ color: "#718096" }}>
        Top 2 strategies hold{" "}
        <span className="font-mono tabular-nums font-medium" style={{ color: "#1A1A2E" }}>
          {top2Pct.toFixed(1)}%
        </span>{" "}
        of AUM
      </span>
    </div>
  );
}
