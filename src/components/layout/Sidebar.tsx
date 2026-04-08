"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";

type IconComponent = ({ className }: { className?: string }) => React.JSX.Element;
interface NavItem { label: string; href: string; icon: IconComponent }
interface NavSection { heading: string; items: NavItem[] }

function buildNavSections(
  populatedSlugs?: string[],
  isAdmin?: boolean,
  isAllocator?: boolean,
): NavSection[] {
  const categories = populatedSlugs
    ? DISCOVERY_CATEGORIES.filter((cat) => populatedSlugs.includes(cat.slug))
    : DISCOVERY_CATEGORIES;

  const workspaceItems: NavItem[] = [
    { label: "Strategies", href: "/strategies", icon: BarChartIcon },
    { label: "Portfolios", href: "/portfolios", icon: PieChartIcon },
    { label: "Allocations", href: "/allocations", icon: PortfolioIcon },
  ];

  // Allocator-facing recommendations surface — hidden from managers and
  // from the founder (who has the admin Match Queue instead).
  if (isAllocator && !isAdmin) {
    workspaceItems.push({
      label: "Recommendations",
      href: "/recommendations",
      icon: RecommendIcon,
    });
  }

  return [
    {
      heading: "MY WORKSPACE",
      items: workspaceItems,
    },
    ...(categories.length > 0
      ? [{
          heading: "DISCOVERY",
          items: categories.map((cat) => ({
            label: cat.name,
            href: `/discovery/${cat.slug}`,
            icon: SearchIcon,
          })),
        }]
      : []),
    ...(isAdmin
      ? [{
          heading: "ADMIN",
          items: [
            { label: "Dashboard", href: "/admin", icon: BarChartIcon },
            { label: "Match queue", href: "/admin/match", icon: MatchIcon },
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
}: {
  populatedSlugs?: string[];
  isAdmin?: boolean;
  isAllocator?: boolean;
} = {}) {
  const pathname = usePathname();
  const sections = useMemo(
    () => buildNavSections(populatedSlugs, isAdmin, isAllocator),
    [populatedSlugs, isAdmin, isAllocator],
  );

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-[260px] flex-col bg-sidebar text-sidebar-text">
      <div className="flex h-16 items-center px-6">
        <Link href="/" className="text-lg font-display text-white tracking-tight">
          Quantalyze
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {sections.map((section) => (
          <div key={section.heading} className="mt-6 first:mt-2">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-text/50">
              {section.heading}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                        active
                          ? "bg-sidebar-active text-sidebar-text-active"
                          : "hover:bg-sidebar-hover hover:text-sidebar-text-active"
                      }`}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
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

function RecommendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1l1.8 4.2 4.7.4-3.6 3 1.1 4.6L8 10.8 3.9 13.2l1.1-4.6-3.6-3 4.7-.4L8 1z" />
    </svg>
  );
}
