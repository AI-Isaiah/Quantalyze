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
 */

import { useState } from "react";
import { NoteRender } from "./NoteRender";
import { useNoteAutoSave } from "./useNoteAutoSave";
import { NoteSaveStatus } from "./NoteSaveStatus";

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

  const onBlurTextarea = () => {
    const payload = draft;
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
          autoFocus
          rows={6}
          className="w-full resize-none rounded border border-border p-2 font-mono text-[13px] leading-[1.6] focus:border-accent focus:outline-none"
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
