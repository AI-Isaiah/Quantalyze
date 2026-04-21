"use client";

/**
 * Phase 08 Plan 03 — NotesWidget (portfolio-scope).
 *
 * Upgraded in place to consume the three shared primitives:
 *   - NoteRender for read mode (rehype-sanitize markdown)
 *   - useNoteAutoSave for on-blur PATCH with generation-guard + 5xx retry
 *     (NO unmount flush — blur is the sole persistence trigger per S2)
 *   - NoteSaveStatus for aria-live status line (mirrors MandateSaveStatus)
 *
 * Route shape change: the GET now uses the multi-scope query params
 * (?scope_kind=portfolio&scope_ref=…) per Plan 01's route rewrite. The
 * PATCH body shape flows through useNoteAutoSave.
 */

import { useEffect, useState } from "react";
import type { WidgetProps } from "../../lib/types";
import { NoteRender } from "@/components/notes/NoteRender";
import { NoteSaveStatus } from "@/components/notes/NoteSaveStatus";
import { useNoteAutoSave } from "@/components/notes/useNoteAutoSave";

export function NotesWidget({ data }: WidgetProps) {
  const portfolioId: string | undefined = data?.portfolio?.id;
  const scopeRef = portfolioId ?? "";
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { saveState, lastSavedAt, save } = useNoteAutoSave(
    "portfolio",
    scopeRef,
    null,
  );

  // Load notes on mount
  useEffect(() => {
    if (!portfolioId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/notes?scope_kind=portfolio&scope_ref=${encodeURIComponent(portfolioId)}`,
          { credentials: "same-origin" },
        );
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            const c = (json.content as string | undefined) ?? "";
            setNotes(c);
            setDraft(c);
          }
        }
        // 404 is fine — no note exists yet
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portfolioId]);

  // Keep draft in sync with notes whenever we're in read mode (e.g. refetch
  // re-hydrated content). In edit mode, draft is authoritative.
  useEffect(() => {
    if (!editing) setDraft(notes);
  }, [notes, editing]);

  const onBlurTextarea = () => {
    // Commit the draft to the displayed notes and fire the PATCH. If there's
    // no portfolio yet, short-circuit — there's nothing to scope the save to.
    if (!portfolioId) {
      setEditing(false);
      return;
    }
    const payload = draft;
    setNotes(payload);
    setEditing(false);
    void save(payload);
  };

  return (
    <div className="flex h-full flex-col gap-2">
      {!loaded ? (
        <div className="flex-1 w-full text-sm text-text-muted">Loading…</div>
      ) : editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={onBlurTextarea}
          placeholder="Portfolio notes — markdown supported."
          autoFocus
          className="flex-1 w-full resize-none rounded border border-border p-2 font-mono text-[13px] leading-[1.6] focus:border-accent focus:outline-none"
        />
      ) : (
        <div className="flex-1 overflow-auto">
          {notes ? (
            <NoteRender content={notes} />
          ) : (
            <p className="text-sm text-text-muted">
              Portfolio notes — markdown supported.
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
