"use client";

import { useMemo } from "react";

import { LiveRegion } from "@/components/ui/LiveRegion";
import { EXCHANGE_DISPLAY, venueIsSerialized } from "@/lib/closed-sets";
import {
  WAIT_QUEUE_FRACTION,
  WAIT_SLOW_FRACTION,
  validateBudgetMsFor,
  validateBudgetSecondsFor,
} from "@/lib/wizard/validate-budget";

/**
 * Phase 153.4-03 / D-05 / WIZFORM-05 — the long-wait validate card
 * (`153-UI-SPEC.md` §Surface 1).
 *
 * WHY THIS EXISTS.
 *   Phase 153.4-01/02 gave a serialized venue a 120 000 ms validate budget. Today's
 *   connect surface renders a disabled button reading `Validating...` and nothing else,
 *   so that budget buys a TWO-MINUTE SILENT SPINNER — which D-05 states plainly is a
 *   worse product than the fast wrong answer it replaced. This card is the other half
 *   of the budget: it names what is happening, states the deadline it was granted, and
 *   offers a way out.
 *
 * WHY IT LIVES AT THE WIZARD ROOT.
 *   BOTH connect surfaces mount it — `ConnectKeyStep` (single key, plan 153.4-04) and
 *   `MultiKeyConnectStep` (one per validating member panel, plan 153.4-05). A copy in
 *   each step would be two escalation ladders, and a ladder that exists twice drifts:
 *   this repo has paid for that shape repeatedly. It is a sibling of
 *   `WizardErrorEnvelope.tsx` for exactly that reason.
 *
 * IT IS PURE, AND IT DOES NOT TIME.
 *   The caller owns the clock and passes `elapsedMs`. A card that ran its own interval
 *   could not be mounted per member panel without N timers disagreeing about "now", and
 *   the caller already owns the abort controller the `Stop waiting` control drives.
 *
 * ⛔ WHAT THIS CARD MAY NEVER CLAIM.
 *   `validate-key` is ONE request/response. The client observes NO server stages, so
 *   `Queued`, `Signing in`, `Probing` may never be rendered as OBSERVED states — that is
 *   the TRAP-3 class ("a surface must never invent a duration it did not receive"). One
 *   label per venue CLASS, true for the whole span. If a future phase streams real stage
 *   events, these may become observed states; until then, one label.
 *
 * ⛔ NO PROGRESS AFFORDANCE. No spinner, no progress bar, no percentage, no indeterminate
 *   stripe (UI-SPEC forbidden item #7). A progress bar implies a known completion
 *   fraction we do not have, which is a fabricated figure under the Numbers Contract.
 *   The 8px pulse dot is the ONLY motion, and it keeps the `animate-pulse` utility
 *   deliberately: `globals.css:182-187` already suppresses that class under
 *   `prefers-reduced-motion`, so a bespoke animation would be a NEW motion with no such
 *   rule. The wait is conveyed by TEXT; the dot is `aria-hidden`.
 */

/**
 * ── ELLIPSIS: ASCII `...`, NOT U+2026 — a deliberate divergence from the UI-SPEC ──
 *
 * The UI-SPEC copy table spells these labels with a typographic ellipsis. D-21's ruling
 * is "one spelling, chosen, everywhere", and the incumbent busy label is ASCII at four
 * of the five live sites (`ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx`,
 * `ApiKeyForm.tsx`, `StrategyForm.tsx`) with a RECORDED superseding decision at
 * `MultiKeyConnectStep.test.tsx:19-21` ("the busy label is ASCII `Validating...`,
 * superseding the UI-SPEC's typographic ellipsis").
 *
 * This card renders directly beside that button. `Validating...` next to
 * `Signing in to your broker…` in the same viewport is precisely the blend Rule 7
 * forbids — surface the conflict, pick the more-tested side, do not average them. So the
 * divergence from the UI-SPEC table is chosen, not accidental.
 * (`CsvUploadStep.tsx:751` is the one live U+2026 holdout; a repo-wide sweep is logged in
 * TODOS.md and is not this phase's.)
 */
const SIGNING_IN_LABEL = "Signing in to your broker...";

/**
 * The ccxt-venue label. `{VenueName}` resolves through `EXCHANGE_DISPLAY`, a CLOSED
 * record — an unrecognised `exchange` is never echoed back as a venue name (T-153.4-11:
 * a caller-supplied string reaching a user-visible sentence). It falls back to a label
 * that names no venue at all rather than to a guess.
 */
const CHECKING_LABEL_UNNAMED_VENUE = "Checking your key...";

