"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";

export type IconComponent = ({ className }: { className?: string }) => React.JSX.Element;
export interface NavItem {
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
    // Phase 51 NAV-01 — surface the genuine allocator orphans that had no nav
    // entry (direct-link only today): /compare and /decks are allocator-owned
    // dashboard surfaces. They live INSIDE the showsAllocatorWorkspace branch so
    // they never leak to a manager (T-45-01 / T-51-02 info-disclosure). The role
    // OR-logic derivations above are byte-unchanged. /recommendations is left OUT
    // deliberately — it is mandate-CTA-reachable (a child of the profile mandate
    // tab) and gets its back-path via the breadcrumb, not a top-level nav item
    // (RESEARCH soft-orphan classification + UI-SPEC §completeness). The legacy
    // scenarios and preferences slugs are redirect-stubs (NOT orphans) and
    // /security is public marketing — none get nav entries here. (NB: this comment
    // intentionally avoids the literal retired-route slug the FLOW-03 phase-32
    // frozen-spine guard substring-matches on Sidebar.tsx.)
    workspaceItems.push(
      { label: "Compare", href: "/compare", icon: CompareIcon },
      { label: "Decks", href: "/decks", icon: DeckIcon },
    );
  }
  // FLOW-03 (Phase 32): the standalone "Strategy Sandbox" nav item (which
  // pointed at the now-retired Sandbox route) is removed. The example-universe
  // Sandbox was absorbed into the unified composer (Phase 29), and the legacy
  // route now 307-redirects to /allocations?tab=scenario. A separate nav entry
  // would loop the allocator back into the composer they already reach via
  // "My Allocation" — so the allocator now has ONE discoverable entry point
  // (/allocations, above). The phase-32 frozen-spine guard pins this: no
  // Sandbox-route reference may reappear in this file.
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
      // Phase 51 NAV-01 — /referral ("Earn rewards by referring asset managers
      // and allocators") is an account-level affordance owned by allocators AND
      // managers (RESEARCH orphan inventory). ACCOUNT is the role-neutral section
      // (Profile is shown to every role), so a referral entry here is reachable
      // by both owning roles without leaking a workspace-specific surface — it is
      // not gated by the allocator/manager OR-logic and therefore cannot regress
      // the T-45-01 role-leak pin.
      items: [
        { label: "Profile", href: "/profile", icon: UserIcon },
        { label: "Referral", href: "/referral", icon: GiftIcon },
      ],
    },
  ];
}

/**
 * Phase 45 Plan 01 (NAV-01) — the SINGLE source for the mobile bottom nav's
 * role-aware primary item set. Co-located here (Option A per D-NAV01) so it
 * reuses the SAME icon components, labels, and role OR-logic constants that
 * `buildNavSections` above uses — the two navs therefore never drift (DRY /
 * project Rule 6). `MobileNav` imports this; there is NO second hardcoded list.
 *
 * Why not derive directly from `buildNavSections`? Two of the three SC#1
 * allocator destinations (Risk, Bridge) are NOT routes in `buildNavSections`:
 * there is no `/bridge` route (verified 45-RESEARCH Pitfall 1), so we represent
 * them as tab deep-links with DISTINCT hrefs:
 *   - My Allocation → `/allocations`
 *   - Risk         → `/allocations?tab=risk`
 *   - Bridge       → `/allocations?tab=scenario`
 * No two items resolve to the identical URL, satisfying SC#1's "labeled,
 * reachable entries with distinct hrefs".
 *
 * Bridge lands on the Scenario tab because that is where the live bridge flow
 * actually is: the ScenarioComposer renders the "Open Bridge" card → BridgeDrawer
 * (the per-holding cross-strategy browse). The earlier `/allocations?tab=risk#bridge`
 * target was wrong — the Risk tab has no bridge surface and `BridgeWidget` is
 * mounted nowhere, so the `#bridge` hash anchored nothing (product decision
 * 2026-06-27; the new tab=scenario href is naturally distinct from Risk's).
 *
 * The list is capped at <=5 (the hamburger drawer remains the full nav). Role
 * gating mirrors the SAME `showsAllocatorWorkspace`/`showsManagerWorkspace`
 * OR-logic so an allocator never surfaces a manager/admin-only destination and
 * role "both" lights the allocator set (T-45-01 info-disclosure mitigation).
 */
