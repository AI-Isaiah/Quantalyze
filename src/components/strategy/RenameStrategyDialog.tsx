"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { ErrorEnvelope } from "@/components/error/ErrorEnvelope";
import { buildEnvelope, type ErrorEnvelope as ErrorEnvelopeShape } from "@/lib/envelope";
import {
  recogniseDashboardDialogCode,
  type DashboardDialogRoute,
} from "@/lib/wizardErrors";
import { MAGNITUDE_CAPS } from "@/lib/closed-sets";
import { newCorrelationId } from "@/lib/correlation-id-client";

/**
 * Phase 150 / OWN-05 — the owner relabels their own private or draft strategy.
 *
 * Same dialog shape as MarkOwnershipDialog (Modal + status machine +
 * router.refresh(), writing through the route rather than from the browser),
 * with two properties specific to this form:
 *
 *   1. VALIDATION IS INLINE AND THE CTA STAYS CLICKABLE. `Save name` is never
 *      greyed for a validation problem: pressing it surfaces the message AT the
 *      field and moves focus there. Greying it would leave a blocked action with
 *      no remedy attached, which the no-disabled-buttons direction forbids. The
 *      in-flight label is a separate concern and is kept.
 *
 *   2. THE CLIENT NEVER SHORTENS THE OWNER'S NAME. PATCH /api/strategies/{id}/name
 *      REJECTS an over-long name (400 `name too long`) instead of silently
 *      capping it — a deliberate divergence from the alias route, because
 *      quietly dropping the tail of a proper name the owner will see rendered
 *      back is a fail-quiet. Capping the input here would hide that contract, so
 *      the field accepts what the user types and the cap surfaces as a message.
 *
 * Only TRIM is applied before sending, matching the route's own normalisation
 * exactly, so a name that is legal after trimming is never rejected locally.
 *
 * The route's two documented 400 arms land INLINE at the field rather than in
 * the envelope: they are field-level problems with a field-level remedy, and
 * this phase's forms must not re-introduce the terminal-envelope class for
 * those. Every other failure is the canonical envelope.
 *
 * 161-10 / WIZERR-07 — WHICH ARM IS WHICH IS DECIDED BY THE ROUTE'S `code`,
 * not by its `error` sentence. The prose-keyed `ROUTE_FIELD_ERRORS` lookup this
 * file used to carry is retired: it recognised two arms out of nine, minted
 * `code: "UNKNOWN"` for the rest, and would have broken silently on any
 * rewording. There is deliberately NO replacement table here — the roster lives
 * once, in `DASHBOARD_DIALOG_ROUTE_CODES` (src/lib/wizardErrors.ts), so the
 * coverage law can read it and so the guarded cast happens in one audited spot.
 *
 * D-17 (private/draft only) is enforced on the SERVER — the route's UPDATE
 * chain filters on status, so a published row answers 404. The render gates on
 * both surfaces are defence in depth, not the gate.
 */

/**
 * UI-SPEC product cap. `strategies.name` itself is uncapped TEXT in the DB.
 *
 * READ FROM THE SHARED CAP, not re-declared: `MAGNITUDE_CAPS`
 * (src/lib/closed-sets.ts) exists precisely to hold one declaration per cap,
 * and the guard here, the route's guard and the sentence below are three
 * spellings of the SAME number. The sentence interpolates it too, so raising
 * the cap can never leave the copy naming the old one.
 */
const MAX_NAME_LENGTH = MAGNITUDE_CAPS.MAX_NAME_CHARS;

const ERROR_EMPTY = "Enter a name.";
const ERROR_TOO_LONG = `Keep it under ${MAX_NAME_LENGTH} characters.`;

/**
 * 161-10 / WIZERR-07 — THE ROUTE THIS DIALOG WRITES THROUGH, named once.
 *
 * The literal is the roster key in `DASHBOARD_DIALOG_ROUTE_CODES`
 * (src/lib/wizardErrors.ts), which is what makes recognition PER-ROUTE: this
 * dialog admits the codes the name route emits and not the whole vocabulary.
 */
const ROUTE: DashboardDialogRoute = "strategies/[id]/name";

