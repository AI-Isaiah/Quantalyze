"use client";

/**
 * NoteSaveStatus.
 *
 * Aria-live status line shared across all 4 note scopes. Cloned from
 * MandateSaveStatus with copy swaps:
 *
 *   - "Mandate saved" → "Note saved" (2s flash; reuses `.mandate-saved-flash`
 *     CSS keyframe + the same checkmark SVG + `bg-accent/10 text-accent` chip).
 *   - "Not saved yet" (idle + no timestamp) → empty (no noise).
 *   - New "Save failed — retry" state (error branch) — MandateSaveStatus uses
 *     per-field fieldErrors for this; notes are single-content-per-hook.
 *
 * formatRelativeTime is reused directly from ../mandate/formatRelativeTime —
 * no duplication.
 */

import { useEffect, useState } from "react";
import type { SaveState } from "./useNoteAutoSave";
import { formatRelativeTime } from "../mandate/formatRelativeTime";

interface Props {
  saveState: SaveState;
  lastSavedAt: Date | null;
  /** Test seam: inject a fixed `now` for deterministic rendering under jsdom.
   *  When undefined, the component self-ticks every 15s so the relative
   *  label ("just now" → "1 min ago" → ...) advances without a reload. */
  now?: number;
  /** Test seam: override the tick interval. Default 15s. */
  tickIntervalMs?: number;
}

export function NoteSaveStatus({
  saveState,
  lastSavedAt,
  now,
  tickIntervalMs = 15_000,
}: Props) {
  const [tickNow, setTickNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (now !== undefined) return; // Fixed `now` supplied by tests — do not tick.
    if (!lastSavedAt) return; // No timestamp yet — nothing to refresh.
    const id = setInterval(() => setTickNow(Date.now()), tickIntervalMs);
    return () => clearInterval(id);
  }, [now, lastSavedAt, tickIntervalMs]);
  const effectiveNow = now ?? tickNow;
  const showSavedFlash = saveState === "saved";
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="note-save-status"
      className="text-xs text-text-muted font-metric tabular-nums tracking-tight"
    >
      {saveState === "saving" && <span>Saving…</span>}
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
          Note saved
        </span>
      )}
      {saveState === "idle" && lastSavedAt && (
        <span>Last saved: {formatRelativeTime(lastSavedAt.getTime(), effectiveNow)}</span>
      )}
      {saveState === "error" && (
        <span className="text-negative">Save failed — retry</span>
      )}
      {/* idle + no lastSavedAt renders nothing */}
    </div>
  );
}
