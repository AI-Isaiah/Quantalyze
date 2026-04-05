import { LoginForm } from "@/components/auth/LoginForm";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; redirect?: string }>;
}) {
  const params = await searchParams;

  // If Supabase sent a confirmation code, exchange it for a session
  if (params.code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (!error) {
      redirect(params.redirect || "/onboarding");
    }
    // If exchange fails, fall through to show login form
  }

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-text-primary">Quantalyze</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Sign in to your account
        </p>
      </div>
      <LoginForm />
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
