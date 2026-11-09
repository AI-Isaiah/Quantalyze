"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";
import { DEFAULT_AUTHENTICATED_ROUTE } from "@/lib/routing/default-route";

/**
 * The signed-in /browse header's one link (ROUTE-02, UI-SPEC). On
 * `/browse/<slug>` with a known category it goes to `/discovery/<slug>`, so the
 * reader lands on the same category inside the app; anywhere else it goes to
 * the default authenticated route. A client component only because the layout
 * does not receive the pathname.
 */
export function BrowseDiscoveryLink() {
  const pathname = usePathname() ?? "";
  const slug = /^\/browse\/([^/]+)\/?$/.exec(pathname)?.[1];
  const known = DISCOVERY_CATEGORIES.some((c) => c.slug === slug);
  const href = known ? `/discovery/${slug}` : DEFAULT_AUTHENTICATED_ROUTE;
  return (
    <Link
      href={href}
      className="text-body text-text-secondary hover:text-text-primary min-h-[44px] inline-flex items-center"
    >
      Go to Discovery
    </Link>
  );
}
