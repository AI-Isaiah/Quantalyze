import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Route-level loading skeleton for /strategy/[id] (STATE-01). Shown while the
 * server component awaits `getPublicStrategyDetail(id)` + the viewer-scoped
 * private-note fetch.
 *
 * Dominant anchor (52-UI-SPEC §single-strategy): the page-title line
 * (Instrument Serif at the `--text-page-title` tier) + the headline-metric
 * block at the TOP of the page, then an equity-chart placeholder below — all
 * at the SAME narrow prose measure (`mx-auto max-w-3xl px-4 py-12 sm:px-6`).
 * Single-strategy is a prose/detail page (UI-SPEC layout table) and does NOT
 * fluid-fill to 1920 — keep the narrow readable measure so the skeleton
 * matches the page and the layout does not jump on arrival.
 *
 * Server Component (no client directive). `animate-pulse` sits on the shell wrapper — the
 * sanctioned route-shell idiom (matches compare/loading.tsx + the factsheet v2
 * `<article className="… animate-pulse">`) — with the `Skeleton` primitives
 * inside it. Closed by an sr-only role="status" liveness hint for assistive
 * tech.
 */

// Mirrors the page's `grid-cols-2 sm:grid-cols-3` summary-metric panel (6 cards).
const METRIC_CARD_COUNT = 6;

export default function StrategyLoading() {
  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 animate-pulse">
        {/* Header anchor — the Instrument-Serif page-title line at the
            `--text-page-title` tier (h-8 ≈ 32px upper bound) + a live-since
            sub-line. */}
        <div className="mb-8">
          <Skeleton className="h-8 w-2/3 mb-3" />
          <Skeleton className="h-4 w-40" />
        </div>

        {/* Headline-metric block — mirrors the 2/3-col summary-metric panel. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-8">
          {Array.from({ length: METRIC_CARD_COUNT }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card p-4 space-y-2"
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>

        {/* Equity-chart placeholder — same narrow width as the page above. */}
        <div className="rounded-lg border border-border bg-card p-4 mb-8 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-[280px] w-full" />
        </div>

        {/* Screen-reader-only liveness hint while the skeleton is up. */}
        <p className="sr-only" role="status" aria-live="polite">
          Loading strategy — computing analytics.
        </p>
      </div>
    </div>
  );
}
