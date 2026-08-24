"use client";

/**
 * Phase 150 / OWN-03 — the allocate / edit / remove dialog.
 *
 * This is the phase's PRIMARY CTA. It is built on the `RemoveStrategyButton`
 * dialog shape (150-PATTERNS §4/§6) with three deliberate deviations:
 *
 *   1. it writes through `/api/portfolio-strategies/allocation` (the Plan-05
 *      money route) via `fetch`, never a direct client-side database call —
 *      the route owns the ownership/mark pre-checks, the ticket cap and the
 *      audit event. (The forbidden client identifier is deliberately not
 *      spelled anywhere in this file: the plan's acceptance grep runs over
 *      this source and would match its own prose — the 140.2-08 / 150-02
 *      self-matching-comment lesson.);
 *   2. the primary CTA is NEVER disabled for validation. Submitting an invalid
 *      amount surfaces the problem inline at the field and focuses it
 *      (no-disabled-buttons direction);
 *   3. write failures render the canonical `ErrorEnvelope`, never an invented
 *      error string.
 *
 * NO `portfolio_id` is sent (rev-4 / D-03-B). The route derives the caller's
 * real portfolio from `auth.uid()` and lazily provisions it on first allocate,
 * so a client-supplied container id would be untrusted input the route must
 * not honour anyway (T-150-40) — and there is consequently no "no portfolio
 * yet" dead end for this dialog to render.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ErrorEnvelope } from "@/components/error/ErrorEnvelope";
import {
  buildEnvelope,
  type ErrorEnvelope as ErrorEnvelopeType,
} from "@/lib/envelope";
import { parseRetryAfterSeconds } from "@/lib/retry/retry-after";
import {
  recogniseDashboardDialogCode,
  type DashboardDialogRoute,
} from "@/lib/wizardErrors";
import { newCorrelationId } from "@/lib/correlation-id-client";
import { MAGNITUDE_CAPS } from "@/lib/closed-sets";

const ALLOCATION_ROUTE = "/api/portfolio-strategies/allocation";

// ─────────────────────────────────────────────────────────────────────── copy
// 150-UI-SPEC Copywriting Contract — byte-binding. Module constants rather
// than inline JSX text so the two mounts of a string (component + test) cannot
// drift and so apostrophes stay literal.

const FIELD_LABEL = "Allocation (USD)";
const ERROR_NON_POSITIVE = "Enter an amount above $0.";
const ERROR_ABOVE_CAP = "That's above the $1B sanity cap — check the amount.";

/**
 * ⚠️ D-12-B SUPERSESSION — do NOT "fix" this back to the fallback sentence at
 * 150-UI-SPEC line 300. (That sentence is deliberately NOT quoted here: the
 * plan's acceptance grep runs over this source and a quotation would match its
 * own prose — the 140.2-08 / 150-02 self-matching-comment lesson. Read the
 * spec line for the exact wording being superseded.)
 *
 * It was written when Weight was expected to be a share of BOOK EQUITY, a
 * scalar this product does not have until Phase 151. Under the D-12-B
 * amendment the Holdings Weight column is render-derived as
 * `allocation / Σ allocation` across the allocated own-capital rows, so it
 * appears immediately — which makes the book-equity conditional false copy.
 *
 * What has NOT changed: the dialog still previews NO number. There is no
 * book-equity scalar to divide by and the post-write share is not knowable
 * here, so a `≈ {w}%` preview would be fabricated (150-PATTERNS § No Analog
 * Found row 2). The real figure lands in the ROW after the confirmed write.
 */
const HELPER_LINE =
  "Weight shows each strategy's share of your allocated capital.";

const REMOVE_ACTION = "Remove allocation…";

function removeConfirmCopy(strategyName: string): string {
  return `Remove this allocation? ${strategyName} leaves your allocation. The own-capital mark stays.`;
}

// ──────────────────────────────────────────────────────────────── validation

type ParsedAmount = { ok: true; value: number } | { ok: false; error: string };

/**
 * Client mirror of the route's `parseAmount` (route.ts:115-128) — the SERVER
 * stays authoritative; this exists so a typo is caught at the field instead of
 * as a terminal envelope (this form is explicitly in scope for Phase 153's
 * inline-validation criterion).
 *
 * The parse is `MigrationWizard.tsx:65-69`'s (`Number()` + `Number.isFinite` +
 * `> 0`) plus the upper bound that site is missing. The bound is
 * `MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD` ($1e9) — an allocation is a TICKET, and
 * that is what keeps the approved "$1B sanity cap" copy literally true. It is
 * NOT `isValidDollar`, which carries the AUM convention ($1e12, accepts 0) and
 * would make the copy wrong by 1000× while admitting a zero ticket.
 */
