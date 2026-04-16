"use client";

import type { WidgetProps } from "../../lib/types";

interface AlertCount {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

const SEVERITY_CONFIG = {
  critical: { label: "Critical", dot: "#991B1B", bg: "rgba(153,27,27,0.10)" },
  high: { label: "High", dot: "#DC2626", bg: "rgba(220,38,38,0.08)" },
  medium: { label: "Medium", dot: "#D97706", bg: "rgba(217,119,6,0.08)" },
  low: { label: "Low", dot: "#94A3B8", bg: "rgba(148,163,184,0.08)" },
} as const;

export function PortfolioAlerts({ data }: WidgetProps) {
  const alertCount: AlertCount | null = data?.alertCount ?? null;

  if (!alertCount || alertCount.total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <span style={{ fontSize: 20 }}>&#9673;</span>
        <span className="text-sm" style={{ color: "#718096" }}>
          No active alerts
        </span>
      </div>
    );
  }

  const entries = (
    ["critical", "high", "medium", "low"] as const
  ).filter((sev) => alertCount[sev] > 0);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2 pb-1">
        <span style={{ fontSize: 16 }}>&#128276;</span>
        <span
          className="font-mono text-lg tabular-nums font-semibold"
          style={{ color: "#1A1A2E" }}
        >
          {alertCount.total}
        </span>
        <span className="text-xs" style={{ color: "#718096" }}>
          active {alertCount.total === 1 ? "alert" : "alerts"}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {entries.map((sev) => {
          const cfg = SEVERITY_CONFIG[sev];
          const count = alertCount[sev];
          return (
            <div
              key={sev}
              className="flex items-center gap-2 rounded px-2.5 py-1.5"
              style={{ backgroundColor: cfg.bg }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: cfg.dot }}
                aria-hidden="true"
              />
              <span className="text-sm font-medium" style={{ color: "#1A1A2E" }}>
                {count} {cfg.label.toLowerCase()}-severity{" "}
                {count === 1 ? "alert" : "alerts"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
