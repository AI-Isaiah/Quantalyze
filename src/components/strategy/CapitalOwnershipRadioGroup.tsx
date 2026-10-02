"use client";

import { cn } from "@/lib/utils";
import {
  OWN_CAPITAL,
  TEAM_REVIEW,
  type CapitalOwnership,
} from "@/lib/capital-ownership";

/**
 * Phase 150 / OWN-03 — THE capital question. One component, two mounts.
 *
 * UI-SPEC invariant 5: the wizard MetadataStep and the Mark-ownership dialog
 * render THIS component. Only the group `label` differs between them
 * ("Whose capital is in this key?" vs "Whose capital is this?"); the option
 * labels and the helper line are module constants below, so copy drift between
 * the two mounts is impossible rather than merely discouraged.
 *
 * SEMANTICS come from `SignupForm.tsx:174-207` — `role="radio"` buttons with
 * `aria-checked`, each one a natural tab stop. TOKENS come from the wizard's
 * broker-selector cards (`ConnectKeyStep.tsx:630-655`) and the UI-SPEC. The two
 * sources disagreed (the broker selector is `aria-pressed`, i.e. TOGGLE
 * semantics), and the reconciliation is deliberate: take the repo's established
 * radio semantics, take the UI-SPEC's tokens. NO roving-tabindex arrow model is
 * invented here — the repo baseline is one tab stop per option, and a bespoke
 * keyboard model would be new untested a11y surface.
 *
 * The control is CONTROLLED and its value is never null: the caller defaults it
 * to `team_review`. There is no clear/reset arm — clicking the selected option
 * re-emits the same value, never an empty one. A user who never touches the
 * question submits as team-review, which is behaviour-compatible with the
 * pre-Phase-150 wizard.
 *
 * The helper line states the D-03 invariant to the user in the founder's own
 * model. Do not soften it: it is the only place the UI tells an allocator that
 * the choice they are making decides whether the strategy can ever hold money.
 */

const OPTIONS: ReadonlyArray<{ value: CapitalOwnership; label: string }> = [
  { value: OWN_CAPITAL, label: "My own capital" },
  { value: TEAM_REVIEW, label: "A trading team's key I'm verifying" },
];

const HELPER_LINE =
  "Own-capital strategies can be allocated from the Holdings tab. A team's key can never join your allocation.";

export function CapitalOwnershipRadioGroup({
  label,
  value,
  onChange,
  error,
  id,
}: {
  /** Group label. The ONLY thing that differs between the two mounts. */
  label: string;
  /** Never null — the caller defaults to TEAM_REVIEW. */
  value: CapitalOwnership;
  onChange: (v: CapitalOwnership) => void;
  /**
   * 153.2-05 — a refusal that belongs to THIS question, rendered at it.
   *
   * The group cannot be wrapped in `Field`: that primitive wires one `<label
   * htmlFor>` to one control `id`, and a radio group has neither. So the same
   * contract is honoured here instead — `aria-invalid` and `aria-describedby`
   * on the `role="radiogroup"` element, which is what assistive technology
   * treats as the composite control, and the visible sentence rendered from the
   * SAME string. ⛔ Never an `aria-invalid` written without the message, or a
   * message rendered without the ARIA state: a red group AT can't see is the
   * FLAG-1 defect one element type over.
   *
   * ABSENT ⇒ byte-identical to the pre-153.2-05 render: no attributes, no
   * paragraph. The `MarkOwnershipDialog` mount passes nothing.
   */
  error?: string;
  /** Explicit id root for the error node's `aria-describedby` wiring. */
  id?: string;
}) {
  const errorId = error ? `${id ?? "capital-ownership"}-error` : undefined;
  return (
    <fieldset>
      <legend className="text-caption font-medium text-text-primary">
        {label}
      </legend>
      <div
        role="radiogroup"
        aria-label={label}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={errorId}
        className="mt-2 space-y-2"
      >
        {OPTIONS.map((option) => {
          const checked = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checked}
              data-testid={`capital-ownership-${option.value}`}
              onClick={() => onChange(option.value)}
              className={cn(
                "w-full rounded-md border px-4 py-3 text-left text-body transition-colors",
                checked
                  ? "border-accent bg-accent/5 font-medium text-text-primary"
                  : "border-border bg-white text-text-secondary hover:border-accent/50",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {error && (
        // The same treatment `Field` gives a field message, so a refusal reads
        // identically wherever it lands. ⛔ Not `role="alert"` — the wizard's
        // form-level summary owns the announcement, and a second live region
        // for the same fact would double-announce it (Shared Pattern G).
        <p id={errorId} className="mt-2 text-caption text-negative">
          {error}
        </p>
      )}
      <p className="mt-2 text-caption text-text-secondary">{HELPER_LINE}</p>
    </fieldset>
  );
}
