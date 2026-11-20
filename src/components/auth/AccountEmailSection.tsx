"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

// closed: the email and, when a change awaits confirmation, the pending panel.
// editing / submitting: the change form. The pending state is derived (closed
// with a pending address), so a reload with `new_email` set lands in it directly.
type UiState = "closed" | "editing" | "submitting";
type FocusTarget = "input" | "change" | "reopen";

const HELPER =
  "This is the email you use to sign in. Changing it takes effect after you confirm by email.";
const NO_EMAIL = "No sign-in email is set.";
const SAME_ADDRESS = "That is already your sign-in email.";
const EMPTY_MESSAGE_FALLBACK =
  "Could not send the confirmation link. Please try again.";
const NETWORK_ERROR = "Network error. Please try again.";
// Shown while a change is pending and /auth/callback sent the user back with the
// first-link marker (Phase 219 MD-01). True under either "Secure email change"
// setting: the marker only arrives when Auth accepted a confirmation and still
// waits for another.
const FIRST_LINK_ACCEPTED =
  "Your confirmation was accepted. To finish the change, confirm the link sent to your other address.";

/**
 * Phase 219 (D-01..D-05): the Account tab's sign-in email and its change flow.
 *
 * `email` is the server-read `auth.getUser().email` and `pendingEmail` its
 * `new_email` (D-02, D-05); the browser only calls `auth.updateUser`, so the
 * app never writes `auth.users` itself (D-11). Supabase mails the confirmation
 * link, which lands on `/auth/callback` and from there back on this tab (D-04).
 *
 * Copy is true under either "Secure email change" setting (D-12): the pending
 * panel tells the user to confirm at the old address too, if mail arrives there.
 */
export function AccountEmailSection({
  email,
  pendingEmail,
  firstLinkAccepted = false,
}: {
  email: string | null;
  pendingEmail: string | null;
  /** `?email_change=partial`: a first confirmation link was accepted, another is awaited. */
  firstLinkAccepted?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<UiState>("closed");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The address Auth reports as awaiting confirmation (`data.user.new_email`),
  // shown until the refreshed props arrive. Any change in the server props wins
  // over it (SF-01): the refresh is the truth, this is only its stand-in.
  const [sentPending, setSentPending] = useState<string | null>(null);
  const [seenProps, setSeenProps] = useState({ email, pendingEmail });
  if (seenProps.email !== email || seenProps.pendingEmail !== pendingEmail) {
    setSeenProps({ email, pendingEmail });
    setSentPending(null);
  }

  const sectionRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set by a handler, consumed once by the effect below after the next render.
  const focusTarget = useRef<FocusTarget | null>(null);

  const shownPending = sentPending ?? pendingEmail;

  // Button declares no ref (and the shared primitive is not edited), so the
  // two button targets are found by a data attribute Button passes through.
  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === "input") {
      inputRef.current?.focus();
    } else if (target) {
      sectionRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-account-email-focus="${target}"]`,
        )
        ?.focus();
    }
  }, [state]);

  function openForm() {
    setError(null);
    focusTarget.current = "input";
    setState("editing");
  }

  function closeForm() {
    setError(null);
    // Closing never clears a pending address: back to its panel and its button.
    focusTarget.current = shownPending ? "reopen" : "change";
    setState("closed");
  }

  function fail(message: string) {
    setError(message);
    focusTarget.current = "input";
    setState("editing");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = value.trim();
    if (email && next.toLowerCase() === email.toLowerCase()) {
      setError(SAME_ADDRESS);
      return;
    }
    setError(null);
    setState("submitting");
    try {
      // Created here, never at render: the browser client is only needed once
      // the user submits.
      const supabase = createClient();
      const { data, error: updateError } = await supabase.auth.updateUser(
        { email: next },
        {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/profile?tab=account")}`,
        },
      );
      if (updateError) {
        fail(updateError.message.trim() ? updateError.message : EMPTY_MESSAGE_FALLBACK);
        return;
      }
      // No `new_email` means Auth applied the change at once (autoconfirm), so
      // there is nothing awaiting confirmation to show.
      setSentPending(data.user?.new_email ?? null);
    } catch {
      fail(NETWORK_ERROR);
      return;
    }
    setValue("");
    setState("closed");
    router.refresh();
  }

  const formOpen = state === "editing" || state === "submitting";

  return (
    <section
      ref={sectionRef}
      aria-labelledby="account-email-heading"
      className="space-y-3"
    >
      <div>
        <h3
          id="account-email-heading"
          className="text-sm font-semibold text-text-primary"
        >
          Sign-in email
        </h3>
        <p className="mt-1 text-xs text-text-secondary">{HELPER}</p>
      </div>
      <p
        className="text-sm font-semibold text-text-primary break-all"
        data-testid="account-email"
      >
        {email ?? NO_EMAIL}
      </p>

      {!formOpen && !shownPending && (
        <Button
          variant="secondary"
          data-account-email-focus="change"
          onClick={openForm}
        >
          Change email
        </Button>
      )}

      {formOpen && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            ref={inputRef}
            label="New email"
            type="email"
            name="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            disabled={state === "submitting"}
          />
          {error && (
            <p className="text-xs text-negative" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={state === "submitting"}>
              {state === "submitting" ? "Sending link..." : "Send confirmation link"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={closeForm}
              disabled={state === "submitting"}
            >
              Keep current email
            </Button>
          </div>
        </form>
      )}

      {!formOpen && shownPending && (
        <>
          <div
            role="status"
            className="rounded-md border border-border bg-page px-4 py-3 text-sm text-text-secondary"
          >
            We sent a confirmation link to{" "}
            <span className="font-semibold text-text-primary break-all">
              {shownPending}
            </span>
            .
            {email && (
              <>
                {" "}
                You still sign in with{" "}
                <span className="font-semibold text-text-primary break-all">
                  {email}
                </span>{" "}
                until you confirm. If you also get an email at{" "}
                <span className="font-semibold text-text-primary break-all">
                  {email}
                </span>
                , confirm that one too.
              </>
            )}
          </div>
          {firstLinkAccepted && (
            <p
              className="text-xs text-text-secondary"
              data-testid="account-email-first-link"
            >
              {FIRST_LINK_ACCEPTED}
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            data-account-email-focus="reopen"
            onClick={openForm}
          >
            Use a different email
          </Button>
        </>
      )}
    </section>
  );
}
