import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Quantalyze — Live demo",
  description:
    "Live product demo with simulated allocator data. Institutional strategy marketplace.",
};

/**
 * Public demo layout — deliberately minimal.
 *
 * No DashboardChrome, no sidebar, no auth. This layout backs /demo and
 * /demo/founder-view, both of which are reached via a Telegram link in
 * incognito mode on mobile Safari. Every element here has to survive that
 * context: no client-side session dependency, no redirects, no fonts that
 * aren't already in the root layout.
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-page">
      <DemoBanner />
      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}

function DemoBanner() {
  return (
    // A11Y-01 (Phase 48): the sticky demo banner is site chrome (logo +
    // sign-up CTA) that sat outside any landmark, tripping axe's `region`
    // rule ("All page content should be contained by landmarks"). A <header>
    // is the correct landmark for this masthead; the page body keeps its own
    // <main> below, so there is exactly one <main> (no duplicate-landmark
    // trap — the /demo route does not nest an authed <main>).
    <header className="sticky top-0 z-10 border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <p className="font-display text-xl text-text-primary">Quantalyze</p>
          <p className="truncate text-xs text-text-muted">
            Live demo — simulated allocator data. Real product on production.
          </p>
        </div>
        <Link
          href="/signup"
          className="inline-flex shrink-0 items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Sign up →
        </Link>
      </div>
    </header>
  );
}
