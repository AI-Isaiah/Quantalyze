"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { InfoBanner } from "@/components/ui/InfoBanner";

/**
 * Allocations empty state.
 *
 * Three-way branch (Phase 110.1 / DOGFOOD-1):
 *   - hasSyncing === true                       → render a thin InfoBanner
 *                            with the first-sync copy. The allocator has
 *                            already connected a key and ccxt is still pulling
 *                            their first positions; show reassurance, not a CTA.
 *                            (Takes precedence over hasConnectedKeys.)
 *   - !hasSyncing && !hasConnectedKeys          → centred Card with the connect
 *                            CTA: the allocator has no keys, so point them at
 *                            /profile?tab=exchanges to add one.
 *   - !hasSyncing && hasConnectedKeys           → centred Card, honest
 *                            connected-but-empty copy: keys ARE connected but
 *                            no open positions have synced. Link to Manage
 *                            exchanges — NOT a "Connect" CTA, which would read
 *                            as "you have no keys" (the pre-110.1 bug: an
 *                            allocator with 5 synced keys was told to connect
 *                            one).
 *
 * Each Card branch: single Instrument Serif 24px headline
 * "No positions to analyze yet.", single DM Sans 14px sub-line, single link.
 *
 * Minimalism gate (D-07): one headline, one sub-line, one link per branch. No
 * illustration, no 3-step explainer, no checklist. The no-keys and syncing
 * copy strings are locked — do not rephrase.
 *
 * Route: both CTAs route to /profile?tab=exchanges. The legacy /connections
 * and /exchanges surfaces have been retired.
 */

interface EmptyStateProps {
  hasSyncing: boolean;
  // DOGFOOD-1 (Phase 110.1): true when the allocator has at least one
  // genuinely connected key — derived server-side via
  // isPerKeyDailiesEligibleKey (is_active && !revoked && !disconnected) and
  // threaded through MyAllocationDashboardPayload.hasConnectedKeys. NOT
  // activeVenues.length, which counts soft-disconnected / revoked keys.
  hasConnectedKeys: boolean;
}

export function EmptyState({ hasSyncing, hasConnectedKeys }: EmptyStateProps) {
  if (hasSyncing) {
    return (
      <InfoBanner>
        Syncing your first positions — this usually takes under a minute.
      </InfoBanner>
    );
  }

  if (hasConnectedKeys) {
    return (
      <Card className="text-center py-12">
        <h2 className="font-serif text-2xl text-text-primary mb-2">
          No positions to analyze yet.
        </h2>
        <p className="text-sm text-text-secondary max-w-md mx-auto mb-6">
          {/* DOGFOOD-1 (Phase 110.1): count-neutral copy — the repro allocator
              has 5 connected venues, so "Your exchange is connected" (singular)
              read wrong. This phrasing works for one key or many. */}
          You&apos;re connected — no open positions have synced yet. Either none
          are open, or the next position sync hasn&apos;t run.
        </p>
        <Link
          href="/profile?tab=exchanges"
          className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
        >
          Manage exchanges →
        </Link>
      </Card>
    );
  }

  return (
    <Card className="text-center py-12">
      <h2 className="font-serif text-2xl text-text-primary mb-2">
        No positions to analyze yet.
      </h2>
      <p className="text-sm text-text-secondary max-w-md mx-auto mb-6">
        Connect a read-only exchange API key to see your real holdings and performance.
      </p>
      <Link
        href="/profile?tab=exchanges"
        className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
      >
        Connect Exchange →
      </Link>
    </Card>
  );
}
