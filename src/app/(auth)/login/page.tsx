import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { safeRedirectPath } from "@/lib/routing/role-home";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    code?: string;
    redirect?: string | string[];
    next?: string | string[];
  }>;
}) {
  const params = await searchParams;
  // CD-02 / CD-13: one sanitiser for the deep link. `redirect` wins over `next`;
  // anything that is not a same-origin /lowercase path becomes null.
  const redirectTo =
    safeRedirectPath(params.redirect) ?? safeRedirectPath(params.next);

  // If Supabase sent a confirmation code, exchange it for a session
  if (params.code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (!error) {
      redirect(redirectTo ?? "/onboarding");
    }
    // If exchange fails, fall through to show login form
  }

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-display text-text-primary">Quantalyze</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Sign in to your account
        </p>
      </div>
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