function parseAmount(raw: string): ParsedAmount {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: ERROR_NON_POSITIVE };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: ERROR_NON_POSITIVE };
  }
  if (n > MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD) {
    return { ok: false, error: ERROR_ABOVE_CAP };
  }
  return { ok: true, value: n };
}

// ────────────────────────────────────────────────────────────────── envelopes

/**
 * The route's machine code for the ONE refusal on this surface the user can act
 * on. Read off the BODY, not the status: 409 is also what a future conflict on
 * this route would use, and the copy below names a specific remedy.
 */
const NOT_ALLOCATABLE_CODE = "not_allocatable";

/**
 * 161-10 / WIZERR-07 — THE ROUTE THIS DIALOG WRITES THROUGH, as a roster key.
 *
 * The literal matches `ALLOCATION_ROUTE`'s path and is the key in
 * `DASHBOARD_DIALOG_ROUTE_CODES` (src/lib/wizardErrors.ts), so this dialog
 * admits the codes THIS route emits and not the whole vocabulary.
 */
const ROUTE: DashboardDialogRoute = "portfolio-strategies/allocation";

/**
 * Map a failed response to a CANONICAL wizardErrors entry — no new error
 * strings are minted on this surface (150-UI-SPEC Error state).
 *
 * THREE arms, because three are truthful.
 *
 * `RATE_LIMITED` is exact (the route emits `Retry-After`, read through the ONE
 * parser — a raw `Number(header)` is a repo-wide lint error).
 *
 * 151 review E5 — `ALLOCATION_NOT_ALLOCATABLE` is the arm that was missing. The
 * route has emitted 409 `{error:"not_allocatable"}` since Phase 150 (from the
 * pre-check, and since E4 from the D-03-A trigger firing on the insert too),
 * and NO client read it: it fell to `UNKNOWN`, whose copy deliberately "makes
 * no claim about what happened". So the only failure here with a one-screen
 * remedy — mark the strategy as your own capital — was the one the user was
 * told nothing about. Its entry is deliberately NON-recoverable, which is what
 * removes the Retry CTA the server would refuse identically forever (E6).
 *
 * 161-10 / WIZERR-07 — THE FALLTHROUGH IS NO LONGER A BLANKET `UNKNOWN`. The
 * allocation route now puts a machine code on every error arm, so the arms this
 * function could not name — a signed-out session, a request our own page built
 * wrong, nine distinct internal faults, and three 404s — reach their own copy
 * instead of "we could not classify this failure". `UNKNOWN` survives only
 * where it is true: an unreadable body, an unrostered code, or a request that
 * never reached a status at all.
 *
 * ⛔ THE TWO INCUMBENT READS ARE KEPT AHEAD OF THE CODE CHANNEL, DELIBERATELY.
 * They are not a second discriminator competing with it — they AGREE with it
 * (the route answers the same 409 with `code: "ALLOCATION_NOT_ALLOCATABLE"`),
 * and agreement is the property that matters here, not disjointness — the same
 * standard `ConnectKeyStep.tsx` records for its own two-hop lookup. What
 * keeping them buys is a rolling deploy: a browser running THIS bundle against
 * a route instance older than this commit still gets the mark remedy rather
 * than the vague terminal. Delete them once no pre-161-10 instance can serve
 * this route, and not before.
 */
function envelopeForResponse(
  res: Response,
  correlationId: string,
  body: unknown,
): ErrorEnvelopeType {
  if (res.status === 429) {
    return buildEnvelope("RATE_LIMITED", correlationId, {
      retryAfterSeconds: parseRetryAfterSeconds(res.headers) ?? undefined,
    });
  }
  const parsed =
    typeof body === "object" && body !== null
      ? (body as { error?: unknown; code?: unknown })
      : null;
  if (res.status === 409 && parsed?.error === NOT_ALLOCATABLE_CODE) {
    return buildEnvelope("ALLOCATION_NOT_ALLOCATABLE", correlationId);
  }
  return buildEnvelope(
    recogniseDashboardDialogCode(ROUTE, parsed?.code),
    correlationId,
  );
}

// ────────────────────────────────────────────────────────────────── component