/**
 * The 40% rung. Gated on the `serialized` CAPABILITY, never on a venue name — the same
 * class-not-instance rule the budget selector follows.
 *
 * ⚠️ The sentence names `MetaTrader` literally while its gate is class-shaped, so a
 * SECOND serialized venue would render it and it would read wrong. That conflict is
 * REAL, is logged in TODOS.md, and is deliberately not resolved here: the remedy is a
 * copy decision (the concrete noun is what makes the sentence land for the only venue
 * that has the property today) and the copy table is Phase 153.1's.
 *
 * ⛔ Copy vocabulary is `your broker` / `sign-in` / `one sign-in at a time`. Never
 * `terminal`, `gateway`, `rpyc`, `lock`, `MT5 client`, or any Python identifier.
 */
const QUEUE_LINE =
  "Still signing in. MetaTrader allows one sign-in at a time, so your check may be waiting behind another.";

/** The cancel affordance's label. */
const STOP_WAITING_LABEL = "Stop waiting";

/**
 * ⛔ EVERY DURATION IS INTERPOLATED FROM `validateBudgetSecondsFor`, never typed.
 * UI-SPEC forbidden item #8: "A duration in copy that is not read from the configured
 * budget." A literal here would let the copy and the deadline drift apart silently, and
 * the whole point of the agreement pin in `seam-constants.pin.test.ts` is that the
 * number in this sentence is the number the seam will actually honour.
 *
 * ⛔ NO TYPICAL-DURATION RANGE for a serialized venue. No measured distribution of a
 * SUCCESSFUL MT5 login exists anywhere; the 35–70 s figures on record describe FAILURES
 * and are derived from timeout constants, not observed (D-27). State only the budget,
 * which is a fact we control.
 */
function waitPromiseLine(budgetSeconds: number): string {
  return `We wait up to ${budgetSeconds}s for your broker to answer.`;
}

function slowLine(budgetSeconds: number): string {
  return `This is slower than usual. We will wait until ${budgetSeconds}s, then tell you what we found.`;
}

function checkingLine(venueName: string): string {
  return `Checking your key with ${venueName}...`;
}

/**
 * The venue's display name, or `null` when the venue is absent or not a supported code.
 *
 * OWN-property lookup on purpose. `exchange` arrives from a wizard form, and a plain
 * object index resolves `constructor` / `toString` / `__proto__` to inherited members —
 * the Record-vs-Map rule `closed-sets.ts` states as a security property rather than a
 * style choice. Case-insensitive because `canonicalizeExchange` hands back the DISPLAY
 * form (`MT5`), so callers legitimately pass mixed case.
 */
function venueDisplayName(exchange: string | null | undefined): string | null {
  if (!exchange) return null;
  const key = exchange.toLowerCase();
  return Object.hasOwn(EXCHANGE_DISPLAY, key)
    ? ((EXCHANGE_DISPLAY as Record<string, string>)[key] ?? null)
    : null;
}

export interface ValidateWaitCardProps {
  /**
   * The venue being validated. Read ONLY through `venueIsSerialized` (which arm) and
   * `EXCHANGE_DISPLAY` (how to name it) — never rendered raw, never compared to a venue
   * literal inside this component.
   */
  exchange: string;
  /**
   * Milliseconds since the validate request left the browser. The CALLER owns the clock;
   * this card renders what it is told.
   */
  elapsedMs: number;
  /**
   * Abort the in-flight validate. ⛔ NOT DESTRUCTIVE — `validate-key` is strictly
   * pre-encrypt / pre-RPC and persists nothing server-side, so cancelling loses nothing.
   * No confirmation dialog and no `danger` styling: a confirmation step on the one
   * control whose entire purpose is escaping a stall is the opposite of the affordance.
   */
  onStopWaiting: () => void;
}

