"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ErrorEnvelope } from "@/components/error/ErrorEnvelope";
import { buildEnvelope, type ErrorEnvelope as ErrorEnvelopeShape } from "@/lib/envelope";
import {
  recogniseDashboardDialogCode,
  type DashboardDialogRoute,
} from "@/lib/wizardErrors";
import { formatUsd } from "@/lib/dollar-validation";
import { newCorrelationId } from "@/lib/correlation-id-client";
import { TEAM_REVIEW, type CapitalOwnership } from "@/lib/capital-ownership";
import { CapitalOwnershipRadioGroup } from "./CapitalOwnershipRadioGroup";

/**
 * Phase 150 / OWN-03 — the Mark-ownership dialog. THIS IS THE RETRO PATH
 * (D-09 / D-11): a strategy finalized before the wizard asked the capital
 * question becomes markable here, with zero re-onboarding.
 *
 * Built on the RemoveStrategyButton dialog shape (Modal + a status machine +
 * router.refresh()) with three deliberate divergences from that analog, per
 * 150-PATTERNS §4:
 *
 *   1. The write is a `fetch()` to PATCH /api/strategies/{id}/ownership, NOT a
 *      client-direct database write. The route carries CSRF, the rate limit,
 *      the tenant predicate and the audit row; a browser write under RLS alone
 *      carries none of them (T-150-28).
 *   2. Validation never disables the CTA. In-flight labelling is a different
 *      thing and is kept.
 *   3. Failures render the canonical buildEnvelope() -> ErrorEnvelope, never an
 *      invented inline string.
 *
 * THE CONFIRM ARM IS A BODY SWAP, NOT A NESTED MODAL. `Modal` is a native
 * <dialog> driven by showModal(), and native dialogs do not nest cleanly
 * (150-PATTERNS §6), so the flip confirmation replaces this dialog's body
 * inside the same shell.
 *
 * WHY THE CONFIRM EXISTS AT ALL: flipping own-capital -> team-review on a
 * strategy that holds a live position would strand that position against a
 * strategy that is no longer allocatable. The route refuses the unconfirmed
 * flip with `409 { error: "live_allocation", allocated_amount }` and writes
 * NOTHING; the confirmed re-submit runs the removal and the mark change as one
 * transaction. So the flip is never silent, and the amount the user is about to
 * lose is named (T-150-30).
 */

/**
 * The 409 refusal body. `allocated_amount` is the sum the route computed.
 *
 * 161-10 / WIZERR-07 — `code` is the discriminator; `error` is kept on the type
 * only because the route still sends it (byte-identical), not because anything
 * here reads it.
 */
interface LiveAllocationRefusal {
  code?: unknown;
  allocated_amount?: unknown;
}

/**
 * 161-10 / WIZERR-07 — THE ROUTE THIS DIALOG WRITES THROUGH, named once.
 *
 * The literal is the roster key in `DASHBOARD_DIALOG_ROUTE_CODES`
 * (src/lib/wizardErrors.ts): this dialog admits the codes the ownership route
 * emits and not the whole vocabulary.
 */
const ROUTE: DashboardDialogRoute = "strategies/[id]/ownership";

/**
 * The ownership route's 409 token — a QUESTION, not a refusal to read and
 * leave, which is why it is deliberately NOT a `WizardErrorCode` and never
 * reaches `buildEnvelope`. Answering it swaps in the confirmation body below.
 */
const LIVE_ALLOCATION_CODE = "LIVE_ALLOCATION";

