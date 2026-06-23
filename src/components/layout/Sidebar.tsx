"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";

type IconComponent = ({ className }: { className?: string }) => React.JSX.Element;
interface NavItem {
  label: string;
  href: string;
  icon: IconComponent;
  /** Phase 09.1 Plan 11 / R5 — optional badge rendered next to the label. */
  badge?: number;
}
interface NavSubGroup { label: string; items: NavItem[] }
interface NavSection { heading: string; items: NavItem[]; subGroups?: NavSubGroup[] }

function buildNavSections(
  populatedSlugs?: string[],
  isAdmin?: boolean,
  isAllocator?: boolean,
  flaggedCount?: number,
  isManager?: boolean,
): NavSection[] {
  // Admins see BOTH allocator AND manager surfaces (triage / demo).
  // Allocators see the allocator workspace + the Discovery rail (their
  // strategy-shopping surface). Managers see the manager workspace and
  // the Discovery rail is HIDDEN — Discovery is the allocator's
  // browse-investable-strategies surface, not the manager's. role="both"
  // gets both workspaces; the manager flag is derived independently so
  // it does not get nulled out the way the pre-fix `!isAllocator` short
  // circuit did.
  const showsAllocatorWorkspace = isAllocator || isAdmin;
  const showsManagerWorkspace = isManager || isAdmin;
  const showsDiscovery = isAllocator || isAdmin;

  // Bucket categories by `group` preserving first-seen order so the
  // Discovery section renders as stable sub-groups (Digital Assets → TradFi).
  // Build the groups even when Discovery will be hidden so the data path
  // stays simple; we gate the section emission below.
  const categories = populatedSlugs
    ? DISCOVERY_CATEGORIES.filter((cat) => populatedSlugs.includes(cat.slug))
    : DISCOVERY_CATEGORIES;
  const discoveryGroups: NavSubGroup[] = [];
  for (const cat of categories) {
    let bucket = discoveryGroups.find((g) => g.label === cat.group);
    if (!bucket) {
      bucket = { label: cat.group, items: [] };
      discoveryGroups.push(bucket);
    }
    bucket.items.push({
      label: cat.name,
      href: `/discovery/${cat.slug}`,
      icon: SearchIcon,
    });
  }
  const workspaceItems: NavItem[] = [];
  if (showsAllocatorWorkspace) {
    workspaceItems.push({
      label: "My Allocation",
      href: "/allocations",
      icon: PortfolioIcon,
      badge: flaggedCount,
    });
  }
  // FLOW-03 (Phase 32): the standalone "Strategy Sandbox" nav item (→
  // /scenarios) is retired. The example-universe Sandbox was absorbed into
  // the unified composer (Phase 29), and /scenarios now 307-redirects to
  // /allocations?tab=scenario. A separate nav entry would loop the allocator
  // back into the composer they already reach via "My Allocation" — so the
  // allocator now has ONE discoverable entry point (/allocations, above).
  if (showsManagerWorkspace) {
    workspaceItems.push(
      { label: "Strategies", href: "/strategies", icon: BarChartIcon },
      { label: "Portfolios", href: "/portfolios", icon: PieChartIcon },
    );
  }

  return [
    {
      heading: "MY WORKSPACE",
      items: workspaceItems,
    },
    ...(showsDiscovery && discoveryGroups.length > 0
      ? [{
          heading: "DISCOVERY",
          // Discovery renders via `subGroups`; keep `items` empty so
          // consumers that only inspect `items` still render the
          // heading without duplicating links.
          items: [],
          subGroups: discoveryGroups,
        }]
      : []),
    ...(isAdmin
      ? [{
          heading: "ADMIN",
          items: [
            { label: "Dashboard", href: "/admin", icon: BarChartIcon },
            { label: "Users", href: "/admin/users", icon: UserIcon },
            { label: "Deletion requests", href: "/admin/deletion-requests", icon: ShieldIcon },
            { label: "Match queue", href: "/admin/match", icon: MatchIcon },
            { label: "For-quants leads", href: "/admin/for-quants-leads", icon: MailIcon },
          ],
        }]
      : []),
    {
      heading: "ACCOUNT",
      items: [{ label: "Profile", href: "/profile", icon: UserIcon }],
    },
  ];
}

