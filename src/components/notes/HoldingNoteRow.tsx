"use client";

/**
 * HoldingNoteRow + HoldingNoteIconButton (holding-scope notes).
 *
 * Glue code between HoldingsTable (trailing placeholder column reserved for
 * this icon) and the shared notes primitives (NoteRender + useNoteAutoSave +
 * NoteSaveStatus).
 *
 * Icon states:
 *   hasNote=false, revoked=false → outlined glyph, text-text-muted
 *   hasNote=true,  revoked=false → solid glyph,    text-accent
 *   hasNote=true,  revoked=true  → solid glyph,    color-warning #D97706
 *   hasNote=false, revoked=true  → outlined glyph, color-warning #D97706
 *
 * Sub-row: a full-width <tr> with a single colSpan-ed <td> hosting the
 * editing/read toggle. Per the no-unmount-flush contract, consumers rely on
 * textarea blur (not unmount) to persist — same shape as NotesWidget.
 */

import { useEffect, useState } from "react";
import { NoteRender } from "./NoteRender";
import { useNoteAutoSave } from "./useNoteAutoSave";
import { NoteSaveStatus } from "./NoteSaveStatus";
import { buildHoldingScopeRef } from "@/lib/notes/scope-ref";

// ---------------------------------------------------------------- icon glyph

/**
 * 16×16 inline document-note SVG. The outlined variant uses currentColor
 * strokes on a transparent fill; the solid variant uses currentColor fill
 * with white interior lines so the horizontal rules stay readable against
 * the filled rectangle.
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
  // amber warning hex. Non-revoked rows use accent when a note exists,
  // muted when empty. We encode the amber directly in the class string so
  // Tailwind's arbitrary-value pipeline emits the rule.
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

  // Lazy GET on mount, mirroring BridgeOutcomeNoteSection's pattern for
  // holding-scope read-back.
  //
  // HoldingsTable does not server-side-prefetch holding-scope notes (that
  // would widen getMyAllocationDashboard — deferred). Instead the row
  // fetches its own note when the sub-row mounts. Only one sub-row is open
  // at a time so the cost is a single round-trip per open, which is
  // acceptable for the low-frequency note-open UX.
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [initialSavedAt, setInitialSavedAt] = useState<Date | null>(
    props.initialLastSavedAt,
  );
  // Default to edit mode ONLY when the network path confirms empty.
  // Before the fetch resolves, the loading gate below renders — we
  // do not flip editing until we know what the server has.
  const [editing, setEditing] = useState(false);

  useEffect(() => {
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
          const c =
            typeof parsed.content === "string" ? parsed.content : "";
          const ts =
            typeof parsed.updated_at === "string" ? parsed.updated_at : null;
          setContent(c);
          setDraft(c);
          setInitialSavedAt(ts ? new Date(ts) : null);
          // Existing content → read mode with Edit affordance.
          // Empty string → edit mode so placeholder guides first-time users.
          setEditing(!c);
        } else if (!cancelled) {
          // 404 or any other non-OK status (401/403/500/etc.) → default to
          // empty edit mode so the user isn't blocked from writing.
          // save-state will surface errors on first blur.
          setEditing(true);
        }
      } catch {
        // Network error — default to empty edit mode so the user
        // isn't blocked from writing. save-state will surface errors.
        if (!cancelled) setEditing(true);
      } finally {
        if (!cancelled) setInitialLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope_ref]);

  const { saveState, lastSavedAt, save } = useNoteAutoSave(
    "holding",
    scope_ref,
    initialSavedAt,
  );

  // Loading gate: render a skeleton inside the same <tr><td> shell so that
  // the HTML5 table content model is satisfied (<tbody> only permits <tr>
  // children — a bare <p> would be invalid markup and cause DOM warnings).
  if (!initialLoaded) {
    return (
      <tr
        id={`note-row-${props.rowId}`}
        role="region"
        aria-label={`Note for ${props.symbol} ${props.holding_type}`}
      >
        <td colSpan={props.colSpan} className="p-0">
          <div className="px-4 py-3 bg-surface border-t border-border">
            <p className="text-sm text-text-muted">Loading…</p>
          </div>
        </td>
      </tr>
    );
  }

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
