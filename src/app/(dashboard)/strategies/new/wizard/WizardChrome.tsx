"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WizardStepKey } from "@/lib/wizard/localStorage";

/**
 * WizardChrome renders the persistent wizard shell: hairline progress
 * rail, Delete draft and Request a Call links, and the "Progress saved"
 * toast. All step state lives in WizardClient.
 */

const DEFAULT_STEPS: { key: WizardStepKey; label: string; number: string }[] = [
  { key: "connect_key", label: "Connect key", number: "01" },
  { key: "sync_preview", label: "Verify data", number: "02" },
  { key: "metadata", label: "Strategy profile", number: "03" },
  // Phase 53 / APPLY-02 — read-only Review & confirm recap before Submit.
  { key: "review", label: "Review & confirm", number: "04" },
  { key: "submit", label: "Submit", number: "05" },
];

/**
 * Phase 15 / CSV-01..CSV-02 originally shipped a 3-step CSV branch
 * (D-03). QA report 2026-05-21 ISSUE-010 added a fourth step between
 * Preview and Submit so the user can classify the strategy before
 * persisting — without this step the CSV branch was writing
 * category_id=null and empty type/market/exchange arrays, leaving the
 * strategy invisible to discovery + bare in lists.
 */
const CSV_STEPS: { key: WizardStepKey; label: string; number: string }[] = [
  { key: "csv_upload", label: "Upload CSV", number: "01" },
  { key: "csv_preview", label: "Preview", number: "02" },
  { key: "csv_metadata", label: "Strategy profile", number: "03" },
  // Phase 53 / APPLY-02 — read-only Review & confirm recap before Submit.
  { key: "csv_review", label: "Review & confirm", number: "04" },
  { key: "csv_submit", label: "Submit", number: "05" },
];

/** Re-export of CSV_STEPS for the WizardClient ?source=csv branch. */
export const WIZARD_STEPS_CSV = CSV_STEPS;

export interface WizardChromeProps {
  currentStep: WizardStepKey;
  /** Shown next to the progress rail as "Saved 2 minutes ago". */
  savedAt: number | null;
  /** True when Delete draft should be visible (draft exists server-side). */
  canDelete: boolean;
  /** Delete draft callback. Confirmation dialog lives in the parent. */
  onDeleteDraft: () => void;
  /** "Request a Call" callback. Parent opens the RequestCallModal. */
  onRequestCall: () => void;
  /** Optional: tick the "Progress saved" toast. Called after each step save. */
  toastKey?: number;
  /**
   * Phase 15: optional steps override. Absent ⇒ DEFAULT_STEPS (5-step API
   * branch, after the Phase 53 Review step). Pass `WIZARD_STEPS_CSV` to render
   * the 5-step CSV branch stepper.
   */
  steps?: { key: WizardStepKey; label: string; number: string }[];
  /**
   * Phase 15 follow-up: branch which static chrome copy renders. The
   * default subtitle is API-specific ("Paste a read-only API key …") —
   * pass `"csv"` on the `?source=csv` branch to render CSV-appropriate
   * copy. Absent ⇒ "api" (back-compat). The H1 is intentionally neutral
   * across both branches.
   */
  source?: "api" | "csv";
  /**
   * Phase 94 / WIZ-04: fired when the user activates a navigable step cell
   * (click or Enter). Absent ⇒ the stepper renders as inert `<div>` cells,
   * byte-identical to the pre-WIZ-04 markup (CSV branch stays inert).
   */
  onStepSelect?: (key: WizardStepKey) => void;
  /**
   * Phase 94 / WIZ-04: per-step navigability predicate owned by WizardClient
   * (it holds the completion state). A cell is rendered as a real `<button>`
   * only when it is non-active, `onStepSelect` is provided, and this returns
   * true. Absent ⇒ no cell is navigable.
   */
  stepNavigable?: (key: WizardStepKey) => boolean;
  children: React.ReactNode;
}

// Stepper grid columns by step count. Full literals (no template) so Tailwind's
// class scanner emits every variant. 5-col is the default for both branches
// post-Phase-53; the 3/4-col arms cover any caller passing a shorter `steps`.
const GRID_COLS_BY_COUNT: Record<number, string> = {
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-4",
};

