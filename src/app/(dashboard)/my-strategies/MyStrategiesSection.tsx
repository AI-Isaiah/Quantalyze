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
import { MarkOwnershipDialog } from "@/components/strategy/MarkOwnershipDialog";
import { RenameStrategyDialog } from "@/components/strategy/RenameStrategyDialog";
import type { CapitalOwnership } from "@/lib/capital-ownership";
import type { PercentileMap, RankedStrategyRow } from "@/lib/queries";
import type { SupportedExchange } from "@/lib/utils";
import type { PreselectedKey } from "@/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep";

/**
 * 162-06 / HONEST-06 — the placeholder row AS THIS SURFACE KNOWS IT.
 *
 * `PlaceholderKeyRow` is the shared table's contract (what a row RENDERS: the
 * id, the formatted exchange label, the nickname). The owner surface knows one
 * more fact about the same key — its venue ID — because the wizard it hands the
 * click to needs the id, not the display string. Widening here rather than in
 * `StrategyTable` keeps the public discovery surfaces' prop contract byte-
 * identical: the table neither reads nor renders `exchange`.
 */
export type OwnerPlaceholderKeyRow = PlaceholderKeyRow & {
  exchange: SupportedExchange;
};

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
  placeholderKeys: OwnerPlaceholderKeyRow[];
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
  // 162-06 / HONEST-06 — WHICH key the owner clicked, or null for every other
  // way into this overlay. Held as the resolved triple rather than a bare id so
  // the overlay (and the summary the wizard renders from it) never has to
  // re-derive the exchange label the SERVER formatted for the row.
  const [preselectKey, setPreselectKey] = useState<PreselectedKey | null>(null);
  // Phase 150 / OWN-03 + OWN-05 — the two dialogs' targets. Same client-boundary
  // rule as `onFinishSetup` above (see the header comment): the RSC page cannot
  // hand StrategyTable a function prop, so the callbacks are minted here.
  //
  // Only the fields each dialog needs are captured, not the whole row: a mark
  // change re-renders the page through router.refresh(), and a stale row object
  // held in state would be a second, silently diverging copy of the truth.
  const [markTarget, setMarkTarget] = useState<{
    id: string;
    name: string;
    mark: CapitalOwnership | null;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
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
        // 162-06 / HONEST-06 — resolve the clicked id against the SAME array
        // that rendered the row, so the summary can only ever show labels this
        // page actually displayed. A miss (an id from a row that is no longer
        // in this array) opens the wizard with NO preselect: the fresh
        // credential form is the honest fallback, never a guessed key.
        onFinishSetup={(keyId) => {
          const clicked = placeholderKeys.find((k) => k.id === keyId);
          setPreselectKey(
            clicked
              ? {
                  id: clicked.id,
                  exchange: clicked.exchange,
                  exchangeLabel: clicked.exchangeLabel,
                  keyLabel: clicked.keyLabel,
                }
              : null,
          );
          setWizardOpen(true);
        }}
        onMarkOwnership={(s) =>
          setMarkTarget({
            id: s.id,
            name: s.name,
            mark: s.capital_ownership ?? null,
          })
        }
        onRename={(s) => setRenameTarget({ id: s.id, name: s.name })}
      />
      {/* Mounted only while a row is selected, and KEYED by that row's id, so
          each open starts from that row's own current mark/name rather than
          inheriting the previously opened row's answer. */}
      {markTarget && (
        <MarkOwnershipDialog
          key={markTarget.id}
          open
          onClose={() => setMarkTarget(null)}
          strategyId={markTarget.id}
          strategyName={markTarget.name}
          currentMark={markTarget.mark}
        />
      )}
      {renameTarget && (
        <RenameStrategyDialog
          key={renameTarget.id}
          open
          onClose={() => setRenameTarget(null)}
          strategyId={renameTarget.id}
          currentName={renameTarget.name}
        />
      )}
      {/* 162-06 / D-162-3 — "Finish setup" opens the wizard ON the key that was
          clicked. (The comment that stood here recorded the 2026-08-05 founder
          ruling that the overlay had no preselect seam and opened fresh; D-162-3
          supersedes it, and this is that seam.) `preselectKey` is null for every
          other entry point, which is byte-identically the old behavior.
          router.refresh() re-runs the RSC page so a newly created strategy
          replaces its placeholder row. */}
      <ContributionWizardOverlay
        isOpen={wizardOpen}
        preselectKey={preselectKey}
        onClose={() => {
          setWizardOpen(false);
          // Cleared WITH the close, not left standing: the next open may come
          // from a different row — or from no row at all — and a preselect that
          // outlives its click is a claim about a key the user did not choose.
          setPreselectKey(null);
        }}
        onSuccess={() => {
          setWizardOpen(false);
          setPreselectKey(null);
          router.refresh();
        }}
      />
    </>
  );
}
