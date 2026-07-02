"use client";

import { useState } from "react";

/**
 * ProvenanceNote (v1.5 PERSIST-01) — the pre-coverage-window upgrade note.
 *
 * Shown ONLY when reopening a pre-v1.5 (v2, windowless) saved scenario that the
 * codec upgraded on read (decode `reason === "upgraded_v2_windowless"`) and whose
 * coverage window therefore defaulted to the intersection ("common period"). It
 * tells the allocator plainly that this saved scenario predates coverage windows
 * and is being shown at the common period, with a one-click escape hatch back to
 * the full range (the existing Full-range preset).
 *
 * This is a THIN copy+dismissal variant of the POLISH-03 change note
 * (Claude's-discretion "thin wrapper" option, 59-CONTEXT section 4): it renders
 * the SAME `role="status"` live-region shell, the same DESIGN.md tokens, the same
 * accent inline action and `×` dismiss. It is an informational status note, NOT a
 * warning-tier alert.
 *
 * KEY DIVERGENCE from the POLISH-03 note (59-UI-SPEC Interaction contract /
 * Phase-59 Pitfall 3): dismissal here is EPHEMERAL per-open — a component-local
 * `useState`, deliberately NOT the cross-tab persistent-storage primitive and NOT
 * the POLISH-03 global dismissal key that note uses. The provenance note is a
 * PER-SCENARIO data-provenance signal that must re-show whenever ANOTHER old draft
 * is reopened; reusing the global POLISH-03 flag would silently suppress it forever
 * after a single dismissal. Remounting the component (a fresh reopen) re-shows it.
 *
 * No icons — the `×` is a text glyph. Only DESIGN.md tokens; no raw font px.
 */
export interface ProvenanceNoteProps {
  /** The escape hatch — apply the existing Full-range preset (union). */
  onShowFullRange: () => void;
}

export function ProvenanceNote({ onShowFullRange }: ProvenanceNoteProps) {
  // EPHEMERAL per-open dismissal — component-local ONLY. A fresh reopen remounts
  // this component (or re-gates its render on the composer's per-open provenance
  // flag), so an old draft opened after a dismissal shows the note again.
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="scenario-provenance-note"
      className="mt-6 flex items-start justify-between gap-3 rounded-md border border-border bg-surface-subtle px-4 py-3"
    >
      <p className="text-fixed-13 leading-relaxed text-text-secondary">
        This saved scenario predates coverage windows — showing the common period ·{" "}
        <button
          type="button"
          // Ship-review RT-2 — taking the escape hatch DISMISSES the note: after
          // "Show full range" the window is the union, so leaving the banner up
          // would keep claiming "showing the common period" over a full-range
          // window (stale-dishonest copy). Belt to the composer's
          // active-window-is-common-period render gate (braces).
          onClick={() => {
            setDismissed(true);
            onShowFullRange();
          }}
          className="rounded-sm font-medium text-accent transition-colors duration-150 ease-out hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none"
        >
          Show full range
        </button>
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-fixed-13 text-text-muted transition-colors duration-150 ease-out hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none"
      >
        ×
      </button>
    </div>
  );
}
