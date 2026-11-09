"use client";

import { useEffect } from "react";
import Link from "next/link";
import { captureToSentry } from "@/lib/sentry-capture";

/**
 * Route-level error boundary for `/factsheet/[id]` and everything beneath it,
 * the `/v2` alias included. Any thrown error in the subtree lands here instead
 * of crashing the whole app.
 *
 * Try again calls `retry()`, which re-runs the server render. `reset()` would
 * only clear the boundary's state and re-render the same failed result, so it
 * cannot recover a server-component throw. Digest only on screen: the thrown
 * message is the server-side error string. This boundary sits between the throw
 * and the root `error.tsx`, so it reports to Sentry itself.
 */
export default function FactsheetError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Factsheet error:", error);
    captureToSentry(error, {
      tags: { area: "factsheet-error-boundary", digest: error.digest ?? "" },
    });
  }, [error]);

  return (
    <main>
    <article className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-micro font-mono uppercase tracking-[0.22em] text-text-muted">
        Institutional Factsheet · Error
      </p>
      <h1 className="mt-2 font-serif text-3xl text-text-primary">
        We couldn&apos;t render this factsheet
      </h1>
      <p className="mt-4 text-text-2">
        Something went wrong while building the report. The strategy still exists; this is a
        rendering failure on our side.
      </p>
      {error.digest && (
        <p className="mt-2 text-caption font-mono text-text-muted">
          Reference: <code>{error.digest}</code>
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="px-4 py-2 text-sm rounded-md bg-accent text-white hover:bg-accent-hover"
        >
          Try again
        </button>
        <Link
          href="/discovery"
          className="px-4 py-2 text-sm rounded-md border border-border text-text-primary hover:bg-surface"
        >
          Back to discovery
        </Link>
      </div>
    </article>
    </main>
  );
}
