/**
 * Shared "honest absence" empty-state card shell.
 *
 * Single source of the pinned UI-SPEC tokens (UI-SPEC §2) for the
 * below-threshold empty states that scenario/correlation surfaces render when
 * there is not enough data to compute an honest estimate. `CorrelationHeatmap`
 * (the < 10 overlapping-day / < 2 strategy correlation gate) and
 * `SampleFloorEmptyState` (the distributional/tail sample floor) both render
 * THIS so the tokens live in one place and cannot drift between surfaces.
 *
 * A below-threshold state is honest absence, NOT an error — it is deliberately
 * a neutral muted card with no `role="alert"` and no red/warning color
 * (UI-SPEC Color).
 */

interface EmptyStateCardProps {
  /** Reason heading (UI-SPEC Copywriting Contract) — names what's missing. */
  heading: string;
  /** Body copy — names the SPECIFIC reason so the allocator knows what to fix. */
  body: string;
}

export function EmptyStateCard({ heading, body }: EmptyStateCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
      <div className="font-semibold text-text-secondary">{heading}</div>
      <div className="mt-1 text-micro">{body}</div>
    </div>
  );
}
