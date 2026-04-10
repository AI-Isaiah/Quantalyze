"use client";

import { useMemo } from "react";
import type { WidgetProps } from "../../lib/types";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import { compound } from "@/lib/portfolio-math-utils";
import { formatPercent, metricColor } from "@/lib/utils";
import { displayName } from "@/lib/allocation-helpers";

interface StrategyRow {
  strategy_id: string;
  current_weight: number | null;
  alias: string | null;
  strategy: {
    name: string;
    codename: string | null;
    disclosure_tier: string;
    strategy_analytics: {
      daily_returns: unknown;
    } | null;
  };
}

interface PeriodReturns {
  name: string;
  mtd: number | null;
  qtd: number | null;
  ytd: number | null;
  oneYear: number | null;
}

/**
 * Performance by Period — MTD/QTD/YTD/1Y returns per strategy.
 *
 * Computes compounded returns from daily returns for each period window.
 * The bottom row shows the portfolio total (equal-weighted composite).
 */
export default function PerformanceByPeriod({ data }: WidgetProps) {
  const { rows, portfolio } = useMemo<{ rows: PeriodReturns[]; portfolio: PeriodReturns }>(() => {
    const strategies = data?.strategies as StrategyRow[] | undefined;
    if (!strategies?.length) {
      return {
        rows: [],
        portfolio: { name: "Portfolio", mtd: null, qtd: null, ytd: null, oneYear: null },
      };
    }

    // Compute period boundaries based on current date
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const qStartMonth = Math.floor(month / 3) * 3;

    const mtdStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const qtdStart = `${year}-${String(qStartMonth + 1).padStart(2, "0")}-01`;
    const ytdStart = `${year}-01-01`;
    const oneYearAgo = new Date(Date.UTC(year - 1, month, now.getUTCDate()));
    const oneYearStart = oneYearAgo.toISOString().slice(0, 10);

    function periodReturn(
      dr: { date: string; value: number }[],
      start: string,
    ): number | null {
      const window = dr.filter((d) => d.date >= start);
      if (window.length === 0) return null;
      return compound(window.map((d) => d.value));
    }

    // Per-strategy returns
    const allDailyArrays: { date: string; value: number }[][] = [];

    const result: PeriodReturns[] = strategies.map((s) => {
      const dr = normalizeDailyReturns(s.strategy.strategy_analytics?.daily_returns);
      allDailyArrays.push(dr);
      return {
        name: displayName(s),
        mtd: periodReturn(dr, mtdStart),
        qtd: periodReturn(dr, qtdStart),
        ytd: periodReturn(dr, ytdStart),
        oneYear: periodReturn(dr, oneYearStart),
      };
    });

    // Portfolio composite (equal-weighted)
    // Pre-build Map<date, value> per strategy for O(1) lookup (was O(n^2) with .find())
    const dateMaps = allDailyArrays.map((arr) => {
      const m = new Map<string, number>();
      for (const d of arr) m.set(d.date, d.value);
      return m;
    });
    const allDates = new Set<string>();
    for (const arr of allDailyArrays) {
      for (const d of arr) allDates.add(d.date);
    }
    const datesSorted = Array.from(allDates).sort();

    // Build composite daily returns
    const compositeDr: { date: string; value: number }[] = [];
    for (const date of datesSorted) {
      let sum = 0;
      let count = 0;
      for (const m of dateMaps) {
        const val = m.get(date);
        if (val !== undefined) {
          sum += val;
          count++;
        }
      }
      if (count > 0) {
        compositeDr.push({ date, value: sum / count });
      }
    }

    const portfolioRow: PeriodReturns = {
      name: "Portfolio",
      mtd: periodReturn(compositeDr, mtdStart),
      qtd: periodReturn(compositeDr, qtdStart),
      ytd: periodReturn(compositeDr, ytdStart),
      oneYear: periodReturn(compositeDr, oneYearStart),
    };

    return { rows: result, portfolio: portfolioRow };
  }, [data]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        No daily return data available.
      </div>
    );
  }

  const periods: { key: keyof PeriodReturns; label: string }[] = [
    { key: "mtd", label: "MTD" },
    { key: "qtd", label: "QTD" },
    { key: "ytd", label: "YTD" },
    { key: "oneYear", label: "1Y" },
  ];

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm" data-testid="performance-by-period-table">
        <thead>
          <tr className="border-b border-[#E2E8F0]">
            <th className="py-2 pl-3 pr-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Strategy
            </th>
            {periods.map((p) => (
              <th
                key={p.key}
                className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-text-muted"
              >
                {p.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.name}
              className="border-b border-[#E2E8F0] hover:bg-[#F8F9FA] transition-colors"
            >
              <td className="py-2.5 pl-3 pr-2 text-text-primary font-medium truncate max-w-[160px]">
                {row.name}
              </td>
              {periods.map((p) => (
                <td
                  key={p.key}
                  className={`px-2 py-2.5 text-right font-metric tabular-nums ${metricColor(row[p.key] as number | null)}`}
                >
                  {formatPercent(row[p.key] as number | null)}
                </td>
              ))}
            </tr>
          ))}
          {/* Portfolio total row */}
          <tr className="border-t-2 border-[#E2E8F0] bg-[#F8F9FA] font-semibold">
            <td className="py-2.5 pl-3 pr-2 text-text-primary">
              {portfolio.name}
            </td>
            {periods.map((p) => (
              <td
                key={p.key}
                className={`px-2 py-2.5 text-right font-metric tabular-nums ${metricColor(portfolio[p.key] as number | null)}`}
              >
                {formatPercent(portfolio[p.key] as number | null)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