export function Sidebar({
  populatedSlugs,
  isAdmin,
  isAllocator,
  isManager,
  variant = "desktop",
  flaggedCount,
}: {
  populatedSlugs?: string[];
  isAdmin?: boolean;
  isAllocator?: boolean;
  /** `profile.role === "manager" || profile.role === "both"`. Independent
   * of `isAllocator` so role="both" lights up BOTH workspaces; the
   * pre-fix `!isAllocator` short-circuit hid the manager rail from
   * "both" users. */
  isManager?: boolean;
  /** "desktop" (default) mounts as a fixed left rail — existing behavior.
   *  "drawer" mounts as a flow child of its parent so the same Sidebar
   *  component can live inside the MobileSidebarDrawer overlay without
   *  fighting for position with the backdrop or the slide-in panel. */
  variant?: "desktop" | "drawer";
  /** Phase 09.1 Plan 11 / R5 — flaggedHoldings.length sourced upstream
   *  via DashboardChrome's `useFlaggedCountStore()` (no new server
   *  query). Renders as a badge on "My Allocation" when > 0. */
  flaggedCount?: number;
} = {}) {
  const pathname = usePathname();
  const sections = useMemo(
    () => buildNavSections(populatedSlugs, isAdmin, isAllocator, flaggedCount, isManager),
    [populatedSlugs, isAdmin, isAllocator, flaggedCount, isManager],
  );

  return (
    <aside
      className={
        variant === "desktop"
          ? "fixed inset-y-0 left-0 z-30 flex w-[260px] flex-col bg-sidebar text-sidebar-text"
          : // Audit 2026-05-07 G11.C.3: drawer variant lacked overflow-y-auto.
            // On 320×667 viewports with admin nav (MY WORKSPACE + 5 DISCOVERY
            // sub-groups + 5 ADMIN items + ACCOUNT) the content exceeds 100vh
            // and the bottom items are unreachable. Adding overflow-y-auto
            // lets the drawer scroll inside the overlay panel.
            "flex h-full w-[260px] flex-col bg-sidebar text-sidebar-text overflow-y-auto"
      }
    >
      <div className="flex h-16 items-center px-6">
        <Link href="/" className="text-lg font-display text-white tracking-tight">
          Quantalyze
        </Link>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pb-4">
        {sections.map((section) => (
          <div key={section.heading} className="mt-6 first:mt-2">
            {/* PR #108 review: removed `text-sidebar-text/50` — Tailwind opacity
                modifier collapses fg+bg through to the parent (#0F172A), giving
                effective `#525D71 on #0F172A = 2.68:1` (axe color-contrast,
                serious). Use full sidebar-text (#94A3B8) which gives 6.75:1 on
                the same bg. Hierarchy preserved by font-semibold + tracking. */}
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-text">
              {section.heading}
            </p>
            {section.items.length > 0 && (
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <NavItemLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                  />
                ))}
              </ul>
            )}
            {section.subGroups?.map((group, idx) => (
              <div
                key={group.label}
                className={idx === 0 ? "" : "mt-3"}
              >
                {/* PR #108 review: removed `text-sidebar-text/35` — same
                    alpha-collapse issue as the parent heading (1.94:1 on
                    #0F172A, axe-flagged). Sub-group labels use full
                    sidebar-text and rely on font-medium (vs the parent's
                    semibold) + smaller tracking for hierarchy. */}
                <p className="mb-1 px-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-text">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavItemLink
                      key={item.href}
                      item={item}
                      pathname={pathname}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function NavItemLink({
  item,
  pathname,
}: {
  item: NavItem;
  pathname: string;
}) {
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  const badge = item.badge;
  const showBadge = typeof badge === "number" && badge > 0;
  return (
    <li>
      <Link
        href={item.href}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
          active
            ? "bg-sidebar-active text-sidebar-text-active"
            : "hover:bg-sidebar-hover hover:text-sidebar-text-active"
        }`}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span>{item.label}</span>
        {showBadge && (
          <span
            aria-label={`${badge} flagged holding${badge === 1 ? "" : "s"}`}
            className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-medium text-white"
          >
            {badge}
          </span>
        )}
      </Link>
    </li>
  );
}

function BarChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 12V7M8 12V4M12 12V9" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7" cy="7" r="4" />
      <path d="M13 13l-2.5-2.5" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5" r="2.5" />
      <path d="M3 14a5 5 0 0110 0" />
    </svg>
  );
}

function PieChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2v6l4.24 4.24" />
    </svg>
  );
}

function PortfolioIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="12" height="10" rx="1.5" />
      <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1" />
      <path d="M2 8h12" />
    </svg>
  );
}

function MatchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H9zM9 9h4v4H9z" />
      <path d="M7 5h2M7 11h2M5 7v2M11 7v2" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2.5 4.5L8 9l5.5-4.5" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5l5 2v4.5c0 3-2 5.5-5 6.5-3-1-5-3.5-5-6.5V3.5l5-2z" />
    </svg>
  );
}
