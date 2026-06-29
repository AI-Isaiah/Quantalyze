"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Route-level error boundary for the WHOLE /strategy/[id] subtree (STATE-01 /
 * ASVS V7 / T-52-15). This is distinct from the existing `v2/error.tsx` child
 * boundary (which is left untouched) — this sibling covers the v1 page AND
 * everything nested below it.
 *
 * Mirrors the canonical `(dashboard)/error.tsx` shape: client component,
 * `unstable_retry` (Next 16.2.0 — NOT `reset`), digest-ONLY. Never renders the
 * thrown message text: for a Server-Component throw that text is the original
 * server-side error string, and surfacing it to the client is Information
 * Disclosure (T-52-15). The thrown error is logged client-side for diagnostics
 * but only its generated `digest` hash is shown to the user.
 */
export default function StrategyError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[strategy-error]", error);
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
