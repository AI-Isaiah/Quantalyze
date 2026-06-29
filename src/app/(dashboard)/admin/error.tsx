"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Route-level error boundary for the WHOLE /admin subtree (STATE-05 / ASVS V7 /
 * T-53-09). Same boundary CONTRACT as the canonical `(dashboard)/error.tsx`
 * (client component, `unstable_retry` — Next 16.2.0, NOT `reset` — digest-ONLY),
 * but using the Phase 53 design type-tiers (`text-h2`/`text-small`/`text-caption`)
 * where the canonical still uses raw `text-2xl`/`text-sm`/`text-xs`.
 *
 * Admin is the highest-sensitivity in-scope surface (staff-facing,
 * access-gated). When an admin Server Component throws (fetch failure, RLS
 * denial, malformed input), the thrown message text is the raw server-side
 * error string — surfacing it to the client is Information Disclosure
 * (T-53-09). The error is logged client-side for diagnostics, but only its
 * generated `digest` hash is shown to the user — the thrown message string is
 * never rendered into the DOM.
 */
export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[admin-error]", error);
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