export function RenameStrategyDialog({
  open,
  onClose,
  strategyId,
  currentName,
}: {
  open: boolean;
  onClose: () => void;
  strategyId: string;
  currentName: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(currentName);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [envelope, setEnvelope] = useState<ErrorEnvelopeShape | null>(null);

  // Re-opening, or pointing this at a different row, re-reads that row's
  // current name and clears any prior failure — a host that keeps this mounted
  // (the factsheet masthead does) would otherwise reopen on the stale input.
  //
  // Adjusted DURING RENDER (React's documented "adjust state when a prop
  // changes" pattern) rather than in an effect, so the field never paints the
  // previous value for a frame before correcting itself.
  const openSession = `${open}:${strategyId}`;
  const [lastSession, setLastSession] = useState(openSession);
  if (openSession !== lastSession) {
    setLastSession(openSession);
    setName(currentName);
    setFieldError(null);
    setStatus("idle");
    setEnvelope(null);
  }

  function failField(message: string) {
    setFieldError(message);
    inputRef.current?.focus();
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      failField(ERROR_EMPTY);
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      failField(ERROR_TOO_LONG);
      return;
    }

    setFieldError(null);
    setEnvelope(null);
    setStatus("loading");

    // Minted BEFORE the request and SENT on it (@/lib/correlation-id-client, the
    // same helper AllocateDialog and MarkOwnershipDialog use). Previously this
    // was a bare `crypto.randomUUID()` on each failure path with no header, so
    // the id printed in the envelope joined to no server log line — and the copy
    // in the `catch` below would have thrown inside the handler on any runtime
    // without `crypto.randomUUID`, losing the envelope entirely.
    const correlationId = newCorrelationId("rename");

    try {
      const res = await fetch(`/api/strategies/${strategyId}/name`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-Id": correlationId,
        },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        // 161-10 / WIZERR-07 — DISCRIMINATE ON THE CODE, NOT THE PROSE.
        //
        // This block used to read `body.error` through a local prose-keyed
        // `ROUTE_FIELD_ERRORS` table, which recognised exactly two of the
        // route's nine error arms and rendered `buildEnvelope("UNKNOWN", …)` —
        // "we could not classify this failure" — for the other seven, every
        // one of which the route classifies precisely. It also broke silently
        // the moment a sentence was reworded, which is the anti-pattern
        // `keys/validate-and-encrypt`'s SEAMUX-03 comment names verbatim.
        //
        // A body we cannot read yields `null` and falls through to UNKNOWN,
        // which is the honest verdict for a response we could not parse.
        const body = (await res.json().catch(() => null)) as {
          code?: unknown;
        } | null;
        const wireCode = body?.code;

        // FIELD-LEVEL FIRST. These two arms land INLINE at the Name input, not
        // in the envelope: they are field problems with a field remedy, and
        // this phase's forms must not re-introduce the terminal-envelope class
        // for them. It is also what keeps the correlation id OFF an actionable
        // arm (161-UI-SPEC Copy Principle 4) — an inline message renders no
        // envelope, so there is no diagnostics block to compete with the fix.
        //
        // ⛔ Deliberately NOT `WizardErrorCode`s and NOT members of this
        // route's roster; see `DASHBOARD_DIALOG_ROUTE_CODES` for that record.
        if (wireCode === "NAME_REQUIRED" || wireCode === "NAME_TOO_LONG") {
          failField(
            wireCode === "NAME_TOO_LONG" ? ERROR_TOO_LONG : ERROR_EMPTY,
          );
          setStatus("idle");
          return;
        }

        // Everything else is the canonical envelope. The recogniser holds the
        // ONE guarded cast (Pitfall 4): an unrostered or unreadable code
        // answers UNKNOWN by design rather than by accident.
        setEnvelope(
          buildEnvelope(
            recogniseDashboardDialogCode(ROUTE, wireCode),
            correlationId,
          ),
        );
        setStatus("idle");
        return;
      }

      setStatus("idle");
      onClose();
      router.refresh();
    } catch {
      setEnvelope(buildEnvelope("UNKNOWN", correlationId));
      setStatus("idle");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Rename strategy">
      <Field
        label="Name"
        hint="Only you see this name. Public surfaces keep showing the codename."
        error={fieldError ?? undefined}
      >
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-[44px] rounded-lg border border-border bg-surface px-3 py-2.5 text-body text-text-primary placeholder:text-text-muted transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-negative"
        />
      </Field>
      {envelope && (
        <div className="mt-4">
          <ErrorEnvelope envelope={envelope} />
        </div>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {/* Never disabled for a validation problem — only while in flight. */}
        <Button
          type="button"
          onClick={handleSave}
          disabled={status === "loading"}
        >
          {status === "loading" ? "Saving..." : "Save name"}
        </Button>
      </div>
    </Modal>
  );
}
