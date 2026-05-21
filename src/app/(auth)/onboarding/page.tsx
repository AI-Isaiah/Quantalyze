import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isProfileApproved } from "@/lib/approval";
import { OnboardingWizard } from "@/components/auth/OnboardingWizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  // Universal signup-approval gate (task #14, 2026-05-21). /onboarding
  // lives under (auth) so the dashboard layout gate does NOT cover it —
  // duplicate the check here so a freshly-signed-up user who navigates
  // directly to /onboarding still gets redirected to /pending-approval.
  // No session → /login (the existing OnboardingWizard already assumes
  // a session, so this also tightens the route's auth precondition).
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
  if (!isProfileApproved(profile)) {
    redirect("/pending-approval");
  }

  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-text-primary">Welcome</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Tell us about yourself to get started
        </p>
      </div>
      <OnboardingWizard />
    </>
  );
}
