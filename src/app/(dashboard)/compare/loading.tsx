import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /compare (STATE-01). Shown while the server
 * component awaits `supabase.auth.getUser()` + the published-strategy /
 * holding-snapshot fetches.
 *
 * Dominant anchor (52-UI-SPEC §Dominant visual anchor): a multi-column
 * comparison-table skeleton — a fixed metric-label column on the left plus a
 * placeholder data column per (assumed) selected strategy — above a smaller
 * correlation-matrix placeholder. The skeleton mirrors CompareTable's real
 * layout (metric rows × strategy columns) so the page does not jump on arrival.
 *
 * RSC (no "use client"). `animate-pulse` sits on the shell wrapper — the
 * sanctioned route-shell idiom (RESEARCH Pattern 2; matches the factsheet v2
 * `<article className="… animate-pulse">`) — with the `Skeleton` primitives
 * inside it. The fluid-fill measure matches the page (mx-auto max-w-[1920px]).
 * Closed by an sr-only role="status" liveness hint for assistive tech.
 */

// Assume a 3-column comparison while loading (the common multi-select case).
const COLUMN_COUNT = 3;
const METRIC_ROW_COUNT = 9; // mirrors CompareTable's METRICS length

export default function CompareLoading() {
  return (
    <div className="mx-auto max-w-[1920px] px-6 py-6 animate-pulse">
      {/* Page-header anchor — breadcrumb + title lines. */}
      <Skeleton className="h-4 w-48 mb-4" />
      <Skeleton className="h-9 w-72 mb-8" />

      {/* DOMINANT ANCHOR — the side-by-side comparison table. A metric-label
          column on the left + one placeholder data column per strategy. */}
      <div className="@container overflow-x-auto rounded-xl border border-border bg-surface">
        {/* Column-header row (metric label cell + per-strategy name headers). */}
        <div className="flex items-center gap-4 border-b border-border px-4 @3xl:px-8 py-3">
          <Skeleton className="h-4 w-40" />
          <div className="ml-auto flex gap-8">
            {Array.from({ length: COLUMN_COUNT }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-24" />
            ))}
          </div>
        </div>

        {/* Metric rows — label on the left, a value placeholder per column. */}
        <div className="divide-y divide-border/50">
          {Array.from({ length: METRIC_ROW_COUNT }).map((_, r) => (
            <div
              key={r}
              className="flex items-center gap-4 px-4 @3xl:px-8 py-3"
            >
              <Skeleton className="h-4 w-32" />
              <div className="ml-auto flex gap-8">
                {Array.from({ length: COLUMN_COUNT }).map((_, c) => (
                  <Skeleton key={c} className="h-4 w-20" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Secondary placeholder — the correlation-matrix block beneath the table. */}
      <div className="mt-8 space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-[220px] w-full rounded-lg" />
      </div>

      {/* Screen-reader-only liveness hint while the skeleton is up. */}
      <p className="sr-only" role="status" aria-live="polite">
        Loading comparison — computing analytics.
      </p>
    </div>
  );
}
