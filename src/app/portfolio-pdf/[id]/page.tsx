import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { LegalFooter } from "@/components/legal/LegalFooter";
import { formatDay } from "@/lib/utils";

/**
 * Phase 195 TRIM (D-03), 2026-11-07 — the portfolio report is RETIRED.
 *
 * `/portfolio-pdf/<id>` used to render a stored portfolio as a printable
 * report behind an HMAC render token. The renderer, its API route and the
 * token module are deleted. This page is what remains: a named landing for an
 * old share link, so the holder is told the report was retired instead of
 * meeting a login wall, a 404 or a generic error.
 *
 * It reads NOTHING but the URL: no database row, no token check, no session,
 * and it does not even read the `id` segment. The same page renders for any
 * id, with or without `?renderToken=`, signed in or signed out. `/portfolio-pdf`
 * stays in `src/proxy.ts` PUBLIC_ROUTES and bounce-exempt for that reason.
 *
 * It shows no figures, so it carries no disclaimer block (UC-9); the
 * `LegalFooter` links are navigation, not a disclaimer.
 */
export const metadata: Metadata = {
  title: "Allocation report retired",
  robots: "noindex",
};

export default function PortfolioReportRetiredPage() {
  return (
    <>
      <main className="min-h-full bg-page">
        <article className="mx-auto max-w-2xl px-6 py-16">
          <p className="text-micro font-mono uppercase tracking-[0.22em] text-text-muted">
            Allocation report · Retired
          </p>
          <h1 className="mt-2 font-display text-page-title leading-tight text-text-primary">
            This allocation report has been retired
          </h1>
          <p className="mt-4 text-body leading-normal text-text-secondary">
            The link you followed opened an allocation report. We no longer
            publish allocation reports, so this report is not available here or
            as a PDF.
          </p>
          <p className="mt-2 text-body leading-normal text-text-secondary">
            If you hold an allocation with us, its current figures are on My
            allocation once you sign in. You can also browse the strategies we
            list.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/browse">
              <Button variant="primary" size="md">
                Browse verified strategies
              </Button>
            </Link>
            <Link href="/allocations">
              <Button variant="secondary" size="md">
                Open My allocation
              </Button>
            </Link>
          </div>
          <p className="mt-8 text-micro font-mono uppercase tracking-[0.18em] text-text-muted">
            Retired {formatDay("2026-11-07")}
          </p>
        </article>
      </main>
      <LegalFooter />
    </>
  );
}
