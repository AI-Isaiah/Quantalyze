"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { DISCOVERY_LANDING_ROUTE } from "@/lib/routing/default-route";

/**
 * Root error boundary. Catches errors in page.tsx and nested layouts
 * (but not the root layout itself -- that's global-error.tsx).
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary]", error);
    if (typeof window === "undefined") return;
    const cidMeta = document.querySelector('meta[name="x-correlation-id"]');
    const correlation_id = cidMeta?.getAttribute("content") ?? null;
    // Lazy import keeps @sentry/nextjs out of the static bundle for pages
    // that never render this boundary (Phase 16 / OBSERV-04).
    // ⛔ CORRECTED 2026-11-27 (Phase 221 SENTRYSCRUB2): src/instrumentation-client.ts now
    // loads @sentry/nextjs on every page whenever the build carried a DSN, so this
    // lazy import no longer keeps the SDK out of the bundle. The import stays: it
    // resolves to the same module and the same client, and this capture now
    // actually reports, where before Phase 221 the browser had no client and it
    // was a silent no-op.
    import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.captureException(error, {
          tags: {
            digest: error.digest,
            correlation_id,
          },
        });
      })
      .catch(() => {
        // Sentry import failed — never block error boundary rendering.
      });
  }, [error]);

  return (
    <div className="flex min-h-full items-center justify-center bg-page px-4">
      <div className="max-w-md text-center">
        <p className="font-metric text-6xl text-accent">Error</p>
        <h1 className="mt-4 font-display text-3xl text-text-primary md:text-fixed-32">
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
          <Button onClick={() => retry()}>Try again</Button>
          {/* Leaves the failing surface: the role home would redirect back into it (199 WR-01). */}
          <Link href={DISCOVERY_LANDING_ROUTE}>
            <Button variant="ghost">Go to Discovery</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
