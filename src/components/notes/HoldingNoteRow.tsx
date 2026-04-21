"use client";

/**
 * Phase 08 Plan 04 Task 1 — HoldingNoteRow + HoldingNoteIconButton
 * (MANAGE-05 holding scope).
 *
 * Glue code between the Plan 02 HoldingsTable (trailing placeholder column
 * reserved for this icon) and the Plan 03 shared notes primitives
 * (NoteRender + useNoteAutoSave + NoteSaveStatus).
 *
 * Icon states (UI-SPEC §3):
 *   hasNote=false, revoked=false → outlined glyph, text-text-muted
 *   hasNote=true,  revoked=false → solid glyph,    text-accent
 *   hasNote=true,  revoked=true  → solid glyph,    color-warning #D97706
 *   hasNote=false, revoked=true  → outlined glyph, color-warning #D97706
 *
 * Sub-row (UI-SPEC §4b): a full-width <tr> with a single colSpan-ed <td>
 * hosting the editing/read toggle. Per the S2 no-unmount-flush contract
 * shipped in Plan 03, consumers rely on textarea blur (not unmount) to
 * persist — same shape as NotesWidget.
 */

import { useState } from "react";
import { NoteRender } from "./NoteRender";
import { useNoteAutoSave } from "./useNoteAutoSave";
import { NoteSaveStatus } from "./NoteSaveStatus";
import { buildHoldingScopeRef } from "@/lib/notes/scope-ref";

// ---------------------------------------------------------------- icon glyph

/**
 * 16×16 inline document-note SVG per UI-SPEC §3. The outlined variant uses
 * currentColor strokes on a transparent fill; the solid variant uses
 * currentColor fill with white interior lines so the horizontal rules stay
 * readable against the filled rectangle.
 */
function NoteIconSvg({ solid }: { solid: boolean }) {
  if (solid) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <rect x="2.5" y="2" width="11" height="12" rx="1.5" fill="currentColor" />
        <line x1="5" y1="6" x2="11" y2="6" stroke="white" strokeWidth="1" strokeLinecap="round" />
        <line x1="5" y1="8.5" x2="11" y2="8.5" stroke="white" strokeWidth="1" strokeLinecap="round" />
        <line x1="5" y1="11" x2="9" y2="11" stroke="white" strokeWidth="1" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="2"
        width="11"
        height="12"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line x1="5" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <line x1="5" y1="8.5" x2="11" y2="8.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <line x1="5" y1="11" x2="9" y2="11" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------- HoldingNoteIconButton

export interface HoldingNoteIconButtonProps {
  hasNote: boolean;
  revoked: boolean;
  isExpanded: boolean;
  onClick: () => void;
  symbol: string;
  holdingType: "spot" | "derivative";
  rowId: string;
}

export function HoldingNoteIconButton(props: HoldingNoteIconButtonProps) {
  // Revoked rows override the default accent-vs-muted palette with the
  // UI-SPEC §2 amber warning hex. Non-revoked rows use accent when a note
  // exists, muted when empty. We encode the amber directly in the class
  // string so Tailwind's arbitrary-value pipeline emits the rule.
  const colorClass = props.revoked
    ? "text-[#D97706]"
    : props.hasNote
      ? "text-accent"
      : "text-text-muted";
  const label = props.hasNote
    ? `Edit note for ${props.symbol} ${props.holdingType}`
    : `Add note for ${props.symbol} ${props.holdingType}`;
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={props.isExpanded}
      aria-controls={`note-row-${props.rowId}`}
      onClick={props.onClick}
      className={`flex items-center justify-center h-8 w-8 rounded transition-colors hover:bg-border/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent/40 ${colorClass}`}
    >
      <NoteIconSvg solid={props.hasNote} />
    </button>
  );
}

// -------------------------------------------------------------- HoldingNoteRow

export interface HoldingNoteRowProps {
  rowId: string;
  colSpan: number;
  venue: string;
  symbol: string;
  holding_type: "spot" | "derivative";
  initialContent: string;
  initialLastSavedAt: Date | null;
}

export function HoldingNoteRow(props: HoldingNoteRowProps) {
  const scope_ref = buildHoldingScopeRef({
    venue: props.venue,
    symbol: props.symbol,
    holding_type: props.holding_type,
  });
  const { saveState, lastSavedAt, save } = useNoteAutoSave(
    "holding",
    scope_ref,
    props.initialLastSavedAt,
  );
  // Mirror the NotesWidget read/edit toggle: default into edit mode only
  // when there is no existing content (empty state placeholder guides the
  // first-time user). Existing content opens in read mode with an Edit
  // affordance, matching UI-SPEC §4 state machine.
  const [editing, setEditing] = useState(!props.initialContent);
  const [draft, setDraft] = useState(props.initialContent);
  const [content, setContent] = useState(props.initialContent);

  const onBlurTextarea = () => {
    const payload = draft;
    setContent(payload);
    void save(payload);
    // Only flip back to read mode when there's content; empty-state stays
    // in the textarea so the placeholder remains visible.
    if (payload) setEditing(false);
  };

  return (
    <tr
      id={`note-row-${props.rowId}`}
      role="region"
      aria-label={`Note for ${props.symbol} ${props.holding_type}`}
    >
      <td colSpan={props.colSpan} className="p-0">
        <div className="px-4 py-3 bg-surface border-t border-border">
          {editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={onBlurTextarea}
              placeholder="No note yet. Start typing to add one."
              autoFocus
              rows={4}
              className="w-full resize-none rounded border border-border p-2 font-mono text-[13px] leading-[1.6] focus:border-accent focus:outline-none"
            />
          ) : (
            <div>
              {content ? (
                <NoteRender content={content} />
              ) : (
                <p className="text-sm text-text-muted">
                  No note yet. Start typing to add one.
                </p>
              )}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-2 text-xs text-accent underline hover:text-accent-hover"
              >
                Edit
              </button>
            </div>
          )}
          <NoteSaveStatus saveState={saveState} lastSavedAt={lastSavedAt} />
        </div>
      </td>
    </tr>
  );
}
