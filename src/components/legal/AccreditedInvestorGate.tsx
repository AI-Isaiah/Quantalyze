"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/**
 * The accredited-investor self-attestation gate. Rendered by the discovery
 * layout when the current user has no row in `investor_attestations`. Form
 * POSTs to /api/attestation; on success, the layout re-runs its server-side
 * check and renders the actual discovery content.
 *
 * Phase 194.2 D-04: the same component also serves as the attest step inside
 * the two intro entry points (`variant="modal"`, rendered as `Modal` children).
 * The no-prop render is /discovery's full-page gate and stays byte-identical
 * apart from its error path (UD-06).
 *
 * Legal content is templated (Termly/iubenda baseline) and reviewed by a
 * fintech lawyer in Sprint 7 per the plan's P-3 gate. The sentences below are
 * shared by both variants, so the modal can never drift from the reviewed text.
 * Only the lead's closing clause differs, by founder decision (D-06).
 */
const LEAD_BASE =
  "The strategies listed on this platform are made available to accredited or qualified investors only.";
const LEAD_PAGE = `${LEAD_BASE} Before viewing, please confirm the following:`;
const LEAD_MODAL = `${LEAD_BASE} Before requesting an introduction, please confirm the following:`;

const BULLETS = [
  "I qualify as an accredited investor (or the equivalent in my jurisdiction) per applicable securities regulations.",
  "I understand that past performance does not guarantee future results and that cryptocurrency trading involves substantial risk of loss.",
  "I understand that strategies shown are monitored via read-only exchange APIs. Managers retain custody of their assets. The platform provides analytics only — no pooling, no fund administration.",
  "I understand that introduction requests are routed through the platform team and that managers may decline an introduction.",
] as const;

const CHECKBOX_STATEMENT =
  "I confirm the statements above and acknowledge that I am an accredited or qualified investor.";

/**
 * UD-06: a status maps to fixed copy. The route's body is never printed, so raw
 * JSON such as `{"error":"Rate limit exceeded"}` cannot reach the screen.
 */
function attestationErrorCopy(status: number): string {
  if (status === 429) return "Too many attempts. Try again in a minute.";
  if (status === 401) return "Your session has ended. Sign in again to continue.";
  return "Your confirmation was not recorded. Try again.";
}

interface AccreditedInvestorGateProps {
  /** `page` is /discovery's full-page gate; `modal` is the attest step inside a `Modal`. */
  variant?: "page" | "modal";
  /** Modal variant only: the confirm button's label, per entry point. */
  confirmLabel?: string;
  /** Runs once after the attestation is recorded (modal variant: close and continue the action). */
  onAttested?: () => void;
  /** Modal variant only: "Close without confirming". Records nothing. */
  onDismiss?: () => void;
}

export function AccreditedInvestorGate({
  variant = "page",
  confirmLabel,
  onAttested,
  onDismiss,
}: AccreditedInvestorGateProps = {}) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isModal = variant === "modal";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accepted || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/attestation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true }),
      });
      if (!res.ok) {
        setError(attestationErrorCopy(res.status));
        setSubmitting(false);
        return;
      }
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
      return;
    }
    // Recorded. Continue the caller's action first, then soft-reload so the
    // server-rendered state (the discovery layout's check, the factsheet
    // viewer) re-reads investor_attestations.
    onAttested?.();
    router.refresh();
  }

  const body = (
    <>
      <p
        className={
          isModal
            ? "text-sm text-text-secondary leading-relaxed"
            : "mt-3 text-sm text-text-secondary leading-relaxed"
        }
      >
        {isModal ? LEAD_MODAL : LEAD_PAGE}
      </p>

      <ul className="mt-4 space-y-2 text-sm text-text-secondary list-disc pl-5">
        {BULLETS.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="flex items-start gap-3 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-accent"
          />
          <span>{CHECKBOX_STATEMENT}</span>
        </label>

        {error && (
          <p className="text-sm text-negative" role="alert">
            {error}
          </p>
        )}

        {isModal ? (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <a
              href="/legal/disclaimer"
              className="text-xs text-text-muted underline hover:text-text-secondary"
            >
              Read the full disclaimer
            </a>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" onClick={onDismiss}>
                Close without confirming
              </Button>
              <Button type="submit" disabled={!accepted || submitting}>
                {submitting ? "Recording..." : confirmLabel}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between pt-2">
            <a
              href="/legal/disclaimer"
              className="text-xs text-text-muted underline hover:text-text-secondary"
            >
              Read the full disclaimer
            </a>
            <Button type="submit" disabled={!accepted || submitting}>
              {submitting ? "Recording..." : "Continue to discovery"}
            </Button>
          </div>
        )}
      </form>
    </>
  );

  if (isModal) return <div>{body}</div>;

  return (
    <div className="mx-auto max-w-2xl py-12">
      <Card className="p-8">
        <h1 className="text-2xl font-semibold text-text-primary">
          Accredited Investor Acknowledgment
        </h1>
        {body}
      </Card>
    </div>
  );
}
