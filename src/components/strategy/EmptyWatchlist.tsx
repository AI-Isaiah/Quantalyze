/**
 * Phase 13 / Plan 13-01 / DISCO-01 — Empty state for the My Watchlist scope
 * when watchedSet.size === 0.
 *
 * Two-line copy per UI-SPEC Copywriting Contract:
 *   Heading: "Your watchlist is empty"
 *   Body:    "Star strategies from the All tab to track them here."
 *
 * Heading is 14px DM Sans semibold (text-text-primary); body is 14px DM
 * Sans regular (text-text-secondary). Includes a directional hint pointing
 * back to the All tab — closes the loop per UI-SPEC.
 */

export function EmptyWatchlist() {
  return (
    <div className="text-center py-12">
      <p className="text-sm font-semibold text-text-primary mb-1">
        Your watchlist is empty
      </p>
      <p className="text-sm text-text-secondary">
        Star strategies from the All tab to track them here.
      </p>
    </div>
  );
}
