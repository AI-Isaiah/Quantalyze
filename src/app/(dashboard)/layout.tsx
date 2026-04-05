import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { getPopulatedCategorySlugs } from "@/lib/queries";

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

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar populatedSlugs={populatedSlugs} />
      </div>
      <main className="flex-1 md:ml-[260px] overflow-y-auto pb-16 md:pb-0">
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
          {children}
          <Disclaimer variant="footer" />
        </div>
      </main>
      {/* Mobile bottom nav */}
      <MobileNav />
    </div>
  );
}
