"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

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
 */
const MIN_PASSWORD_LENGTH = 6;

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [noSession, setNoSession] = useState(false);
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
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      // Supabase returns "Auth session missing!" when the user lands here
      // without a recovery session (e.g. typed /reset-password directly,
      // or the link expired). Show the recovery affordance instead of the
      // raw error so they know what to do next.
      if (/session/i.test(updateError.message)) {
        setNoSession(true);
        setLoading(false);
        return;
      }
      setError(updateError.message);
      setLoading(false);
      return;
    }

    router.push("/login?reset=1");
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
      {error && <p className="text-sm text-negative">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Updating password..." : "Update password"}
      </Button>
    </form>
  );
}
