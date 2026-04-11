"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WizardStepKey } from "@/lib/wizard/localStorage";

/**
 * WizardChrome renders the persistent wizard shell: hairline progress
 * rail, Delete draft and Request a Call links, and the "Progress saved"
 * toast. All step state lives in WizardClient.
 */

const STEPS: { key: WizardStepKey; label: string; number: string }[] = [
  { key: "connect_key", label: "Connect key", number: "01" },
  { key: "sync_preview", label: "Verify data", number: "02" },
  { key: "metadata", label: "Strategy profile", number: "03" },
  { key: "submit", label: "Submit", number: "04" },
];

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
  children: React.ReactNode;
}

export function WizardChrome({
  currentStep,
  savedAt,
  canDelete,
  onDeleteDraft,
  onRequestCall,
  toastKey,
  children,
}: WizardChromeProps) {
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
        <h1 className="font-display text-3xl tracking-tight text-text-primary md:text-[32px]">
          Connect Your Strategy
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Paste a read-only API key. We will compute your verified factsheet in the next screen.
        </p>
      </header>

      <div
        className="mb-8 border-t border-border"
        role="navigation"
        aria-label="Wizard progress"
      >
        <div className="grid grid-cols-4 border-b border-border">
          {STEPS.map((step) => {
            const isActive = step.key === currentStep;
            const isPast =
              STEPS.findIndex((s) => s.key === step.key) <
              STEPS.findIndex((s) => s.key === currentStep);
            return (
              <div
                key={step.key}
                className={`border-b-2 px-3 py-3 transition-colors ${
                  isActive
                    ? "border-accent"
                    : isPast
                      ? "border-border"
                      : "border-transparent"
                }`}
                aria-current={isActive ? "step" : undefined}
              >
                <p className="font-metric text-[10px] uppercase tracking-wider tabular-nums text-text-muted">
                  {step.number} / 04
                </p>
                <p
                  className={`mt-0.5 text-xs font-medium ${
                    isActive
                      ? "text-text-primary"
                      : isPast
                        ? "text-text-secondary"
                        : "text-text-muted"
                  }`}
                >
                  {step.label}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-1 py-2">
          <p className="text-[11px] text-text-muted tabular-nums">
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
              className="text-[11px] text-text-muted underline-offset-4 hover:text-negative hover:underline"
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
            className="pointer-events-none absolute -top-2 right-0 rounded-md border border-border bg-white px-3 py-1.5 text-[11px] font-medium text-positive shadow-sm"
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
          <p className="text-[11px] text-text-muted">
            Wizard help · <Link href="/security" className="underline-offset-4 hover:underline">Security practices</Link>
          </p>
          <button
            type="button"
            onClick={onRequestCall}
            className="text-xs text-text-muted underline-offset-4 hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:text-text-primary focus-visible:underline"
            data-testid="wizard-request-call"
          >
            Stuck? Request a Call →
          </button>
        </div>
      </footer>
    </div>
  );
}