export function MarkOwnershipDialog({
  open,
  onClose,
  strategyId,
  strategyName,
  currentMark,
}: {
  open: boolean;
  onClose: () => void;
  strategyId: string;
  strategyName: string;
  /** `null` = never asked. The dialog still opens on the SAFE default below. */
  currentMark: CapitalOwnership | null;
}) {
  const router = useRouter();
  // An unmarked row opens on team-review, exactly like the wizard: an accidental
  // save must not mint allocatability for a strategy nobody ever marked.
  const [mark, setMark] = useState<CapitalOwnership>(currentMark ?? TEAM_REVIEW);
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [envelope, setEnvelope] = useState<ErrorEnvelopeShape | null>(null);
  /** Non-null while the flip confirmation is showing; carries the 409's amount. */
  const [pendingRemoval, setPendingRemoval] = useState<{ amount: number } | null>(
    null,
  );

  // Re-opening the dialog, or pointing it at a different row, re-reads that
  // row's current mark and clears any previous failure — a host that keeps this
  // component mounted would otherwise show the previously opened row's answer.
  //
  // Adjusted DURING RENDER (React's documented "adjust state when a prop
  // changes" pattern), not in an effect: an effect would paint the stale answer
  // once and then correct it, which on a two-option safety question is exactly
  // the frame a user can click.
  const openSession = `${open}:${strategyId}`;
  const [lastSession, setLastSession] = useState(openSession);
  if (openSession !== lastSession) {
    setLastSession(openSession);
    setMark(currentMark ?? TEAM_REVIEW);
    setStatus("idle");
    setEnvelope(null);
    setPendingRemoval(null);
  }

  async function submit(confirmRemoveAllocation: boolean) {
    setStatus("loading");
    setEnvelope(null);

    // Minted BEFORE the request and SENT on it (@/lib/correlation-id-client, the
    // same helper AllocateDialog uses). Two things were wrong with the previous
    // shape: the id was minted only on the failure paths and never put on the
    // wire, so the id the envelope showed the user joined to no server log line;
    // and the bare `crypto.randomUUID()` sat inside the `catch` below, where a
    // throw would replace the envelope with an unhandled rejection.
    const correlationId = newCorrelationId("ownership");

    try {
      const res = await fetch(`/api/strategies/${strategyId}/ownership`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-Id": correlationId,
        },
        body: JSON.stringify(
          confirmRemoveAllocation
            ? { mark, confirm_remove_allocation: true }
            : { mark },
        ),
      });

      if (!res.ok) {
        // 161-10 / WIZERR-07 — ONE body read, then discriminate on the CODE.
        //
        // This used to read `refusal.error === "live_allocation"` — prose — and
        // build `buildEnvelope("UNKNOWN", …)` for every other arm, i.e. "we
        // could not classify this failure" for a signed-out session, a rate
        // limit, five distinct internal faults and two 404s, all of which the
        // route classifies precisely.
        //
        // A body we cannot read yields `null` and falls through to UNKNOWN,
        // which is the honest verdict for a response we could not parse. That
        // is also a behaviour change worth naming: the previous code let a
        // 409 with an unreadable body THROW into the transport `catch` below.
        const refusal = (await res
          .json()
          .catch(() => null)) as LiveAllocationRefusal | null;

        if (res.status === 409 && refusal?.code === LIVE_ALLOCATION_CODE) {
          // The route wrote nothing. Show the consequence with the amount and
          // wait for an explicit confirmation.
          setPendingRemoval({
            amount:
              typeof refusal.allocated_amount === "number" &&
              Number.isFinite(refusal.allocated_amount)
                ? refusal.allocated_amount
                : 0,
          });
          setStatus("idle");
          return;
        }

        // The recogniser holds the ONE guarded cast (Pitfall 4): an unrostered
        // or unreadable code answers UNKNOWN by design rather than by accident.
        setEnvelope(
          buildEnvelope(
            recogniseDashboardDialogCode(ROUTE, refusal?.code),
            correlationId,
          ),
        );
        setStatus("idle");
        return;
      }

      setStatus("idle");
      setPendingRemoval(null);
      onClose();
      router.refresh();
    } catch {
      // Transport failure (offline, aborted). Same canonical envelope — the
      // dialog never invents a bespoke error sentence.
      setEnvelope(buildEnvelope("UNKNOWN", correlationId));
      setStatus("idle");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Mark ownership">
      {pendingRemoval ? (
        <>
          <p className="text-body font-medium text-text-primary">
            Remove allocation?
          </p>
          <p className="mt-2 text-small text-text-secondary">
            {`${strategyName} has a ${formatUsd(pendingRemoval.amount)} allocation. A team-review strategy cannot hold an allocation — changing the mark removes it.`}
          </p>
          {envelope && (
            <div className="mt-4">
              <ErrorEnvelope envelope={envelope} />
            </div>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                // Dismiss only. The mark and the position are unchanged — the
                // refusal never wrote anything.
                setPendingRemoval(null);
                setEnvelope(null);
              }}
            >
              Keep own capital
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => submit(true)}
              disabled={status === "loading"}
            >
              {status === "loading"
                ? "Removing..."
                : "Change mark and remove allocation"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-body font-medium text-text-primary">
            {strategyName}
          </p>
          <div className="mt-4">
            <CapitalOwnershipRadioGroup
              label="Whose capital is this?"
              value={mark}
              onChange={setMark}
            />
          </div>
          {envelope && (
            <div className="mt-4">
              <ErrorEnvelope envelope={envelope} />
            </div>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => submit(false)}
              disabled={status === "loading"}
            >
              {status === "loading" ? "Saving..." : "Save mark"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
