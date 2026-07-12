"use client";

/**
 * Phase 09.1 D-06 + D-11 + D-18 / F4b — Holdings tab body.
 *
 * Two sections:
 *   1. **Strategies** — one row per onboarded portfolio strategy
 *      (`props.strategies` → `toStrategyRows` → `HoldingsTable strategyRows`).
 *      This is the primary surface: Strategy / Manager / Weight / Allocation /
 *      MTD / Sharpe / Max DD / Age, each row linking to the strategy factsheet.
 *      Strategy↔analytics data is real (server-projected); there is NO
 *      holding→strategy join, so raw exchange positions live in section 2.
 *   2. **Exchange Positions** — the allocator's raw synced positions, always
 *      shown with position-appropriate columns (no empty strategy columns):
 *        - a flagged-holding "Record outcome" surface
 *          (`ScenarioFlaggedHoldingsList`) when any holdings are flagged for a
 *          bridge/replacement — preserves the per-holding outcome CTA;
 *        - spot balances via the legacy `HoldingsTable` (holding columns +
 *          revoked-key handling);
 *        - open derivative positions via `OpenPositionsTable`.
 *
 * Spot vs derivative are partitioned because their `value_usd` semantics
 * differ (spot = marked equity value; derivative = notional exposure, with
 * `unrealized_pnl_usd` the equity contribution).
 */

import { useMemo, useState } from "react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { buildHoldingRef } from "./lib/holding-outcome-adapter";
import { toStrategyRows } from "./lib/strategies-row-adapter";
import { HoldingsTable, type HoldingRow } from "./components/HoldingsTable";
import {
  OpenPositionsTable,
  type OpenPositionRow,
} from "./components/OpenPositionsTable";
import { ScenarioFlaggedHoldingsList } from "./ScenarioFlaggedHoldingsList";
// Phase 99 / 99-04 — DIRECT imports of the three exposure widgets. NOT routed
// through the B7b-locked widgets/index.ts WIDGET_COMPONENTS barrel (these are
// section-mounted, not part of the configurable dashboard grid).
import { ExposureByClass } from "./widgets/positions/ExposureByClass";
import { NetExposureChart } from "./widgets/positions/NetExposureChart";
import { AllocationOverTime } from "./widgets/allocation/AllocationOverTime";
import type { ExposureSectionData } from "./lib/exposure-props";
// Phase 100 / 100-04 (PI-04 + PI-05) — the two demo-hero sections mounted below
// the exposure trio, fed by the distinct `favorites` / `optimizer` / `note`
// props threaded from page.tsx (wave-1 exports from plans 100-01 / 100-02).
import { WatchlistPanel } from "./components/WatchlistPanel";
import { OptimizerPanel } from "./components/OptimizerPanel";
import { DashboardNoteCard } from "./components/DashboardNoteCard";
import type { FavoriteRow, OptimizerPrefetch } from "./lib/watchlist-read";

/** Honest-empty optimizer state when the prop is absent (test harnesses). */
const EMPTY_OPTIMIZER: OptimizerPrefetch = {
  portfolios: [],
  defaultPortfolioId: null,
  initialSuggestions: null,
  computedAt: null,
  computationStatus: null,
};

