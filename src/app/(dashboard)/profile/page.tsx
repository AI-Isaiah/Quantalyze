import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProfileTabs } from "@/components/auth/ProfileTabs";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getOwnPreferences } from "@/lib/preferences";
import { getUserApiKeys } from "@/lib/queries";
import type { ExchangesTabContentProps } from "@/components/exchanges/ExchangesTabContent";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

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

  // Allocator-only tabs (mandate + exchanges) only fetch for allocator / both.
  const isAllocator = profile.role === "allocator" || profile.role === "both";
  const initialPreferences = isAllocator
    ? await getOwnPreferences(supabase, user.id)
    : null;

  let exchanges: ExchangesTabContentProps | null = null;
  if (isAllocator) {
    const initialKeys = await getUserApiKeys(user.id);
    const { data: activePortfolio } = await admin
      .from("portfolios")
      .select("id, name")
      .eq("user_id", user.id)
      .ilike("name", "Active Allocation")
      .maybeSingle();
    exchanges = {
      initialKeys,
      activePortfolio: activePortfolio
        ? { id: activePortfolio.id as string, name: activePortfolio.name as string }
        : null,
    };
  }

  return (
    <>
      <PageHeader
        title="Profile Settings"
        description="Manage your account, organizations, and allocation mandate."
        actions={<SignOutButton />}
      />
      <ProfileTabs
        profile={profile}
        initialPreferences={initialPreferences}
        isAllocator={isAllocator}
        exchanges={exchanges}
      />
    </>
  );
}
