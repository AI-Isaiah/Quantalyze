"use client";

import { useTweaks } from "../context/TweaksContext";

/**
 * Phase 170 / AD-05 — inline Tweaks toggle.
 *
 * The chip sits in the allocations header action row, between Export and
 * + Allocation, at every width. A fixed bottom-right chip collided with
 * the mobile nav (2026-09-26) and with the scenario footer's Commit
 * button (2026-09-27). Class list is the Export button's, plus shrink-0
 * and a coarse-pointer hit target. The pressed state is accent border,
 * text, and a 12% accent tint via aria-pressed variants (DESIGN.md
 * accent item 6) — no inline position.
 *
 * data-tweaks-toggle is read by the panel's outside-click guard so
 * clicking the toggle to close the panel doesn't double-fire (one click
 * → close).
 */

export function TweaksToggle() {
  const { panelOpen, togglePanel } = useTweaks();

  return (
    <button
      type="button"
      data-tweaks-toggle
      onClick={togglePanel}
      aria-pressed={panelOpen}
      aria-label="Toggle tweaks panel"
      title="Tweaks · design variations"
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-[44px] aria-pressed:border-accent aria-pressed:text-accent aria-pressed:bg-accent/10"
    >
      <SparkleIcon />
      <span>Tweaks</span>
    </button>
  );
}

function SparkleIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 1.75l1.4 3.85L13.25 7l-3.85 1.4L8 12.25 6.6 8.4 2.75 7l3.85-1.4L8 1.75z" />
      <path d="M12.75 11.25l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1z" />
    </svg>
  );
}
