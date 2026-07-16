"use client";

/**
 * Phase 110 / CONTRIB-01 — ContributionWizardOverlay.
 *
 * The reusable inline overlay that mounts the onboarding wizard for an
 * allocator WITHOUT any URL navigation. This is the unit plan 110-05 (nav
 * entry + Browse "Add your own" CTA) and Phase 116 ("+ Allocation") mount —
 * all they do is control `isOpen`; the overlay is agnostic of its trigger.
 *
 * Why an overlay and not a route: `/strategies/new/wizard` lives under the
 * manager-guarded `strategies/` subtree (locked manager-only in Phase 109).
 * Routing an allocator there would `redirect()`-bounce them off. Mounting the
 * wizard inline via `createPortal` carves allocator wizard access WITHOUT
 * weakening the 109 guard or re-opening the route (CONTEXT lock).
 *
 * Layered analogs (all sibling `allocations/components/` overlays, so the
 * a11y + visual treatment is already DESIGN.md-conformant):
 * - StrategyBrowseDrawer — isOpen/onClose contract, Esc handler, hooks-above-
 *   null-gate discipline.
 * - ScenarioCommitDrawer — createPortal-to-document.body fixed-inset shell.
 *
 * Source toggle: the manager page keys its CSV↔API branch off `?source=csv`
 * (wizard/page.tsx:120). The overlay has NO route searchParams (Pitfall 3), so
 * it owns the toggle in state and drives the remount with `key={source}` — the
 * same keying discipline, minus the URL.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WizardClient } from "@/app/(dashboard)/strategies/new/wizard/WizardClient";

export interface ContributionWizardOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  /** Receives the finalized (private) strategy id when the wizard completes. */
  onSuccess?: (strategyId: string) => void;
}

export function ContributionWizardOverlay({
  isOpen,
  onClose,
  onSuccess,
}: ContributionWizardOverlayProps) {
  // The overlay owns the CSV↔API branch (no route searchParams, Pitfall 3).
  // `key={source}` on WizardClient below drives the remount on toggle, exactly
  // like the manager page's URL keying (wizard/page.tsx:120).
  const [source, setSource] = useState<"api" | "csv">("api");
  // Panel node so we can pull focus INTO the dialog on open (see below).
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc-to-dismiss + reset-on-close. Hooks MUST run unconditionally, so this
  // sits ABOVE the `!isOpen` early return (StrategyBrowseDrawer discipline).
  // Resetting source to "api" on close means every fresh open starts on the
  // API-key branch, matching the fresh-wizard (initialDraft=null) semantics.
  useEffect(() => {
    if (!isOpen) {
      // Close-reset (same pattern StrategyBrowseDrawer:210-227 blesses): the
      // overlay stays mounted while closed (renders null), so reset the source
      // toggle to its default so a reopen always starts on the API branch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSource("api");
      return;
    }
    // Move focus INTO the dialog on open. Without this, opening from the mobile
    // drawer leaves focus on the hamburger BEHIND the portalled overlay (the
    // drawer's close transition calls triggerRef.focus()), so a Tab would walk
    // background content — WCAG 2.4.3. Focusing the tabIndex=-1 panel parks
    // focus inside the modal; the first Tab then lands on a real control. This
    // mirrors MobileSidebarDrawer's initial-focus pattern (minus the full Tab
    // trap, which matches the sibling ScenarioCommitDrawer precedent).
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add a strategy"
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-[rgba(15,23,42,0.5)] p-6"
      // Backdrop click dismisses; clicks inside the panel are stopped below.
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="my-8 w-[760px] max-w-[92vw] rounded-lg border border-border bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.04)] outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="text-lg font-semibold text-text-primary">
            Add a strategy
          </div>
          <div className="flex items-center gap-3">
            {/* Source selector — the overlay's stand-in for the manager page's
                ?source=csv URL switch. Toggling remounts WizardClient via the
                key below (keyed CSV↔API remount). */}
            <div
              className="flex items-center gap-1 rounded-md border border-border p-0.5"
              role="group"
              aria-label="Track record source"
            >
              <SourcePill
                label="API key"
                active={source === "api"}
                onClick={() => setSource("api")}
                testId="overlay-source-api"
              />
              <SourcePill
                label="CSV upload"
                active={source === "csv"}
                onClick={() => setSource("csv")}
                testId="overlay-source-csv"
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-text-muted hover:text-text-primary"
            >
              ×
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          {/*
            initialDraft={null} = a fresh wizard on every open. The overlay does
            not resume server drafts in Phase 110; any abandoned overlay draft is
            reaped by the wizard-draft cleanup cron (migration 20260713120000).
            key={source} drives the CSV↔API remount (Pitfall 3 — no URL keying).
          */}
          <WizardClient
            key={source}
            entryContext="contribution"
            sourceOverride={source}
            initialDraft={null}
            onSuccess={(id) => onSuccess?.(id)}
            onClose={onClose}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SourcePill({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={`rounded px-2.5 py-1 text-xs ${
        active
          ? "bg-accent text-white"
          : "text-text-secondary hover:text-text-primary"
      }`}
    >
      {label}
    </button>
  );
}
