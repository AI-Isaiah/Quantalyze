"use client";

/**
 * Phase 10 Plan 06b — full Scenario tab body assembly.
 *
 * Composes Plan 06a's `useScenarioState` hook + `ScenarioFooter` with
 * the Wave 2-5 component primitives (KpiStrip mode=scenario, EquityChart
 * scenarioSeries, DrawdownChart scenarioDailyPoints, StrategyBrowseDrawer,
 * BridgeDrawer onAddToScenario, ScenarioFlaggedHoldingsList).
 *
 * Sections (top→bottom per UI-SPEC §Component Inventory):
 *   1. Header — "Scenario" + subtitle
 *   2. Fingerprint-mismatch banner (when stored fingerprint != current)
 *   3. KpiStrip in mode="scenario" with scenarioMetrics + liveMetrics
 *   4. EquityChart + DrawdownChart with scenarioSeries / scenarioDailyPoints
 *   5. Bridge inline card (only when flaggedHoldings.length > 0) embedding
 *      ScenarioFlaggedHoldingsList — RESEARCH §Architecture decision
 *   6. CompositionList — toggle/weight/per-row delta/Compare/Remove
 *   7. "Add more strategies" CTA row → opens StrategyBrowseDrawer
 *   8. ScenarioFooter (sticky)
 *
 * Adapter signature is B4-pinned: `buildStrategyForBuilderSet` is called
 * with `addedStrategies: AddedStrategy[]` (lightweight) plus two lookup
 * maps `addedStrategyReturnsLookup` + `addedStrategyMetadataLookup`
 * constructed from `payload.strategies`. The composer NEVER hand-rolls a
 * `StrategyForBuilder`-shaped object at the call site (no pre-casting,
 * no inline disclosure-tier literals).
 *
 * Pitfall 1 — `computeScenario().equity_curve` returns cumulative RETURN
 * (e.g. 0.18 = +18%). The composer converts to cumulative WEALTH (start
 * at 1.0) before passing to EquityChart, and scales by the scenario AUM
 * before passing to DrawdownChart (which expects USD-form values).
 *
 * M4 — live baseline read from `payload.liveBaselineMetrics` (SSR-lifted
 * in Plan 03). The composer does NOT re-derive the live baseline by
 * calling computeScenario a second time per render.
 *
 * M3 — when `holdingsSummary.length === 0` AND no strategies have been
 * added yet, render the EmptyState dual-CTA layout. Once the user adds
 * a strategy via the empty-state Browse drawer, the gate falls through
 * and the composer body renders with an empty live baseline.
 *
 * M5 — multi-venue caveat tooltip on composition rows where the symbol
 * is shared across venues. Surfaces the holdingReturnsByScopeRef
 * symbol-keyed merge that produces identical return series for
 * BTC@binance + BTC@okx.
 *
 * Plan 07 wires `onCommitRequested` to the actual ScenarioCommitDrawer +
 * POST /api/allocator/scenario/commit. This plan ships the Commit BUTTON
 * (sticky-footer right CTA) but routes the click to the callback prop.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  buildDateMapCache,
  computeScenario,
  type ComputedMetrics,
  type DailyPoint,
  type StrategyForBuilder,
} from "@/lib/scenario";
import { useScenarioState } from "../hooks/useScenarioState";
import { buildStrategyForBuilderSet } from "../lib/scenario-adapter";
import {
  buildHoldingRef,
  type FlaggedHolding,
} from "../lib/holding-outcome-adapter";
import { KpiStrip } from "./KpiStrip";
import { EquityChart } from "../widgets/performance/EquityChart";
import DrawdownChart from "../widgets/performance/DrawdownChart";
import { StrategyBrowseDrawer } from "./StrategyBrowseDrawer";
import { BridgeDrawer } from "./BridgeDrawer";
import { ScenarioCommitDrawer } from "./ScenarioCommitDrawer";
import { ScenarioFooter } from "./ScenarioFooter";
import { ScenarioFlaggedHoldingsList } from "../ScenarioFlaggedHoldingsList";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import type { AllocatorMandateForFit } from "../lib/mandate-fit";
import type { AddedStrategy } from "../lib/scenario-state";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Review-pass P2 fix. When the allocator opens the composer with zero
 * holdings AND has added at least one strategy, `scenarioAum` collapses to
 * 0 and the wealth-curve denominators (`scenarioWealthSeries.value *
 * scenarioAum`) collapse to a degenerate flat-zero series. Substitute a
 * symbolic 1 USD baseline so the chart renders the SHAPE of the projection
 * (relative wealth movement) instead of a flat line. The KPI strip + delta
 * pills remain unaffected — they read fractional metrics from the engine
 * directly, not USD-scaled values.
 */
