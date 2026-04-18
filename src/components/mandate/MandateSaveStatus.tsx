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
      className="text-xs text-text-muted font-metric"
    >
      {showSavedFlash && (
        <span>
          <span className="text-accent" aria-hidden="true">
            {"\u2713"}
          </span>
          {" "}Mandate saved
        </span>
      )}
      {!showSavedFlash && lastSavedAt && (
        <span>Last saved: {formatRelativeTime(lastSavedAt.getTime(), now)}</span>
      )}
      {!showSavedFlash && !lastSavedAt && <span>Not saved yet</span>}
    </div>
  );
}