export function WizardChrome({
  currentStep,
  savedAt,
  canDelete,
  onDeleteDraft,
  onRequestCall,
  toastKey,
  steps,
  source,
  onStepSelect,
  stepNavigable,
  children,
}: WizardChromeProps) {
  const activeSteps = steps ?? DEFAULT_STEPS;
  const totalCount = activeSteps.length;
  const totalLabel = String(totalCount).padStart(2, "0");
  // Phase 46 / WIZARD-01 reflow: the stepper rail is a fixed N-column grid on
  // ≥sm (640px) but stacks to a single column below it. With a bare
  // grid-cols-N the step cells (each holding "04 / 05" + a label like
  // "Review & confirm") force horizontal page overflow at 320px. Stacking
  // them keeps every step label fully visible — no truncation, no scroll —
  // and the existing top/bottom hairline borders read as a vertical list.
  //
  // Phase 53 / APPLY-02 added a Review step so both branches are now 5-step;
  // GRID_COLS_BY_COUNT (module scope) maps the count to the literal classes.
  const gridColsClass =
    GRID_COLS_BY_COUNT[totalCount] ?? "grid-cols-1 sm:grid-cols-5";
  const isCsv = source === "csv";
  const [showToast, setShowToast] = useState(false);

  // Defer both state writes into setTimeout callbacks so no setState
  // runs synchronously inside the effect body (React Compiler rule).
  useEffect(() => {
    if (toastKey === undefined) return;
    const showTimer = setTimeout(() => setShowToast(true), 0);
    const hideTimer = setTimeout(() => setShowToast(false), 2000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [toastKey]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="font-display text-page-title tracking-tight text-text-primary">
          Connect Your Strategy
        </h1>
        <p className="mt-2 text-body text-text-secondary">
          {isCsv
            ? "Upload a daily-returns, NAV, or trades CSV. We validate every row before computing your factsheet."
            : "Paste a read-only API key. We will compute your verified factsheet in the next screen."}
        </p>
      </header>

      <div
        className="mb-8 border-t border-border"
        role="navigation"
        aria-label="Wizard progress"
      >
        <div className={`grid ${gridColsClass} border-b border-border`}>
          {activeSteps.map((step) => {
            const isActive = step.key === currentStep;
            const isPast =
              activeSteps.findIndex((s) => s.key === step.key) <
              activeSteps.findIndex((s) => s.key === currentStep);
            // Phase 94 / WIZ-04: a cell is activatable only when it is not the
            // active step, an onStepSelect seam is wired (API branch), and the
            // WizardClient-owned predicate marks it navigable. Otherwise the
            // cell stays an inert <div>, keeping the CSV branch byte-identical.
            const navigable =
              !isActive && !!onStepSelect && (stepNavigable?.(step.key) ?? false);
            // Border/text token ladders are byte-identical across the <button>
            // and <div> branches — no new visual language (DESIGN.md:241/:302).
            const borderClass = isActive
              ? "border-accent"
              : isPast
                ? "border-border"
                : "border-transparent";
            const labelClass = isActive
              ? "text-text-primary"
              : isPast
                ? "text-text-secondary"
                : "text-text-muted";
            const inner = (
              <>
                <p className="font-metric text-micro uppercase tracking-wider tabular-nums text-text-muted">
                  {step.number} / {totalLabel}
                </p>
                <p className={`mt-0.5 text-caption font-medium ${labelClass}`}>
                  {step.label}
                </p>
              </>
            );
            if (navigable) {
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => onStepSelect?.(step.key)}
                  data-testid={`wizard-step-${step.key}`}
                  className={`w-full cursor-pointer border-b-2 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:text-text-primary ${borderClass}`}
                >
                  {inner}
                </button>
              );
            }
            return (
              <div
                key={step.key}
                className={`border-b-2 px-3 py-3 transition-colors ${borderClass}`}
                aria-current={isActive ? "step" : undefined}
              >
                {inner}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-1 py-2">
          <p className="text-micro text-text-muted tabular-nums">
            {savedAt ? (
              <span data-testid="wizard-saved-at">
                Draft saved · {new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : (
              <span className="text-text-muted">Not saved yet</span>
            )}
          </p>
          {canDelete && (
            <button
              type="button"
              onClick={onDeleteDraft}
              className="text-micro text-text-muted underline-offset-4 hover:text-negative hover:underline"
              data-testid="wizard-delete-draft"
            >
              Delete draft
            </button>
          )}
        </div>
      </div>

      <div className="relative">
        {children}

        {showToast && (
          <div
            className="pointer-events-none absolute -top-2 right-0 rounded-md border border-border bg-white px-3 py-1.5 text-micro font-medium text-positive shadow-sm"
            role="status"
            aria-live="polite"
            data-testid="wizard-progress-saved-toast"
          >
            Progress saved
          </div>
        )}
      </div>

      <footer className="mt-12 border-t border-border pt-6">
        <div className="flex items-center justify-between">
          <p className="text-caption text-text-muted">
            Wizard help ·{" "}
            <Link
              href="/security"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline-offset-4 hover:underline"
            >
              Review our security posture →<span className="sr-only"> (opens in new tab)</span>
            </Link>
          </p>
          <button
            type="button"
            onClick={onRequestCall}
            className="text-caption text-text-muted underline-offset-4 hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:text-text-primary focus-visible:underline"
            data-testid="wizard-request-call"
          >
            Stuck? Request a Call →
          </button>
        </div>
      </footer>
    </div>
  );
}
