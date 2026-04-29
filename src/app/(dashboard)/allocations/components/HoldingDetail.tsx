"use client";

/**
 * Phase 09.1 Plan 08 / D-11 / D-12 / D-13 — HoldingDetail.
 *
 * 3-tab sub-row mounted INSIDE a `<tr><td colSpan={N}>` host (caller wraps
 * this component in the table row shell). Tabs:
 *
 *   - Metrics (default)         — read-only per-holding stats
 *   - Record outcome            — embeds OutcomeForm; routes through
 *                                 postBridgeOutcome. Disabled copy when
 *                                 the row is not a Bridge candidate.
 *   - Notes                     — wraps Phase 08 primitives verbatim
 *                                 (NoteRender + NoteSaveStatus +
 *                                 useNoteAutoSave + buildHoldingScopeRef).
 *                                 Lazy GET /api/notes on first mount of
 *                                 the Notes tab — clones HoldingNoteRow's
 *                                 cancelled-flag pattern.
 *
 * One-open-at-a-time is owned by the parent table (only one HoldingDetail
 * is mounted at a time). This component is purely the tab body.
 */

import { useEffect, useState } from "react";
import { NoteRender } from "@/components/notes/NoteRender";
import { NoteSaveStatus } from "@/components/notes/NoteSaveStatus";
import { useNoteAutoSave } from "@/components/notes/useNoteAutoSave";
import { buildHoldingScopeRef } from "@/lib/notes/scope-ref";
import { formatNumber, formatPercent } from "@/lib/utils";
import type { DesignHoldingRow } from "../lib/holdings-adapter";
import { OutcomeForm } from "./OutcomeForm";

type Tab = "metrics" | "outcome" | "note";

export type HoldingDetailProps = {
  row: DesignHoldingRow;
  /** From flaggedHoldings[].top_candidate_strategy_id; null when row is not flagged. */
  topCandidateStrategyId?: string | null;
  onRecorded?: (outcomeId: string) => void;
  onClose?: () => void;
};

function formatUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDays(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n}d`;
}

export function HoldingDetail({
  row,
  topCandidateStrategyId,
  onRecorded,
}: HoldingDetailProps) {
  const [tab, setTab] = useState<Tab>("metrics");

  const scope_ref = buildHoldingScopeRef({
    venue: row.venue,
    symbol: row.symbol,
    holding_type: row.holding_type,
  });

  // Lazy GET on first mount of the Notes tab — clones HoldingNoteRow's
  // cancelled-flag pattern (HoldingNoteRow.tsx:158-199).
  const [noteContent, setNoteContent] = useState<string>("");
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [initialSavedAt, setInitialSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (tab !== "note" || noteLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/notes?scope_kind=holding&scope_ref=${encodeURIComponent(scope_ref)}`,
          { credentials: "same-origin" },
        );
        if (!cancelled && res.ok) {
          const json: unknown = await res.json();
          const parsed =
            json && typeof json === "object"
              ? (json as Record<string, unknown>)
              : {};
          const c = typeof parsed.content === "string" ? parsed.content : "";
          const ts =
            typeof parsed.updated_at === "string" ? parsed.updated_at : null;
          setNoteContent(c);
          setNoteDraft(c);
          setInitialSavedAt(ts ? new Date(ts) : null);
          setNoteEditing(!c);
        } else if (!cancelled) {
          // 404 or any non-OK → start in edit mode so placeholder guides input.
          setNoteEditing(true);
        }
      } catch {
        if (!cancelled) setNoteEditing(true);
      } finally {
        if (!cancelled) setNoteLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, scope_ref, noteLoaded]);

  const { saveState, lastSavedAt, save } = useNoteAutoSave(
    "holding",
    scope_ref,
    initialSavedAt,
  );

  function onNoteBlur() {
    const payload = noteDraft;
    setNoteContent(payload);
    void save(payload);
    if (payload) setNoteEditing(false);
  }

  return (
    <div
      role="region"
      aria-label={`Holding detail for ${row.symbol}`}
      className="rounded-md bg-page/50 p-4"
    >
      <div
        role="tablist"
        aria-label="Holding detail tabs"
        className="mb-3 flex gap-1 border-b border-border"
      >
        {(
          [
            { key: "metrics", label: "Metrics" },
            { key: "outcome", label: "Record outcome" },
            { key: "note", label: "Notes" },
          ] as const
        ).map((t) => {
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => setTab(t.key)}
              className={
                isActive
                  ? "-mb-px border-b-2 border-accent px-3 py-1.5 text-xs font-medium text-accent"
                  : "-mb-px border-b-2 border-transparent px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "metrics" ? (
        <div
          role="tabpanel"
          aria-label="Metrics"
          className="grid grid-cols-2 gap-3 text-xs md:grid-cols-3"
        >
          <Metric label="Allocation" value={formatUsd(row.alloc)} />
          <Metric label="Weight" value={formatPercent(row.weight, 2, { signed: false })} />
          <Metric label="MTD" value={formatPercent(row.mtd, 2)} />
          <Metric label="Sharpe" value={formatNumber(row.sharpe)} />
          <Metric label="Max DD" value={formatPercent(row.dd, 2)} />
          <Metric label="Age" value={formatDays(row.age)} />
        </div>
      ) : null}

      {tab === "outcome" ? (
        <div role="tabpanel" aria-label="Record outcome">
          {topCandidateStrategyId ? (
            <OutcomeForm
              strategyId={topCandidateStrategyId}
              row={row}
              onRecorded={onRecorded}
            />
          ) : (
            <p className="text-xs text-text-muted">
              This holding is not flagged for Bridge action — no candidate to
              record against.
            </p>
          )}
        </div>
      ) : null}

      {tab === "note" ? (
        <div role="tabpanel" aria-label="Notes">
          {!noteLoaded ? (
            <p className="text-xs text-text-muted">Loading…</p>
          ) : (
            <div>
              {noteEditing ? (
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onBlur={onNoteBlur}
                  placeholder="No note yet. Start typing to add one."
                  autoFocus
                  rows={4}
                  className="w-full resize-none rounded border border-border bg-surface p-2 font-mono text-[13px] leading-[1.6] focus:border-accent focus:outline-none"
                />
              ) : (
                <div>
                  {noteContent ? (
                    <NoteRender content={noteContent} />
                  ) : (
                    <p className="text-sm text-text-muted">
                      No note yet. Start typing to add one.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setNoteEditing(true)}
                    className="mt-2 text-xs text-accent underline hover:text-accent-hover"
                  >
                    Edit
                  </button>
                </div>
              )}
              <NoteSaveStatus saveState={saveState} lastSavedAt={lastSavedAt} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className="font-metric tabular-nums text-text-primary">{value}</div>
    </div>
  );
}
