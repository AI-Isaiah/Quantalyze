import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { LegalFooter } from "@/components/legal/LegalFooter";
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
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar
          populatedSlugs={populatedSlugs}
          isAdmin={isAdmin}
          isAllocator={isAllocator}
        />
      </div>
      <main className="flex-1 md:ml-[260px] overflow-y-auto pb-16 md:pb-0">
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
          {children}
          <Disclaimer variant="footer" />
        </div>
        <LegalFooter />
      </main>
      {/* Mobile bottom nav */}
      <MobileNav />
    </div>
  );
}
