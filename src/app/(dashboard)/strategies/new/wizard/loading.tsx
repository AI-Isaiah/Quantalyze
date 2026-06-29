/**
 * STATE-05 (Phase 53) — Suspense fallback for the manager API-key wizard route.
 *
 * The wizard route does its server-prep (draft load + auth gate) in `page.tsx`
 * before `WizardClient` hydrates. Without this `loading.tsx` the segment flashes
 * blank during that gap. This renders a `WizardChrome`-shaped skeleton — a
 * 4-cell stepper-rail placeholder plus a first-step field block — at the same
 * `mx-auto max-w-3xl px-6 py-10` measure as `WizardChrome` (WizardChrome.tsx:105)
 * so the layout does not jump when content arrives.
 *
 * RSC (no "use client"). A single `animate-pulse` on the shell wrapper is the
 * sanctioned idiom (the anti-pattern is bespoke per-element pulse divs); the
 * `Skeleton` primitive is reduced-motion-safe via globals.css.
 */
import { Skeleton } from "@/components/ui/Skeleton";

export default function WizardLoading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 animate-pulse">
      {/* Header (H1 + subtitle) */}
      <header className="mb-8">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      </header>

      {/* Stepper rail — 4 cells, mirroring DEFAULT_STEPS */}
      <div
        data-testid="wizard-skeleton-rail"
        className="grid grid-cols-1 gap-3 border-y border-border py-4 sm:grid-cols-4"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>

      {/* First-step field block */}
      <div className="mt-10 space-y-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ))}
        <Skeleton className="h-10 w-40 rounded-lg" />
      </div>

      {/* Screen-reader-only liveness hint while the skeleton is up. */}
      <p className="sr-only" role="status" aria-live="polite">
        Loading strategy setup.
      </p>
    </div>
  );
}
