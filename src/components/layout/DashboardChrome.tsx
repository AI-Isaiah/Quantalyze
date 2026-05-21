"use client";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { MobileTopBar } from "@/components/layout/MobileTopBar";
import { MobileSidebarDrawer } from "@/components/layout/MobileSidebarDrawer";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { LegalFooter } from "@/components/legal/LegalFooter";
import { useFlaggedCountStore } from "@/app/(dashboard)/allocations/AllocationContext";

interface DashboardChromeProps {
  populatedSlugs?: string[];
  isAdmin?: boolean;
  isAllocator?: boolean;
  isManager?: boolean;
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
 *
 * Phase 09.1 Plan 11 / R5 accepted — `flaggedCount` for the "My Allocation"
 * sidebar badge sources from the cross-tree store published by
 * AllocationProvider (which lives _below_ this component in the React tree
 * because AllocationProvider is mounted inside `/allocations/page.tsx` and
 * DashboardChrome lives in `(dashboard)/layout.tsx` which wraps it). Plain
 * Context cannot bridge that boundary, so AllocationContext.tsx exposes a
 * `useSyncExternalStore`-backed bridge — `useFlaggedCountStore()` here. On
 * non-allocations routes the provider is absent → store value is `0` →
 * Sidebar hides the badge. No new server query is introduced.
 */
export function DashboardChrome({
  populatedSlugs,
  isAdmin,
  isAllocator,
  isManager,
  children,
}: DashboardChromeProps) {
  const pathname = usePathname();
  // Plan 11 / R5 — read flaggedCount from the cross-tree store; Sidebar
  // renders the badge on "My Allocation" when > 0.
  const flaggedCount = useFlaggedCountStore();

  // Mobile sidebar drawer — owned at the chrome level so both the
  // full-bleed and standard layouts can share the same hamburger +
  // overlay without duplicating state.
  const [menuOpen, setMenuOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  // Full-bleed routes: hide sidebar + skip the centered max-w container so
  // the underlying page can claim every pixel. The match queue detail page
  // is the only one that needs this for now (Sprint 4 T10.1).
  const isFullBleed = /^\/admin\/match\/[^/]+\/?$/.test(pathname) &&
    pathname !== "/admin/match/eval";

  if (isFullBleed) {
    return (
      <div className="flex h-full">
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          <MobileTopBar
            ref={hamburgerRef}
            onMenuClick={() => setMenuOpen(true)}
            menuOpen={menuOpen}
          />
          <div className="px-4 py-6 md:px-8 md:py-8">
            {children}
            <Disclaimer variant="footer" />
          </div>
          <LegalFooter />
        </main>
        <MobileNav />
        <MobileSidebarDrawer
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          isAdmin={isAdmin}
          isAllocator={isAllocator}
          isManager={isManager}
          populatedSlugs={populatedSlugs}
          triggerRef={hamburgerRef}
          flaggedCount={flaggedCount}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        {/* Plan 11 / R5 — pass `flaggedCount` so Sidebar can render the
            badge on "My Allocation" when > 0. */}
        <Sidebar
          populatedSlugs={populatedSlugs}
          isAdmin={isAdmin}
          isAllocator={isAllocator}
          isManager={isManager}
          flaggedCount={flaggedCount}
        />
      </div>
      <main aria-label="Dashboard content" className="flex-1 md:ml-[260px] overflow-y-auto pb-16 md:pb-0">
        <MobileTopBar
          ref={hamburgerRef}
          onMenuClick={() => setMenuOpen(true)}
          menuOpen={menuOpen}
        />
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
          {children}
          <Disclaimer variant="footer" />
        </div>
        <LegalFooter />
      </main>
      {/* Mobile bottom nav */}
      <MobileNav />
      {/* Mobile sidebar drawer — opens from the top bar hamburger.
          The desktop Sidebar above is <div className="hidden md:block">
          so the drawer and desktop rail never render simultaneously. */}
      <MobileSidebarDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        isAdmin={isAdmin}
        isAllocator={isAllocator}
        populatedSlugs={populatedSlugs}
        triggerRef={hamburgerRef}
        flaggedCount={flaggedCount}
      />
    </div>
  );
}
