import Link from "next/link";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-sm text-text-muted mb-4"
    >
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && (
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          )}
          {item.href ? (
            <Link
              href={item.href}
              // Phase 51 NAV-02 — keyboard-only focus ring in the accent token
              // (the <Link> had hover only). focus-visible (never bare focus:)
              // per UI-SPEC §Breadcrumb Contract; mirrors the nav/MobileNav ring.
              className="hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {item.label}
            </Link>
          ) : (
            // Phase 51 NAV-02 — the leaf (current page) advertises itself to AT.
            // Intermediate linked crumbs do NOT carry aria-current.
            <span aria-current="page" className="text-text-primary font-medium">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
