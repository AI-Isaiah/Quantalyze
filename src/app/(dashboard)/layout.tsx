import { DashboardChrome } from "@/components/layout/DashboardChrome";
import { getPopulatedCategorySlugs } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/lib/admin";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let populatedSlugs: string[] | undefined;
  try {
    const result = await getPopulatedCategorySlugs();
    if (result.length > 0) populatedSlugs = result;
  } catch {
    // undefined falls back to showing all categories in Sidebar
  }

  let isAdmin = false;
  let isAllocator = false;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    isAdmin = await isAdminUser(supabase, user);
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      isAllocator = profile?.role === "allocator" || profile?.role === "both";
    }
  } catch {
    // Not admin / no profile
  }

  return (
    <DashboardChrome
      populatedSlugs={populatedSlugs}
      isAdmin={isAdmin}
      isAllocator={isAllocator}
    >
      {children}
    </DashboardChrome>
  );
}
