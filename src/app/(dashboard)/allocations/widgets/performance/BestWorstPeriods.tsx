"use client";

import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildCompositeReturns } from "../lib/composite-returns";
import { computeBestWorstPeriods, computeMonthlyReturns, computeAnnualReturns } from "@/lib/portfolio-stats";
import { compound } from "@/lib/portfolio-math-utils";
import { useMemo } from "react";

interface PeriodRow {
  label: string;
  best: number;
  worst: number;
  avg: number;
}

export default function BestWorstPeriods({ data }: WidgetProps) {
  const rows = useMemo((): PeriodRow[] => {
    const compositeDaily: DailyPoint[] = data?.compositeReturns ?? buildCompositeReturns(data?.strategies ?? []);
    if (compositeDaily.length === 0) return [];

    const bw = computeBestWorstPeriods(compositeDaily);
    const monthlyReturns = computeMonthlyReturns(compositeDaily);
    const annualReturns = computeAnnualReturns(compositeDaily);

    const avgDaily = compositeDaily.length > 0
      ? compound(compositeDaily.map((d) => d.value)) / compositeDaily.length
      : 0;
    const avgMonthly = monthlyReturns.length > 0
      ? monthlyReturns.reduce((s, m) => s + m.value, 0) / monthlyReturns.length
      : 0;
    const avgAnnual = annualReturns.length > 0
      ? annualReturns.reduce((s, a) => s + a.value, 0) / annualReturns.length
      : 0;

    return [
      { label: "Day", best: bw.day.best.value, worst: bw.day.worst.value, avg: avgDaily },
      { label: "Week", best: bw.week.best.value, worst: bw.week.worst.value, avg: 0 },
      { label: "Month", best: bw.month.best.value, worst: bw.month.worst.value, avg: avgMonthly },
      { label: "Quarter", best: bw.quarter.best.value, worst: bw.quarter.worst.value, avg: avgAnnual / 4 },
    ];
  }, [data]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        No period data available
      </div>
    );
  }

  const fmt = (v: number) => `${(v * 100).toFixed(2)}%`;
  const color = (v: number) => (v >= 0 ? "#16A34A" : "#DC2626");

  return (
    <div className="overflow-auto h-full">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-text-muted">
            <th className="px-3 py-2 text-left font-medium">Period</th>
            <th className="px-3 py-2 text-right font-medium">Best</th>
            <th className="px-3 py-2 text-right font-medium">Worst</th>
            <th className="px-3 py-2 text-right font-medium">Average</th>
          </tr>
        </thead>
        <tbody style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-border">
              <td className="px-3 py-2 font-medium text-text-primary" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
                {row.label}
              </td>
              <td className="px-3 py-2 text-right" style={{ color: color(row.best) }}>
                {fmt(row.best)}
              </td>
              <td className="px-3 py-2 text-right" style={{ color: color(row.worst) }}>
                {fmt(row.worst)}
              </td>
              <td className="px-3 py-2 text-right text-text-secondary">
                {fmt(row.avg)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
