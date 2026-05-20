"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { trackFactsheetEvent } from "./factsheet-analytics";

/**
 * Broadcast on `window` to ask every CollapsibleSection in the tree to
 * pop open. Used by the ControlBar's "Reset view" button — see
 * FactsheetView.ControlBar.
 */
export const FACTSHEET_OPEN_ALL_EVENT = "factsheet-v2:open-all";

/**
 * Collapsible section wrapper for the factsheet — native <details> at the
 * core so it's keyboard-accessible by default, works without JS, and prints
 * with the user's last open/closed state. Persists per (strategyId, sectionId)
 * via localStorage so a reload restores the user's chosen layout.
 *
 * Panel-interactivity best practice: collapsing the heaviest below-fold
 * sections lets allocators focus on what matters for their thesis. Default
 * varies by section — heavy/optional content starts collapsed on mobile.
 */
export function CollapsibleSection({
  id,
  title,
  subtitle,
  defaultOpen = true,
  storageKey,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  storageKey?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [hydrated, setHydrated] = useState(false);

  // Two-pass mount: SSR renders the default; on hydration we read the user's
  // last choice from localStorage if a storageKey was provided.
  useEffect(() => {
    if (!storageKey) { setHydrated(true); return; }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === "open") setOpen(true);
      else if (raw === "closed") setOpen(false);
    } catch { /* private mode / quota */ }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated || !storageKey) return;
    try {
      window.localStorage.setItem(storageKey, open ? "open" : "closed");
    } catch { /* private mode / quota */ }
  }, [open, storageKey, hydrated]);

  // "Reset view" broadcasts FACTSHEET_OPEN_ALL_EVENT so every collapsed
  // section pops back open. We listen here rather than in a parent so
  // sections that were rendered conditionally still register cleanly.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setOpen(true);
    window.addEventListener(FACTSHEET_OPEN_ALL_EVENT, handler);
    return () => window.removeEventListener(FACTSHEET_OPEN_ALL_EVENT, handler);
  }, []);

  return (
    <details
      id={id}
      open={open}
      onToggle={e => {
        const nextOpen = (e.target as HTMLDetailsElement).open;
        // Only fire analytics for user-initiated toggles (skip the initial
        // mount when we're matching the stored preference).
        if (hydrated && nextOpen !== open) {
          trackFactsheetEvent("factsheet_v2_section_toggle", { section: id, open: nextOpen });
        }
        setOpen(nextOpen);
      }}
      className="group"
    >
      <summary className="flex items-baseline justify-between gap-3 cursor-pointer list-none border-b border-border py-3 mb-4 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm min-h-[44px]">
        <div className="flex items-baseline gap-3">
          <span
            aria-hidden
            className="inline-block w-2 h-2 transition-transform group-open:rotate-90"
            style={{
              borderTop: "4px solid transparent",
              borderBottom: "4px solid transparent",
              borderLeft: "5px solid var(--color-text-muted)",
            }}
          />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
            {title}
          </h2>
          {subtitle && (
            <span className="text-[11px] text-text-muted normal-case tracking-normal">
              {subtitle}
            </span>
          )}
        </div>
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted">
          {open ? "Hide" : "Show"}
        </span>
      </summary>
      <div className="flex flex-col gap-10">{children}</div>
    </details>
  );
}
