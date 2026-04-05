"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";

type IconComponent = ({ className }: { className?: string }) => React.JSX.Element;
interface NavItem { label: string; href: string; icon: IconComponent }
interface NavSection { heading: string; items: NavItem[] }

function buildNavSections(populatedSlugs?: string[]): NavSection[] {
  const categories = populatedSlugs
    ? DISCOVERY_CATEGORIES.filter((cat) => populatedSlugs.includes(cat.slug))
    : DISCOVERY_CATEGORIES;

  return [
    {
      heading: "MY WORKSPACE",
      items: [
        { label: "Strategies", href: "/strategies", icon: BarChartIcon },
      ],
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
    {
      heading: "ACCOUNT",
      items: [{ label: "Profile", href: "/profile", icon: UserIcon }],
    },
  ];
}

export function Sidebar({ populatedSlugs }: { populatedSlugs?: string[] } = {}) {
  const pathname = usePathname();
  const sections = useMemo(() => buildNavSections(populatedSlugs), [populatedSlugs]);

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-[260px] flex-col bg-sidebar text-sidebar-text">
      <div className="flex h-16 items-center px-6">
        <Link href="/" className="text-lg font-bold text-white tracking-tight">
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
