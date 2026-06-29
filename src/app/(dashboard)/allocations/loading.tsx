import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for `/allocations` — shown while the server
 * component awaits `getMyAllocationDashboard()` (auth, the allocator payload,
 * and the onboarding-funnel side effects). A match-layout placeholder keeps the
 * layout dimensions stable so the page does not jump when the real content
 * arrives (STATE-01).
 *
 * **Server Component** — no client directive. `loading.tsx` is an RSC by
 * convention; the Skeleton primitives are pure markup.
 *
 * **Dominant anchor (52-UI-SPEC §Dominant visual anchor):** the KPI strip is
 * the largest, first region — a full-width 4-cell grid above the equity-chart
 * placeholder — so the skeleton reads unmistakably as the allocations dashboard
 * loading, not a generic spinner. The page shell mirrors the real page's fluid
 * `max-w-[1920px] mx-auto` so the skeleton fills the same envelope (Task 1).
 */
export default function AllocationsLoading() {
  return (
    <div className="mx-auto max-w-[1920px] px-6 py-6">
      {/* Header row — title + entity name placeholder (mirrors the inline
          AllocationsTabs header the real page renders). */}
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      {/* DOMINANT ANCHOR — the KPI strip: a full-width 4-cell grid, the first
          and largest region, matching the live KpiStrip @container shape. */}
      <div className="@container" aria-hidden>
        {/* The `@container` HOST and the `@sm`/`@lg` grid variants must sit on
            SEPARATE elements — an element never queries its own container size
            (CSS containment spec), so the host wraps the grid. */}
        <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="space-y-2 rounded-lg border border-border bg-surface p-4"
            >
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-2.5 w-28" />
            </div>
          ))}
        </div>
      </div>

      {/* Equity-chart placeholder — sits below the KPI anchor. */}
      <Skeleton className="mt-6 h-[320px] w-full" />

      {/* Holdings rows placeholder. */}
      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>

      {/* Screen-reader-only liveness hint while the skeleton is up
          (52-UI-SPEC Copywriting Contract — loading liveness). */}
      <p className="sr-only" role="status" aria-live="polite">
        Loading allocations — computing analytics.
      </p>
    </div>
  );
}
