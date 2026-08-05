"use client";

/**
 * Phase 149 / NAV-01 — the client host for the owner ranking.
 *
 * Two things need a client boundary and nothing else does: the wizard
 * overlay's open/closed state, and the `onFinishSetup` callback the Delta-5
 * placeholder rows fire (a function prop is non-serializable across the
 * RSC→client boundary, so the RSC page cannot hand one to StrategyTable
 * directly). Everything else — the fetches, the percentile scoring, the
 * exchange-label formatting — stays on the server.
 *
 * Local `useState` for the overlay is the AllocationsTabs:1010-1018 precedent.
 * The chrome-level overlay (`contributeOpen` inside DashboardChrome) is
 * unreachable from `{children}`, so a page that needs the wizard mounts its
 * own; the overlay renders `null` while closed and portals to document.body.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ContributionWizardOverlay } from "@/app/(dashboard)/allocations/components/ContributionWizardOverlay";
import {
  StrategyTable,
  type PlaceholderKeyRow,
} from "@/components/strategy/StrategyTable";
import type { PercentileMap, RankedStrategyRow } from "@/lib/queries";

interface MyStrategiesSectionProps {
  /**
   * The owner's rows at every non-archived status. Typed as
   * `RankedStrategyRow[]` — NOT the looser shared row type — because
   * `analyticsPresent` is REQUIRED on this path (W-C): plan 03's chip
   * derivation coerces an absent analytics row to a null status so the 16h
   * bound can terminate the spinner, and an OMITTED signal means "trust the
   * raw status" instead. The shared StrategyTable prop stays optional for the
   * public callers that have no such distinction to make.
   */
  strategies: RankedStrategyRow[];
  /** Server-formatted (EXCHANGE_DISPLAY already applied) bare-key rows. */
  placeholderKeys: PlaceholderKeyRow[];
  portfolioId: string | null;
  /**
   * The OWN-scored map from `getOwnRowPercentiles().ownMap` — never the
   * published map. Only own rows render here, and their Pnn must come from the
   * scorer helper that ranks them against the published population without
   * joining it.
   */
  percentiles: PercentileMap | null;
}

export function MyStrategiesSection({
  strategies,
  placeholderKeys,
  portfolioId,
  percentiles,
}: MyStrategiesSectionProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <StrategyTable
        strategies={strategies}
        // A prefs-SCOPE key, not a discovery category (research Pitfall 6):
        // useDiscoveryPrefs namespaces localStorage by (userId, categorySlug),
        // and this surface needs its own scope so its sort/density choices do
        // not overwrite a real category's saved prefs.
        categorySlug="my-strategies"
        portfolioId={portfolioId}
        percentiles={percentiles ?? undefined}
        visibility="owner-all-statuses"
        placeholderKeys={placeholderKeys}
        onFinishSetup={() => setWizardOpen(true)}
      />
      {/* Opens FRESH — there is no preselect seam on this overlay today
          (founder ruling 2026-08-05; the follow-up is logged in TODOS.md), so
          "Finish setup" starts the wizard on its API-key branch rather than
          pretending a key is already chosen. router.refresh() re-runs the RSC
          page so a newly created strategy replaces its placeholder row. */}
      <ContributionWizardOverlay
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={() => {
          setWizardOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
