"use client";

/**
 * StrategyNoteCard — strategy-scoped private note card.
 *
 * Full-width card on the /strategy/[id] factsheet, sandwiched between
 * the sparkline card and the CTA card. Consumes the three shared note
 * primitives (NoteRender + useNoteAutoSave + NoteSaveStatus).
 *
 * scope_kind = "strategy"; scope_ref = strategyId (strategies.id UUID).
 * The ownership predicate is strategies.status = 'published' — ANY
 * authenticated allocator can annotate any published strategy. RLS on
 * user_notes enforces per-allocator privacy.
 *
 * No unmount flush: if a future navigation path closes the page before
 * blur, the draft is lost.
 *
 * Opening writes nothing (Phase 193 D-09, TRUST-06): the textarea never takes
 * focus on open (an explicit Edit click focuses it), and a blur saves only when
 * `shouldSaveNoteOnBlur` says the draft differs from what is persisted. The
 * persisted baseline follows the DashboardNoteCard idiom: seeded from the
 * initial content and advanced only when the save reports "saved", so a failed
 * save stays dirty and a later blur retries.
 */

import { useEffect, useRef, useState } from "react";
import { NoteRender } from "./NoteRender";
import { useNoteAutoSave } from "./useNoteAutoSave";
import { NoteSaveStatus } from "./NoteSaveStatus";
import { shouldSaveNoteOnBlur } from "./should-save-note";

export interface StrategyNoteCardProps {
  strategyId: string;
  initialContent: string;
  initialLastSavedAt: Date | null;
}

export function StrategyNoteCard(props: StrategyNoteCardProps) {
  const { saveState, lastSavedAt, save } = useNoteAutoSave(
    "strategy",
    props.strategyId,
    props.initialLastSavedAt,
  );
  // Default into edit mode only when there's no prior content, matching
  // the HoldingNoteRow + BridgeOutcomeNoteSection pattern.
  const [editing, setEditing] = useState(!props.initialContent);
  const [draft, setDraft] = useState(props.initialContent);
  const [content, setContent] = useState(props.initialContent);

  // Last content known to be persisted; see the docblock.
  const [persisted, setPersisted] = useState(props.initialContent);
  const pendingSaveRef = useRef(props.initialContent);
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
    // While a save is in flight the server will end at what was last sent, so
    // compare against that, not the last confirmed value (WR-01).
    const baseline = saveState === "saving" ? pendingSaveRef.current : persisted;
    // A failed save leaves the server state unknown (a superseded save may have
    // committed), so "Save failed — retry" must really retry: send the draft.
    if (saveState !== "error" && !shouldSaveNoteOnBlur(draft, baseline)) {
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

  return (
    <div className="rounded-lg border border-border bg-surface p-4 mb-8">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
        Your note
      </p>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={onBlurTextarea}
          placeholder="Private note about this strategy — markdown supported."
          ref={textareaRef}
          rows={6}
          className="w-full resize-none rounded border border-border p-2 font-mono text-fixed-13 leading-[1.6] focus:border-accent focus:outline-none"
        />
      ) : (
        <div>
          {content ? (
            <NoteRender content={content} />
          ) : (
            <p className="text-sm text-text-muted">
              Private note about this strategy — markdown supported.
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
      <NoteSaveStatus saveState={saveState} lastSavedAt={lastSavedAt} />
    </div>
  );
}
