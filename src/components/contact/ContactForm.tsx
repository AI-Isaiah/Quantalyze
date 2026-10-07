"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/utils";
import {
  CONTACT_REFERENCE_MAX,
  CONTACT_TOPICS,
  CONTACT_TOPIC_LABELS,
  type ContactTopic,
} from "@/lib/contact";

/**
 * The /contact form (Phase 164.6.6.3.5 DOMAINONE, D-01 / D-02). Every pointer in
 * the product lands here.
 *
 * It shares `RequestCallForm`'s submit discipline: a synchronous `useRef`
 * in-flight gate (state is async, so two clicks in one render tick would both
 * see `submitting === false`), the H-0270 honeypot, and the first issue per
 * field under its control. It differs where a page differs from a modal: no
 * autofocus on mount (a page must not steal focus), no analytics event, and a
 * left-aligned success view with no icon (UI-SPEC AD-09).
 *
 * Success means STORED (UI-SPEC "Success means stored"): `Message received`
 * renders only when the route answers `status: "stored"`. Any other 2xx, a bare
 * `{ ok: true }` included, is a route regression and reads as not sent.
 */

/**
 * Form-level strings, verbatim from 164.6.6.3.5-UI-SPEC.md (Copywriting
 * Contract). The form picks one by HTTP status and never renders the server's
 * `error` text or an `Error.message`, so a developer sentence or a browser's
 * `Failed to fetch` can never reach the visitor.
 */
const ERROR_UNREADABLE =
  "Our server could not read this submission. Reload the page and send it again; if it is refused again, shorten the message. What you typed is still here until you reload, so copy the message first.";
const ERROR_RATE_LIMITED =
  "Too many messages from this connection. Try again in a few minutes; what you typed is still here.";
const ERROR_SERVER =
  "Your message was not sent. Try again in a minute; what you typed is still here.";
const ERROR_UNAVAILABLE =
  "The contact form is unavailable right now. Try again in a few minutes; what you typed is still here.";
const ERROR_NETWORK =
  "We could not reach the server. Check your connection and send again; what you typed is still here.";

/**
 * The `fieldErrors` keys this form draws a control for (UI-SPEC "Rendered-key
 * rule"). Any other key (`_form`, `topic`, `website`) has nowhere to render, so
 * a 400 carrying only those must fall to the unreadable alert rather than end
 * with nothing on screen. `topic` is unrendered on purpose: the Select cannot
 * produce an invalid value, so a topic error is our fault, not the visitor's.
 */
const RENDERED_FIELD_KEYS = [
  "name",
  "email",
  "firm",
  "reference",
  "message",
] as const;

/** The form-level string for a non-2xx status, or null when a field note covers it. */
function errorForStatus(
  status: number,
  drawn: Record<string, string[]>,
): string | null {
  if (status === 400) {
    return Object.keys(drawn).length > 0 ? null : ERROR_UNREADABLE;
  }
  if (status === 413) return ERROR_UNREADABLE;
  if (status === 429) return ERROR_RATE_LIMITED;
  if (status === 503) return ERROR_UNAVAILABLE;
  return ERROR_SERVER;
}

const TOPIC_OPTIONS = CONTACT_TOPICS.map((value) => ({
  value,
  label: CONTACT_TOPIC_LABELS[value],
}));

