"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Root error boundary. Catches errors in page.tsx and nested layouts
 * (but not the root layout itself -- that's global-error.tsx).
 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary]", error);
    // TODO: wire Sentry.captureException(error) once observability is set up
  }, [error]);

  return (
    <div className="flex min-h-full items-center justify-center bg-page px-4">
      <div className="max-w-md text-center">
        <p className="font-metric text-6xl text-accent">Error</p>
        <h1 className="mt-4 font-display text-3xl text-text-primary md:text-[32px]">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          An unexpected error occurred. Please try again or return to the
          dashboard.
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