export function HoldingsTabPanel(
  // `favorites` / `optimizer` / `note` are ADDITIVE (100-04). Optional here so
  // the panel renders honest-empty in harnesses that don't supply them; page.tsx
  // always threads all three (SC-4).
  props: MyAllocationDashboardPayload & {
    exposure: ExposureSectionData;
    favorites?: FavoriteRow[];
    optimizer?: OptimizerPrefetch;
    note?: { initialContent: string; initialLastSavedAt: Date | null };
  },
) {
  const holdingsSummary = useMemo(() => props.holdingsSummary ?? [], [props.holdingsSummary]);
  const flaggedHoldings = props.flaggedHoldings ?? [];
  const matchDecisionsByHoldingRef = props.matchDecisionsByHoldingRef ?? {};
  const apiKeys = useMemo(() => props.apiKeys ?? [], [props.apiKeys]);
  const strategies = useMemo(() => props.strategies ?? [], [props.strategies]);

  // Phase 100 / 100-04 — additive section inputs (honest-empty when absent).
  const favorites = useMemo(() => props.favorites ?? [], [props.favorites]);
  const optimizer = props.optimizer ?? EMPTY_OPTIMIZER;
  const note = props.note ?? { initialContent: "", initialLastSavedAt: null };
  // Real cross-link: the watchlist "Suggested" chip lights up ONLY for favorites
  // that are ALSO a current optimizer suggestion. [] when nothing is computed.
  const suggestedIds = useMemo(
    () => (optimizer.initialSuggestions ?? []).map((s) => s.strategy_id),
    [optimizer.initialSuggestions],
  );

  const [showRevoked, setShowRevoked] = useState(true);

  // ── Section 1: one row per onboarded strategy. Real strategy data; no
  //    holding involvement (raw positions render in section 2 below).
  const strategyRows = useMemo(
    () => toStrategyRows({ strategies }),
    [strategies],
  );

  const spotHoldings = useMemo(
    () => holdingsSummary.filter((h) => h.holding_type === "spot"),
    [holdingsSummary],
  );
  const derivativeHoldings = useMemo(
    () => holdingsSummary.filter((h) => h.holding_type === "derivative"),
    [holdingsSummary],
  );

  // ── Map api_key.id → sync_status. Defensive default 'unknown' when the FK
  //    doesn't resolve (RESTRICT FK should prevent this in practice).
  const keyStatusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of apiKeys) {
      m.set(k.id, k.sync_status ?? "unknown");
    }
    return m;
  }, [apiKeys]);

  // ── spot rows for the legacy holding-column table (Exchange Positions).
  //    source_key_sync_status drives the revoked-key chip.
  const spotHoldingRows = useMemo<HoldingRow[]>(
    () =>
      spotHoldings.map((h) => {
        const ref = buildHoldingRef({
          venue: h.venue,
          symbol: h.symbol,
          holding_type: h.holding_type,
        });
        const status = h.api_key_id
          ? keyStatusById.get(h.api_key_id) ?? "unknown"
          : "unknown";
        return {
          id: ref,
          venue: h.venue,
          symbol: h.symbol,
          holding_type: "spot",
          quantity: h.quantity,
          value_usd: h.value_usd,
          entry_price: h.entry_price ?? null,
          unrealized_pnl_usd: h.unrealized_pnl_usd ?? null,
          api_key_id: h.api_key_id,
          source_key_sync_status: status,
        };
      }),
    [spotHoldings, keyStatusById],
  );

  const openPositionRows = useMemo<OpenPositionRow[]>(
    () =>
      derivativeHoldings.map((h) => {
        const ref = buildHoldingRef({
          venue: h.venue,
          symbol: h.symbol,
          holding_type: h.holding_type,
        });
        const status = h.api_key_id
          ? keyStatusById.get(h.api_key_id) ?? "unknown"
          : "unknown";
        return {
          id: ref,
          venue: h.venue,
          symbol: h.symbol,
          side: h.side ?? "flat",
          quantity: h.quantity,
          notional_usd: h.value_usd,
          entry_price: h.entry_price ?? null,
          mark_price: h.mark_price_usd,
          unrealized_pnl_usd: h.unrealized_pnl_usd ?? null,
          api_key_id: h.api_key_id,
          source_key_sync_status: status,
        };
      }),
    [derivativeHoldings, keyStatusById],
  );

  const allocatorPreferences = props.mandate
    ? { max_weight: props.mandate.max_weight }
    : null;

  return (
    <div data-tab-panel="holdings" className="grid gap-8">
      {/* Section 1 — onboarded strategies (renders its own "Strategies" header). */}
      <HoldingsTable strategyRows={strategyRows} />

      {/* Section 2 — Exposure (PI-01/02/03). Sits directly after Strategies per
          the 99-UI-SPEC placement (the 100-04 Watchlist/Notes sections now follow
          it, before Exchange Positions). Additive: fed by the distinct `exposure`
          prop; renders honest-empty when the trio is empty. */}
      <section aria-label="Exposure" className="grid gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Exposure
        </h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ExposureByClass snapshot={props.exposure.snapshot} />
          <NetExposureChart {...props.exposure.netSeries} />
          <div className="lg:col-span-2">
            <AllocationOverTime {...props.exposure.allocationSeries} />
          </div>
        </div>
      </section>

      {/* Section 3 — Watchlist & Optimizer (PI-05). Mounts directly BELOW the
          exposure trio per the 100-UI-SPEC composition. Additive: fed by the
          distinct `favorites` / `optimizer` props; each panel renders honest-empty
          when its data is empty (zero fabricated rows). The two panels reflow on
          THIS section's own width (stacked <1024px) via a @container host on a
          SEPARATE ancestor from the @5xl:grid-cols-2 variant — the CompareTable
          idiom (DESIGN.md 2026-06-29). The parent grid's gap-8 gives the 32px
          section gap the UI-SPEC pins. */}
      <section aria-label="Watchlist & Optimizer" className="grid gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Watchlist &amp; Optimizer
        </h3>
        <div className="@container">
          <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-2">
            <WatchlistPanel favorites={favorites} suggestedIds={suggestedIds} />
            <OptimizerPanel prefetch={optimizer} />
          </div>
        </div>
      </section>

      {/* Section 4 — Notes (PI-04), full-width. DashboardNoteCard owns its own
          "Notes" heading + autosave; the <section> is an aria landmark only (no
          duplicate section heading). */}
      <section aria-label="Notes">
        <DashboardNoteCard
          initialContent={note.initialContent}
          initialLastSavedAt={note.initialLastSavedAt}
        />
      </section>

      {/* Section 5 — raw exchange positions (always shown). */}
      <section className="grid gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-text-primary">
          Exchange Positions
        </h3>
        {flaggedHoldings.length > 0 ? (
          <ScenarioFlaggedHoldingsList
            flaggedHoldings={flaggedHoldings}
            matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
            // Matches the Scenario-tab wiring (ScenarioStub): existing outcomes
            // are not pre-loaded here; the banner's server-side eligibility
            // check gates double-recording.
            existingOutcomesByHoldingRef={{}}
            allocatorPreferences={allocatorPreferences}
          />
        ) : null}
        <HoldingsTable
          holdings={spotHoldingRows}
          showRevoked={showRevoked}
          onShowRevokedChange={setShowRevoked}
        />
        <OpenPositionsTable rows={openPositionRows} />
      </section>
    </div>
  );
}
