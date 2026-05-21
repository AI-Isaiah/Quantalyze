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
 * The reset link arrives as `/auth/callback?token_hash=...&type=recovery`
 * — that route (PR #254) calls verifyOtp and issues a recovery session,
 * then redirects to `?next=/reset-password` where ResetPasswordForm
 * finishes the flow with `updateUser({ password })`.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const supabase = createClient();
    // We intentionally ignore the returned `error` for the visible UI —
    // showing "user not found" here is the enumeration leak. Real
    // delivery issues will surface in Supabase logs / Resend dashboard.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

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
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Sending reset link..." : "Send reset link"}
      </Button>
    </form>
  );
}
