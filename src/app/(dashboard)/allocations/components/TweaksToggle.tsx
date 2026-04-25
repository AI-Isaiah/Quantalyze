"use client";

import { useTweaks } from "../context/TweaksContext";

/**
 * PR3 (HANDOFF G5) — Header Tweaks toggle
 *
 * Pixel-faithful port of the truth screenshot's top-right "Tweaks [switch]"
 * affordance. Mounted alongside the Widget / Export / + Allocation chip
 * group inside AllocationsTabs. Tied to TweaksContext.panelOpen — clicking
 * toggles the floating panel mounted at AllocationDashboardV2 root.
 *
 * The button uses an iOS-style switch indicator so the on/off state is
 * legible at a glance, mirroring the prototype where the parent Figma
 * harness exposed an "edit mode" toggle. data-tweaks-toggle is read by
 * the panel's outside-click guard so clicking the toggle to close the
 * panel doesn't double-fire.
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
      className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span>Tweaks</span>
      <span
        aria-hidden
        style={{
          position: "relative",
          display: "inline-block",
          width: 26,
          height: 14,
          borderRadius: 9999,
          background: panelOpen
            ? "var(--color-accent)"
            : "var(--color-border)",
          transition: "background-color 150ms ease-out",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 1,
            left: panelOpen ? 13 : 1,
            width: 12,
            height: 12,
            borderRadius: 9999,
            background: "var(--color-surface)",
            boxShadow: "0 1px 2px rgba(15, 23, 42, 0.18)",
            transition: "left 150ms ease-out",
          }}
        />
      </span>
    </button>
  );
}