const SYNTHETIC_BASELINE_AUM = 1;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScenarioCommitDiff {
  kind:
    | "voluntary_remove"
    | "voluntary_add"
    | "voluntary_modify"
    | "bridge_recommended";
  holding_ref?: string;
  strategy_id?: string;
  new_weight?: number;
  size_at_decision_usd: number;
}

export interface ScenarioComposerProps {
  payload: MyAllocationDashboardPayload;
  allocatorId: string;
  allocatorMandate: AllocatorMandateForFit | null;
  /** Legacy callback API. When `useInternalCommitDrawer === false`, the
   *  composer fires this callback INSTEAD of opening its own
   *  ScenarioCommitDrawer — host owns the commit-confirmation surface.
   *  When `useInternalCommitDrawer === true` (default), the composer
   *  opens its internal drawer and does NOT fire this callback, avoiding
   *  the dual-drawer stack the previous (always-fire-both) code created
   *  whenever a host wired `onCommitRequested` to also open a modal. */
  onCommitRequested?: (diffs: ScenarioCommitDiff[]) => void;
  /** Review-pass P2 fix. Defaults to `true` — composer opens its own
   *  ScenarioCommitDrawer (Plan 07 wiring). Set `false` to delegate the
   *  commit gesture to the host via `onCommitRequested` and suppress the
   *  internal drawer entirely (legacy / forward-compat API for tests
   *  and future hosts that prefer to own the commit UI). */
  useInternalCommitDrawer?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * M4 — adapt `payload.liveBaselineMetrics` (SSR-lifted in Plan 03 with custom
 * field names: ytdTwr / sharpe / maxDd / avgRho / equity / drawdown) into a
 * `ComputedMetrics`-shaped object so KpiStrip can index it by `twr` /
 * `sharpe` / `max_drawdown` / `avg_pairwise_correlation`.
 *
 * The shape conversion is purely a key rename — no math, no recomputation.
 * computeScenario is NOT invoked here; that's the whole point of M4.
 */
function liveBaselineToComputedMetrics(
  baseline: MyAllocationDashboardPayload["liveBaselineMetrics"],
): ComputedMetrics {
  return {
    n: baseline.equity.length,
    twr: baseline.ytdTwr,
    cagr: null,
    volatility: null,
    sharpe: baseline.sharpe,
    sortino: null,
    max_drawdown: baseline.maxDd,
    max_dd_days: null,
    correlation_matrix: null,
    avg_pairwise_correlation: baseline.avgRho,
    equity_curve: baseline.equity,
    effective_start: baseline.equity[0]?.date ?? null,
    effective_end: baseline.equity[baseline.equity.length - 1]?.date ?? null,
  };
}

// ---------------------------------------------------------------------------
// ScenarioComposer
// ---------------------------------------------------------------------------

export function ScenarioComposer({
  payload,
  allocatorId,
  allocatorMandate,
  onCommitRequested,
  useInternalCommitDrawer = true,
}: ScenarioComposerProps) {
  const {
    holdingsSummary,
    flaggedHoldings,
    matchDecisionsByHoldingRef,
    existingOutcomesByHoldingRef,
    strategies,
    equityDailyPoints,
    holdingReturnsByScopeRef,
    snapshotCount,
    allKeysStale,
    minHistoryDepthMonths,
    activeVenues,
  } = payload as MyAllocationDashboardPayload & {
    existingOutcomesByHoldingRef?: Record<string, unknown>;
  };
  const router = useRouter();

  const scenario = useScenarioState({
    holdingsSummary: holdingsSummary as { symbol: string; venue: string; holding_type: string; value_usd: number }[],
    allocatorId,
  });

  const [browseOpen, setBrowseOpen] = useState(false);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  // Plan 07 — ScenarioCommitDrawer wire-in. handleCommit builds the diffs,
  // stashes them, then opens the drawer. onSubmitSuccess (drawer-side, full-
  // success only per H4) calls scenario.reset() to clear localStorage and
  // reinitialize from current live holdings.
  const [commitDrawerOpen, setCommitDrawerOpen] = useState(false);
  const [commitDiffs, setCommitDiffs] = useState<ScenarioCommitDiff[]>([]);

  // M3 — Empty state computed flag. The early-return moves to the END of
  // the hook list so React's hook ordering invariant is preserved across
  // the empty → "added a strategy" transition (otherwise the second
  // render would call MORE hooks than the first, triggering React's
  // "Rendered more hooks than during the previous render" guard).
  const isEmptyState =
    holdingsSummary.length === 0 &&
    scenario.draft.addedStrategies.length === 0;

  // -------------------------------------------------------------------------
  // B4 — Build lookup maps from payload.strategies (NO pre-casting at the
  // call site). The maps are the canonical channel for added-strategy
  // returns + metadata; the adapter merges them with the lightweight
  // AddedStrategy[] coming from scenario.draft.
  // -------------------------------------------------------------------------
  // Note on the `as unknown as DailyPoint[]` cast: the upstream
  // StrategyAnalytics type declares `daily_returns: Record<string, Record<string,
  // number>>` (a year-keyed nested record), but the runtime payload from
  // queries.ts often surfaces it as `DailyPoint[]` for the scenario sandbox
  // path. The adapter (and downstream computeScenario engine) consume
  // `DailyPoint[]`. When the field is missing or shaped wrong at runtime, we
  // fall back to `[]`, which the frozen scenario-adapter warm-up gate
  // already excludes from the projection (Plan 01 D-01 + warm-up gate).
  const addedStrategyReturnsLookup = useMemo<Record<string, DailyPoint[]>>(
    () => {
      const map: Record<string, DailyPoint[]> = {};
      for (const a of scenario.draft.addedStrategies) {
        const found = strategies.find((s) => s.strategy.id === a.id);
        const raw = found?.strategy.strategy_analytics?.daily_returns;
        // Runtime defensiveness: only accept a DailyPoint[]-shaped array.
        const arr = Array.isArray(raw) ? (raw as unknown as DailyPoint[]) : [];
        map[a.id] = arr;
      }
      return map;
    },
    [scenario.draft.addedStrategies, strategies],
  );

  const addedStrategyMetadataLookup = useMemo<
    Record<
      string,
      Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
    >
  >(() => {
    const map: Record<
      string,
      Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
    > = {};
    for (const a of scenario.draft.addedStrategies) {
      const found = strategies.find((s) => s.strategy.id === a.id);
      if (found) {
        map[a.id] = {
          disclosure_tier: found.strategy.disclosure_tier,
          cagr: found.strategy.strategy_analytics?.cagr ?? null,
          sharpe: found.strategy.strategy_analytics?.sharpe ?? null,
        };
      }
    }
    return map;
  }, [scenario.draft.addedStrategies, strategies]);

  // -------------------------------------------------------------------------
  // Build scenario projection via adapter + frozen scenario.ts engine
  // (B4-pinned positional signature).
  // -------------------------------------------------------------------------
  const disabledHoldingRefs = useMemo(() => {
    const set = new Set<string>();
    for (const [k, v] of Object.entries(scenario.draft.toggleByScopeRef)) {
      const isHoldingRef = k.startsWith("holding:");
      if (!v && isHoldingRef) set.add(k);
    }
    return set;
  }, [scenario.draft.toggleByScopeRef]);

  const adapterOutput = useMemo(
    () =>
      buildStrategyForBuilderSet(
        holdingsSummary as Array<{
          symbol: string;
          venue: string;
          holding_type: "spot" | "derivative";
          value_usd: number;
        }>,
        disabledHoldingRefs,
        scenario.draft.addedStrategies,
        holdingReturnsByScopeRef,
        addedStrategyReturnsLookup as Record<
          import("../lib/scenario-adapter").StrategyForBuilderId,
          DailyPoint[]
        >,
        addedStrategyMetadataLookup as Record<
          import("../lib/scenario-adapter").StrategyForBuilderId,
          Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
        >,
      ),
    [
      holdingsSummary,
      disabledHoldingRefs,
      scenario.draft.addedStrategies,
      holdingReturnsByScopeRef,
      addedStrategyReturnsLookup,
      addedStrategyMetadataLookup,
    ],
  );

  const scenarioMetrics = useMemo(() => {
    const cache = buildDateMapCache(adapterOutput.strategies);
    return computeScenario(adapterOutput.strategies, adapterOutput.state, cache);
  }, [adapterOutput]);

  // -------------------------------------------------------------------------
  // M4 — live baseline from payload (NOT recomputed here).
  // -------------------------------------------------------------------------
  const liveMetricsForKpi: ComputedMetrics = useMemo(
    () => liveBaselineToComputedMetrics(payload.liveBaselineMetrics),
    [payload.liveBaselineMetrics],
  );

  // -------------------------------------------------------------------------
  // Pitfall 1 — convert equity_curve cumulative RETURN → cumulative WEALTH
  // (start at 1.0). EquityChart needs wealth-form. DrawdownChart needs
  // wealth × scenarioAum (USD-scaled) so deriveSnapshotDrawdowns can
  // compute peak-anchored drawdown directly.
  // -------------------------------------------------------------------------
  const scenarioWealthSeries: DailyPoint[] = useMemo(
    () =>
      scenarioMetrics.equity_curve.map((p) => ({
        date: p.date,
        value: p.value + 1,
      })),
    [scenarioMetrics.equity_curve],
  );

  const scenarioAum = useMemo(() => {
    let sum = 0;
    for (const [scopeRef, on] of Object.entries(scenario.draft.toggleByScopeRef)) {
      if (!on) continue;
      const isHoldingRef = scopeRef.startsWith("holding:");
      if (!isHoldingRef) continue;
      const h = holdingsSummary.find(
        (x) =>
          buildHoldingRef({
            venue: x.venue,
            symbol: x.symbol,
            holding_type: x.holding_type,
          }) === scopeRef,
      );
      if (h) sum += h.value_usd;
    }
    return sum;
  }, [scenario.draft.toggleByScopeRef, holdingsSummary]);

  // Review-pass P2 fix — when the allocator has added strategies but the
  // live holdings list is empty (or all toggled off), `scenarioAum` is 0
  // and the USD-scaled drawdown series degenerates to a flat zero. Fall
  // back to a symbolic 1 USD so the curve renders the SHAPE of the
  // projection. The KPI strip is sourced from fractional engine metrics
  // and is unaffected by this substitution.
  const effectiveScenarioAumForChart =
    scenarioAum > 0 ? scenarioAum : SYNTHETIC_BASELINE_AUM;
  const scenarioDailyPointsForDrawdown: DailyPoint[] = useMemo(
    () =>
      scenarioWealthSeries.map((p) => ({
        date: p.date,
        value: p.value * effectiveScenarioAumForChart,
      })),
    [scenarioWealthSeries, effectiveScenarioAumForChart],
  );

  // -------------------------------------------------------------------------
  // Build delta summary for footer (top 3 above noise floor).
  // Direction-aware mapping per CONTEXT D-16. Plan 07 may extend this; v0
  // ships a simple Sharpe + Max DD + TWR projection.
  // -------------------------------------------------------------------------
  const deltaSummary = useMemo(() => {
    const items: Array<{
      label: string;
      value: string;
      tier: "positive" | "negative" | "muted";
    }> = [];
    const live = liveMetricsForKpi;
    const sc = scenarioMetrics;
    function pushDelta(
      label: string,
      direction: "up-good" | "down-good",
      noise: number,
      formatter: (n: number) => string,
      liveVal: number | null,
      scVal: number | null,
    ) {
      if (liveVal == null || scVal == null) return;
      const d = scVal - liveVal;
      let tier: "positive" | "negative" | "muted" = "muted";
      if (Math.abs(d) >= noise) {
        const improved = direction === "up-good" ? d > 0 : d < 0;
        tier = improved ? "positive" : "negative";
      }
      // Sign convention matches KpiStrip.formatSignedDelta verbatim:
      // ASCII '+' for non-negative, Unicode minus '−' (U+2212) for
      // negative. The mix is deliberate (typographic minus reads as a
      // single signed-numeric glyph in the proportional font; the ASCII
      // plus matches the rest of the dashboard's signed-percentage UI).
      // Single source of truth for the convention lives in KpiStrip.
      const sign = d >= 0 ? "+" : "−";
      items.push({ label, value: `${sign}${formatter(Math.abs(d))}`, tier });
    }
    pushDelta(
      "Sharpe",
      "up-good",
      0.01,
      (n) => n.toFixed(2),
      live.sharpe,
      sc.sharpe,
    );
    pushDelta(
      "Max DD",
      "up-good",
      0.01,
      (n) => `${(n * 100).toFixed(1)}%`,
      live.max_drawdown,
      sc.max_drawdown,
    );
    pushDelta(
      "TWR",
      "up-good",
      0.01,
      (n) => `${(n * 100).toFixed(1)}%`,
      live.twr,
      sc.twr,
    );
    return items;
  }, [liveMetricsForKpi, scenarioMetrics]);

  // -------------------------------------------------------------------------
  // Build Commit diffs and route to onCommitRequested. Plan 07 replaces this
  // wiring with the real ScenarioCommitDrawer.
  // -------------------------------------------------------------------------
  function handleCommit() {
    const diffs: ScenarioCommitDiff[] = [];
    for (const [scopeRef, on] of Object.entries(scenario.draft.toggleByScopeRef)) {
      if (on) continue;
      if (!scopeRef.startsWith("holding:")) continue;
      const h = holdingsSummary.find(
        (x) =>
          buildHoldingRef({
            venue: x.venue,
            symbol: x.symbol,
            holding_type: x.holding_type,
          }) === scopeRef,
      );
      if (!h) continue;
      diffs.push({
        kind: "voluntary_remove",
        holding_ref: scopeRef,
        size_at_decision_usd: h.value_usd,
      });
    }
    for (const a of scenario.draft.addedStrategies) {
      diffs.push({
        kind: "voluntary_add",
        strategy_id: a.id,
        size_at_decision_usd:
          (scenario.draft.weightOverrides[a.id] ?? 0) * scenarioAum,
      });
    }
    // Review-pass P2 fix — single-source the commit-drawer surface. When
    // `useInternalCommitDrawer === true` (default) the composer owns the
    // drawer and SUPPRESSES the legacy onCommitRequested callback so a
    // host that wires onCommitRequested to also open a modal cannot stack
    // two confirmation surfaces on top of each other. When `false`, the
    // host is signalling "I own the commit UI" — fire onCommitRequested
    // and skip opening the internal drawer.
    setCommitDiffs(diffs);
    if (useInternalCommitDrawer) {
      setCommitDrawerOpen(true);
    } else {
      onCommitRequested?.(diffs);
    }
  }

  // -------------------------------------------------------------------------
  // M5 — multi-venue caveat: identify symbols shared across multiple venues.
  // Returns the set of symbols that appear under more than one venue in the
  // current holdings. Composition rows whose symbol is in this set surface
  // a tooltip explaining the merged-returns side-effect.
  // -------------------------------------------------------------------------
  const sharedSymbols = useMemo(() => {
    const symbolToVenues = new Map<string, Set<string>>();
    for (const h of holdingsSummary) {
      const set = symbolToVenues.get(h.symbol) ?? new Set<string>();
      set.add(h.venue);
      symbolToVenues.set(h.symbol, set);
    }
    const out = new Set<string>();
    for (const [sym, venues] of symbolToVenues.entries()) {
      if (venues.size > 1) out.add(sym);
    }
    return out;
  }, [holdingsSummary]);

  // -------------------------------------------------------------------------
  // Render — M3 empty-state branch first (after ALL hooks have run, so
  // React's hooks-order invariant holds when the user adds a strategy from
  // the empty state and the composer transitions to its main body).
  // -------------------------------------------------------------------------
  if (isEmptyState) {
    return (
      <div
        data-widget-id="scenario-composer"
        className="mx-auto max-w-[1100px] py-12"
      >
        <div className="rounded-lg border border-border bg-surface p-12 text-center">
          <h2
            className="mb-2 text-2xl text-text-primary"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Scenario builder needs holdings
          </h2>
          <p className="mx-auto max-w-md text-sm text-text-secondary">
            Connect a read-only exchange API key to project portfolio scenarios
            — or browse strategies to start a hypothetical scenario from
            scratch.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href="/profile?tab=exchanges"
              className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              Connect Exchange →
            </Link>
            <button
              type="button"
              onClick={() => setBrowseOpen(true)}
              className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary hover:border-accent"
            >
              Browse strategies
            </button>
          </div>
          <p className="mt-6 text-xs text-text-muted">
            Want to compare strategies without your portfolio?{" "}
            <Link href="/scenarios" className="text-accent underline">
              Try the Strategy Sandbox →
            </Link>
          </p>
        </div>
        <StrategyBrowseDrawer
          isOpen={browseOpen}
          onClose={() => setBrowseOpen(false)}
          onAdd={(s) =>
            scenario.addStrategyBrowse({
              id: s.id as AddedStrategy["id"],
              name: s.name,
              markets: s.markets,
              strategy_types: s.strategy_types,
            })
          }
          allocatorMandate={allocatorMandate}
        />
      </div>
    );
  }

  return (
    <div
      data-widget-id="scenario-composer"
      className="mx-auto flex max-w-[1100px] flex-col"
    >
      <h2 className="text-2xl font-semibold text-text-primary">Scenario</h2>
      <p className="mt-1 text-sm text-text-muted">
        Compose a draft portfolio and project KPI / equity / drawdown impact vs
        your live baseline.
      </p>

      {scenario.fingerprintMismatch && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-warning bg-[rgba(217,119,6,0.08)] p-3 text-sm text-text-primary"
        >
          <div className="font-medium">
            Your live holdings have changed since you last edited the scenario.
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            Reset and start from current holdings, or keep your draft for now.
          </div>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => {
                scenario.reset();
              }}
              className="rounded-md border border-border px-3 py-1 text-xs text-text-secondary hover:border-negative hover:text-negative"
            >
              Reset and start over
            </button>
            <button
              type="button"
              autoFocus
              onClick={scenario.dismissFingerprintMismatchBanner}
              className="rounded-md border border-border px-3 py-1 text-xs"
            >
              Keep my draft
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        <KpiStrip
          mode="scenario"
          scenarioMetrics={scenarioMetrics}
          liveMetrics={liveMetricsForKpi}
          metrics={liveMetricsForKpi}
          analytics={{}}
          aum={scenarioAum}
          snapshotCount={snapshotCount}
          allKeysStale={allKeysStale}
          minHistoryDepthMonths={minHistoryDepthMonths}
          activeVenues={activeVenues}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EquityChart
          equityDailyPoints={equityDailyPoints}
          scenarioSeries={scenarioWealthSeries}
        />
        <div className="h-[300px]">
          {/* DrawdownChart extends WidgetProps (data + timeframe + width + height
              required for the legacy widget-grid path). On the Scenario tab
              we feed the f7 parallel-prop (`equityDailyPoints`) so the
              widget-data fields default to empty / safe values. */}
          <DrawdownChart
            data={{}}
            timeframe="all"
            width={6}
            height={4}
            equityDailyPoints={equityDailyPoints}
            scenarioDailyPoints={scenarioDailyPointsForDrawdown}
          />
        </div>
      </div>

      {flaggedHoldings.length > 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-4">
          <div className="text-base font-semibold text-text-primary">
            Bridge flagged {flaggedHoldings.length} holding
            {flaggedHoldings.length === 1 ? "" : "s"}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Review the recommended replacement
            {flaggedHoldings.length === 1 ? "" : "s"} below — add any to the
            scenario at a swap-in weight.
          </p>
          <button
            type="button"
            onClick={() => setBridgeOpen(true)}
            className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90"
          >
            Open Bridge
          </button>
          <div className="mt-4">
            <ScenarioFlaggedHoldingsList
              flaggedHoldings={flaggedHoldings}
              matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
              existingOutcomesByHoldingRef={
                (existingOutcomesByHoldingRef ?? {}) as Record<
                  string,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  any
                >
              }
              allocatorPreferences={null}
            />
          </div>
        </div>
      )}

      <CompositionList
        draft={scenario.draft}
        holdingsSummary={holdingsSummary}
        flaggedHoldings={flaggedHoldings}
        sharedSymbols={sharedSymbols}
        onToggle={scenario.toggleHolding}
        onSetWeight={scenario.setWeightOverride}
        onRemoveAdded={scenario.removeAddedStrategy}
        onCompare={(scopeRef, candidateId) =>
          router.push(
            `/compare?ids=${encodeURIComponent(scopeRef)},${candidateId}`,
          )
        }
      />

      <div className="mt-8 rounded-lg border border-border bg-surface p-4">
        <div className="text-base font-semibold text-text-primary">
          Add more strategies
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Browse the verified-strategies catalog to add candidates outside the
          Bridge recommendations.
        </p>
        <button
          type="button"
          onClick={() => setBrowseOpen(true)}
          className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90"
        >
          Browse strategies
        </button>
      </div>

      <ScenarioFooter
        diffCount={scenario.diffCount}
        deltaSummary={deltaSummary}
        onResetRequested={() => setResetModalOpen(true)}
        onCommitRequested={handleCommit}
      />

      <StrategyBrowseDrawer
        isOpen={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onAdd={(s) =>
          scenario.addStrategyBrowse({
            id: s.id as AddedStrategy["id"],
            name: s.name,
            markets: s.markets,
            strategy_types: s.strategy_types,
          })
        }
        allocatorMandate={allocatorMandate}
      />
      <BridgeDrawer
        isOpen={bridgeOpen}
        onClose={() => setBridgeOpen(false)}
        flaggedHoldings={flaggedHoldings}
        matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
        onAddToScenario={(holdingScopeRef, candidate) => {
          scenario.addStrategyBridge(holdingScopeRef, {
            id: candidate.id as AddedStrategy["id"],
            name: candidate.name,
            markets: candidate.markets,
            strategy_types: candidate.strategy_types,
          });
        }}
      />

      {resetModalOpen && (
        <ResetConfirmationModal
          onConfirm={() => {
            scenario.reset();
            setResetModalOpen(false);
          }}
          onCancel={() => setResetModalOpen(false)}
        />
      )}

      {/* Plan 07 — Scenario commit pipeline. The drawer fires the actual
          POST /api/allocator/scenario/commit; on FULL-SUCCESS only it
          invokes onSubmitSuccess (which calls scenario.reset() to clear
          the draft + reinitialize from the new live holdings). Full-failure
          keeps the drawer open with per-row errors and does NOT reset the
          draft (the user can fix and retry). */}
      <ScenarioCommitDrawer
        isOpen={commitDrawerOpen}
        onClose={() => setCommitDrawerOpen(false)}
        diffs={commitDiffs}
        onSubmitSuccess={() => {
          scenario.reset();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompositionList — sub-component
// ---------------------------------------------------------------------------

interface CompositionListProps {
  draft: ReturnType<typeof useScenarioState>["draft"];
  holdingsSummary: MyAllocationDashboardPayload["holdingsSummary"];
  flaggedHoldings: FlaggedHolding[];
  sharedSymbols: Set<string>;
  onToggle: (scopeRef: string) => void;
  onSetWeight: (scopeRef: string, weight: number) => void;
  onRemoveAdded: (id: string) => void;
  onCompare: (scopeRef: string, candidateId: string) => void;
}

function CompositionList({
  draft,
  holdingsSummary,
  flaggedHoldings,
  sharedSymbols,
  onToggle,
  onSetWeight,
  onRemoveAdded,
  onCompare,
}: CompositionListProps) {
  const flaggedByRef = useMemo(() => {
    const map = new Map<string, FlaggedHolding>();
    for (const f of flaggedHoldings) {
      map.set(buildHoldingRef(f), f);
    }
    return map;
  }, [flaggedHoldings]);

  return (
    <div className="mt-8 rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 text-base font-semibold text-text-primary">
        Composition
      </div>
      <ul className="grid gap-2">
        {holdingsSummary.map((h) => {
          const ref = buildHoldingRef({
            venue: h.venue,
            symbol: h.symbol,
            holding_type: h.holding_type,
          });
          const enabled = draft.toggleByScopeRef[ref] !== false;
          const weight = draft.weightOverrides[ref] ?? 0;
          const flagged = flaggedByRef.get(ref);
          const sharedSym = sharedSymbols.has(h.symbol);
          const otherVenuesForSym = sharedSym
            ? holdingsSummary
                .filter((x) => x.symbol === h.symbol && x.venue !== h.venue)
                .map((x) => x.venue)
            : [];
          return (
            <li
              key={ref}
              data-scope-ref={ref}
              className={`flex items-center justify-between gap-3 rounded-md border border-border p-3 ${
                enabled ? "" : "opacity-50 line-through"
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`Toggle ${h.symbol} on/off in scenario`}
                  onClick={() => onToggle(ref)}
                  className={`flex h-5 w-9 items-center rounded-full transition-colors ${
                    enabled ? "bg-accent" : "bg-border"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-4 w-4 rounded-full bg-white transition-transform ${
                      enabled ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
                <span className="font-mono text-sm text-text-primary">
                  {h.symbol}
                </span>
                <span className="text-xs text-text-muted">{h.venue}</span>
                {sharedSym && (
                  <span
                    className="text-[11px] text-warning"
                    title={`Returns merged with ${otherVenuesForSym.join(", ")} (symbol shared across venues)`}
                  >
                    Returns merged with {otherVenuesForSym.join(", ")} (symbol
                    shared across venues)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`weight-${ref}`}>
                  {h.symbol} weight
                </label>
                <input
                  id={`weight-${ref}`}
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={weight.toFixed(3)}
                  disabled={!enabled}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next)) onSetWeight(ref, next);
                  }}
                  className="w-20 rounded border border-border bg-surface px-2 py-1 text-right font-mono text-xs disabled:opacity-50"
                />
                {flagged && flagged.top_candidate_strategy_id && (
                  <button
                    type="button"
                    onClick={() =>
                      onCompare(ref, flagged.top_candidate_strategy_id)
                    }
                    className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:border-accent"
                  >
                    Compare →
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {draft.addedStrategies.length > 0 && (
          <li className="mt-2 px-1 text-xs uppercase tracking-wider text-text-muted">
            Strategies added · {draft.addedStrategies.length}
          </li>
        )}
        {draft.addedStrategies.map((a) => {
          const enabled = draft.toggleByScopeRef[a.id] !== false;
          const weight = draft.weightOverrides[a.id] ?? 0;
          return (
            <li
              key={a.id}
              data-scope-ref={a.id}
              className={`flex items-center justify-between gap-3 rounded-md border border-border p-3 ${
                enabled ? "" : "opacity-50 line-through"
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`Toggle ${a.name} on/off in scenario`}
                  onClick={() => onToggle(a.id)}
                  className={`flex h-5 w-9 items-center rounded-full transition-colors ${
                    enabled ? "bg-accent" : "bg-border"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-4 w-4 rounded-full bg-white transition-transform ${
                      enabled ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
                <span className="text-sm text-text-primary">{a.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`weight-${a.id}`}>
                  {a.name} weight
                </label>
                <input
                  id={`weight-${a.id}`}
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={weight.toFixed(3)}
                  disabled={!enabled}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next)) onSetWeight(a.id, next);
                  }}
                  className="w-20 rounded border border-border bg-surface px-2 py-1 text-right font-mono text-xs disabled:opacity-50"
                />
                <button
                  type="button"
                  aria-label="Remove from scenario"
                  onClick={() => onRemoveAdded(a.id)}
                  className="rounded-md border border-border px-2 py-1 text-xs text-text-muted hover:border-negative hover:text-negative"
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResetConfirmationModal — sub-component
// ---------------------------------------------------------------------------

interface ResetConfirmationModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

function ResetConfirmationModal({
  onConfirm,
  onCancel,
}: ResetConfirmationModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.32)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 480,
          maxWidth: "96vw",
          background: "var(--color-surface, white)",
          borderRadius: 8,
          padding: 24,
          boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
        }}
      >
        <h3
          id="reset-modal-title"
          className="text-lg font-semibold text-text-primary"
        >
          Discard your scenario draft?
        </h3>
        <p className="mt-2 text-sm text-text-secondary">
          This reinitializes the scenario from your current live holdings. Any
          toggled-off holdings, added strategies, and weight changes in the
          draft will be lost. This can&apos;t be undone.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:border-accent hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-negative px-4 py-1.5 text-sm font-medium text-white hover:bg-negative/90"
            style={{ background: "var(--color-negative, #DC2626)" }}
          >
            Discard draft
          </button>
        </div>
      </div>
    </div>
  );
}