export function ValidateWaitCard({
  exchange,
  elapsedMs,
  onStopWaiting,
}: ValidateWaitCardProps) {
  const serialized = venueIsSerialized(exchange);
  const budgetMs = validateBudgetMsFor(exchange);
  const budgetSeconds = validateBudgetSecondsFor(exchange);

  // ⛔ FRACTIONS OF THE CONFIGURED BUDGET, never module millisecond constants. The house
  // analog (`SyncPreviewStep.tsx`) uses absolute thresholds and that is exactly the
  // delta UI-SPEC Surface 1 mandates against it: "so a budget change moves them
  // automatically". On the two live arms these resolve to 48 s / 90 s (serialized) and
  // 12 s / 22.5 s (default) from ONE pair of constants.
  const pastQueueRung = elapsedMs >= budgetMs * WAIT_QUEUE_FRACTION;
  const pastSlowRung = elapsedMs >= budgetMs * WAIT_SLOW_FRACTION;

  const venueName = venueDisplayName(exchange);
  const statusLabel = serialized
    ? SIGNING_IN_LABEL
    : venueName
      ? checkingLine(venueName)
      : CHECKING_LABEL_UNNAMED_VENUE;

  // The promise stands from t=0 and is RETIRED by the 75% rung, which restates the same
  // budget with more information ("we will wait until Ns, then tell you what we found").
  // Rendering both would put two sentences about one deadline in one card.
  const showPromiseLine = serialized && !pastSlowRung;
  // The queue disclosure is a FACT about a serialized venue, not a flag — muted, and
  // never rendered for a venue whose calls do not queue, because claiming a queue we
  // cannot observe invents a specific fact about the user's situation.
  const showQueueLine = serialized && pastQueueRung;
  const showStopWaiting = pastQueueRung;

  /**
   * Announce the MOST SPECIFIC sentence currently on screen, and only when that sentence
   * changes — i.e. on mount and at each threshold crossing, never on the 1 s tick
   * (UI-SPEC forbidden item #10: a per-second `aria-live` update floods AT).
   *
   * ⛔ Every branch returns a string this card ALSO renders visually. `LiveRegion`'s
   * contract is explicit that it is a second channel for existing copy and never a place
   * to author new copy (PATTERNS Shared Pattern G).
   *
   * Polite, not assertive: a wait is a non-blocking state change (DESIGN-05).
   */
  const announcement = useMemo(() => {
    if (pastSlowRung) return slowLine(budgetSeconds);
    if (showQueueLine) return QUEUE_LINE;
    return statusLabel;
  }, [pastSlowRung, showQueueLine, budgetSeconds, statusLabel]);

  return (
    <div
      data-testid="validate-wait-card"
      className="mt-6 rounded-md border border-border bg-page px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          data-testid="validate-wait-dot"
          className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent"
        />
        <p className="text-body font-medium text-text-primary">{statusLabel}</p>
        {/* aria-hidden: a per-second live update floods AT. A sighted user reads the
            figure; an AT user hears the label and the threshold sentences. */}
        <span
          aria-hidden="true"
          data-testid="validate-wait-elapsed"
          className="ml-auto font-metric text-caption tabular-nums text-text-muted"
        >
          {Math.floor(elapsedMs / 1000)}s
        </span>
      </div>

      {showPromiseLine && (
        <p className="mt-2 text-caption text-text-muted">
          {waitPromiseLine(budgetSeconds)}
        </p>
      )}

      {showQueueLine && (
        <p className="mt-2 text-caption text-text-muted">{QUEUE_LINE}</p>
      )}

      {/* ⛔ `text-warning` (the TOKEN), never the raw amber Tailwind class that the
          `SyncPreviewStep.tsx:2377` site this card is lifted from uses — a raw colour
          class is not a token, and forbidden item #12 names that exact substitution.
          (The class itself is deliberately not spelled here: this phase's acceptance
          check for it is a plain grep over this file, and a guard satisfied forever by
          the comment warning against the thing it looks for has stopped guarding.)
          ⛔ AND NEVER `text-negative` while the wait is still inside its budget:
          DESIGN.md §Semantic-color gates is normative — red asserts a PERMANENT failure,
          and a wait that may still answer correctly is a recoverable disclosure with a
          user action attached, which is exactly what amber means. */}
      {pastSlowRung && (
        <p className="mt-2 text-caption text-warning">
          {slowLine(budgetSeconds)}
        </p>
      )}

      {showStopWaiting && (
        <div className="mt-2">
          {/*
            ⚠️ A PLAIN `<button>`, NOT `<Button variant="ghost" size="sm">` — a conflict
            surfaced and resolved (Rule 7), not blended.

            The UI-SPEC specifies the shared `Button`. But `ui/Button.tsx:35` hard-codes
            `focus-visible:ring-accent/50` on EVERY variant, and `cn` (`lib/utils.ts:72`)
            is a plain `filter(Boolean).join(" ")` — NOT tailwind-merge — so a caller
            cannot override it; a passed className merely appends a losing declaration.
            UI-SPEC forbidden item #9 forbids a `/50` ring on a control this phase
            creates (a 50%-alpha accent ring is far under WCAG 1.4.11's 3:1 floor), and
            the same contract ⛔ forbids fixing `Button.tsx` here, because
            `AllocateDialog.test.tsx`'s focus sweep carves it out BY IDENTITY and asserts
            it still carries `ring-accent/50`.

            So the classes below are the ghost variant's own look (`text-text-secondary
            hover:bg-page`) plus size `sm` (`px-3 py-1.5 text-caption`), VERBATIM, so the
            day `Button.tsx` is fixed this becomes a drop-in swap with no visual delta —
            and the focus contract is written out at full opacity with `ring-inset`.
            ⚠️ Known and accepted: `hover:bg-page` is a no-op against this card's own
            `bg-page`. Copying the ghost variant exactly is what keeps the future swap
            free; the keyboard affordance (the ring) is the one that carries the
            accessibility argument, and it is correct. Logged in TODOS.md with the
            `Button` item.
          */}
          <button
            type="button"
            onClick={onStopWaiting}
            className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-caption font-medium text-text-secondary transition-colors hover:bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            {STOP_WAITING_LABEL}
          </button>
        </div>
      )}

      <LiveRegion message={announcement} />
    </div>
  );
}
