"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import type { CtaLocation } from "@/lib/analytics";

/**
 * Request a Call modal for /for-quants. Structured fields (not a
 * free-text textarea) per the institutional audience, with a mailto
 * fallback for users who prefer email.
 *
 * Why a child form component:
 *   The inner `<RequestCallForm>` is mounted when the modal opens and
 *   unmounted when it closes, so reopening starts with fresh useState
 *   initial values. No reset effect, no setState-in-effect anti-pattern.
 *
 * Why a synchronous submit gate via useRef:
 *   `submitting` state is async; a double-click within one render tick
 *   would see `submitting === false` twice and fire two POSTs. The ref
 *   is set synchronously so the second click bails immediately.
 */

const MAILTO_HREF =
  "mailto:security@quantalyze.com?subject=Quantalyze%20onboarding%20call%20request&body=Hi%2C%0A%0AI%27d%20like%20to%20schedule%20an%20onboarding%20call%20for%20my%20quant%20team.%0A%0AName%3A%0AFirm%3A%0APreferred%20time%3A%0ANotes%3A%0A";

/**
 * Optional wizard context payload — populated by WizardClient so the
 * founder can tell a lead came from inside the /strategies/new/wizard
 * flow and at which step. Shape matches `for_quants_leads.wizard_context`
 * JSONB column added in migration 031.
 */
export interface RequestCallWizardContext {
  draft_strategy_id: string | null;
  step: string;
  wizard_session_id: string;
}

interface RequestCallModalProps {
  open: boolean;
  onClose: () => void;
  ctaLocation: CtaLocation;
  /** When present, forwarded to /api/for-quants-lead as `wizard_context`. */
  wizardContext?: RequestCallWizardContext;
}

export function RequestCallModal({
  open,
  onClose,
  ctaLocation,
  wizardContext,
}: RequestCallModalProps) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Request a Call">
      <p className="-mt-3 mb-4 text-xs text-text-muted">
        The founder will reach out within 24 hours.
      </p>
      <RequestCallForm
        onClose={onClose}
        ctaLocation={ctaLocation}
        wizardContext={wizardContext}
      />
    </Modal>
  );
}

function RequestCallForm({
  onClose,
  ctaLocation,
  wizardContext,
}: {
  onClose: () => void;
  ctaLocation: CtaLocation;
  wizardContext?: RequestCallWizardContext;
}) {
  const [name, setName] = useState("");
  const [firm, setFirm] = useState("");
  const [email, setEmail] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const firstFieldRef = useRef<HTMLInputElement>(null);
  // Must be a ref, not state — synchronous gate against double-click
  // within one React render tick (see docblock).
  const inFlight = useRef(false);

  useEffect(() => {
    trackForQuantsEventClient("for_quants_request_call_click", {
      cta_location: ctaLocation,
    });
    const timer = window.setTimeout(() => {
      firstFieldRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ctaLocation]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;

    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      const res = await fetch("/api/for-quants-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          firm,
          email,
          preferred_time: preferredTime,
          notes,
          wizard_context: wizardContext ?? null,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!res.ok) {
        if (data.fieldErrors) {
          setFieldErrors(data.fieldErrors);
        }
        setError(
          data.error ??
            "Something went wrong. Email security@quantalyze.com directly.",
        );
        setSubmitting(false);
        inFlight.current = false;
        return;
      }

      setSubmitted(true);
      setSubmitting(false);
      // Leave inFlight true — the form is replaced by the success view
      // and should never re-submit.
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Network error. Email security@quantalyze.com directly.",
      );
      setSubmitting(false);
      inFlight.current = false;
    }
  }

  if (submitted) {
    return (
      <div className="py-4 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
          <svg
            aria-hidden="true"
            focusable="false"
            className="h-6 w-6 text-accent"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="font-display text-base text-text-primary">
          Request received
        </h3>
        <p className="mt-2 text-sm text-text-secondary">
          Thank you. We&apos;ll be in touch at {email} within 24 hours.
        </p>
        <Button variant="secondary" onClick={onClose} className="mt-6 w-full">
          Close
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        ref={firstFieldRef}
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Jane Doe"
        required
        autoComplete="name"
        error={fieldErrors.name}
      />
      <Input
        label="Firm"
        value={firm}
        onChange={(e) => setFirm(e.target.value)}
        placeholder="Firm or team name"
        required
        autoComplete="organization"
        error={fieldErrors.firm}
      />
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@firm.com"
        required
        autoComplete="email"
        error={fieldErrors.email}
      />
      <Input
        label="Preferred time (optional)"
        value={preferredTime}
        onChange={(e) => setPreferredTime(e.target.value)}
        placeholder="e.g. Tue morning PT"
        error={fieldErrors.preferred_time}
      />
      <Textarea
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything we should know before the call"
        rows={3}
        error={fieldErrors.notes}
      />

      {error && (
        <p className="text-sm text-negative" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Sending..." : "Send request"}
      </Button>

      <p className="text-center text-xs text-text-muted">
        Prefer email?{" "}
        <a
          href={MAILTO_HREF}
          className="underline hover:text-text-primary"
          onClick={() =>
            trackForQuantsEventClient("for_quants_lead_submit", {
              source: "mailto",
              cta_location: ctaLocation,
            })
          }
        >
          security@quantalyze.com
        </a>
      </p>
    </form>
  );
}
