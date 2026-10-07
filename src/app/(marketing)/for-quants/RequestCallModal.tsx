"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import type { CtaLocation } from "@/lib/analytics";
import type { WizardStepKey } from "@/lib/wizard/localStorage";

/**
 * Request a Call modal for /for-quants. Structured fields (not a
 * free-text textarea) per the institutional audience. It names no email
 * address (Phase 164.6.6.3.5 DOMAINONE, D-01).
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

/**
 * Form-level strings, verbatim from 164.6.6.3.5-UI-SPEC.md "Error rendering
 * rule" (RequestCallForm column). The form picks one by HTTP status and never
 * renders the server's `error` text or an `Error.message`, so a developer
 * sentence or a browser's `Failed to fetch` can never reach the visitor.
 */
const ERROR_UNREADABLE =
  "Our server could not read this request. Reload the page and send it again; if it is refused again, shorten the notes. What you typed is still here until you reload, so copy the notes first.";
const ERROR_RATE_LIMITED =
  "Too many requests from this connection. Try again in a few minutes; what you typed is still here.";
const ERROR_SERVER =
  "Your request was not sent. Try again in a minute; what you typed is still here.";
const ERROR_UNAVAILABLE =
  "Requests are unavailable right now. Try again in a few minutes; what you typed is still here.";
const ERROR_NETWORK =
  "We could not reach the server. Check your connection and send again; what you typed is still here.";

/**
 * The `fieldErrors` keys this form draws a control for (UI-SPEC "Rendered-key
 * rule"). Any other key (`_form`, `website`, `wizard_context.*`) has nowhere to
 * render, so a 400 carrying only those must fall to the unreadable alert rather
 * than end with nothing on screen.
 */
const RENDERED_FIELD_KEYS = [
  "name",
  "firm",
  "email",
  "preferred_time",
  "notes",
] as const;

/** The form-level string for a non-2xx status, or null when a field note covers it. */
function errorForStatus(
  status: number,
  fieldErrors: Record<string, string[]> | undefined,
): string | null {
  if (status === 400) {
    const hasRenderedKey = RENDERED_FIELD_KEYS.some(
      (k) => (fieldErrors?.[k]?.length ?? 0) > 0,
    );
    return hasRenderedKey ? null : ERROR_UNREADABLE;
  }
  if (status === 413) return ERROR_UNREADABLE;
  if (status === 429) return ERROR_RATE_LIMITED;
  if (status === 503) return ERROR_UNAVAILABLE;
  return ERROR_SERVER;
}

/**
 * Optional wizard context payload — populated by WizardClient so the
 * founder can tell a lead came from inside the /strategies/new/wizard
 * flow and at which step. Shape matches `for_quants_leads.wizard_context`
 * JSONB column added in migration 031.
 *
 * `step` is typed as `WizardStepKey` (not `string`) so a caller passing
 * an arbitrary value fails at compile time instead of 400ing at the API
 * boundary — the server's WIZARD_CONTEXT_SCHEMA enum and this type now
 * agree. See G9.B.18.
 */
