"use client";

import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildCompositeReturns } from "../lib/composite-returns";
import { computeMonthlyReturns } from "@/lib/portfolio-stats";
import { useMemo } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function cellColor(value: number): string {
  if (value > 0) {
    const intensity = Math.min(value / 0.1, 1); // 10% = max green
    const r = Math.round(255 - intensity * (255 - 22));
    const g = Math.round(255 - intensity * (255 - 163));
    const b = Math.round(255 - intensity * (255 - 74));
    return `rgb(${r},${g},${b})`;
  }
  if (value < 0) {
    const intensity = Math.min(Math.abs(value) / 0.1, 1); // -10% = max red
    const r = Math.round(255 - intensity * (255 - 220));
    const g = Math.round(255 - intensity * (255 - 38));
    const b = Math.round(255 - intensity * (255 - 38));
    return `rgb(${r},${g},${b})`;
  }
  return "transparent";
}

function textColorForBg(value: number): string {
  const absVal = Math.abs(value);
  return absVal > 0.04 ? "#FFFFFF" : "#1A1A2E";
}

export default function MonthlyReturns({ data }: WidgetProps) {
  const { years, grid } = useMemo(() => {
    const compositeDaily: DailyPoint[] = data?.compositeReturns ?? buildCompositeReturns(data?.strategies ?? []);
    if (compositeDaily.length === 0) return { years: [] as string[], grid: new Map<string, Map<number, number>>() };

    const monthly = computeMonthlyReturns(compositeDaily);

    // Build grid: year -> month -> value
    const yearMonthGrid = new Map<string, Map<number, number>>();
    for (const m of monthly) {
      const year = m.date.slice(0, 4);
      const month = parseInt(m.date.slice(5, 7), 10) - 1;
      if (!yearMonthGrid.has(year)) yearMonthGrid.set(year, new Map());
      yearMonthGrid.get(year)!.set(month, m.value);
    }

    const sortedYears = Array.from(yearMonthGrid.keys()).sort();
    return { years: sortedYears, grid: yearMonthGrid };
  }, [data]);

  if (years.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        No monthly return data available
      </div>
    );
  }

  return (
    <div className="overflow-auto h-full">
      <table className="w-full border-collapse text-xs" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
        <thead>
          <tr>
            <th className="sticky left-0 bg-surface px-2 py-1.5 text-left text-text-muted font-medium" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
              Year
            </th>
            {MONTHS.map((m) => (
              <th key={m} className="px-2 py-1.5 text-center text-text-muted font-medium" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {years.map((year) => {
            const row = grid.get(year)!;
            return (
              <tr key={year} className="border-t border-border">
                <td className="sticky left-0 bg-surface px-2 py-1.5 font-medium text-text-primary" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
                  {year}
                </td>
                {Array.from({ length: 12 }, (_, i) => {
                  const val = row.get(i);
                  if (val === undefined) {
                    return <td key={i} className="px-2 py-1.5 text-center text-text-muted">--</td>;
                  }
                  return (
                    <td
                      key={i}
                      className="px-2 py-1.5 text-center"
                      style={{
                        backgroundColor: cellColor(val),
                        color: textColorForBg(val),
                      }}
                    >
                      {(val * 100).toFixed(1)}%
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
