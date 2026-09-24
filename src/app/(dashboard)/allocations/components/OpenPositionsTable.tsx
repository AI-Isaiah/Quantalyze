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
// Phase 167 CREDTRUST / D-16 — the SEVENTH former `=== "revoked"` equality,
// and the only one on this surface. Shared with HoldingsTable so the two money
// surfaces cannot drift on what "trusted" means. ⛔ Do not re-introduce a
// local equality on `sync_status` here.
import {
  UNKNOWN_KEY_STATUS_ROW_LABEL,
  isUntrustedKeySyncStatus,
  untrustedKeyChipLabel,
} from "@/lib/closed-sets";
// Phase 167.1 review round 2 WR-05 — the footer qualifier's wording comes from
// the ONE clause builder the composer's AUM marker uses, so both surfaces name
// the same parts with the same nouns.
import {
  buildKeyTrustClause,
  capitalizeFirst,
  type LiveHoldingsPart,
} from "../lib/live-holdings-summary";

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
  /** Phase 167.1 review round 2 WR-05. True when `api_key_id` is MISSING from
   *  the key list, so the status is unknown rather than trusted. A key that is
   *  present with a null status leaves this unset and stays trusted. */
  source_key_missing?: boolean;
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
  // Phase 167.1 AUMTRUST / D-16 — the footer total and its untrusted part.
  // They MUST come from this ONE pass: a total and a disclosed subset summed by
  // two loops with two filters can drift, and then the footer states a part
  // the whole does not contain (D-04). The pass DISCLOSES, it never subtracts:
  // an untrusted row's P&L stays in `totalUnrealized` (D-03, "keep the total
  // and flag it"). Same finite-else-0 rule for both sums, and the untrusted
  // test is the shared predicate the row chip answers, never a local equality.
  //
  // Review WR-03: a null or non-finite P&L still sums as 0 (the total is
  // unchanged), but an untrusted row whose P&L was defaulted is COUNTED, so the
  // qualifier says the P&L is unavailable instead of presenting that 0 as a
  // known figure.
  //
  // Review round 2 WR-05: a row whose key is missing from the key list is
  // counted as a SEPARATE unknown-status part, never folded into the untrusted
  // one, and named in the composer's wording.
  let totalUnrealized = 0;
  const untrusted: LiveHoldingsPart = { amount: 0, count: 0, unavailable: 0 };
  const unknownStatus: LiveHoldingsPart = { amount: 0, count: 0, unavailable: 0 };
  for (const r of rows) {
    const known = Number.isFinite(r.unrealized_pnl_usd ?? NaN);
    const pnl = known ? (r.unrealized_pnl_usd as number) : 0;
    totalUnrealized += pnl;
    const part = isUntrustedKeySyncStatus(r.source_key_sync_status)
      ? untrusted
      : r.source_key_missing === true
        ? unknownStatus
        : null;
    if (part !== null) {
      part.amount += pnl;
      part.count += 1;
      if (!known) part.unavailable += 1;
    }
  }

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
              // D-16 site 7. The chip is per-status copy, not one shared
              // sentence — `revoked` names a cause a sign-in failure does not
              // have, and vice versa.
              const untrustedLabel = untrustedKeyChipLabel(
                r.source_key_sync_status,
              );
              const isUntrusted = untrustedLabel !== null;
              const numericCell = isUntrusted
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
                      {untrustedLabel !== null ? (
                        <span
                          className="inline-flex items-center rounded px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider"
                          style={AMBER_CHIP_STYLE}
                        >
                          {untrustedLabel}
                        </span>
                      ) : r.source_key_missing === true ? (
                        // Review round 2 WR-05: the key is missing from the
                        // key list, so its status is unknown. Muted, like the
                        // disclosures that name it; not struck through,
                        // because nothing says these numbers are stale.
                        <span
                          data-testid="holding-key-status-unknown"
                          className="text-xs text-text-muted"
                        >
                          {UNKNOWN_KEY_STATUS_ROW_LABEL}
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
                      isUntrusted
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
            {/* Renders on the untrusted COUNT, not the amount (D-07): an
                untrusted row with a null P&L is summed as 0 and still says so.
                Muted, sentence case, no role (D-09). Its own row, so the
                uppercase label cell above is not overridden. Review round 2
                WR-05: an unknown-status row opens it too, as its own part. */}
            {untrusted.count > 0 || unknownStatus.count > 0 ? (
              <tr className="bg-page/40">
                <td
                  colSpan={7}
                  data-testid="open-positions-untrusted-note"
                  className="px-4 pb-2 text-xs text-text-muted"
                >
                  {capitalizeFirst(
                    buildKeyTrustClause(untrusted, unknownStatus, {
                      amount: formatPnl,
                      missing: "P&L",
                      unit: ["position", "positions"],
                    }),
                  )}
                  .
                </td>
              </tr>
            ) : null}
          </tfoot>
        </table>
        </ResponsiveTable>
      )}
    </section>
  );
}
