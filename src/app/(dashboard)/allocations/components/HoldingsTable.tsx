"use client";

/**
 * HoldingsTable — Phase 09.1 Plan 08 rewrite (D-11 / D-14 / D-18).
 *
 * The component supports TWO modes side-by-side:
 *
 *   LEGACY MODE (Phase 08 props: `holdings` + `showRevoked` +
 *   `onShowRevokedChange`).
 *     Preserves the Phase 08 MANAGE-02 surface byte-for-byte: revoked-key
 *     strikethrough + amber chip + Show-revoked toggle + hidden-footer copy
 *     + per-row note icon + lazy-loading note sub-row. AllocationDashboard
 *     (the legacy V1 root) still consumes this mode and the existing
 *     HoldingsTable.test.tsx + AllocationDashboard.revoked-holdings.test.tsx
 *     suites stay green. No behaviour change for legacy callers.
 *
 *   NEW MODE (Plan 08 props: `rows` of DesignHoldingRow +
 *   `revokedStatusByHoldingId` + `flaggedHoldingsByRef` +
 *   `matchDecisionsByHoldingRef`).
 *     Renders the designer's 8-column table consuming `toDesignHoldings`
 *     output (Plan 04). Sortable headers (Strategy / Weight / Allocation /
 *     MTD / Sharpe / Max DD / Age) with `sort` state. Row click opens the
 *     3-tab `HoldingDetail` sub-row (Metrics / Record outcome / Notes) —
 *     one-open-at-a-time. Per-row `BridgeOutcomeBanner` renders ABOVE the
 *     sub-row whenever `row.bridgeCandidate === true` (D-14 — banner is
 *     mounted HERE, not in Plan 09). Revoked-key UI from Phase 08 is
 *     preserved by joining `revokedStatusByHoldingId[row.id]` against
 *     each design row.
 *
 * Mode is selected by presence of `rows` prop. New callers pass `rows`;
 * legacy callers pass `holdings`. The two paths share zero render code
 * past the wrapper section, which keeps the legacy MANAGE-02 invariants
 * unconditionally intact and lets the new mode evolve independently.
 */

import { Fragment, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  HoldingNoteIconButton,
  HoldingNoteRow,
} from "@/components/notes/HoldingNoteRow";
import { buildHoldingScopeRef } from "@/lib/notes/scope-ref";
import type { DesignHoldingRow } from "../lib/holdings-adapter";
import { BridgeOutcomeBanner } from "./BridgeOutcomeBanner";
import { HoldingDetail } from "./HoldingDetail";

// ─────────────────────────────────────────────────────────── shared utilities

const AMBER_CHIP_STYLE: CSSProperties = {
  color: "#D97706",
  backgroundColor: "#FEF3C7",
  border: "1px solid #FDE68A",
};

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

