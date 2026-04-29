"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const pathname = usePathname();
  // pathname is like "/strategy/{id}/v2" — derive v1 path by stripping the trailing "/v2"
  const v1Href = pathname?.endsWith("/v2") ? pathname.slice(0, -3) : pathname ?? "/";

  return (
    <main className="min-h-screen bg-page">
      <div className="mx-auto max-w-[1200px] px-6 py-12">
        <div className="rounded-lg border border-border bg-surface p-8 text-center shadow-card">
          <h2 className="text-base font-semibold text-text-primary">
            We couldn&apos;t load this strategy
          </h2>
          <p className="mt-2 text-xs font-normal text-text-muted">
            Something went wrong loading the v2 view. Reload strategy, or fall back to the v1 factsheet.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => unstable_retry()}
              className="rounded-md border border-accent bg-surface px-4 py-2 text-xs font-semibold text-accent"
            >
              Reload strategy
            </button>
            <Link
              href={v1Href}
              className="rounded-md border border-border bg-surface px-4 py-2 text-xs font-normal text-text-secondary"
            >
              Open v1 factsheet
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
