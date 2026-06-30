import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Quantalyze — Live demo",
  description:
    "Live product demo with simulated allocator data. Institutional strategy marketplace.",
};

/**
 * Nested layout for `/demo` + `/demo/founder-view` under the `(marketing)`
 * route group — deliberately minimal.
 *
 * No DashboardChrome, no sidebar, no auth. Reached via a Telegram link in
 * incognito mode on mobile Safari, so every element here must survive that
 * context: no client-side session dependency, no redirects, no fonts that
 * aren't already in the root layout.
 *
 * The shared (marketing)/layout.tsx now provides the top-level masthead
 * `<header>` (banner) + the LegalFooter. This nested layout keeps ONLY the
 * demo-specific chrome — the sticky "Live demo — simulated data" notice + its
 * own Sign up CTA — and the single `<main>` the demo body renders into.
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-page">
      <DemoNotice />
      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}

function DemoNotice() {
  return (
    // A11Y-01: the sticky demo notice is contained in a `region` landmark so
    // axe's `region` rule ("all page content should be contained by
    // landmarks") passes. It is deliberately NOT a second `<header>` — the
    // shared (marketing) masthead is the single top-level banner, so a second
    // <header> here would trip axe's landmark-no-duplicate-banner (the same
    // duplicate-landmark class JOURNEY-03 caught). The page body keeps the
    // single <main> below.
    <div
      role="region"
      aria-label="Live demo notice"
      className="sticky top-0 z-10 border-b border-border bg-surface"
    >
      <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <p className="min-w-0 text-xs text-text-muted">
          Live demo — simulated allocator data. Real product on production.
        </p>
        <Link
          href="/signup"
          className="inline-flex shrink-0 items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Sign up →
        </Link>
      </div>
    </div>
  );
}
