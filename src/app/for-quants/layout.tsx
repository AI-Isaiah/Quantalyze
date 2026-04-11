import Link from "next/link";
import { LegalFooter } from "@/components/legal/LegalFooter";

/**
 * Public shell for /for-quants. Mirrors `src/app/browse/layout.tsx` but with
 * quant-team-facing nav copy — "Sign in" / "Sign up" instead of the allocator
 * "Log in" / "Sign up" pair. The "Request a Call" entry point lives inside
 * the page (not here in the header) because it opens a modal that belongs
 * to the page's client component tree.
 */
export default function ForQuantsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-white">
      <header className="border-b border-border bg-white sticky top-0 z-10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="inline-flex items-center py-2 font-display text-lg tracking-tight text-text-primary"
          >
            Quantalyze
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium text-text-secondary hover:bg-page hover:text-text-primary transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/signup?role=manager"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              Start Wizard
            </Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <LegalFooter />
    </div>
  );
}
