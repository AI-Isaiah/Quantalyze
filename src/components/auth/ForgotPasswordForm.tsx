"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * Request a password-reset email.
 *
 * Enumeration-safety: success copy is identical whether or not the email
 * exists in `auth.users`. Supabase's `resetPasswordForEmail` itself returns
 * a generic success even for unknown emails, but a UI that flips between
 * "we sent a link" and "we couldn't find that account" leaks membership.
 * We collapse both paths into the same neutral message.
 *
 * The reset link is a PKCE link, `/auth/callback?code=...&next=/reset-password`:
 * the browser client stores a code verifier cookie with this request, so the
 * link only works in the browser that asked for it. The callback exchanges the
 * code for a recovery session, then redirects to `/reset-password`, where
 * ResetPasswordForm finishes the flow with `updateUser({ password })`.
 *
 * A failed request is logged to the console (code and status only, never the
 * email), and a failure that reached Auth is also sent to Sentry as a warning
 * with the same two fields, so an operator sees it. Only a
 * network failure (status 0) and Auth's per-IP `over_request_rate_limit` show
 * a retry message: both happen before Auth looks the email up. Auth answers an
 * unknown email with 200 at once, so its per-user and project email limits
 * (429 `over_email_send_rate_limit`) and an email send failure (5xx) only ever
 * reach a real account; they keep the neutral copy, or the retry message would
 * reveal that the account exists.
 */
const TRY_LATER =
  "We could not send a reset link right now. Please try again in a few minutes.";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      },
    );
    if (resetError) {
      console.error(
        "[forgot-password] reset request failed:",
        resetError.code ?? "unknown",
        resetError.status ?? "no-status",
      );
      if ((resetError.status ?? 0) !== 0) {
        // Same fire-and-forget capture SignupForm uses (F-08): the browser
        // console is invisible to ops. Code and status only, never the email.
        const tags = {
          reset_request_code: resetError.code ?? "unknown",
          reset_request_status: String(resetError.status),
        };
        void import("@sentry/nextjs")
          .then(({ captureMessage }) => {
            captureMessage("ForgotPasswordForm: resetPasswordForEmail failed", {
              level: "warning",
              tags,
            });
          })
          .catch(() => {});
      }
      if (
        (resetError.status ?? 0) === 0 ||
        resetError.code === "over_request_rate_limit"
      ) {
        setError(TRY_LATER);
        setLoading(false);
        return;
      }
    }

    setSubmitted(true);
    setLoading(false);
  }

  if (submitted) {
    return (
      <p
        role="status"
        className="rounded-lg border border-border bg-surface p-4 text-sm text-text-primary"
      >
        If an account exists for that email, we sent a reset link. Check your
        inbox.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Email"
        type="email"
        name="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
        autoComplete="email"
      />
      {error && <p className="text-sm text-negative">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Sending reset link..." : "Send reset link"}
      </Button>
    </form>
  );
}
