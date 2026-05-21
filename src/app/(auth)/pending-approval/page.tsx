import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isProfileApproved } from "@/lib/approval";
import { SignOutButton } from "@/components/auth/SignOutButton";

/**
 * /pending-approval — task #14 (2026-05-21).
 *
 * Where new signups land after creating an account. Tells them their
 * application is being reviewed by an admin. The dashboard + onboarding
 * gates also redirect any not-yet-verified profile here, so a user who
 * tries to sign in mid-review still gets the same message instead of
 * a 404 / silent dashboard wall.
 *
 * Server-side behaviour:
 *  - No session → /login (no reason to show "your application is being
 *    reviewed" to someone who hasn't applied).
 *  - Approved profile → /onboarding (don't strand verified users on this
 *    page if they navigate back to the URL).
 *  - Pending profile → render the message + sign-out button.
 *
 * Lives under (auth) so the dashboard chrome (sidebar, top nav) does NOT
 * render — those would tease features the user cannot yet reach.
 */

export const metadata: Metadata = {
  title: "Application under review | Quantalyze",
  description: "Your Quantalyze application is being reviewed by our team.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PendingApprovalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, allocator_status, manager_status, is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (isProfileApproved(profile)) {
    redirect("/onboarding");
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-6 px-6 py-12 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-text-primary">
          Thanks for signing up
        </h1>
        <p className="text-sm text-text-muted">
          Your application is being reviewed. We&rsquo;ll email you as
          soon as it&rsquo;s approved &mdash; usually within one business
          day.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4 text-left">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
          What happens next
        </p>
        <ol className="mt-2 space-y-1 text-sm text-text-primary">
          <li>1. A Quantalyze admin reviews your application.</li>
          <li>2. You receive an email when your account is approved.</li>
          <li>3. Sign back in to access the platform.</li>
        </ol>
      </div>
      <div className="flex flex-col items-center gap-3">
        <SignOutButton />
        <p className="text-xs text-text-muted">
          Questions?{" "}
          <Link
            href="mailto:hello@quantalyze.com"
            className="text-accent underline"
          >
            hello@quantalyze.com
          </Link>
        </p>
      </div>
    </div>
  );
}
