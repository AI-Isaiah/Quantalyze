"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary. Any thrown error in the factsheet v2 subtree
 * lands here instead of crashing the whole app. Reset rebuilds the page.
 */
export default function FactsheetV2Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to the browser console for now; in prod this should go to Sentry.
    console.error("Factsheet v2 error:", error);
  }, [error]);

  return (
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
          onClick={reset}
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
  );
}
