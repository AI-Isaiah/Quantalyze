/**
 * Chrome for a reader with no session (Phase 196, D-05 shape, ROUTE-02,
 * UI-SPEC "Visitor header" and "Sign-up line").
 *
 * `VisitorHeader` sits above the document in the same shell as the signed-in
 * `ViewerBar`; `SignUpLine` sits after the document, immediately above the
 * footer so the footer stamp and the page's one disclaimer stay last. Both are
 * screen-only (`factsheet-v2-no-print`). The share route reuses both, passing
 * `showSignUp={false}` for a signed-in recipient (session wins, OQ-3).
 *
 * ⛔ A signed-in viewer never sees "Sign up" on any factsheet route: the page
 * chooses these components from the session, and a signed-in viewer gets the
 * `ViewerBar` instead.
 *
 * The wordmark is plain text, not a link: "What is Quantalyze?" already goes to
 * `/`, and two links to one target would be noise. Server components, no state.
 */
import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";

export function VisitorHeader({ showSignUp }: { showSignUp: boolean }) {
  return (
    <header className="factsheet-v2-no-print bg-surface border-b border-border">
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10 py-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-h3 text-text-primary">Quantalyze</span>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/"
            className="text-body text-text-secondary hover:text-text-primary transition-colors duration-150 ease-out min-h-[44px] inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            What is Quantalyze?
          </Link>
          {showSignUp && (
            <Link href="/signup" className={buttonClassName({ variant: "primary", size: "md" })}>
              Sign up
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function SignUpLine() {
  return (
    <div className="factsheet-v2-no-print mt-12 border-t border-border pt-6">
      <p className="text-body text-text-secondary">
        Quantalyze lists quantitative strategies and states how each track record was sourced.{" "}
        <Link href="/signup" className="text-accent underline underline-offset-4">
          Sign up
        </Link>{" "}
        to request an introduction to a strategy&apos;s manager.
      </p>
    </div>
  );
}
