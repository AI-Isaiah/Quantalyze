"use client";

import type { WidgetProps } from "../../lib/types";

interface DataSource {
  label: string;
  key: string;
}

const DATA_SOURCES: DataSource[] = [
  { label: "Analytics", key: "analytics" },
  { label: "Trades", key: "trades" },
  { label: "Prices", key: "prices" },
  { label: "Correlations", key: "correlations" },
  { label: "Risk", key: "risk" },
];

function hasData(data: Record<string, unknown>, key: string): boolean {
  // Check common payload shapes
  if (key === "analytics") return data?.analytics != null;
  if (key === "trades") return Array.isArray(data?.trades) && data.trades.length > 0;
  if (key === "prices") return data?.prices != null;
  if (key === "correlations") return data?.correlations != null;
  if (key === "risk") return data?.analytics != null; // risk derived from analytics
  return false;
}

export function DataFreshness({ data }: WidgetProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {DATA_SOURCES.map((source) => {
        const available = hasData(data ?? {}, source.key);
        return (
          <div
            key={source.key}
            className="flex items-center gap-2 rounded px-2.5 py-2"
            style={{
              border: "1px solid #E2E8F0",
            }}
          >
            <span
              className="inline-block h-2 w-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: available ? "#16A34A" : "#DC2626" }}
              aria-hidden="true"
            />
            <div className="flex flex-col min-w-0">
              <span
                className="text-xs font-medium truncate"
                style={{ color: "#1A1A2E" }}
              >
                {source.label}
              </span>
              <span
                className="text-[10px]"
                style={{ color: available ? "#16A34A" : "#DC2626" }}
              >
                {available ? "Available" : "No data"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
