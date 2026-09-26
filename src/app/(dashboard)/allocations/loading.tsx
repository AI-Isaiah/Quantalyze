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
 * **Dominant anchor (52-UI-SPEC §Dominant visual anchor), suspended by Phase
 * 167.1.2 / D-02:** the skeleton used to open with a full-width 4-cell KPI grid
 * above a 320px equity-chart placeholder. While the equity history is rebuilt,
 * the Overview (the default tab) renders neither: no factsheet KPI strip and no
 * curve, only a short "being rebuilt" text panel. A skeleton that promises a
 * KPI row and a chart and then swaps to a paragraph is a layout shift that
 * briefly implies numbers that will not come (review round 1 IN-04). So the
 * anchor is a text-block placeholder shaped like that panel. Plan 11 of Phase
 * 167.1.2 restores the KPI anchor and the chart placeholder when it defines
 * "ready". The page shell is fully fluid (no px cap), so the skeleton fills the
 * same envelope as the page it stands in for (Task 1; founder decision
 * 2026-08-09 — dense tables lost their cap).
 *
 * ⛔ That last sentence is a CLAIM, and `loading.test.tsx` now carries the
 * assertion behind it (153.2 review WR-06 — it did not, for a whole release).
 */
export default function AllocationsLoading() {
  return (
    <div className="px-6 py-6">
      {/* Header row — title + entity name placeholder (mirrors the inline
          AllocationsTabs header the real page renders). */}
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      {/* Phase 167.1.2 / D-02: the Overview renders the "being rebuilt" text
          panel in place of the KPI strip and the curve, so the skeleton draws
          that panel's shape (eyebrow, heading, three body lines) and no KPI
          grid or chart block. `max-w-prose` mirrors the panel's body measure
          and is not a px cap. */}
      <div
        data-testid="allocations-loading-rebuilding-block"
        className="mt-6 max-w-prose space-y-3 border-t border-border py-8"
        aria-hidden
      >
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-5 w-72 max-w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>

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