export function ContactForm({
  initialTopic,
  initialReference,
}: {
  initialTopic: ContactTopic;
  initialReference: string;
}) {
  const [topic, setTopic] = useState<ContactTopic>(initialTopic);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [firm, setFirm] = useState("");
  const [reference, setReference] = useState(initialReference);
  const [message, setMessage] = useState("");
  // H-0270 honeypot: a human never sees it, so it stays "". A bot that fills
  // every input populates it and the server drops the message silently.
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<{ email: string; reference: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // The route answers `Record<string, string[]>` per field; the first issue is
  // the most actionable, so that is the one drawn under its control.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const firstFieldError = (key: (typeof RENDERED_FIELD_KEYS)[number]) =>
    fieldErrors[key]?.[0];
  const inFlight = useRef(false);
  const successHeading = useRef<HTMLHeadingElement>(null);

  // The success view replaces the form, so focus would otherwise fall to <body>.
  useEffect(() => {
    if (sent) successHeading.current?.focus();
  }, [sent]);

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
          source: "contact_form",
          topic,
          name,
          email,
          firm,
          reference,
          message,
          website,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        fieldErrors?: Record<string, string[]>;
      };

      if (!res.ok) {
        // Only keys this form draws are kept; the rest never render anywhere.
        const drawn: Record<string, string[]> = {};
        for (const key of RENDERED_FIELD_KEYS) {
          const issues = data.fieldErrors?.[key];
          if (Array.isArray(issues) && issues.length > 0) drawn[key] = issues;
        }
        setFieldErrors(drawn);
        setError(errorForStatus(res.status, drawn));
        setSubmitting(false);
        inFlight.current = false;
        return;
      }

      if (res.ok && data.status === "stored") {
        setSent({ email, reference: reference.trim() });
        setSubmitting(false);
        // Leave inFlight true: the form is replaced and must never re-submit.
        return;
      }

      // A 2xx that is not `stored` (a bare `{ ok: true }`, `duplicate`, an old
      // route) wrote nothing we can vouch for, so it is never the success view.
      setError(ERROR_SERVER);
      setSubmitting(false);
      inFlight.current = false;
    } catch {
      // A failed fetch throws a TypeError carrying browser text ("Failed to
      // fetch"); the visitor sees the fixed string instead.
      setError(ERROR_NETWORK);
      setSubmitting(false);
      inFlight.current = false;
    }
  }

  function sendAnother() {
    setName("");
    setEmail("");
    setFirm("");
    setReference("");
    setMessage("");
    setWebsite("");
    setError(null);
    setFieldErrors({});
    inFlight.current = false;
    setSent(null);
  }

  if (sent) {
    return (
      <div role="status" className="space-y-2">
        <h2
          ref={successHeading}
          tabIndex={-1}
          className="font-display text-h2 tracking-tight text-text-primary focus:outline-none"
        >
          Message received
        </h2>
        <p className="text-body leading-relaxed text-text-secondary">
          We reply to {sent.email} within one business day.
        </p>
        {sent.reference && (
          <p className="text-body leading-relaxed text-text-secondary">
            Reference: <span className="font-metric">{sent.reference}</span>
          </p>
        )}
        <div className="pt-4">
          <Button variant="secondary" onClick={sendAnother}>
            Send another message
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/*
        H-0270 honeypot, copied from RequestCallForm: off-screen (not
        display:none, which some bots skip), aria-hidden, tabIndex -1 and
        autoComplete off so password managers do not fill it.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[9999px] top-0 h-px w-px overflow-hidden"
      >
        <label htmlFor="contact-website">Website (leave this blank)</label>
        <input
          id="contact-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      <Select
        label="Topic"
        value={topic}
        onChange={(e) => setTopic(e.target.value as ContactTopic)}
        options={TOPIC_OPTIONS}
      />
      <Input
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={200}
        autoComplete="name"
        error={firstFieldError("name")}
      />
      <Field
        label="Email"
        hint="We reply to this address."
        error={firstFieldError("email")}
      >
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={320}
          autoComplete="email"
          className={firstFieldError("email") ? "border-negative" : undefined}
        />
      </Field>
      <Input
        label="Firm (optional)"
        value={firm}
        onChange={(e) => setFirm(e.target.value)}
        maxLength={200}
        autoComplete="organization"
        error={firstFieldError("firm")}
      />
      <Field
        label="Reference (optional)"
        hint="The correlation id or draft ID from an error message. It is filled in when you arrive from one."
        error={firstFieldError("reference")}
      >
        <Input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={CONTACT_REFERENCE_MAX}
          className={cn(
            "font-metric",
            firstFieldError("reference") && "border-negative",
          )}
        />
      </Field>
      <Textarea
        label="Message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        required
        rows={6}
        maxLength={2000}
        error={firstFieldError("message")}
      />

      {error && (
        <p className="text-caption text-negative" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6">
        <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
          {submitting ? "Sending..." : "Send message"}
        </Button>
      </div>
    </form>
  );
}
