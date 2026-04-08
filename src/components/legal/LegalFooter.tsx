import Link from "next/link";

const PLATFORM_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME ?? "Quantalyze";

/**
 * Minimal footer rendered on every public and authenticated page. Three
 * legal links + the platform name. Kept small enough to drop into existing
 * layouts without rewriting their spacing. Lives under components/legal so
 * the `legal/*` routes can import it too.
 */
export function LegalFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-text-muted">
        <p>
          © {new Date().getFullYear()} {PLATFORM_NAME}. All rights reserved.
        </p>
        <nav className="flex items-center gap-4">
          <Link href="/legal/privacy" className="hover:text-text-primary">
            Privacy
          </Link>
          <Link href="/legal/terms" className="hover:text-text-primary">
            Terms
          </Link>
          <Link href="/legal/disclaimer" className="hover:text-text-primary">
            Risk Disclaimer
          </Link>
        </nav>
      </div>
    </footer>
  );
}
