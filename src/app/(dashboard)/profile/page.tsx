import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProfileTabs } from "@/components/auth/ProfileTabs";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Profile self-read uses the admin client because migration 012 column-
  // REVOKE'd bio/years_trading/aum_range from anon + authenticated. The
  // owner has authority to read their own row, but `select('*')` would be
  // denied at the column level via the user-scoped client. We're already
  // gated by the `user.id` from auth.getUser() above so this is the same
  // authorization scope, just executed through service_role.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/onboarding");

  return (
    <>
      <PageHeader
        title="Profile Settings"
        description="Manage your account and organizations."
        actions={<SignOutButton />}
      />
      <ProfileTabs profile={profile} />
    </>
  );
}
