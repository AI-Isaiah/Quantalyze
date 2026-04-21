"use client";

/**
 * HoldingsTable — Phase 08 Plan 02 Task 2 (MANAGE-02).
 *
 * Renders the allocator's `allocator_holdings` rows with three Phase
 * 08 treatments:
 *
 *   1. Rows whose source API key has `sync_status='revoked'` render
 *      their numeric cells with `line-through` + `text-text-muted`
 *      plus an amber "Key revoked" chip adjacent to the venue cell
 *      (UI-SPEC §2). Venue + symbol cells themselves stay normal
 *      weight.
 *
 *   2. A page-level "Show revoked-key holdings" toggle (controlled by
 *      AllocationDashboard, persisted to localStorage key
 *      `allocations.showRevokedHoldings`, default ON per D-05). The
 *      toggle affects the TABLE RENDER ONLY — callers pass the full,
 *      unfiltered holdings list to KPI / equity / drawdown widgets
 *      (D-04 historical-inclusion invariant).
 *
 *   3. A trailing placeholder column reserved for the note icon in
 *      Plan 04. Keeping it now means Plan 04 can slot its button in
 *      without shifting existing columns.
 *
 * When the toggle is OFF and at least one revoked row is hidden, a
 * muted footer line renders `"{N} holding{s} hidden from revoked keys
 * · Show all"` with a ghost Show-all button that flips the toggle
 * back ON via `onShowRevokedChange(true)`.
 */

import { Fragment, useState, type CSSProperties } from "react";
import {
  HoldingNoteIconButton,
  HoldingNoteRow,
} from "@/components/notes/HoldingNoteRow";
import { buildHoldingScopeRef } from "@/lib/notes/scope-ref";

export interface HoldingRow {
  id: string;
  venue: string;
  symbol: string;
  holding_type: "spot" | "derivative";
  quantity: number;
  value_usd: number;
  entry_price: number | null;
  unrealized_pnl_usd: number | null;
  api_key_id: string;
  /** Joined from `api_keys.sync_status` by the dashboard layer. */
  source_key_sync_status: string;
}

export interface HoldingsTableProps {
  holdings: HoldingRow[];
  showRevoked: boolean;
  onShowRevokedChange: (next: boolean) => void;
  /**
   * Phase 08 Plan 04 — optional map of `buildHoldingScopeRef(...)` → existing
   * user_note row for the current user. When a row's scope_ref lives in this
   * map, the trailing note icon renders in the "has note" state and the
   * sub-row seeds its editor with the content. When absent (default — Plan
   * 04 ships with no server-side prefetch hook yet), the icon renders in
   * the empty state. Server-side population inside getMyAllocationDashboard
   * is a follow-up optimisation; for now Phase 08 keeps the holdings layer
   * indicator-only when the query layer supplies the map.
   */
  notesByHoldingScopeRef?: Record<
    string,
    { content: string; updated_at: string } | undefined
  >;
}

// UI-SPEC §2 amber chip palette — amber-50 bg, amber-200 border,
// --color-warning foreground. Inline style so it doesn't depend on
// Tailwind JIT picking up a one-off utility.
const AMBER_CHIP_STYLE: CSSProperties = {
  color: "#D97706",
  backgroundColor: "#FEF3C7",
  border: "1px solid #FDE68A",
};

