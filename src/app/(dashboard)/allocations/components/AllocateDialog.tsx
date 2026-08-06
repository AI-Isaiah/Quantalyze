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
 * A correlation id for the failure the user is looking at. Sent as
 * `X-Correlation-Id` on the request, so the id on screen joins to the server's
 * log line for THIS attempt rather than being a decorative uuid.
 */
function newCorrelationId(): string {
  const c = globalThis.crypto;
  return typeof c?.randomUUID === "function"
    ? c.randomUUID()
    : `allocation-${Date.now().toString(16)}`;
}

/**
 * Map a failed response to a CANONICAL wizardErrors entry — no new error
 * strings are minted on this surface (150-UI-SPEC Error state).
 *
 * Only two arms, because only two are truthful. `RATE_LIMITED` is exact (the
 * route emits `Retry-After`, read through the ONE parser — a raw
 * `Number(header)` is a repo-wide lint error). Everything else routes to
 * `UNKNOWN`, whose copy makes no claim about what happened; the 409
 * mark-flipped race additionally re-fetches the row set (see `runWrite`) so the
 * stale affordance disappears rather than inviting an identical retry.
 */
function envelopeForResponse(
  res: Response,
  correlationId: string,
): ErrorEnvelopeType {
  if (res.status === 429) {
    return buildEnvelope("RATE_LIMITED", correlationId, {
      retryAfterSeconds: parseRetryAfterSeconds(res.headers) ?? undefined,
    });
  }
  return buildEnvelope("UNKNOWN", correlationId);
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
    const correlationId = newCorrelationId();
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
      setEnvelope(envelopeForResponse(res, correlationId));
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

  const envelopeBlock = envelope ? (
    <div className="mt-4">
      <ErrorEnvelope
        envelope={envelope}
        onRetry={confirmingRemove ? handleRemove : handleSave}
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
              onChange={(e) => setAmount(e.target.value)}
              className={`min-h-[44px] rounded-lg border bg-surface px-3 py-2.5 text-body text-text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-accent/20 ${
                fieldError ? "border-negative" : "border-border"
              }`}
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
                className="text-caption font-medium text-negative hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
