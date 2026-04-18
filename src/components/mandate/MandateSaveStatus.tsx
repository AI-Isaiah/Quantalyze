"use client";

import type { SaveState } from "./useMandateAutoSave";
import { formatRelativeTime } from "./formatRelativeTime";

interface Props {
  saveState: SaveState;
  lastSavedAt: Date | null;
  /** Test seam: inject a fixed `now` for deterministic rendering under jsdom. */
  now?: number;
}

/**
 * Form-level aria-live region. Per UI-SPEC (D-16 reinterpretation), the
 * "toast" is an inline region — no floating-toast dependency. The text
 * briefly flashes "Mandate saved" (2s) then reverts to the relative
 * timestamp, preserving the toast UX shape.
 */
export function MandateSaveStatus({ saveState, lastSavedAt, now }: Props) {
  const showSavedFlash = saveState === "saved";
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="mandate-save-status"
      className="text-xs text-text-muted font-metric tabular-nums tracking-tight"
    >
      {showSavedFlash && (
        <span className="mandate-saved-flash inline-flex items-center gap-1.5 text-text-primary">
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-accent/10 text-accent"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path
                d="M1.5 4l2 2 3-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          Mandate saved
        </span>
      )}
      {!showSavedFlash && lastSavedAt && (
        <span>Last saved: {formatRelativeTime(lastSavedAt.getTime(), now)}</span>
      )}
      {!showSavedFlash && !lastSavedAt && <span>Not saved yet</span>}
    </div>
  );
}
