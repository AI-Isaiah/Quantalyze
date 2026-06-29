"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Portfolio detail (`/portfolios/[id]`) error boundary. Catches errors thrown
 * by the RSC page (portfolio-detail / analytics fetch failure, RLS denial)
 * before the detail renders. Surfaces the `digest` ONLY — never the thrown
 * message (ASVS V7 / Information Disclosure, T-53-13).
 */
export default function PortfolioDetailError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[portfolio-detail-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="mt-4 font-display text-h2 text-text-primary">
          Something went wrong
        </h1>
        <p className="mt-2 text-small text-text-muted">
          This section encountered an error. You can retry or navigate to
          another page.
        </p>
        {error.digest && (
          <p className="mt-1 font-mono text-caption text-text-muted/60">
            Error ID: {error.digest}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button onClick={() => unstable_retry()}>Try again</Button>
          <Link href="/portfolios">
            <Button variant="ghost">Back to portfolios</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
