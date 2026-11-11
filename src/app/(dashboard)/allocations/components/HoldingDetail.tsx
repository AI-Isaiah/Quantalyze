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

import { useEffect, useRef, useState } from "react";
import { NoteRender } from "@/components/notes/NoteRender";
import { NoteSaveStatus } from "@/components/notes/NoteSaveStatus";
import { useNoteAutoSave } from "@/components/notes/useNoteAutoSave";
import { shouldSaveNoteOnBlur } from "@/components/notes/should-save-note";
import { buildHoldingScopeRef } from "@/lib/notes/scope-ref";
import { formatNumber, formatPercent } from "@/lib/utils";
import { Term } from "@/components/ui/Term";
import type { TermKey } from "@/lib/glossary";
// Phase 169 review round 1 IN-04: the ONE money module (DESIGN.md Currency
// row). The private copy that stood here duplicated its body.
import { formatUsd } from "@/lib/dollar-validation";
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
  // Loud-fail (F1 / H-0092 / H-0093 / H-1216 / M-0075): a fetch failure must be
  // a DISTINCT state from "no note yet" — only a genuine 404 means empty. Any
  // other non-OK (401/403/429/5xx) or a thrown network/parse error sets
  // noteLoadError so we render an error+retry affordance instead of dropping the
  // user into an empty editor that onNoteBlur would PUT over their unread note.
  const [noteLoadError, setNoteLoadError] = useState(false);

  // Phase 193 D-09: last note content known to be persisted. Seeded from the
  // GET ("" on a 404) and advanced only when a save reports "saved", so a
  // failed save stays dirty and a later blur retries.
  const [notePersisted, setNotePersisted] = useState("");
  const pendingSaveRef = useRef("");
  // Focus moves only from an explicit Edit click, once the textarea mounts.
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const focusOnEditRef = useRef(false);
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
          setNotePersisted(c);
          pendingSaveRef.current = c;
          setInitialSavedAt(ts ? new Date(ts) : null);
          setNoteEditing(!c);
        } else if (!cancelled && res.status === 404) {
          // Genuine "no note yet" → start in edit mode so placeholder guides input.
          setNoteEditing(true);
        } else if (!cancelled) {
          // 401/403/429/5xx → load failed. Do NOT enter edit mode (an empty
          // draft would overwrite the unread server note on blur).
          console.error(
            "[HoldingDetail] notes load failed",
            res.status,
            scope_ref,
          );
          setNoteLoadError(true);
        }
      } catch (err) {
        // Network drop / JSON parse error → same loud-fail path as a 5xx.
        if (!cancelled) {
          console.error("[HoldingDetail] notes load failed", err, scope_ref);
          setNoteLoadError(true);
        }
      } finally {
        if (!cancelled) setNoteLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, scope_ref, noteLoaded]);

  function retryNoteLoad() {
    setNoteLoadError(false);
    setNoteLoaded(false);
  }

  const { saveState, lastSavedAt, save } = useNoteAutoSave(
    "holding",
    scope_ref,
    initialSavedAt,
  );

  useEffect(() => {
    if (saveState === "saved") setNotePersisted(pendingSaveRef.current);
  }, [saveState]);

  useEffect(() => {
    if (noteEditing && focusOnEditRef.current) {
      focusOnEditRef.current = false;
      noteTextareaRef.current?.focus();
    }
  }, [noteEditing]);

  function onNoteBlur() {
    // Never persist a draft when the initial load failed — we don't know the
    // server-side content, so a save here would clobber it (data-loss fence).
    if (noteLoadError) return;
    // While a save is in flight the server will end at what was last sent, so
    // compare against that, not the last confirmed value (WR-01).
    const baseline = saveState === "saving" ? pendingSaveRef.current : notePersisted;
    // A failed save leaves the server state unknown (a superseded save may have
    // committed), so "Save failed — retry" must really retry: send the draft.
    if (saveState !== "error" && !shouldSaveNoteOnBlur(noteDraft, baseline)) {
      // Nothing to write (D-09): show what is stored.
      setNoteDraft(baseline);
      setNoteContent(baseline);
      setNoteEditing(baseline === "");
      return;
    }
    const payload = noteDraft;
    pendingSaveRef.current = payload;
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
          <Metric label="Sharpe" term="sharpe" value={formatNumber(row.sharpe)} />
          <Metric label="Max DD" term="max_drawdown" value={formatPercent(row.dd, 2)} />
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
              This holding is not flagged as outside your mandate — no
              replacement to record against.
            </p>
          )}
        </div>
      ) : null}

      {tab === "note" ? (
        <div role="tabpanel" aria-label="Notes">
          {!noteLoaded ? (
            <p className="text-xs text-text-muted">Loading…</p>
          ) : noteLoadError ? (
            <div role="alert" className="text-xs text-text-muted">
              <p>Couldn&apos;t load your note. Your saved note is safe.</p>
              <button
                type="button"
                onClick={retryNoteLoad}
                className="mt-2 text-xs text-accent underline hover:text-accent-hover"
              >
                Retry
              </button>
            </div>
          ) : (
            <div>
              {noteEditing ? (
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onBlur={onNoteBlur}
                  placeholder="No note yet. Start typing to add one."
                  ref={noteTextareaRef}
                  rows={4}
                  className="w-full resize-none rounded border border-border bg-surface p-2 font-mono text-fixed-13 leading-[1.6] focus:border-accent focus:outline-none"
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
                    onClick={() => {
                      focusOnEditRef.current = true;
                      setNoteEditing(true);
                    }}
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

function Metric({
  label,
  term,
  value,
}: {
  label: string;
  /** Registry key (Phase 201 D-01): the label opens its definition. Omit for a plain word. */
  term?: TermKey;
  value: string;
}) {
  return (
    <div>
      <div className="text-fixed-10 uppercase tracking-wider text-text-muted">
        {term ? <Term k={term}>{label}</Term> : label}
      </div>
      <div className="font-metric tabular-nums text-text-primary">{value}</div>
    </div>
  );
}
