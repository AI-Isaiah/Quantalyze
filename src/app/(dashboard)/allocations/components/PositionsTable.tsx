"use client";

import { useMemo } from "react";
import { formatPercent, formatNumber, formatCurrency } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Bloomberg-style dense Positions & Exposures table.
// No TanStack Table here — simpler, denser, with a fixed Total row.
// ---------------------------------------------------------------------------

interface PositionRow {
  name: string;
  allocated: number | null;
  cagr: number | null;
  sharpe: number | null;
  maxDd: number | null;
  sortino: number | null;
  vol: number | null;
  winRate: number | null;
  calmar: number | null;
}

interface TotalRow {
  allocated: number;
  cagr: number | null;
  sharpe: number | null;
  maxDd: number | null;
  sortino: number | null;
  vol: number | null;
  winRate: number | null;
  calmar: number | null;
}

interface PositionsTableProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strategies: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metrics: any;
}

function fmtPct(v: number | null): string {
  if (v == null) return "--";
  return formatPercent(v);
}

function fmtRatio(v: number | null): string {
  if (v == null) return "--";
  return formatNumber(v);
}

function fmtUsd(v: number | null): string {
  if (v == null) return "--";
  return formatCurrency(v);
}

function valueColor(v: number | null | undefined): string {
  if (v == null) return "#718096";
  if (v > 0) return "#16A34A";
  if (v < 0) return "#DC2626";
  return "#1A1A2E";
}

function ddColor(v: number | null | undefined): string {
  if (v == null) return "#718096";
  return "#DC2626";
}

const COLUMNS = [
  { key: "name", label: "STRATEGY", align: "left" as const },
  { key: "allocated", label: "ALLOCATED", align: "right" as const },
  { key: "cagr", label: "CAGR", align: "right" as const },
  { key: "sharpe", label: "SHARPE", align: "right" as const },
  { key: "maxDd", label: "MAX DD", align: "right" as const },
  { key: "sortino", label: "SORTINO", align: "right" as const },
  { key: "vol", label: "VOL", align: "right" as const },
  { key: "winRate", label: "WIN RATE", align: "right" as const },
  { key: "calmar", label: "CALMAR", align: "right" as const },
] as const;

export function BloombergPositionsTable({ strategies, metrics }: PositionsTableProps) {
  const { rows, total } = useMemo(() => {
    if (!strategies?.length) return { rows: [] as PositionRow[], total: null as TotalRow | null };

    const strats = strategies as Array<{
      strategy_id: string;
      current_weight?: number | null;
      weight?: number;
      allocated_amount?: number | null;
      alias?: string | null;
      strategy: {
        name: string;
        codename?: string | null;
        disclosure_tier: string;
        strategy_analytics?: {
          cagr?: number | null;
          sharpe?: number | null;
          volatility?: number | null;
          max_drawdown?: number | null;
          sortino?: number | null;
          calmar?: number | null;
          win_rate?: number | null;
        } | null;
      };
    }>;

    const posRows: PositionRow[] = strats.map((row) => {
      const a = row.strategy.strategy_analytics;
      const name =
        (row.alias && row.alias.trim()) ||
        (row.strategy.disclosure_tier === "exploratory" && row.strategy.codename) ||
        row.strategy.name;
      return {
        name,
        allocated: row.allocated_amount ?? null,
        cagr: a?.cagr ?? null,
        sharpe: a?.sharpe ?? null,
        maxDd: a?.max_drawdown ?? null,
        sortino: a?.sortino ?? null,
        vol: a?.volatility ?? null,
        winRate: a?.win_rate ?? null,
        calmar: a?.calmar ?? null,
      };
    });

    const totalAllocated = posRows.reduce((s, r) => s + (r.allocated ?? 0), 0);

    const totalRow: TotalRow = {
      allocated: totalAllocated,
      cagr: metrics?.cagr ?? null,
      sharpe: metrics?.sharpe ?? null,
      maxDd: metrics?.max_drawdown ?? null,
      sortino: metrics?.sortino ?? null,
      vol: metrics?.volatility ?? null,
      winRate: null,
      calmar:
        metrics?.cagr != null && metrics?.max_drawdown != null && metrics.max_drawdown !== 0
          ? Math.abs(metrics.cagr / metrics.max_drawdown)
          : null,
    };

    return { rows: posRows, total: totalRow };
  }, [strategies, metrics]);

  if (rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center py-8 text-sm"
        style={{ color: "#718096" }}
      >
        No positions data available
      </div>
    );
  }

  return (
    <section>
      <h2
        className="text-base font-semibold mb-3"
        style={{ color: "#1A1A2E" }}
      >
        Positions & Exposures
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#E2E8F0]">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap"
                  style={{
                    color: "#718096",
                    textAlign: col.align,
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-[#E2E8F0] last:border-b-0 transition-colors hover:bg-[#F8F9FA]"
                style={{ height: 44 }}
              >
                <td className="px-3 py-2 text-sm text-left" style={{ color: "#1A1A2E" }}>
                  <span className="truncate block max-w-[180px]">{row.name}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm" style={{ color: "#1A1A2E" }}>
                    {fmtUsd(row.allocated)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm" style={{ color: valueColor(row.cagr) }}>
                    {fmtPct(row.cagr)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm" style={{ color: "#1A1A2E" }}>
                    {fmtRatio(row.sharpe)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm" style={{ color: ddColor(row.maxDd) }}>
                    {fmtPct(row.maxDd)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm" style={{ color: "#1A1A2E" }}>
                    {fmtRatio(row.sortino)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm" style={{ color: "#1A1A2E" }}>
                    {fmtPct(row.vol)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm" style={{ color: "#1A1A2E" }}>
                    {fmtPct(row.winRate)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm" style={{ color: "#1A1A2E" }}>
                    {fmtRatio(row.calmar)}
                  </span>
                </td>
              </tr>
            ))}

            {/* Total row */}
            {total && (
              <tr
                className="border-t-2 border-[#E2E8F0] bg-[#F8F9FA]"
                style={{ height: 44 }}
              >
                <td className="px-3 py-2 text-sm text-left font-semibold" style={{ color: "#1A1A2E" }}>
                  Total
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                    {fmtUsd(total.allocated)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm font-semibold" style={{ color: valueColor(total.cagr) }}>
                    {fmtPct(total.cagr)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                    {fmtRatio(total.sharpe)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm font-semibold" style={{ color: ddColor(total.maxDd) }}>
                    {fmtPct(total.maxDd)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                    {fmtRatio(total.sortino)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                    {fmtPct(total.vol)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                    {fmtPct(total.winRate)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="font-metric tabular-nums text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                    {fmtRatio(total.calmar)}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
