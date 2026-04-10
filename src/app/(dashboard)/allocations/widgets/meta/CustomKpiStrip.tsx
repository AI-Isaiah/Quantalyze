"use client";

import type { WidgetProps } from "../../lib/types";
import { formatPercent, formatNumber } from "@/lib/utils";

interface KpiDef {
  label: string;
  key: string;
  format: (v: number | null | undefined) => string;
}

const KPI_DEFS: KpiDef[] = [
  { label: "TWR", key: "twr", format: formatPercent },
  { label: "Sharpe", key: "sharpe", format: (v) => formatNumber(v) },
  { label: "Max DD", key: "max_drawdown", format: formatPercent },
  { label: "CAGR", key: "cagr", format: formatPercent },
];

function resolve(data: Record<string, unknown>, key: string): number | null {
  // Check analytics first, then metrics
  const analytics = data?.analytics as Record<string, unknown> | undefined;
  const metrics = data?.metrics as Record<string, unknown> | undefined;
  const val = analytics?.[key] ?? metrics?.[key] ?? null;
  return typeof val === "number" ? val : null;
}

export function CustomKpiStrip({ data }: WidgetProps) {
  return (
    <div className="flex h-full items-center justify-around gap-2">
      {KPI_DEFS.map((kpi) => {
        const raw = resolve(data ?? {}, kpi.key);
        return (
          <div key={kpi.key} className="flex flex-col items-center px-3 py-1">
            <span
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: "#718096" }}
            >
              {kpi.label}
            </span>
            <span
              className="font-mono text-sm tabular-nums font-medium"
              style={{
                color:
                  raw == null
                    ? "#718096"
                    : raw > 0
                      ? "#16A34A"
                      : raw < 0
                        ? "#DC2626"
                        : "#1A1A2E",
              }}
            >
              {kpi.format(raw)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
