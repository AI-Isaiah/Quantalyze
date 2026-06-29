"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Route-level error boundary for `/allocations` (STATE-01). Catches errors
 * thrown by the allocations server component (auth, the dashboard payload
 * query, or any nested client tab) and renders a digest-only fallback with a
 * working retry — without losing the dashboard chrome above it.
 *
 * Mirrors the `(dashboard)/error.tsx` shape verbatim:
 *   - `unstable_retry` (Next 16.2.0 — NOT the legacy `reset`); re-fetches and
 *     re-renders the segment's children on click.
 *   - **digest-only** — renders `error.digest` (the server-log correlation id)
 *     but NEVER the raw error text. Next strips RSC error messages in production
 *     to avoid leaking sensitive server detail (ASVS V7 / T-52-05); rendering
 *     the raw text would defeat that on any client-thrown error.
 *   - Copy is the 52-UI-SPEC Copywriting Contract error string.
 */
export default function AllocationsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[allocations-error]", error);
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
