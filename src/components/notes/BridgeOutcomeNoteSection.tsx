"use client";

/**
 * Phase 08 Plan 04 Task 2 — BridgeOutcomeNoteSection (MANAGE-05
 * bridge_outcome scope).
 *
 * Thin wrapper for the Plan 03 primitives used inside OutcomesWidget's
 * ExpandedPanel. Lazy-fetches the current user's note for the given
 * bridge_outcomes.id on mount (this section is below the fold of an
 * already-expanded row; clicking the caret is the user's signal), then
 * toggles between read (NoteRender) and edit (textarea) modes.
 *
 * scope_kind = "bridge_outcome"; scope_ref = outcome.id (UUID).
 *
 * S2 contract: no unmount flush. The user must blur or explicitly save
 * before collapsing. The generation guard in useNoteAutoSave prevents
 * stale responses from mutating unmounted state.
 *
 * Each mount is scoped per outcomeId — a new useEffect run cancels the
 * prior fetch via the local `cancelled` flag, so re-expanding a
 * different outcome never reads the previous outcome's response
 * (T-08-18 mitigation).
 */

import { useEffect, useState } from "react";
import { NoteRender } from "./NoteRender";
import { useNoteAutoSave } from "./useNoteAutoSave";
import { NoteSaveStatus } from "./NoteSaveStatus";

export interface BridgeOutcomeNoteSectionProps {
  outcomeId: string;
}

export function BridgeOutcomeNoteSection({
  outcomeId,
}: BridgeOutcomeNoteSectionProps) {
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [initialSavedAt, setInitialSavedAt] = useState<Date | null>(null);
  // Default to edit mode only when the initial load comes back empty.
  // Existing content opens in read mode with an Edit affordance.
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/notes?scope_kind=bridge_outcome&scope_ref=${encodeURIComponent(outcomeId)}`,
          { credentials: "same-origin" },
        );
        if (!cancelled && res.ok) {
          const json = await res.json();
          const c = (json.content as string | undefined) ?? "";
          setContent(c);
          setDraft(c);
          setInitialSavedAt(
            json.updated_at ? new Date(json.updated_at as string) : null,
          );
          // Existing content → open in read mode. Empty → edit mode so
          // the placeholder guides the first-time user.
          setEditing(!c);
        } else if (!cancelled && res.status === 404) {
          // No existing note — start in edit mode with empty placeholder.
          setEditing(true);
        }
      } catch {
        // Network error — default to empty edit mode so the user isn't
        // blocked from writing.
        if (!cancelled) setEditing(true);
      } finally {
        if (!cancelled) setInitialLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outcomeId]);

  const { saveState, lastSavedAt, save } = useNoteAutoSave(
    "bridge_outcome",
    outcomeId,
    initialSavedAt,
  );

  const onBlurTextarea = () => {
    const payload = draft;
    setContent(payload);
    void save(payload);
    if (payload) setEditing(false);
  };

  if (!initialLoaded) {
    return <p className="text-sm text-text-muted">Loading…</p>;
  }

  return (
    <div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={onBlurTextarea}
          placeholder="No note for this outcome. Start typing to add one."
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
              No note for this outcome. Start typing to add one.
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
  );
}
