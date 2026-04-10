"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Auth-level error boundary. Catches errors in login/signup pages.
 * Offers a link back to login rather than deep dashboard pages.
 */
export default function AuthError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[auth-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-full items-center justify-center bg-page px-4">
      <div className="max-w-md text-center">
        <p className="font-metric text-5xl text-accent">Error</p>
        <h1 className="mt-4 font-display text-2xl text-text-primary">
          Authentication error
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Something went wrong. Please try again.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button onClick={() => unstable_retry()}>Try again</Button>
          <Link href="/login">
            <Button variant="ghost">Back to login</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
