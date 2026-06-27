"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { buildPrimaryMobileNav } from "./Sidebar";

/**
 * Phase 45 Plan 01 (NAV-01) — role-aware mobile bottom nav.
 *
 * Items are single-sourced from `buildPrimaryMobileNav` in Sidebar.tsx (DRY /
 * project Rule 6) — there is NO hardcoded TABS list here, so the desktop
 * Sidebar and this bottom nav never drift. Role props flow from DashboardChrome
 * (the same props it already threads to MobileSidebarDrawer). The hamburger
 * drawer remains the FULL nav; this is the <=5-item primary subset.
 *
 * Active-state discretion (45-RESEARCH Pitfall 6 / A3): `usePathname()` strips
 * the query string, so `/allocations?tab=risk` and `/allocations` both resolve
 * to pathname `/allocations`. We deliberately KEEP the simple pathname-prefix
 * match (the same rule the desktop Sidebar uses) rather than introducing
 * `useSearchParams()`, which would force a Next 16 CSR-bailout requiring a
 * Suspense boundary around this component (DashboardChrome renders it without
 * one). Consequence: the My Allocation / Risk / Bridge cells share an active
 * highlight on `/allocations*` — a purely cosmetic, SSR-safe tradeoff.
 */
export function MobileNav({
  isAllocator,
  isManager,
  isAdmin,
  flaggedCount,
  inert,
}: {
  isAllocator?: boolean;
  isManager?: boolean;
  isAdmin?: boolean;
  flaggedCount?: number;
  /**
   * NAV-03: when the mobile drawer is open, DashboardChrome passes
   * `inert={true}` so the bottom nav (a SIBLING of the inert `<main>`, not
   * covered by it) is also removed from the tab order + AT tree. Without this
   * the bottom-nav links stay focusable behind the backdrop and focus
   * containment would rest solely on the drawer's manual Tab trap. React 19
   * native boolean prop; absent when false.
   */
  inert?: boolean;
} = {}) {
  const pathname = usePathname();
  const items = buildPrimaryMobileNav({ isAllocator, isManager, isAdmin, flaggedCount });

  return (
    <nav
      aria-label="Primary mobile"
      inert={inert}
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-surface md:hidden"
    >
      <div className="flex">
        {items.map((item) => {
          // KEEP the existing pathname-prefix active rule (see header note).
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const badge = item.badge;
          const showBadge = typeof badge === "number" && badge > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                // SC#4: min-h-[44px] + justify-center lifts the ~36px stub cell
                // to the WCAG 2.5.8 floor. focus-visible ring added (the stub
                // had none) — matches MobileTopBar's accent outline.
                "relative flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[44px] py-2 text-[10px] font-medium transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                active ? "text-accent" : "text-text-muted",
              )}
            >
              <span className="relative">
                <item.icon className="h-5 w-5" />
                {showBadge && (
                  <span
                    aria-label={`${badge} flagged holding${badge === 1 ? "" : "s"}`}
                    className="absolute -right-2 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-medium text-white"
                  >
                    {badge}
                  </span>
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
