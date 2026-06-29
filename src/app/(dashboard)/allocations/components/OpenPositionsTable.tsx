"use client";

/**
 * OpenPositionsTable — derivative-positions surface, sibling to HoldingsTable.
 *
 * Splits derivative rows out of the Holdings tile so the user sees:
 *
 *   1. Holdings  — spot rows only. `value_usd` is the marked value owned,
 *      i.e. the contribution to equity. Weight denominator is the spot sum.
 *   2. Open Positions — derivative rows. Surfaces side, notional size
 *      (`value_usd` from CCXT size_usd), entry, mark, and unrealized P&L.
 *      Footer reminds the reader that ONLY `unrealized_pnl_usd` rolls into
 *      the equity curve — notional is exposure, not equity.
 *
 * Same surface tokens as HoldingsTable's legacy mode: `border-border`,
 * `bg-surface`, `font-metric tabular-nums`, amber chip for revoked-key
 * rows. Sortable headers + bridge banner are not in scope for this surface
 * — Open Positions is read-only context, not an allocation-decision tile.
 */

import { type CSSProperties } from "react";
import { ResponsiveTable } from "@/components/ResponsiveTable";

const AMBER_CHIP_STYLE: CSSProperties = {
  color: "var(--color-warning)",
  backgroundColor: "var(--color-warning-bg)",
  border: "1px solid var(--color-warning-border)",
};

export interface OpenPositionRow {
  id: string;
  venue: string;
  symbol: string;
  side: "long" | "short" | "flat";
  quantity: number;
  /** Notional (= CCXT size_usd). NOT the equity contribution. */
  notional_usd: number;
  entry_price: number | null;
  mark_price: number | null;
  /** The actual equity contribution for this row. */
  unrealized_pnl_usd: number | null;
  api_key_id: string;
  /** Joined from `api_keys.sync_status` by the dashboard layer. */
  source_key_sync_status: string;
}

interface OpenPositionsTableProps {
  rows: OpenPositionRow[];
}

function venueLabel(v: string): string {
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function formatQuantity(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const digits = abs < 1 ? 4 : 2;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatUsd(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatPnl(n: number | null): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function sideLabel(side: OpenPositionRow["side"]): string {
  if (side === "long") return "Long";
  if (side === "short") return "Short";
  return "—";
}

function sideColor(side: OpenPositionRow["side"]): string {
  if (side === "long") return "var(--color-positive)";
  if (side === "short") return "var(--color-negative)";
  return "var(--color-text-muted)";
}

function pnlColor(pnl: number | null): string | undefined {
  if (pnl == null) return undefined;
  if (pnl > 0) return "var(--color-positive)";
  if (pnl < 0) return "var(--color-negative)";
  return undefined;
}

export function OpenPositionsTable({ rows }: OpenPositionsTableProps) {
  const totalUnrealized = rows.reduce(
    (sum, r) => sum + (Number.isFinite(r.unrealized_pnl_usd ?? NaN) ? (r.unrealized_pnl_usd as number) : 0),
    0,
  );

  return (
    <section className="mt-6 rounded-sm border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Open Positions
        </h3>
        <span className="text-xs text-text-muted">
          Derivative positions — only unrealized P&amp;L contributes to equity
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-text-muted">
          No open derivative positions.
        </p>
      ) : (
        <ResponsiveTable label="Open positions">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-micro uppercase tracking-wider text-text-muted">
              <th className="px-4 py-2 font-semibold">Venue / Symbol</th>
              <th className="px-4 py-2 font-semibold">Side</th>
              <th className="px-4 py-2 text-right font-semibold">Quantity</th>
              <th className="px-4 py-2 text-right font-semibold">Entry</th>
              <th className="px-4 py-2 text-right font-semibold">Mark</th>
              <th className="px-4 py-2 text-right font-semibold">
                Exposure (notional)
              </th>
              <th className="px-4 py-2 text-right font-semibold">
                Unrealized P&amp;L
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isRevoked = r.source_key_sync_status === "revoked";
              const numericCell = isRevoked
                ? "px-4 py-2 font-metric tabular-nums text-right line-through text-text-muted"
                : "px-4 py-2 font-metric tabular-nums text-right text-text-primary";
              return (
                <tr
                  key={r.id}
                  className="border-b border-border transition-colors last:border-b-0 hover:bg-page/50"
                  style={{ minHeight: 44 }}
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-primary">
                        {venueLabel(r.venue)} · {r.symbol}
                      </span>
                      {isRevoked ? (
                        <span
                          className="inline-flex items-center rounded px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider"
                          style={AMBER_CHIP_STYLE}
                        >
                          Key revoked
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: sideColor(r.side) }}
                  >
                    {sideLabel(r.side)}
                  </td>
                  <td className={numericCell}>{formatQuantity(r.quantity)}</td>
                  <td className={numericCell}>{formatUsd(r.entry_price)}</td>
                  <td className={numericCell}>{formatUsd(r.mark_price)}</td>
                  <td
                    className={
                      isRevoked
                        ? "px-4 py-2 font-metric tabular-nums text-right line-through text-text-muted"
                        : "px-4 py-2 font-metric tabular-nums text-right text-text-secondary"
                    }
                    title="Notional exposure. NOT counted in total equity — only unrealized P&L is."
                  >
                    {formatUsd(r.notional_usd)}
                  </td>
                  <td
                    className={numericCell}
                    style={{ color: pnlColor(r.unrealized_pnl_usd) }}
                  >
                    {formatPnl(r.unrealized_pnl_usd)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-page/40">
              <td
                className="px-4 py-2 text-xs uppercase tracking-wider text-text-muted"
                colSpan={6}
              >
                Total unrealized P&amp;L (equity contribution)
              </td>
              <td
                className="px-4 py-2 font-metric tabular-nums text-right text-sm font-semibold"
                style={{ color: pnlColor(totalUnrealized) }}
              >
                {formatPnl(totalUnrealized)}
              </td>
            </tr>
          </tfoot>
        </table>
        </ResponsiveTable>
      )}
    </section>
  );
}
