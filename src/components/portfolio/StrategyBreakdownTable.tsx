"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { formatPercent, formatNumber, metricColor, extractAnalytics } from "@/lib/utils";
import { isRankableAnalyticsRow } from "@/lib/closed-sets";
import { SyncBadge } from "@/components/strategy/SyncBadge";
import type { StrategyAnalytics, AttributionRow } from "@/lib/types";

type SortKey = "name" | "weight" | "twr" | "sharpe" | "max_dd" | "contribution";
type SortDir = "asc" | "desc";

interface StrategyRow {
  strategy_id: string;
  name: string;
  weight: number | null;
  twr: number | null;
  sharpe: number | null;
  max_dd: number | null;
  contribution: number | null;
  /**
   * The constituent's own analytics computed_at — drives the per-row freshness
   * badge so a mixed-freshness portfolio cannot present stale per-strategy
   * metrics as current (B14). `null` when the join carried no analytics.
   */
  computedAt: string | null;
}

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Strategy" },
  { key: "weight", label: "Weight %", align: "right" },
  { key: "twr", label: "TWR %", align: "right" },
  { key: "sharpe", label: "Sharpe", align: "right" },
  { key: "max_dd", label: "Max DD %", align: "right" },
  { key: "contribution", label: "Contribution %", align: "right" },
];

interface StrategyBreakdownTableProps {
  strategies: Array<{
    strategy_id: string;
    current_weight: number | null;
    strategies: {
      id: string;
      name: string;
      strategy_analytics: unknown;
    } | null;
  }>;
  attribution: AttributionRow[] | null;
  portfolioId: string;
}

function getSortValue(row: StrategyRow, key: SortKey): number | string {
  switch (key) {
    case "name":
      return row.name;
    case "weight":
      return row.weight ?? 0;
    case "twr":
      return row.twr ?? 0;
    case "sharpe":
      return row.sharpe ?? 0;
    case "max_dd":
      return row.max_dd ?? 0;
    case "contribution":
      return row.contribution ?? 0;
  }
}

export function StrategyBreakdownTable({ strategies, attribution, portfolioId }: StrategyBreakdownTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("weight");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const rows: StrategyRow[] = useMemo(() => {
    return strategies.map((ps) => {
      const s = ps.strategies;
      const rawAnalytics = s
        ? (extractAnalytics(s.strategy_analytics) as StrategyAnalytics | null)
        : null;
      // STALE-01 — the constituents of an allocator's portfolio are OTHER
      // managers' published strategies, so this table is a cross-tenant read of
      // exactly the rows the prod census found dead: 17 of 18 published
      // strategies at `computation_status = 'failed'`, still holding cagr /
      // sharpe / max_drawdown and a non-null `computed_at`.
      //
      // `getPortfolioStrategies` has ALWAYS projected `computation_status`
      // (queries.ts) — this component simply never read it. That is the shape
      // of the whole defect class: the column is selected and then not filtered.
      //
      // Gating here nulls the three metric cells (their `formatPercent` /
      // `formatNumber` already render the em-dash) AND the per-row `computedAt`,
      // which is what silences SyncBadge — it early-returns on a falsy
      // timestamp, so no separate render gate is needed. That badge is the
      // sharper half: B14 added it so a mixed-freshness portfolio could not
      // present stale per-strategy metrics as current, but `computed_at` on a
      // failed row is re-stamped to the FAILURE time by the SQL status bridge,
      // so it was reading "just synced" at the moment the sync failed.
      //
      // Weight and contribution survive: neither comes from the strategy's own
      // analytics job (weight is the portfolio's, contribution is the persisted
      // portfolio-level attribution).
      const analytics = isRankableAnalyticsRow(rawAnalytics)
        ? rawAnalytics
        : null;
      const attr = attribution?.find((a) => a.strategy_id === ps.strategy_id);

      // The persisted attribution payload contains contribution + allocation_effect
      // (see analytics-service/services/portfolio_risk.py::compute_attribution).
      // Weight and TWR come from the joined portfolio_strategies row and the
      // strategy's own analytics, not from attribution.
      return {
        strategy_id: ps.strategy_id,
        name: s?.name ?? "Unknown",
        weight: ps.current_weight ?? null,
        twr: analytics?.cagr ?? null,
        sharpe: analytics?.sharpe ?? null,
        max_dd: analytics?.max_drawdown ?? null,
        contribution: attr?.contribution ?? null,
        // extractAnalytics casts the row without validating, so computed_at may
        // be absent/empty (or analytics itself null). `|| null` collapses all of
        // those to null so SyncBadge (which renders nothing for a falsy
        // computedAt) makes no freshness claim. The `|| null` is load-bearing —
        // do not drop it on the assumption computed_at is always present.
        computedAt: analytics?.computed_at || null,
      };
    });
  }, [strategies, attribution]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, sortKey, sortDir]);

  if (sorted.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-small">
        No strategies in this portfolio.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-small">
        <thead>
          <tr className="border-b border-border">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`px-4 py-3 font-medium text-text-muted cursor-pointer hover:text-text-primary transition-colors select-none ${col.align === "right" ? "text-right" : "text-left"}`}
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="ml-1">{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.strategy_id}
              className="border-b border-border last:border-0 hover:bg-page/50 transition-colors"
            >
              <td className="px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <Link
                    href={`/portfolios/${portfolioId}/strategies/${row.strategy_id}`}
                    className="font-medium text-text-primary hover:text-accent transition-colors"
                  >
                    {row.name}
                  </Link>
                  {/* B14: per-constituent freshness so a stale strategy's
                      Sharpe/MaxDD isn't read as current. Renders nothing when
                      the row carries no computed_at. */}
                  <SyncBadge computedAt={row.computedAt} />
                </div>
              </td>
              <td className="px-4 py-3 text-right font-metric text-text-secondary">
                {row.weight != null ? formatPercent(row.weight) : "\u2014"}
              </td>
              <td className={`px-4 py-3 text-right font-metric ${metricColor(row.twr)}`}>
                {formatPercent(row.twr)}
              </td>
              <td className={`px-4 py-3 text-right font-metric ${metricColor(row.sharpe)}`}>
                {formatNumber(row.sharpe)}
              </td>
              <td className="px-4 py-3 text-right font-metric text-negative">
                {formatPercent(row.max_dd)}
              </td>
              <td className={`px-4 py-3 text-right font-metric ${metricColor(row.contribution)}`}>
                {row.contribution != null ? formatPercent(row.contribution) : "\u2014"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
