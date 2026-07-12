"use client";

/**
 * DashboardNoteCard — the allocator's whole-book private note (Phase 100 PI-04).
 *
 * Full-width "Notes" card on /allocations. Structurally cloned from
 * StrategyNoteCard but ALWAYS-EDITABLE (no edit-mode toggle — autosave removes
 * the need for a Save button). Reuses the entire existing notes stack verbatim:
 * useNoteAutoSave (debounced PATCH /api/notes state machine), NoteRender
 * (sanitized markdown preview) and NoteSaveStatus ("Saved Ns ago").
 *
 * scope_kind = "dashboard"; scope_ref = the fixed literal "allocations" — the
 * note is user-scoped (the whole book), not portfolio-scoped, so there is no id
 * prop. RLS (user_id = auth.uid()) on user_notes enforces per-allocator privacy.
 *
 * No unmount flush (useNoteAutoSave contract): the draft persists on blur.
 *
 * Dirty check (Phase 100 red-team F-1): this card is ALWAYS-EDITABLE — unlike
 * StrategyNoteCard, whose edit-mode toggle gated blur-saves, a focus→blur here
 * WITHOUT any typing would otherwise fire save(staleContent) and last-write-wins
 * overwrite another tab's concurrent edit. We track `lastSavedContent` and only
 * PATCH when the content actually changed, killing the idle-blur clobber vector
 * (and skipping the pointless PATCH/audit/rate-limit hit on a no-op blur).
 */

import { useEffect, useRef, useState } from "react";
import { NoteRender } from "@/components/notes/NoteRender";
import { useNoteAutoSave } from "@/components/notes/useNoteAutoSave";
import { NoteSaveStatus } from "@/components/notes/NoteSaveStatus";

export interface DashboardNoteCardProps {
  initialContent: string;
  initialLastSavedAt: Date | null;
}

export function DashboardNoteCard(props: DashboardNoteCardProps) {
  const { saveState, lastSavedAt, save } = useNoteAutoSave(
    "dashboard",
    "allocations",
    props.initialLastSavedAt,
  );
  const [content, setContent] = useState(props.initialContent);

  // Dirty check: `lastSavedContent` is the last content known-persisted (seeded
  // from the server-rendered initial value). We advance it only when the hook
  // reports a successful save ("saved"), so a failed PATCH stays dirty and a
  // later blur retries — but a no-op blur is silently skipped.
  const [lastSavedContent, setLastSavedContent] = useState(props.initialContent);
  const pendingSaveRef = useRef(props.initialContent);
  useEffect(() => {
    if (saveState === "saved") {
      setLastSavedContent(pendingSaveRef.current);
    }
  }, [saveState]);

  const handleBlur = () => {
    if (content === lastSavedContent) return; // idle blur — no clobber, no PATCH
    pendingSaveRef.current = content;
    void save(content);
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <div className="mb-1 flex items-start justify-between gap-4">
        <h3 className="text-h3 font-semibold">Notes</h3>
        <NoteSaveStatus saveState={saveState} lastSavedAt={lastSavedAt} />
      </div>
      <p className="text-caption text-text-muted mb-3">
        Private — visible only to you.
      </p>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add a private note about your allocation book — markdown supported. Visible only to you."
        rows={6}
        className="w-full resize-none rounded border border-border p-2 text-body leading-[1.6] focus:border-focus focus:outline-none"
      />
      {content ? (
        <div className="mt-3">
          <NoteRender content={content} />
        </div>
      ) : null}
    </div>
  );
}