function formatPercent(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function formatNumber(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatDays(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n}d`;
}

function venueLabel(v: string): string {
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

// ──────────────────────────────────────────────────────────────── legacy types

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

// ──────────────────────────────────────────────────────────────── new-mode types

export type SortKey =
  | "strategy"
  | "weight"
  | "alloc"
  | "mtd"
  | "sharpe"
  | "dd"
  | "age";

export interface HoldingsTableProps {
  // ── Legacy props (Phase 08) — required when `rows` is absent.
  holdings?: HoldingRow[];
  showRevoked?: boolean;
  onShowRevokedChange?: (next: boolean) => void;
  notesByHoldingScopeRef?: Record<
    string,
    { content: string; updated_at: string } | undefined
  >;
  // ── New-mode props (Plan 08) — selecting these enables the design table.
  rows?: DesignHoldingRow[];
  /** ref → sync_status (e.g. "revoked") for the row's source api_key. */
  revokedStatusByHoldingId?: Record<string, string | null | undefined>;
  /**
   * ref → flagged-holding metadata. Drives the OutcomeForm strategyId in
   * the row-expand "Record outcome" tab. Absent ref → no candidate.
   */
  flaggedHoldingsByRef?: Record<
    string,
    { top_candidate_strategy_id: string | null }
  >;
}

export function HoldingsTable(props: HoldingsTableProps) {
  if (props.rows) {
    return (
      <DesignHoldingsTable
        rows={props.rows}
        revokedStatusByHoldingId={props.revokedStatusByHoldingId ?? {}}
        flaggedHoldingsByRef={props.flaggedHoldingsByRef ?? {}}
        showRevoked={props.showRevoked ?? true}
        onShowRevokedChange={props.onShowRevokedChange}
      />
    );
  }
  return (
    <LegacyHoldingsTable
      holdings={props.holdings ?? []}
      showRevoked={props.showRevoked ?? true}
      onShowRevokedChange={props.onShowRevokedChange ?? (() => {})}
      notesByHoldingScopeRef={props.notesByHoldingScopeRef ?? {}}
    />
  );
}

// ──────────────────────────────────────────────────────────── LEGACY MODE

interface LegacyProps {
  holdings: HoldingRow[];
  showRevoked: boolean;
  onShowRevokedChange: (next: boolean) => void;
  notesByHoldingScopeRef: Record<
    string,
    { content: string; updated_at: string } | undefined
  >;
}

function LegacyHoldingsTable({
  holdings,
  showRevoked,
  onShowRevokedChange,
  notesByHoldingScopeRef,
}: LegacyProps) {
  const visibleHoldings = showRevoked
    ? holdings
    : holdings.filter((h) => h.source_key_sync_status !== "revoked");

  const hiddenCount = showRevoked
    ? 0
    : holdings.filter((h) => h.source_key_sync_status === "revoked").length;

  const [expandedNoteRowId, setExpandedNoteRowId] = useState<string | null>(
    null,
  );

  const TOTAL_COLUMNS = 7;

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">Holdings</h3>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted">
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
              <th className="px-4 py-2 text-right font-semibold">Quantity</th>
              <th className="px-4 py-2 text-right font-semibold">Entry price</th>
              <th className="px-4 py-2 text-right font-semibold">Value (USD)</th>
              <th className="px-4 py-2 text-right font-semibold">
                Unrealized P&amp;L
              </th>
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
                    className="border-b border-border transition-colors last:border-b-0 hover:bg-page/50"
                    style={{ minHeight: 44 }}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary">
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

// ──────────────────────────────────────────────────────── NEW DESIGN MODE

interface DesignProps {
  rows: DesignHoldingRow[];
  revokedStatusByHoldingId: Record<string, string | null | undefined>;
  flaggedHoldingsByRef: Record<
    string,
    { top_candidate_strategy_id: string | null }
  >;
  showRevoked: boolean;
  onShowRevokedChange?: (next: boolean) => void;
}

type SortDir = "asc" | "desc";

function compareDesignRows(
  a: DesignHoldingRow,
  b: DesignHoldingRow,
  key: SortKey,
  dir: SortDir,
): number {
  const dirMul = dir === "asc" ? 1 : -1;
  const av = a[key];
  const bv = b[key];

  // strategy is string-or-null; numerics are number-or-null.
  if (av == null && bv == null) return 0;
  if (av == null) return 1; // nulls sort to end regardless of dir
  if (bv == null) return -1;
  if (typeof av === "string" && typeof bv === "string") {
    return av.localeCompare(bv) * dirMul;
  }
  if (typeof av === "number" && typeof bv === "number") {
    return (av - bv) * dirMul;
  }
  return 0;
}

// 9 columns: status-dot / Strategy / Symbol / Weight / Allocation / MTD /
// Sharpe / Max DD / Age. Used as colSpan for the banner + sub-row rows.
const DESIGN_TOTAL_COLUMNS = 9;

function DesignHoldingsTable({
  rows,
  revokedStatusByHoldingId,
  flaggedHoldingsByRef,
  showRevoked,
  onShowRevokedChange,
}: DesignProps) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "alloc",
    dir: "desc",
  });
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const visibleRows = useMemo(() => {
    if (showRevoked) return rows;
    return rows.filter(
      (r) => revokedStatusByHoldingId[r.id] !== "revoked",
    );
  }, [rows, revokedStatusByHoldingId, showRevoked]);

  const hiddenCount = useMemo(() => {
    if (showRevoked) return 0;
    return rows.filter((r) => revokedStatusByHoldingId[r.id] === "revoked")
      .length;
  }, [rows, revokedStatusByHoldingId, showRevoked]);

  const sortedRows = useMemo(() => {
    // Tie-break on row id so equal sort values produce a deterministic order
    // across re-renders. Without this, sub-row HoldingDetail components
    // remount on every sort with null/equal values because React sees
    // different child keys per render.
    return [...visibleRows].sort(
      (a, b) =>
        compareDesignRows(a, b, sort.key, sort.dir) || a.id.localeCompare(b.id),
    );
  }, [visibleRows, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">Holdings</h3>
        {onShowRevokedChange ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={showRevoked}
              onChange={(e) => onShowRevokedChange(e.target.checked)}
            />
            <span>Show revoked-key holdings</span>
          </label>
        ) : null}
      </div>

      {sortedRows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-text-muted">
          No holdings to display.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-text-muted">
              <th className="w-3 px-2 py-2" aria-label="Status" />
              <SortableHeader
                label="Strategy"
                sortKey="strategy"
                sort={sort}
                onSort={toggleSort}
              />
              <th className="px-4 py-2 font-semibold">Symbol</th>
              <SortableHeader
                label="Weight"
                sortKey="weight"
                sort={sort}
                onSort={toggleSort}
                align="right"
              />
              <SortableHeader
                label="Allocation"
                sortKey="alloc"
                sort={sort}
                onSort={toggleSort}
                align="right"
              />
              <SortableHeader
                label="MTD"
                sortKey="mtd"
                sort={sort}
                onSort={toggleSort}
                align="right"
              />
              <SortableHeader
                label="Sharpe"
                sortKey="sharpe"
                sort={sort}
                onSort={toggleSort}
                align="right"
              />
              <SortableHeader
                label="Max DD"
                sortKey="dd"
                sort={sort}
                onSort={toggleSort}
                align="right"
              />
              <SortableHeader
                label="Age"
                sortKey="age"
                sort={sort}
                onSort={toggleSort}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const isExpanded = expandedRowId === row.id;
              const isRevoked = revokedStatusByHoldingId[row.id] === "revoked";
              const numericCell = isRevoked
                ? "px-4 py-2 font-metric tabular-nums text-right line-through text-text-muted"
                : "px-4 py-2 font-metric tabular-nums text-right text-text-primary";
              const candidateStrategyId =
                flaggedHoldingsByRef[row.id]?.top_candidate_strategy_id ?? null;
              return (
                <Fragment key={row.id}>
                  <tr
                    onClick={() =>
                      setExpandedRowId((prev) =>
                        prev === row.id ? null : row.id,
                      )
                    }
                    aria-expanded={isExpanded}
                    data-row-id={row.id}
                    className="cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-page/50"
                    style={{ minHeight: 44 }}
                  >
                    <td className="px-2 py-2" aria-hidden="true">
                      <StatusDot status={row.status} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary">
                          {row.strategy ?? "—"}
                        </span>
                        {isRevoked ? (
                          <span
                            className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                            style={AMBER_CHIP_STYLE}
                          >
                            Key revoked
                          </span>
                        ) : null}
                        {row.bridgeCandidate ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedRowId(row.id);
                            }}
                            className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent hover:bg-accent/20"
                          >
                            Review
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-text-secondary">
                      {venueLabel(row.venue)} · {row.symbol}
                    </td>
                    <td className={numericCell}>{formatPercent(row.weight)}</td>
                    <td className={numericCell}>{formatUsd(row.alloc)}</td>
                    <td className={numericCell}>{formatPercent(row.mtd)}</td>
                    <td className={numericCell}>{formatNumber(row.sharpe)}</td>
                    <td className={numericCell}>{formatPercent(row.dd)}</td>
                    <td className={numericCell}>{formatDays(row.age)}</td>
                  </tr>

                  {/* D-14 per-row banner — renders whenever bridgeCandidate
                      is true, independent of expansion. Phase 09 banner's
                      onAllocatedClick / onRejectedClick / onDismiss
                      callbacks expand the row and hop the user to the
                      Record-outcome tab via the existing OutcomeForm. */}
                  {row.bridgeCandidate && candidateStrategyId ? (
                    <tr data-banner-row-id={row.id}>
                      <td
                        colSpan={DESIGN_TOTAL_COLUMNS}
                        className="border-b border-border p-0"
                      >
                        <BridgeOutcomeBanner
                          strategyId={candidateStrategyId}
                          onAllocatedClick={() => setExpandedRowId(row.id)}
                          onRejectedClick={() => setExpandedRowId(row.id)}
                          onDismiss={() => {
                            // Dismissal is server-side (BridgeOutcomeBanner
                            // POSTs the decision before calling onDismiss).
                            // Refresh the route to re-fetch
                            // getMyAllocationDashboard so the holding drops
                            // out of `flaggedHoldings` and the banner
                            // unmounts. Without this the banner re-renders
                            // from the memoized prop and the user sees no
                            // feedback until full page reload.
                            router.refresh();
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}

                  {isExpanded ? (
                    <tr data-detail-row-id={row.id}>
                      <td
                        colSpan={DESIGN_TOTAL_COLUMNS}
                        className="border-b border-border bg-surface p-3"
                      >
                        <HoldingDetail
                          row={row}
                          topCandidateStrategyId={candidateStrategyId}
                          onRecorded={() => setExpandedRowId(null)}
                          onClose={() => setExpandedRowId(null)}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {!showRevoked && hiddenCount > 0 && onShowRevokedChange ? (
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

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  align,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  align?: "right";
}) {
  const isActive = sort.key === sortKey;
  const arrow = isActive ? (sort.dir === "asc" ? "↑" : "↓") : "";
  return (
    <th
      className={
        align === "right"
          ? "px-4 py-2 text-right font-semibold"
          : "px-4 py-2 font-semibold"
      }
      aria-sort={
        isActive ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-muted hover:text-text-primary"
      >
        {label}
        {arrow ? <span aria-hidden="true">{arrow}</span> : null}
      </button>
    </th>
  );
}

function StatusDot({ status }: { status: DesignHoldingRow["status"] }) {
  // Tailwind doesn't pick up dynamic class fragments — use literal classes.
  const cls =
    status === "underperform"
      ? "h-2 w-2 rounded-full bg-negative"
      : status === "watch"
        ? "h-2 w-2 rounded-full bg-warning"
        : "h-2 w-2 rounded-full bg-accent/40";
  return <span aria-label={`Status: ${status}`} className={cls} />;
}
