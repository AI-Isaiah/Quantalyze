import Link from "next/link";
import { LegalFooter } from "@/components/legal/LegalFooter";

/**
 * Shared shell for the `(marketing)` route group — landing (`/`), `/legal/*`,
 * `/for-quants`, `/security`, `/demo`. The parens make this a Next route group:
 * folder-only, ZERO URL change (RESEARCH §route-groups; the route-contract
 * guard's `pageFileToUrl` drops the `(group)` segment, so every wrapped route
 * still resolves at its current URL and stays in `proxy.ts` PUBLIC_ROUTES).
 *
 * Owns CHROME ONLY (NAV-04): the public masthead hoisted from the old per-page
 * headers (landing / for-quants / security each hand-rolled their own) plus a
 * single `LegalFooter`. It deliberately renders NO `<main>`, NO `<h1>`, and NO
 * `metadata`/`generateMetadata` — each wrapped page keeps its own `<main>`,
 * single `<h1>`, and metadata export so SEO + the single-landmark discipline
 * (the JOURNEY-03 axe class) are preserved by construction. Server component:
 * no "use client" boundary that could defer the page `<h1>`/metadata or shift
 * hydration. The landing page's authed `redirect("/discovery/…")` stays IN the
 * page, not here.
 *
 * Nested layouts under the group supply their OWN distinct chrome on top of
 * this one: `/legal` adds its tab-nav, `/demo` adds its sticky DemoBanner.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-white">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center py-2 font-display text-lg tracking-tight text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Quantalyze
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-page hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Sign up
            </Link>
          </div>
        </div>
      </header>

      {children}

      <LegalFooter />
    </div>
  );
}
