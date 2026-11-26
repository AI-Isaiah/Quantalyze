import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import Link from "next/link";
import { safeRedirectPath } from "@/lib/routing/role-home";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    redirect?: string | string[];
    next?: string | string[];
    error?: string | string[];
  }>;
}) {
  const params = await searchParams;
  // CD-02 / CD-13: one sanitiser for the deep link. `redirect` wins over `next`;
  // anything that is not a same-origin /lowercase path becomes null.
  const redirectTo =
    safeRedirectPath(params.redirect) ?? safeRedirectPath(params.next);

  // No ?code= exchange here (removed 2026-11-26): a Server Component cannot
  // set cookies, so it spent the one-time code and dropped the session. That
  // is how a signed-out password reset reached /reset-password with no
  // session. Email links are exchanged by the /auth/callback route handler.

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-display text-text-primary">Quantalyze</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Sign in to your account
        </p>
      </div>
      {params.error !== undefined && (
        // Fixed copy, never the reflected ?error= text: /auth/callback sends a
        // failed email link (an expired signup confirmation, say) here.
        <p
          role="alert"
          className="mb-4 rounded-lg border border-border bg-surface p-3 text-sm text-text-primary"
        >
          That email link could not be used. It may have expired or already
          been used.
        </p>
      )}
      <LoginForm redirectTo={redirectTo} />
      <p className="mt-6 text-center text-sm text-text-muted">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="font-medium text-accent hover:text-accent-hover"
        >
          Sign up
        </Link>
      </p>
    </>
  );
}
