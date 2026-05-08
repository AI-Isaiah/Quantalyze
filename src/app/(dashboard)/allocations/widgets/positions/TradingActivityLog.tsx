"use client";

import { useState, useEffect } from "react";
import type { WidgetProps } from "../../lib/types";
import type { DailyPnlRow } from "@/lib/types";

export default function TradingActivityLog({ data }: WidgetProps) {
  const portfolioId: string | undefined = data?.portfolio?.id;
  const [activity, setActivity] = useState<DailyPnlRow[]>([]);
  const [hasFills, setHasFills] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!portfolioId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/activity/portfolio?portfolio_id=${portfolioId}`,
        );
        if (!res.ok) throw new Error(`fetch failed (${res.status})`);
        const json = await res.json();
        if (!cancelled) {
          setActivity(json.activity ?? []);
          setHasFills(json.has_fills === true);
          setError(null);
        }
      } catch (err) {
        // audit-2026-05-07 G12.G.2: previously "silent — empty state is
        // fine" was wrong. The empty state ("No trading activity yet.")
        // is indistinguishable from a 5xx, RLS rejection, or fetch abort,
        // so allocators saw the misleading "no trades" message even when
        // they had a populated book and the API was failing.
        console.error(
          "[TradingActivityLog] portfolio activity fetch failed:",
          err,
        );
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load trading activity.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portfolioId]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs" style={{ color: "#64748B" }}>
        Loading activity...
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center px-4 text-center text-sm"
        style={{ color: "#991B1B" }}
      >
        <span>Couldn&apos;t load trading activity.</span>
        <span className="text-xs" style={{ color: "#64748B" }}>
          Try refreshing. ({error})
        </span>
      </div>
    );
  }

  if (activity.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: "#64748B" }}>
        No trading activity yet.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "#E2E8F0" }}>
              {["Date", "Strategy", "Symbol", "PnL (USD)", "Exchange"].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider"
                  style={{ color: "#64748B" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activity.map((row, i) => (
              <tr
                key={`${row.date}-${row.strategy_id}-${row.symbol}-${i}`}
                className="border-b last:border-b-0 transition-colors"
                style={{ borderColor: "#E2E8F0", height: 44 }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "#F8F9FA";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "";
                }}
              >
                <td className="px-3 py-2 font-metric tabular-nums text-xs" style={{ color: "#1A1A2E" }}>
                  {row.date}
                </td>
                <td className="px-3 py-2 text-xs truncate max-w-[140px]" style={{ color: "#4A5568" }}>
                  {row.strategy_name}
                </td>
                <td className="px-3 py-2 font-metric text-xs" style={{ color: "#1A1A2E" }}>
                  {row.symbol}
                </td>
                <td
                  className="px-3 py-2 font-metric tabular-nums text-xs"
                  style={{ color: row.pnl_usd >= 0 ? "#15803D" : "#DC2626" }}
                >
                  {row.pnl_usd >= 0 ? "+" : ""}
                  {row.pnl_usd.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>
                <td className="px-3 py-2 text-xs" style={{ color: "#64748B" }}>
                  {row.exchange}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!hasFills && (
        <p className="px-3 py-2 text-xs" style={{ color: "#64748B", fontSize: 12 }}>
          Daily P&amp;L aggregated from exchange account history. Trade-level granularity coming in a future sprint.
        </p>
      )}
    </div>
  );
}
