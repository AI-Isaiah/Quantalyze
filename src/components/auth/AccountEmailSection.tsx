"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

// closed: the email and, when a change awaits confirmation, the pending panel.
// editing / submitting: the change form. The pending state is derived (closed
// with a pending address), so a reload with `new_email` set lands in it directly.
type UiState = "closed" | "editing" | "submitting";
type FocusTarget = "input" | "password" | "change" | "reopen";

// The wire contract of POST /api/account/email (Phase 219 plans 06 and 07).
type RouteBody = {
  ok?: unknown;
  pending_email?: unknown;
  code?: unknown;
  error?: unknown;
} | null;

const HELPER =
  "This is the email you use to sign in. Changing it takes effect after you confirm by email.";
const NO_EMAIL = "No sign-in email is set.";
const SAME_ADDRESS = "That is already your sign-in email.";
const EMPTY_MESSAGE_FALLBACK =
  "Could not send the confirmation link. Please try again.";
const SESSION_EXPIRED = "Your session expired. Sign in again.";
const UNAVAILABLE =
  "Email change is unavailable right now. Please try again later.";
const NETWORK_ERROR = "Network error. Please try again.";
const PASSWORD_SET = "Your password is set.";
const CONFIRMED_PREFIX = "Your sign-in email is now";
const TOO_MANY ="Too many attempts. Wait a minute and try again.";
const WRONG_PASSWORD = "That password is not right. Nothing was sent.";
const SET_PASSWORD_FIRST =
  "This account has no password yet. Set a password first, then change your email.";
// Public, bounce-exempt for every signed-in role (src/proxy.ts); plan 219-06.
const SET_PASSWORD_HREF = "/reset-password";
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
 * `new_email` (D-02, D-05). The browser no longer calls Auth: the form posts
 * the new address and the CURRENT PASSWORD to `POST /api/account/email`, which
 * checks the password (GD-01) and then asks Auth to mail the confirmation link,
 * so the app still never writes `auth.users` itself (D-11). The link lands on
 * `/auth/callback` and from there back on this tab (D-04).
 *
 * The password is held in state only until the response arrives: it is cleared
 * after every answer and on a thrown fetch, and never rendered back (T-219-29).
 *
 * Copy is true under either "Secure email change" setting (D-12): the pending
 * panel tells the user to confirm at the old address too, if mail arrives there.
 */
export function AccountEmailSection({
  email,
  pendingEmail,
  firstLinkAccepted = false,
  emailChangeConfirmed = false,
  passwordSet = false,
}: {
  email: string | null;
  pendingEmail: string | null;
  /** `?email_change=partial`: a first confirmation link was accepted, another is awaited. */
  firstLinkAccepted?: boolean;
  /**
   * `?email_change=confirmed`: the callback says the change finished. Only a
   * hint; the done note also needs NO pending address (GD-04).
   */
  emailChangeConfirmed?: boolean;
  /** `?password_set=1`: /reset-password sent a signed-in user back after setting a password. */
  passwordSet?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<UiState>("closed");
  const [value, setValue] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // GD-05a: a password-less account gets its own message and a link, never the
  // wrong-password line.
  const [passwordNotSet, setPasswordNotSet] = useState(false);
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
  const passwordRef = useRef<HTMLInputElement>(null);
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
    } else if (target === "password") {
      passwordRef.current?.focus();
    } else if (target) {
      sectionRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-account-email-focus="${target}"]`,
        )
        ?.focus();
    }
  }, [state]);

  function clearErrors() {
    setError(null);
    setPasswordNotSet(false);
  }

  function openForm() {
    clearErrors();
    focusTarget.current = "input";
    setState("editing");
  }

  function closeForm() {
    clearErrors();
    // Closing never clears a pending address: back to its panel and its button.
    focusTarget.current = shownPending ? "reopen" : "change";
    setState("closed");
  }

  function fail(message: string, focus: "input" | "password" = "input") {
    setError(message);
    focusTarget.current = focus;
    setState("editing");
  }

  // A server-supplied line shown as-is; blank falls back to an app-written one.
  function serverText(body: RouteBody, fallback: string) {
    return typeof body?.error === "string" && body.error.trim()
      ? body.error
      : fallback;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = value.trim();
    if (email && next.toLowerCase() === email.toLowerCase()) {
      setError(SAME_ADDRESS);
      return;
    }
    clearErrors();
    setState("submitting");
    let res: Response;
    try {
      res = await fetch("/api/account/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: next, password }),
      });
    } catch {
      setPassword("");
      fail(NETWORK_ERROR);
      return;
    }
    // The password is spent the moment an answer arrives, whatever it says.
    setPassword("");
    // Defensive: a non-JSON body (a proxy error page) must not throw past here.
    const body: RouteBody = await res.json().catch(() => null);
    const code = typeof body?.code === "string" ? body.code : null;

    if (res.status === 200 && body?.ok === true) {
      // A null pending_email means Auth applied the change at once
      // (autoconfirm), so there is nothing awaiting confirmation to show.
      setSentPending(
        typeof body.pending_email === "string" ? body.pending_email : null,
      );
      setValue("");
      setState("closed");
      router.refresh();
      return;
    }
    if (res.status === 429) {
      // A 429 carrying `update_failed` is Auth's own refusal (for example its
      // email send limit); its message says when to retry. The app's limiter
      // sends no code.
      fail(code === "update_failed" ? serverText(body, TOO_MANY) : TOO_MANY);
    } else if (res.status === 401) {
      fail(SESSION_EXPIRED);
    } else if (res.status === 503) {
      fail(UNAVAILABLE);
    } else if (code === "wrong_password") {
      fail(serverText(body, WRONG_PASSWORD), "password");
    } else if (code === "password_not_set") {
      setPasswordNotSet(true);
      focusTarget.current = "input";
      setState("editing");
    } else if (
      code === "verify_unavailable" ||
      code === "update_failed" ||
      code === "same_address"
    ) {
      fail(serverText(body, EMPTY_MESSAGE_FALLBACK));
    } else {
      fail(EMPTY_MESSAGE_FALLBACK);
    }
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

      {/* GD-04: a statement about Auth, never about the URL. The marker alone
          never asserts success: a pending address always wins over it. */}
      {!formOpen && !shownPending && emailChangeConfirmed && email && (
        <p
          role="status"
          className="text-xs text-text-secondary"
          data-testid="account-email-confirmed"
        >
          {CONFIRMED_PREFIX} {email}.
        </p>
      )}

      {passwordSet && (
        <p
          role="status"
          className="text-xs text-text-secondary"
          data-testid="account-password-set"
        >
          {PASSWORD_SET}
        </p>
      )}

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
          <Input
            ref={passwordRef}
            label="Current password"
            type="password"
            name="current_password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            disabled={state === "submitting"}
          />
          {passwordNotSet && (
            <p className="text-xs text-negative" role="alert">
              {SET_PASSWORD_FIRST}{" "}
              <Link
                href={SET_PASSWORD_HREF}
                className="font-semibold text-accent underline hover:text-accent-hover"
              >
                Set a password
              </Link>
            </p>
          )}
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
                until you open it.
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
