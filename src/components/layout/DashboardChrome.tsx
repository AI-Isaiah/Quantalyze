"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { LegalFooter } from "@/components/legal/LegalFooter";

interface DashboardChromeProps {
  populatedSlugs?: string[];
  isAdmin?: boolean;
  isAllocator?: boolean;
  children: React.ReactNode;
}

/**
 * Client wrapper for the (dashboard) layout. Most routes get the sidebar +
 * centered max-w-7xl content shell. A small allow-list of "full-bleed" routes
 * (currently the allocator match queue detail) hides the sidebar so the queue
 * can use the full viewport width on iPad/landscape.
 *
 * The pathname check happens client-side via usePathname() so we can keep the
 * parent layout server-rendered (it still needs to do the auth lookup).
 */
export function DashboardChrome({
  populatedSlugs,
  isAdmin,
  isAllocator,
  children,
}: DashboardChromeProps) {
  const pathname = usePathname();

  // Full-bleed routes: hide sidebar + skip the centered max-w container so
  // the underlying page can claim every pixel. The match queue detail page
  // is the only one that needs this for now (Sprint 4 T10.1).
  const isFullBleed = /^\/admin\/match\/[^/]+\/?$/.test(pathname) &&
    pathname !== "/admin/match/eval";

  if (isFullBleed) {
    return (
      <div className="flex h-full">
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          <div className="px-4 py-6 md:px-8 md:py-8">
            {children}
            <Disclaimer variant="footer" />
          </div>
          <LegalFooter />
        </main>
        <MobileNav />
      </div>
    );
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