export interface RequestCallWizardContext {
  draft_strategy_id: string | null;
  step: WizardStepKey;
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
  // Guard ensures RequestCallForm mounts on each open and unmounts on
  // close — the form's useEffect at L94 must fire per-open (the click
  // tracker), and unmount-on-close gives a fresh useState on the next
  // open. Removing this guard while leaving Modal open={open} would
  // change useEffect timing from "on modal open" to "on page load",
  // silently breaking the click event semantics. See G9.B.19.
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
  // H-0270 honeypot. A real (sighted or screen-reader) user never sees
  // this field, so it stays "" and the server proceeds normally. A naive
  // bot that fills every input populates it; the server then drops the
  // lead silently (success-shaped 200, no insert, no founder email).
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // What the server confirmed: `stored` (a row was written) or `duplicate` (an
  // earlier request from this email is already on record today). Null until then.
  const [outcome, setOutcome] = useState<"stored" | "duplicate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Server returns `Record<string, string[]>` per field so callers can
  // show every Zod issue (e.g., email is both invalid format AND too
  // long). For inline rendering we surface the FIRST issue per field
  // — the most actionable — and fall back to undefined when there are
  // no issues for that field. G9.B.16.
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string[] | undefined>
  >({});
  const firstFieldError = (key: string): string | undefined =>
    fieldErrors[key]?.[0];
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
          // H-0270 honeypot — always sent so the server can evaluate it.
          // "" for humans; bots fill it and get silently dropped.
          website,
          wizard_context: wizardContext ?? null,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        error?: string;
        fieldErrors?: Record<string, string[]>;
      };

      if (!res.ok) {
        // Only keys this form draws are kept; the rest never render anywhere.
        const drawn: Record<string, string[]> = {};
        for (const key of RENDERED_FIELD_KEYS) {
          const issues = data.fieldErrors?.[key];
          if (issues?.length) drawn[key] = issues;
        }
        setFieldErrors(drawn);
        setError(errorForStatus(res.status, data.fieldErrors));
        setSubmitting(false);
        inFlight.current = false;
        return;
      }

      // A 2xx is success only when the route says what it did. A bare
      // `{ ok: true }` (an old route, a proxy, a regression) is NOT a stored
      // request, so it must never show the success view.
      if (data.status !== "stored" && data.status !== "duplicate") {
        setError(ERROR_SERVER);
        setSubmitting(false);
        inFlight.current = false;
        return;
      }

      if (data.status === "stored") {
        // Fire the conversion event from the CLIENT (not the server)
        // so its distinctId is the visitor's PostHog cookie ID — joining
        // view → click → submit on the same person. Server-side capture
        // would use a synthetic `lead:<uuid>` distinctId and split the
        // funnel across three unrelated IDs (G9.B.1). Not fired on
        // `duplicate`: no row was written, so it is not a new conversion.
        trackForQuantsEventClient("for_quants_lead_submit", {
          source: "modal",
          cta_location: ctaLocation,
        });
      }

      setOutcome(data.status);
      setSubmitting(false);
      // Leave inFlight true — the form is replaced by the outcome view
      // and should never re-submit.
    } catch {
      // A failed fetch throws a TypeError carrying browser text ("Failed to
      // fetch"); the visitor sees the fixed string instead (UI-SPEC).
      setError(ERROR_NETWORK);
      setSubmitting(false);
      inFlight.current = false;
    }
  }

  if (outcome) {
    const duplicate = outcome === "duplicate";
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
          {duplicate ? "Request already received" : "Request received"}
        </h3>
        <p className="mt-2 text-sm text-text-secondary">
          {duplicate
            ? `We already have a call request from ${email} today. The founder will reach out within 24 hours.`
            : `Thank you. We'll be in touch at ${email} within 24 hours.`}
        </p>
        <Button variant="secondary" onClick={onClose} className="mt-6 w-full">
          Close
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/*
        H-0270 honeypot. Hidden from humans — off-screen (not
        `display:none`, which some bots skip), `aria-hidden` so screen
        readers ignore it, `tabIndex={-1}` so it is unreachable by
        keyboard, and `autoComplete="off"` so password managers don't
        fill it. Naive bots that populate every input trip it; the server
        then drops the lead silently. Kept in the layout tree (where bots
        scrape) rather than removed so the bait actually works.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[9999px] top-0 h-px w-px overflow-hidden"
      >
        <label htmlFor="fq-website">Website (leave this blank)</label>
        <input
          id="fq-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      <Input
        ref={firstFieldRef}
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Jane Doe"
        required
        autoComplete="name"
        error={firstFieldError("name")}
      />
      <Input
        label="Firm"
        value={firm}
        onChange={(e) => setFirm(e.target.value)}
        placeholder="Firm or team name"
        required
        autoComplete="organization"
        error={firstFieldError("firm")}
      />
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@firm.com"
        required
        autoComplete="email"
        error={firstFieldError("email")}
      />
      <Input
        label="Preferred time (optional)"
        value={preferredTime}
        onChange={(e) => setPreferredTime(e.target.value)}
        placeholder="e.g. Tue morning PT"
        error={firstFieldError("preferred_time")}
      />
      <Textarea
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything we should know before the call"
        rows={3}
        error={firstFieldError("notes")}
      />

      {error && (
        <p className="text-sm text-negative" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Sending..." : "Send request"}
      </Button>
    </form>
  );
}
