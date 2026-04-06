import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { AdminTabs } from "@/components/admin/AdminTabs";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email)) redirect("/discovery/crypto-sma");

  const admin = createAdminClient();

  const [introRequests, pendingStrategies, pendingAllocators] = await Promise.all([
    admin
      .from("contact_requests")
      .select("id, status, message, admin_note, created_at, allocator_id, strategy_id, profiles!contact_requests_allocator_id_fkey(display_name, company), strategies!contact_requests_strategy_id_fkey(name)")
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("strategies")
      .select("id, name, status, strategy_types, created_at, user_id, profiles!strategies_user_id_fkey(display_name)")
      .eq("status", "pending_review")
      .order("created_at", { ascending: false }),
    admin
      .from("profiles")
      .select("id, display_name, company, email, allocator_status, created_at")
      .in("allocator_status", ["newbie", "pending"])
      .order("created_at", { ascending: false }),
  ]);

  return (
    <>
      <PageHeader title="Admin Dashboard" />
      <AdminTabs
        introRequests={introRequests.data ?? []}
        pendingStrategies={pendingStrategies.data ?? []}
        pendingAllocators={pendingAllocators.data ?? []}
      />
    </>
  );
}
