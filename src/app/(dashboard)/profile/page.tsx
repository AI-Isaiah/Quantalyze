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
    // DOGFOOD-2: head-count allocator_holdings so the Exchanges-tab subtitle
    // only asserts "Active Allocation auto-synced" when holdings actually back
    // it. head:true fetches no row payload — same authorization scope as the
    // other admin reads on this page (gated by user.id from auth.getUser()).
    // This is a page-load-time signal; router.refresh() re-reads it, so it
    // does not need to track the 5s client sync poll.
    //
    // FIX 2 fail-loud (mirror of H-0499 in getUserApiKeys): surface `error`.
    // The pre-fix code discarded it, so a transient count failure produced
    // count=null → `(null ?? 0) > 0` === false → the subtitle falsely asserted
    // "no open positions yet" on a money path. On error we pass `hasHoldings:
    // null` (unknown) so AllocatorExchangeManager shows a neutral subtitle
    // rather than an affirmative-negative it can't back. We log but do NOT
    // throw — a holdings-count blip must not take down the whole Exchanges tab
    // (the keys list + balances remain accurate); it only de-asserts a
    // secondary signal.
    //
    // ponytail: this count includes holdings retained from soft-disconnected
    // keys (the disconnect modal's holdings-purge is optional / LOW-1), so an
    // allocator who disconnected every key can still read hasHoldings=true.
    // Genuine low-frequency edge; the upgrade path is to scope the count to
    // active (isPerKeyDailiesEligibleKey) keys via a join, deferred here to
    // avoid a subquery for a secondary subtitle signal.
    const { count: holdingsCount, error: holdingsCountError } = await admin
      .from("allocator_holdings")
      .select("id", { count: "exact", head: true })
      .eq("allocator_id", user.id);
    if (holdingsCountError) {
      console.error(
        "[ProfilePage] allocator_holdings head-count failed:",
        holdingsCountError.message ?? holdingsCountError,
      );
    }
    exchanges = {
      initialKeys,
      activePortfolio: activePortfolio
        ? { id: activePortfolio.id as string, name: activePortfolio.name as string }
        : null,
      hasHoldings: holdingsCountError ? null : (holdingsCount ?? 0) > 0,
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