export interface AllocateDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "allocate" | "edit";
  /** The STRATEGY id — `StrategyRow.id` is the strategy id; there is no second id field. */
  strategyId: string;
  strategyName: string;
  /** Prefill for edit mode; `null` in allocate mode. */
  currentAmount: number | null;
}

export function AllocateDialog({
  open,
  onClose,
  mode,
  strategyId,
  strategyName,
  currentAmount,
}: AllocateDialogProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState(
    currentAmount == null ? "" : String(currentAmount),
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<ErrorEnvelopeType | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const isEdit = mode === "edit";

  /**
   * The ONE write path for both verbs. Returns only after the server has
   * confirmed: there is no optimistic row update anywhere on this surface —
   * the row (and its derived weight) re-renders from the refreshed server data,
   * so the number the user sees is always one the database agreed to.
   */
  async function runWrite(method: "POST" | "DELETE", body: object) {
    // Shared with the two strategy dialogs (@/lib/correlation-id-client): a
    // guarded, per-failure id that is also SENT below, so the id on screen joins
    // to the server's log line for THIS attempt.
    const correlationId = newCorrelationId("allocation");
    setEnvelope(null);
    setBusy(true);
    let res: Response;
    try {
      res = await fetch(ALLOCATION_ROUTE, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-Id": correlationId,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // Offline / aborted — the request never reached a status.
      setEnvelope(buildEnvelope("UNKNOWN", correlationId));
      setBusy(false);
      return;
    }

    if (!res.ok) {
      if (res.status === 409) {
        // The 150-05 edit-path race: this row offered its affordance because
        // the strategy was own-capital-marked at render time, and the mark
        // flipped before submit. Retrying re-fails identically, so re-fetch the
        // row set — the affordance is gone once the dialog closes, which is a
        // truer remedy than a Retry the server will refuse again.
        router.refresh();
      }
      // 151 review E5 — the code rides the BODY, so the body has to be read.
      // A failed parse yields `null` and the caller falls through to UNKNOWN,
      // which is the honest verdict for a response we could not read.
      const body = await res.json().catch(() => null);
      setEnvelope(envelopeForResponse(res, correlationId, body));
      setBusy(false);
      return;
    }

    setBusy(false);
    onClose();
    router.refresh();
  }

  function handleSave() {
    const parsed = parseAmount(amount);
    if (!parsed.ok) {
      // Inline at the field, and the field takes focus — never a terminal
      // envelope for a field-level problem, and never a disabled CTA.
      setFieldError(parsed.error);
      inputRef.current?.focus();
      return;
    }
    setFieldError(null);
    void runWrite("POST", {
      strategy_id: strategyId,
      allocated_amount: parsed.value,
    });
  }

  function handleRemove() {
    void runWrite("DELETE", { strategy_id: strategyId });
  }

  if (!open) return null;

  const title = isEdit
    ? `Edit allocation — ${strategyName}`
    : `Allocate — ${strategyName}`;

  // 151 review E6 — A RETRY HANDLER IS ONLY WIRED FOR A FAILURE RETRYING CAN
  // CLEAR. `onRetry` was passed unconditionally, so the mark-flipped 409 got a
  // "Try the last action again." CTA for a request the server refuses
  // identically until the mark changes — the exact false affordance the file's
  // own comment at `runWrite` claims this surface does not offer.
  //
  // `envelope.recoverable` is the canonical discriminator (`buildEnvelope`
  // derives it from the entry's `actions`), and `ErrorEnvelope` already gates
  // the control on `recoverable && Boolean(onRetry)`. Passing `undefined` here
  // as well is not redundant belt-and-braces: it stops a non-recoverable
  // envelope from carrying a live handler at all, so a future renderer that
  // reads only `onRetry` cannot resurrect the dead button.
  const envelopeBlock = envelope ? (
    <div className="mt-4">
      <ErrorEnvelope
        envelope={envelope}
        onRetry={
          envelope.recoverable
            ? confirmingRemove
              ? handleRemove
              : handleSave
            : undefined
        }
      />
    </div>
  ) : null;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {confirmingRemove ? (
        // Two-step confirm INSIDE the dialog — a useState body swap, not a
        // nested modal (`Modal` is a native <dialog>.showModal(), which does
        // not nest cleanly; 150-PATTERNS §6).
        <>
          <p className="text-body text-text-secondary">
            {removeConfirmCopy(strategyName)}
          </p>
          {envelopeBlock}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEnvelope(null);
                setConfirmingRemove(false);
              }}
              disabled={busy}
            >
              Keep
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleRemove}
              disabled={busy}
            >
              Remove
            </Button>
          </div>
        </>
      ) : (
        <>
          <Field label={FIELD_LABEL} error={fieldError ?? undefined}>
            <input
              ref={inputRef}
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const next = e.target.value;
                setAmount(next);
                // D-12 — AN AMOUNT THE USER HAS ALREADY FIXED MUST NOT STILL
                // READ RED. `fieldError` was set in `handleSave` and cleared
                // only on the NEXT save, so a corrected value kept its red (and
                // its message) until the user clicked a second time — the
                // reveal-timing rule this phase applies to every field.
                //
                // Once a message IS showing, re-run the mirror on every
                // keystroke and take its verdict: `null` the instant the value
                // becomes valid, and the OTHER message when the value is still
                // invalid but for a different reason (`-5` → `1000000001`).
                //
                // The `!== null` guard is what preserves SILENCE before the
                // first refusal: an untouched or never-refused field must not
                // turn red while the user is still typing the number.
                if (fieldError !== null) {
                  const reparsed = parseAmount(next);
                  setFieldError(reparsed.ok ? null : reparsed.error);
                }
              }}
              // 153.2 / FLAG-1 — THE RED BORDER IS DERIVED, NOT TOGGLED. The
              // invalid colour used to be a JS ternary on `fieldError`, with
              // `border-border` as its false branch. That was correct only by
              // coincidence: the same state also feeds `Field`'s `error` prop,
              // so the two happened to agree. Deriving the colour from the ARIA
              // state `Field` writes makes them the SAME fact — the only way to
              // paint this field red is to give `Field` an error, so a red
              // control whose a11y wiring is broken becomes structurally
              // impossible rather than merely unlikely (Shared Pattern A).
              // ⛔ Do not set the attribute on this input: `Field` spreads the
              // child's own props LAST, so a hand-written one would win and
              // re-open exactly the hazard this closes.
              //
              // 151 review E7 — WCAG 1.4.11 (≥3:1 non-text contrast). This was
              // `focus:ring-accent/20`, a 20%-alpha ring that measures ~1.3:1
              // against `bg-surface` — an indicator a sighted keyboard user
              // cannot see, on the money field of the phase's primary CTA. It
              // also dropped the `border-focus` companion every shared input
              // primitive carries. The repo already treats the alpha ring as a
              // defect: `focus-ring-clipproof.test.tsx` and
              // `AllocationsTabs.test.tsx` assert full-opacity `ring-accent` and
              // explicitly FORBID `ring-accent/20`. `ring-inset` keeps it inside
              // the border box so an ancestor's overflow cannot clip it, and
              // `focus-visible` (not `focus`) keeps it off pointer interactions.
              className="min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2.5 text-body text-text-primary transition-colors focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent aria-[invalid=true]:border-negative"
            />
          </Field>
          <p className="mt-2 text-caption text-text-secondary">{HELPER_LINE}</p>
          {envelopeBlock}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            {/* Disabled ONLY while a write is in flight (double-submit guard on
                a money write). Validation never disables it — an invalid amount
                surfaces inline at the field instead. */}
            <Button type="button" onClick={handleSave} disabled={busy}>
              {isEdit ? "Save allocation" : "Allocate"}
            </Button>
          </div>
          {isEdit && (
            // Without this a mistaken position has no exit: amount 0 is refused
            // by validation, so removal would otherwise be a dead end.
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setEnvelope(null);
                  setConfirmingRemove(true);
                }}
                // 151 review I4 — the E7 fix landed on the money field above and
                // left THIS control on `ring-accent/50`, a half-alpha ring with
                // no `ring-inset`. It is the worst case for that idiom: the
                // button is borderless and `hover:underline`-only, so the ring
                // is the ENTIRE keyboard affordance, and it is the destructive
                // action on this surface. `rounded-sm` gives the inset ring a
                // radius to follow and the negative inline margin keeps the
                // padded hit area flush with the column edge — the same shape
                // `StrategyTable.tsx:100` and `FactsheetView.tsx:770` were fixed
                // to. Full-opacity `ring-accent` clears WCAG 1.4.11 (≥3:1);
                // `ring-inset` paints inside the border box so no ancestor
                // overflow can clip it.
                className="-mx-1 rounded-sm px-1 text-caption font-medium text-negative hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              >
                {REMOVE_ACTION}
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
