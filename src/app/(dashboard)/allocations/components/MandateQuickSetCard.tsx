"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { STRATEGY_TYPES } from "@/lib/constants";
import { useSessionStorageBoolean } from "@/lib/hooks/useSessionStorageBoolean";

/**
 * Phase 11 / 11-05 / S2 / ONBOARD-02 — Mandate quick-set card.
 *
 * Visibility predicate (UI-SPEC §Interaction Contract — parent gates):
 *   visible = (apiKeysCount === 0)
 *           && (mandateIsSet === false)
 *           && !sessionStorage["allocations.mandate_card_dismissed"]
 *
 * BLOCK-2 reconciliation (review feedback resolving Phase 02 D-09 LOCKED
 * vs Phase 11 D-04):
 *   - Input element renders with value="" (empty) and placeholder="e.g. 15"
 *     on first paint. This satisfies Phase 02 D-09 LOCKED — "all mandate
 *     fields blank / NULL on first-visit render. No default pre-fill."
 *   - Helper text below the input reads "Suggested: 15%. ..." which
 *     satisfies Phase 11 D-04 — the suggestion is visible to the user
 *     without being silently submitted.
 *   - Save button is DISABLED while the input is empty. The user must
 *     type a value to enable Save. This eliminates the "silent default
 *     save" risk that Phase 02 D-09 forbids.
 *   - If the user clears the input back to empty after typing, Save
 *     re-disables. There is no path to fire the RPC with an empty value.
 *
 * NO auto-save on first render (Phase 02 D-09 LOCKED — silent default
 * save is forbidden). Save button explicitly PUTs the user-typed
 * values to update_allocator_mandates RPC via /api/preferences. Per-
 * field PUT shape: `{ [field]: value }` (matches existing
 * useMandateAutoSave.ts:90 contract).
 */

const STORAGE_KEY = "allocations.mandate_card_dismissed";

interface Props {
  onSaved?: () => void;
  onSkipped?: () => void;
}

export function MandateQuickSetCard({ onSaved, onSkipped }: Props) {
  // Phase 11 review fix IN-01: useSessionStorageBoolean consolidates the
  // SSR-safe "render-then-hide-after-mount" pattern (RESEARCH Pitfall 6)
  // and the dismiss-flag write. Same precedent as OnboardingBanner.
  // `dismissed` represents the *persisted* dismiss state (Skip button —
  // sessionStorage flag). The post-save transient hide is a separate
  // local-only `savedHidden` so a successful save does NOT write the
  // sessionStorage flag (the server-side mandateIsSet=true on next page
  // load is the canonical "keep hidden" signal — this matches the
  // pre-IN-01 behavior).
  const [dismissed, setDismissed] = useSessionStorageBoolean(STORAGE_KEY);
  const [savedHidden, setSavedHidden] = useState(false);
  // BLOCK-2: empty string on first render (NOT "15"). Phase 02 D-09 LOCKED.
  const [maxWeightPct, setMaxWeightPct] = useState<string>("");
  const [preferredTypes, setPreferredTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // BLOCK-2: Save is disabled when the input is empty (also during in-flight
  // save). Trim handles whitespace-only values. This is the only path that
  // prevents silent default save — gating SAVE on a typed non-empty value.
  const isSaveDisabled = saving || maxWeightPct.trim() === "";

  const handleSave = async () => {
    // Defensive: callers cannot reach handleSave with an empty input
    // because the button is disabled, but check anyway.
    if (maxWeightPct.trim() === "") return;
    const pct = Number(maxWeightPct);
    if (!Number.isFinite(pct)) return;

    setSaving(true);
    setError(null);
    const max_weight = pct / 100;

    try {
      // Per-field PUT (matches existing useMandateAutoSave.ts:90 contract).
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_weight }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(`max_weight save returned ${res.status}`);
      }

      if (preferredTypes.length > 0) {
        const res2 = await fetch("/api/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferred_strategy_types: preferredTypes }),
          credentials: "same-origin",
        });
        if (!res2.ok) {
          throw new Error(
            `preferred_strategy_types save returned ${res2.status}`,
          );
        }
      }

      // Success — hide card for the rest of the session; rely on
      // server-side mandateIsSet=true on next page load to keep it hidden.
      // IN-01 fidelity: a successful save does NOT write the
      // sessionStorage flag — only Skip does — so the hook's setDismissed
      // is bypassed in favor of a local-only transient hide.
      setSavedHidden(true);
      onSaved?.();
    } catch (err) {
      setError("Could not save mandate. Please try again.");
      console.warn("[MandateQuickSetCard] save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    // Phase 11 IN-01: setDismissed(true) handles both the sessionStorage
    // write and the local-state update via the shared hook.
    setDismissed(true);
    onSkipped?.();
  };

  const toggleType = (t: string) => {
    setPreferredTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  if (dismissed || savedHidden) return null;

  return (
    <Card padding="md">
      <h2
        id="mandate-quick-set-heading"
        className="text-lg font-semibold text-text-primary leading-snug mb-2"
      >
        Mandate quick-set
      </h2>
      <p className="text-sm text-text-secondary leading-relaxed mb-4">
        Set how the Bridge ranks recommendations for you. We&apos;ve suggested
        defaults — review and save, or skip for now.
      </p>

      {/*
        Field 1 — max_weight (BLOCK-2: empty by default with placeholder
        suggestion; Save disabled until user types). Composes the project
        <Input> primitive (UI-FLAG-02 fix) so future Input chrome changes
        propagate. Suffix "%" is a sibling label — visual only; the input
        is the labelled control via htmlFor.
      */}
      <div className="mb-4">
        <label
          htmlFor="mqs-max-weight"
          className="block text-sm font-semibold text-text-primary mb-1"
        >
          Maximum weight per holding
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="mqs-max-weight"
            type="number"
            min={0}
            max={100}
            step={1}
            value={maxWeightPct}
            placeholder="e.g. 15"
            onChange={(e) => setMaxWeightPct(e.target.value)}
            wrapperClassName="flex-1"
          />
          <span aria-hidden="true" className="text-sm text-text-muted">
            %
          </span>
        </div>
        <p className="text-xs text-text-muted mt-1">
          Suggested: 15%. The Bridge flags any holding that exceeds this share
          of your portfolio.
        </p>
      </div>

      {/* Field 2 — preferred strategy types (chip multi-select) */}
      <div className="mb-4">
        <p className="block text-sm font-semibold text-text-primary mb-2">
          Preferred strategy types
        </p>
        <div
          role="group"
          aria-label="Preferred strategy types"
          className="flex flex-wrap gap-2"
        >
          {STRATEGY_TYPES.map((t) => {
            const active = preferredTypes.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                className={
                  active
                    ? "rounded-full border border-accent bg-accent px-3 py-1 text-xs text-white transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
                    : "rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-secondary transition-colors hover:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/50"
                }
              >
                {t}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-text-muted mt-1">
          Suggested: none — keep open until you&apos;ve seen a few Bridge
          picks.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="text-sm text-negative mb-3"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaveDisabled}
        >
          {saving ? "Saving…" : "Save mandate"}
        </Button>
        <button
          type="button"
          onClick={handleSkip}
          className="text-sm text-text-muted hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          Skip for now
        </button>
      </div>
    </Card>
  );
}
