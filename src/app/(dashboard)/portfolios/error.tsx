"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * /portfolios list-route error boundary. Catches errors thrown by the RSC
 * page (e.g. `getUserPortfolios()` failure, RLS denial) before the list
 * renders. Surfaces the `digest` ONLY — never the thrown message — because a
 * thrown RSC message can leak server internals across the client boundary
 * (ASVS V7 / Information Disclosure, T-53-13).
 */
export default function PortfoliosError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[portfolios-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="font-metric text-5xl text-accent">Error</p>
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
          <Link href="/discovery/crypto-sma">
            <Button variant="ghost">Go to Discovery</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
