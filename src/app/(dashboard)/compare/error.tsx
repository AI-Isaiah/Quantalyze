"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Route-level error boundary for /compare (STATE-01 / ASVS V7 / T-52-09).
 *
 * Mirrors the dashboard `(dashboard)/error.tsx` shape: client component,
 * `unstable_retry` (Next 16.2.0), digest-ONLY (never `error.message`, which
 * would leak the server-side message to the client for a Server-Component
 * throw — Information Disclosure). The thrown error is logged client-side for
 * diagnostics but only its generated `digest` hash is shown to the user.
 */
export default function CompareError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[compare-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="font-metric text-5xl text-accent">Error</p>
        <h1 className="mt-4 font-display text-2xl text-text-primary">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          This section encountered an error. You can retry or navigate to
          another page.
        </p>
        {error.digest && (
          <p className="mt-1 font-mono text-xs text-text-muted/60">
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
