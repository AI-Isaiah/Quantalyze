"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { InfoBanner } from "@/components/ui/InfoBanner";

/**
 * Phase 07 Plan 05 / PURGE-04 / D-07 / D-08 — Allocations empty state.
 *
 * Branches:
 *   - hasSyncing === true  → render a thin InfoBanner with the first-sync
 *                            copy. The allocator has already connected a
 *                            key and ccxt is still pulling their first
 *                            positions; show reassurance, not a CTA.
 *   - hasSyncing === false → render a centred Card with:
 *                              • single Instrument Serif 24px headline
 *                                "No positions to analyze yet."
 *                              • single DM Sans 14px sub-line
 *                              • single primary button "Connect Exchange →"
 *                                routing to /profile?tab=exchanges (Phase 06 IA)
 *
 * D-07 minimalism gate: one headline, one sub-line, one button. No
 * illustration, no 3-step explainer, no checklist. Copy strings are
 * verbatim from 07-UI-SPEC.md §Copywriting — do not rephrase.
 *
 * Route: every "Connect Exchange" CTA in Phase 07 routes to
 * /profile?tab=exchanges. The legacy /connections and /exchanges surfaces
 * were retired during Phase 06 UAT.
 */

interface EmptyStateProps {
  hasSyncing: boolean;
}

export function EmptyState({ hasSyncing }: EmptyStateProps) {
  if (hasSyncing) {
    return (
      <InfoBanner>
        Syncing your first positions — this usually takes under a minute.
      </InfoBanner>
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