export function buildPrimaryMobileNav(p: {
  isAllocator?: boolean;
  isManager?: boolean;
  isAdmin?: boolean;
  flaggedCount?: number;
}): NavItem[] {
  // Mirror buildNavSections' role OR-logic EXACTLY (its showsAllocatorWorkspace
  // / showsManagerWorkspace derivations) so the two navs share one source of
  // truth and "both" lights the allocator set.
  const showsAllocatorWorkspace = p.isAllocator || p.isAdmin;
  const showsManagerWorkspace = p.isManager || p.isAdmin;

  // Profile is ACCOUNT — always present (mirrors buildNavSections' trailing
  // Profile item). Held aside so it survives the <=5 cap even when both the
  // allocator and manager families are active (admin), where the discretionary
  // filler items are what get trimmed instead.
  const profile: NavItem = { label: "Profile", href: "/profile", icon: UserIcon };

  const primary: NavItem[] = [];
  const fillers: NavItem[] = [];
  if (showsAllocatorWorkspace) {
    // SC#1 trio leads the allocator set, in order, with distinct hrefs.
    primary.push(
      { label: "My Allocation", href: "/allocations", icon: PortfolioIcon, badge: p.flaggedCount },
      { label: "Risk", href: "/allocations?tab=risk", icon: ShieldIcon },
      { label: "Bridge", href: "/allocations?tab=scenario", icon: BridgeIcon },
    );
    // Discovery is a discretionary filler (allocator browse surface) — trimmed
    // first when the cap binds (admin keeps the SC trio + a manager destination).
    // Href is the canonical landing slug `/discovery/crypto-sma` (the same target
    // the /discovery layout redirect uses): bare `/discovery` has no page.tsx
    // (only layout.tsx + [slug]/), so it 404s — a regression from the prior
    // hardcoded TABS value this helper replaced.
    fillers.push({ label: "Discovery", href: "/discovery/crypto-sma", icon: SearchIcon });
  }
  if (showsManagerWorkspace) {
    primary.push(
      { label: "Strategies", href: "/strategies", icon: BarChartIcon },
      { label: "Portfolios", href: "/portfolios", icon: PieChartIcon },
    );
  }

  // Reserve one slot for Profile so it is never trimmed; fill the remaining
  // budget with primary destinations first, then discretionary fillers. Cap is
  // <=5 per CONTEXT (the hamburger drawer remains the full nav).
  const CAP = 5;
  const budget = CAP - 1; // one slot reserved for the always-present Profile
  const items = [...primary, ...fillers].slice(0, budget);
  items.push(profile);
  return items;
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
        // Phase 51 NAV-02 — expose the active item to AT (aria-current) and add a
        // keyboard-only focus ring in the accent token (the rail had neither).
        // Mirrors MobileNav's aria-current pattern; uses focus-visible:ring (never
        // bare focus:) per UI-SPEC §Item state contract. The active bg stays the
        // slate bg-sidebar-active (accent fill on the navy rail fails contrast).
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
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

// Phase 51 NAV-01 — glyphs for the newly-surfaced allocator/account orphans.
// House style: 16x16 viewBox, stroke-1.5, currentColor, no icon dependency —
// matches the inline SVGs above so the nav stays a single self-contained file.
function CompareIcon({ className }: { className?: string }) {
  // Two side-by-side bars — "compare" two strategies.
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="4" height="10" rx="1" />
      <rect x="10" y="3" width="4" height="10" rx="1" />
      <path d="M8 2v12" />
    </svg>
  );
}

function DeckIcon({ className }: { className?: string }) {
  // Stacked cards — a "deck" of strategies.
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="9" height="11" rx="1.5" />
      <path d="M2 4.5v7.5A1.5 1.5 0 003.5 13.5H11" />
    </svg>
  );
}

function GiftIcon({ className }: { className?: string }) {
  // A gift/reward — the referral "earn rewards" affordance.
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="6" width="11" height="7.5" rx="1" />
      <path d="M2 6h12M8 6v7.5" />
      <path d="M8 6S6.5 2.5 4.75 3.25 6.5 6 8 6zM8 6s1.5-3.5 3.25-2.75S9.5 6 8 6z" />
    </svg>
  );
}

// Phase 45 Plan 01 (NAV-01) — a suspension-bridge glyph for the allocator
// bottom nav's "Bridge" deep-link. Matches the established 16x16 / stroke-1.5
// house style of the icons above. NOT cream-tinted (DESIGN.md Bridge cream
// identity is for the Bridge surfaces themselves; the bottom nav uses the
// standard accent/muted active/inactive treatment for visual consistency).
function BridgeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* deck */}
      <path d="M2 10h12" />
      {/* towers */}
      <path d="M4 10V4M12 10V4" />
      {/* main cable spanning the towers */}
      <path d="M4 4c2 3 6 3 8 0" />
      {/* hangers */}
      <path d="M6.5 6.5V10M9.5 6.5V10" />
    </svg>
  );
}
