"use client";

import { useTweaks } from "../context/TweaksContext";

/**
 * PR3 (HANDOFF G5) — Floating Tweaks toggle
 *
 * Pixel-faithful port of the prototype's bottom-right "✻ Tweaks" chip
 * (visible in the truth screenshot at fixed bottom-right above the
 * sidebar avatar). Tied to TweaksContext.panelOpen — clicking toggles
 * the floating panel mounted next to it at AllocationDashboardV2 root.
 *
 * data-tweaks-toggle is read by the panel's outside-click guard so
 * clicking the toggle to close the panel doesn't double-fire (one click
 * → close).
 *
 * Position is fixed: bottom 20px, right 20px so the chip sits in the
 * dashboard's safe corner regardless of which tab is active. When the
 * panel is open the chip gains an accent border + filled accent
 * background so the on-state reads from across the screen.
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
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 49,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        fontSize: 12,
        fontWeight: 500,
        fontFamily: "var(--font-sans)",
        borderRadius: 9999,
        border: panelOpen
          ? "1px solid var(--color-accent)"
          : "1px solid var(--color-border)",
        background: panelOpen
          ? "color-mix(in srgb, var(--color-accent) 12%, var(--color-surface))"
          : "var(--color-surface)",
        color: panelOpen
          ? "var(--color-accent)"
          : "var(--color-text-secondary)",
        boxShadow: panelOpen
          ? "0 4px 12px rgba(27, 107, 90, 0.16)"
          : "0 2px 8px rgba(15, 23, 42, 0.06)",
        cursor: "pointer",
        transition:
          "background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out, box-shadow 150ms ease-out",
      }}
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
