"use client";

import { useMemo } from "react";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { pearson } from "@/lib/correlation-math";

interface CompareItem {
  strategy: Strategy;
  analytics: StrategyAnalytics;
}

const MIN_OVERLAP = 30;
const TRAILING_DAYS = 365;

function cellBg(val: number | null): string {
  if (val === null) return "transparent";
  if (val > 0.7) return "rgba(220,38,38,0.1)";
  if (val < 0.2) return "rgba(22,163,74,0.1)";
  return "transparent";
}

export function CompareCorrelationMatrix({ items }: { items: CompareItem[] }) {
  const matrix = useMemo(() => {
    // Extract trailing daily returns keyed by date for each strategy
    const series = items.map((item) => {
      const rs = item.analytics.returns_series;
      if (!rs || rs.length === 0) return new Map<string, number>();
      const tail = rs.slice(-TRAILING_DAYS);
      const m = new Map<string, number>();
      for (const p of tail) m.set(p.date, p.value);
      return m;
    });

    // Build NxN matrix
    const n = items.length;
    const result: (number | null)[][] = Array.from({ length: n }, () =>
      Array(n).fill(null) as (number | null)[],
    );

    for (let i = 0; i < n; i++) {
      result[i][i] = 1.0;
      for (let j = i + 1; j < n; j++) {
        // Find overlapping dates
        const datesA = series[i];
        const datesB = series[j];
        const common: string[] = [];
        for (const d of datesA.keys()) {
          if (datesB.has(d)) common.push(d);
        }

        if (common.length < MIN_OVERLAP) {
          result[i][j] = null;
          result[j][i] = null;
        } else {
          const a = common.map((d) => datesA.get(d)!);
          const b = common.map((d) => datesB.get(d)!);
          const corr = pearson(a, b);
          result[i][j] = corr;
          result[j][i] = corr;
        }
      }
    }

    return result;
  }, [items]);

  if (items.length < 2) {
    return (
      <div
        className="flex items-center justify-center py-8 text-sm"
        style={{ color: "#718096" }}
      >
        Select at least 2 strategies to see correlation.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: "#E2E8F0" }}>
            <th
              className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
              style={{ color: "#718096" }}
            />
            {items.map((item) => (
              <th
                key={item.strategy.id}
                className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider truncate max-w-[120px]"
                style={{ color: "#1A1A2E" }}
                title={item.strategy.name}
              >
                {item.strategy.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((rowItem, i) => (
            <tr
              key={rowItem.strategy.id}
              className="border-b last:border-b-0 transition-colors"
              style={{ borderColor: "#E2E8F0", height: 44 }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "#F8F9FA";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "";
              }}
            >
              <td
                className="px-3 py-2 text-xs font-medium truncate max-w-[120px]"
                style={{ color: "#1A1A2E" }}
                title={rowItem.strategy.name}
              >
                {rowItem.strategy.name}
              </td>
              {items.map((_, j) => {
                const val = matrix[i][j];
                const isDiag = i === j;

                return (
                  <td
                    key={items[j].strategy.id}
                    className="px-3 py-2 text-right font-metric tabular-nums text-xs"
                    style={{
                      color: isDiag ? "#718096" : "#1A1A2E",
                      backgroundColor: isDiag ? "transparent" : cellBg(val),
                    }}
                    title={
                      val === null
                        ? "Insufficient data"
                        : undefined
                    }
                  >
                    {val === null ? "—" : val.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
