"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";

/**
 * Finish the password-reset flow.
 *
 * Reaching this form requires an active recovery session in cookies —
 * `/auth/callback?type=recovery` exchanges the token_hash on landing and
 * the resulting session is what authorizes `updateUser({ password })`.
 *
 * Direct navigation to `/reset-password` (no email link) yields a 401-ish
 * "Auth session missing!" from Supabase. We surface that as a friendly
 * "open the link from your email" message rather than the raw error.
 *
 * A signed-in user whose session is older than 24 h (for example a
 * password-less partner-import user following the Account tab's "Set a
 * password" link) meets `reauthentication_needed` once Secure password change
 * is ON (GD-07). The form then sends a code with `reauthenticate()` and retries
 * `updateUser({ password, nonce })`. A recovery session is always new, so the
 * recovery-link path never sees the prompt.
 *
 * The length floor is `MIN_PASSWORD_LENGTH` from `@/lib/auth/password-policy`
 * — the ONE place the client floor is written, and where the measured hosted
 * policy it mirrors is recorded (SEC-01). It used to be a local constant here,
 * independent of SignupForm's own literal.
 */

const CODE_SENT =
  "For your security, we sent a code to your email. Enter it below to set your password.";

const CODE_RESENT = "We sent a new code to your email.";
const CODE_INVALID =
  "That code is not right or has expired. Send a new code and try again.";
const CODE_SEND_FAILED = "Could not send a code. Please try again.";

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [noSession, setNoSession] = useState(false);
  const [step, setStep] = useState<"password" | "code">("password");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { data, error: updateError } = await supabase.auth.updateUser(
      step === "code" ? { password, nonce: code.trim() } : { password },
    );

    if (updateError) {
      // GD-07: matched on the error code, never on message text.
      if (updateError.code === "reauthentication_needed" && step === "password") {
        // The one automatic send. Every later send is the explicit resend control.
        const { error: sendError } = await supabase.auth.reauthenticate();
        if (sendError) {
          setError(sendError.message.trim() || CODE_SEND_FAILED);
        } else {
          setStep("code");
          setNotice(CODE_SENT);
          setCode("");
        }
        setLoading(false);
        return;
      }
      const isReauthCode = updateError.code?.startsWith("reauth") ?? false;
      // Supabase returns "Auth session missing!" when the user lands here
      // without a recovery session (e.g. typed /reset-password directly,
      // or the link expired). Show the recovery affordance instead of the
      // raw error so they know what to do next.
      if (!isReauthCode && /session/i.test(updateError.message)) {
        setNoSession(true);
        setLoading(false);
        return;
      }
      if (step === "code") {
        // A failed nonce retry never re-sends and never falls back to an
        // un-nonced call; the typed code is cleared, the passwords are kept.
        setError(
          updateError.code === "reauthentication_not_valid"
            ? CODE_INVALID
            : updateError.message.trim() || CODE_INVALID,
        );
        setNotice(null);
        setCode("");
        setLoading(false);
        return;
      }
      setError(updateError.message);
      setLoading(false);
      return;
    }

    // updateUser keeps the session, and the proxy bounces a signed-in user off
    // /login to the role home, where neither note would show. So a signed-in
    // user returns to the Account tab with its own confirmation (GR1-MD-02).
    router.push(
      data?.user ? "/profile?tab=account&password_set=1" : "/login?reset=1",
    );
  }

  async function handleResend() {
    setError(null);
    setResending(true);
    const { error: sendError } = await createClient().auth.reauthenticate();
    if (sendError) {
      setError(sendError.message.trim() || CODE_SEND_FAILED);
    } else {
      setNotice(CODE_RESENT);
      setCode("");
    }
    setResending(false);
  }

  if (noSession) {
    return (
      <div className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm text-text-primary">
        <p>Open the password-reset link from your email to continue.</p>
        <Link
          href="/forgot-password"
          className="font-medium text-accent hover:text-accent-hover"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="New password"
        type="password"
        name="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
      />
      <Input
        label="Confirm new password"
        type="password"
        name="confirm_password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Re-type your new password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
      />
      {step === "code" && (
        <>
          {notice && (
            <p role="status" className="text-sm text-text-secondary">
              {notice}
            </p>
          )}
          <Input
            label="Code from your email"
            type="text"
            name="reauth_code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            inputMode="numeric"
            autoComplete="one-time-code"
          />
        </>
      )}
      {error && <p className="text-sm text-negative">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Updating password..." : "Update password"}
      </Button>
      {step === "code" && (
        <Button
          type="button"
          variant="secondary"
          disabled={loading || resending}
          onClick={handleResend}
          className="w-full"
        >
          Send a new code
        </Button>
      )}
    </form>
  );
}