function formatQuantity(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  // Institutional tone: 4 decimal places for sub-1 quantities, else 2.
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

function venueLabel(v: string): string {
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export function HoldingsTable({
  holdings,
  showRevoked,
  onShowRevokedChange,
  notesByHoldingScopeRef = {},
}: HoldingsTableProps) {
  const visibleHoldings = showRevoked
    ? holdings
    : holdings.filter((h) => h.source_key_sync_status !== "revoked");

  const hiddenCount = showRevoked
    ? 0
    : holdings.filter((h) => h.source_key_sync_status === "revoked").length;

  // One-open-at-a-time sub-row (OutcomesWidget convention). Clicking a
  // different row's note icon closes the previously-open sub-row.
  const [expandedNoteRowId, setExpandedNoteRowId] = useState<string | null>(
    null,
  );

  // 7 visible columns: Venue/Symbol, Type, Quantity, Entry price,
  // Value (USD), Unrealized P&L, plus the new trailing note column.
  const TOTAL_COLUMNS = 7;

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface">
      {/* Header bar: title (left) + toggle (right) — UI-SPEC §2. */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">Holdings</h3>
        <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showRevoked}
            onChange={(e) => onShowRevokedChange(e.target.checked)}
          />
          <span>Show revoked-key holdings</span>
        </label>
      </div>

      {visibleHoldings.length === 0 ? (
        <p className="px-4 py-6 text-sm text-text-muted">
          No holdings to display.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-muted">
              <th className="px-4 py-2 font-semibold">Venue / Symbol</th>
              <th className="px-4 py-2 font-semibold">Type</th>
              <th className="px-4 py-2 font-semibold text-right">Quantity</th>
              <th className="px-4 py-2 font-semibold text-right">Entry price</th>
              <th className="px-4 py-2 font-semibold text-right">Value (USD)</th>
              <th className="px-4 py-2 font-semibold text-right">Unrealized P&amp;L</th>
              {/* Phase 08 Plan 04 — trailing note-icon column. aria-label
                  (not aria-hidden) so screenreaders announce the column
                  purpose while keeping the header visually unlabeled. */}
              <th className="w-10 px-2 py-2" aria-label="Notes" />
            </tr>
          </thead>
          <tbody>
            {visibleHoldings.map((h) => {
              const isRevoked = h.source_key_sync_status === "revoked";
              const numericCell = isRevoked
                ? "px-4 py-2 font-metric tabular-nums text-right line-through text-text-muted"
                : "px-4 py-2 font-metric tabular-nums text-right text-text-primary";
              const scopeRef = buildHoldingScopeRef({
                venue: h.venue,
                symbol: h.symbol,
                holding_type: h.holding_type,
              });
              const noteEntry = notesByHoldingScopeRef[scopeRef];
              const isExpanded = expandedNoteRowId === h.id;
              return (
                <Fragment key={h.id}>
                  <tr
                    className="border-b border-border last:border-b-0 hover:bg-page/50 transition-colors"
                    style={{ minHeight: 44 }}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-text-primary font-medium">
                          {venueLabel(h.venue)} · {h.symbol}
                        </span>
                        {isRevoked ? (
                          <span
                            className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                            style={AMBER_CHIP_STYLE}
                          >
                            Key revoked
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-text-secondary">
                      {h.holding_type === "spot" ? "Spot" : "Derivative"}
                    </td>
                    <td className={numericCell}>{formatQuantity(h.quantity)}</td>
                    <td className={numericCell}>{formatUsd(h.entry_price)}</td>
                    <td className={numericCell}>{formatUsd(h.value_usd)}</td>
                    <td className={numericCell}>
                      {formatPnl(h.unrealized_pnl_usd)}
                    </td>
                    <td className="px-2 py-2">
                      <HoldingNoteIconButton
                        hasNote={!!noteEntry}
                        revoked={isRevoked}
                        isExpanded={isExpanded}
                        onClick={() =>
                          setExpandedNoteRowId((prev) =>
                            prev === h.id ? null : h.id,
                          )
                        }
                        symbol={h.symbol}
                        holdingType={h.holding_type}
                        rowId={h.id}
                      />
                    </td>
                  </tr>
                  {isExpanded ? (
                    <HoldingNoteRow
                      rowId={h.id}
                      colSpan={TOTAL_COLUMNS}
                      venue={h.venue}
                      symbol={h.symbol}
                      holding_type={h.holding_type}
                      initialContent={noteEntry?.content ?? ""}
                      initialLastSavedAt={
                        noteEntry?.updated_at
                          ? new Date(noteEntry.updated_at)
                          : null
                      }
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Hidden-footer copy — UI-SPEC §2 lines 196-207. Renders only
          when showRevoked=false AND at least one revoked row was
          filtered out. */}
      {!showRevoked && hiddenCount > 0 ? (
        <p className="px-4 py-2 text-xs text-text-muted">
          {hiddenCount} {hiddenCount === 1 ? "holding" : "holdings"} hidden from
          revoked keys ·{" "}
          <button
            type="button"
            onClick={() => onShowRevokedChange(true)}
            className="text-accent underline-offset-4 hover:underline"
          >
            Show all
          </button>
        </p>
      ) : null}
    </section>
  );
}
