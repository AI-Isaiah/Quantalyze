"use client";

/**
 * Phase 149 / NAV-01 — the client host for the owner ranking.
 *
 * Phase 199 plan 09 (LEAN-01, D-02): moved from my-strategies/MyStrategiesSection.tsx.
 * It is now the ONE client host for every strategy owner's list: the merged
 * /strategies page mounts it for allocator, manager and `both`, and the old
 * /my-strategies page still mounts it until plan 199-13 retires that page. The
 * server decides each role's furniture and hands it down as data
 * (`managerRows`, `allocatorFurniture`); the Mark/Rename callbacks are minted
 * here ONLY when `allocatorFurniture` is on, so a manager-only list never
 * carries a control that needs an allocator portfolio.
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

import { useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { ContributionWizardOverlay } from "@/app/(dashboard)/allocations/components/ContributionWizardOverlay";
import {
  StrategyTable,
  type PlaceholderKeyRow,
} from "@/components/strategy/StrategyTable";
import { MarkOwnershipDialog } from "@/components/strategy/MarkOwnershipDialog";
import { RenameStrategyDialog } from "@/components/strategy/RenameStrategyDialog";
import type { CapitalOwnership } from "@/lib/capital-ownership";
import type { FactsheetOrigin } from "@/lib/factsheet/origin";
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

interface StrategiesSectionProps {
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
  /**
   * R-04 (REVIEWS, T-199-33): where a row's factsheet link says it came from.
   * REQUIRED and set by each page, never hard-coded here: the merged /strategies
   * page passes the strategies origin (its rows link `?from=strategies`) and
   * the old /my-strategies page passes the my-strategies origin until plan
   * 199-13 retires it. It also names the prefs-SCOPE key below.
   */
  origin: FactsheetOrigin;
  /** Server-formatted (EXCHANGE_DISPLAY already applied) bare-key rows. Absent: none. */
  placeholderKeys?: OwnerPlaceholderKeyRow[];
  portfolioId?: string | null;
  /**
   * The OWN-scored map from `getOwnRowPercentiles().ownMap` — never the
   * published map. Only own rows render here, and their Pnn must come from the
   * scorer helper that ranks them against the published population without
   * joining it.
   */
  percentiles?: PercentileMap | null;
  /**
   * Phase 170.7 / D-01 — the owner-list switch and each row's server-built Edit
   * target, actions slot and note (see StrategyTable's `managerRows`). Absent:
   * the plain owner mount /my-strategies has always been.
   */
  managerRows?: ComponentProps<typeof StrategyTable>["managerRows"];
  /**
   * Phase 199 / D-02 — the allocator half of the furniture: the ownership tag,
   * Mark ownership, Rename and Simulate Impact. Also the switch for the Mark and
   * Rename callbacks below, so they exist only when this is true.
   */
  allocatorFurniture?: boolean;
  /** Seeds the table sort only (StrategyTable's `initialSort`). */
  initialSort?: ComponentProps<typeof StrategyTable>["initialSort"];
}

export function StrategiesSection({
  strategies,
  origin,
  placeholderKeys = [],
  portfolioId = null,
  percentiles = null,
  managerRows,
  allocatorFurniture = false,
  initialSort,
}: StrategiesSectionProps) {
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
        // Phase 199: it is the page's own origin key ("strategies" on the merged
        // page, "my-strategies" on the old one), so each page keeps the scope it
        // always had and a third host cannot collide with either.
        categorySlug={origin.key}
        origin={origin}
        portfolioId={portfolioId}
        percentiles={percentiles ?? undefined}
        visibility="owner-all-statuses"
        managerRows={managerRows}
        allocatorFurniture={allocatorFurniture}
        initialSort={initialSort}
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
        // D-02: wired ONLY for the allocator furniture. A manager-only page passes
        // neither, so Mark ownership and Rename are absent from it by the props,
        // and the table's own `allocatorFurniture` gate is the second lock.
        onMarkOwnership={
          allocatorFurniture
            ? (s) =>
                setMarkTarget({
                  id: s.id,
                  name: s.name,
                  mark: s.capital_ownership ?? null,
                })
            : undefined
        }
        onRename={
          allocatorFurniture
            ? (s) => setRenameTarget({ id: s.id, name: s.name })
            : undefined
        }
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
