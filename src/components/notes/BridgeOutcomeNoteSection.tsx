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

import { useEffect, useRef, useState } from "react";
import { NoteRender } from "./NoteRender";
import { useNoteAutoSave } from "./useNoteAutoSave";
import { NoteSaveStatus } from "./NoteSaveStatus";
import { shouldSaveNoteOnBlur } from "./should-save-note";

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
  // WR-02: a failed load is a DISTINCT state from "no note yet" — only a
  // genuine 404 means empty. Any other failure sets loadError, and nothing is
  // saved while it is set, so typing can never overwrite an unread server note.
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

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
          setPersisted(c);
          pendingSaveRef.current = c;
          setInitialSavedAt(
            json.updated_at ? new Date(json.updated_at as string) : null,
          );
          // Existing content → open in read mode. Empty → edit mode so
          // the placeholder guides the first-time user.
          setEditing(!c);
        } else if (!cancelled && res.status === 404) {
          // No existing note — start in edit mode with empty placeholder.
          setEditing(true);
        } else if (!cancelled) {
          // 401/403/429/5xx → load failed. Do NOT enter edit mode (typing there
          // would overwrite the unread server note on blur).
          console.error(
            "[BridgeOutcomeNoteSection] notes load failed",
            res.status,
            outcomeId,
          );
          setLoadError(true);
        }
      } catch (err) {
        // Network drop / JSON parse error → same loud-fail path as a 5xx.
        if (!cancelled) {
          console.error(
            "[BridgeOutcomeNoteSection] notes load failed",
            err,
            outcomeId,
          );
          setLoadError(true);
        }
      } finally {
        if (!cancelled) setInitialLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outcomeId, loadAttempt]);

  function retryLoad() {
    setLoadError(false);
    setInitialLoaded(false);
    setLoadAttempt((n) => n + 1);
  }

  const { saveState, lastSavedAt, save } = useNoteAutoSave(
    "bridge_outcome",
    outcomeId,
    initialSavedAt,
  );

  // Phase 193 D-09: last content known to be persisted. Seeded from the GET
  // ("" only on a 404; any other failed load sets loadError and nothing saves)
  // and advanced only when a save reports "saved", so a failed save stays
  // dirty and a later blur retries.
  const [persisted, setPersisted] = useState("");
  const pendingSaveRef = useRef("");
  useEffect(() => {
    if (saveState === "saved") setPersisted(pendingSaveRef.current);
  }, [saveState]);

  // Focus moves only from an explicit Edit click, once the textarea mounts.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusOnEditRef = useRef(false);
  useEffect(() => {
    if (editing && focusOnEditRef.current) {
      focusOnEditRef.current = false;
      textareaRef.current?.focus();
    }
  }, [editing]);

  const onBlurTextarea = () => {
    // Never persist a draft when the initial load failed — we don't know the
    // server-side content, so a save here would clobber it (data-loss fence).
    if (loadError) return;
    // While a save is in flight the server will end at what was last sent, so
    // compare against that, not the last confirmed value (WR-01).
    const baseline = saveState === "saving" ? pendingSaveRef.current : persisted;
    // A failed save leaves the server state unknown (a superseded save may have
    // committed), so "Save failed — retry" must really retry: send the draft.
    if (saveState !== "error" && !shouldSaveNoteOnBlur(draft, baseline)) {
      // Nothing to write (D-09): show what is stored.
      setDraft(baseline);
      setContent(baseline);
      setEditing(baseline === "");
      return;
    }
    const payload = draft;
    pendingSaveRef.current = payload;
    setContent(payload);
    void save(payload);
    if (payload) setEditing(false);
  };

  if (!initialLoaded) {
    return <p className="text-sm text-text-muted">Loading…</p>;
  }

  return (
    <div>
      {loadError ? (
        <div role="alert" className="text-xs text-text-muted">
          <p>Couldn&apos;t load your note. Your saved note is safe.</p>
          <button
            type="button"
            onClick={retryLoad}
            className="mt-2 text-xs text-accent underline hover:text-accent-hover"
          >
            Retry
          </button>
        </div>
      ) : editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={onBlurTextarea}
          placeholder="No note for this outcome. Start typing to add one."
          ref={textareaRef}
          rows={4}
          className="w-full resize-none rounded border border-border p-2 font-mono text-fixed-13 leading-[1.6] focus:border-accent focus:outline-none"
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
            onClick={() => {
              focusOnEditRef.current = true;
              setEditing(true);
            }}
            className="mt-2 text-xs text-accent underline hover:text-accent-hover"
          >
            Edit
          </button>
        </div>
      )}
      {loadError ? null : (
        <NoteSaveStatus saveState={saveState} lastSavedAt={lastSavedAt} />
      )}
    </div>
  );
}
