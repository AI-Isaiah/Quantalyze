"use client";

/**
 * Phase 10 Plan 06b — full Scenario tab body assembly.
 *
 * Composes Plan 06a's `useScenarioState` hook + `ScenarioFooter` with
 * the Wave 2-5 component primitives (KpiStrip mode=scenario, EquityChart
 * scenarioSeries, DrawdownChart scenarioDailyPoints, StrategyBrowseDrawer,
 * BridgeDrawer onAddToScenario, ScenarioFlaggedHoldingsList).
 *
 * Sections (top→bottom):
 *   1. Header — "Scenario" + subtitle
 *   2. Fingerprint-mismatch banner (when stored fingerprint != current)
 *   3. KpiStrip in mode="scenario" with scenarioMetrics + liveMetrics
 *   4. EquityChart + DrawdownChart with scenarioSeries / scenarioDailyPoints
 *   5. Bridge inline card (only when flaggedHoldings.length > 0) embedding
 *      ScenarioFlaggedHoldingsList — RESEARCH §Architecture decision
 *   6. CompositionList — read-only-tokens model: live holdings are FIXED
 *      context (symbol · venue · USD value, plus the multi-venue caveat and the
 *      Bridge "Compare →" deep-link); only ADDED strategies carry the
 *      interactive controls (toggle / weight / leverage / Remove). A commit
 *      therefore emits only voluntary_add — holdings produce no
 *      voluntary_remove / voluntary_modify decision.
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
import { collapseAliasedHoldingStrategies } from "@/lib/scenario-dealias";
import { useScenarioState } from "../hooks/useScenarioState";
import { buildStrategyForBuilderSet } from "../lib/scenario-adapter";
import {
  buildHoldingRef,
  type FlaggedHolding,
} from "../lib/holding-outcome-adapter";
import { KpiStrip } from "./KpiStrip";
import { EquityChart, toWealth } from "../widgets/performance/EquityChart";
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

/**
 * R4 — leverage v1 bounds. No shorting (L ≥ 0); a 10× ceiling keeps the
 * projection in a sane range. Module-scoped so the composer's fail-loud change
 * handler and the CompositionList input share a single source of truth.
 */
const MAX_LEVERAGE = 10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * retro audit (type-design-analyzer): ScenarioCommitDiff was a single
 * interface with every field optional, so the downstream
 * ScenarioCommitDrawer + RPC adapter had no compile-time guarantee that
 * a `voluntary_remove` diff carried `holding_ref` or that a
 * `voluntary_add` diff carried `strategy_id`. A discriminated union on
 * `kind` lets the consumer narrow exhaustively and surfaces missing-
 * field bugs at the type seam instead of at runtime.
 *
 * pr189-followup H5 (type-design-analyzer HIGH/9) — fields aligned to the
 * Zod wire contract at src/app/api/allocator/scenario/commit/route.ts so
 * a diff that type-checks client-side WILL pass server validation:
 *   - BridgeRecommendedDiff: holding_ref is REQUIRED (NOT NULL on the SQL
 *     side per migration 20260516160600).
 *   - VoluntaryModifyDiff: percent_allocated added as the canonical
 *     percent encoding alongside the legacy new_weight (Migration 128
 *     removed the SQL-side fallback; the route accepts either).
 *   - VoluntaryRemoveDiff: rejection_reason narrowed from `string?` to
 *     `RejectionReason` (the enum exported from @/lib/bridge-outcome-schema)
 *     so a non-enum value can't slip through the type seam.
 *   - effective_date added to all members (z.string().date().optional()).
 *   - note narrowed to `string | null | undefined` matching z.nullish().
 *
 * Optional fields (rejection_reason, percent_allocated, note) remain
 * optional because they are filled in by the drawer's per-row inputs
 * AFTER the diff is constructed; the composer hands the partial diff to
 * the drawer where the user completes it.
 */
import type { RejectionReason } from "@/lib/bridge-outcome-schema";

interface ScenarioCommitDiffBase {
  size_at_decision_usd: number;
  /** ISO date (YYYY-MM-DD). Optional — server defaults to now() when absent. */
  effective_date?: string;
  /** Optional free-text note (max 2000 chars). Per-row drawer input. */
  note?: string | null;
}

export interface VoluntaryRemoveDiff extends ScenarioCommitDiffBase {
  kind: "voluntary_remove";
  holding_ref: string;
  /** Required for voluntary_remove. Collected by ScenarioCommitDrawer. */
  rejection_reason?: RejectionReason;
}

export interface VoluntaryAddDiff extends ScenarioCommitDiffBase {
  kind: "voluntary_add";
  strategy_id: string;
  /** Required for voluntary_add (0..100). Collected by ScenarioCommitDrawer. */
  percent_allocated?: number;
}

export interface VoluntaryModifyDiff extends ScenarioCommitDiffBase {
  kind: "voluntary_modify";
  holding_ref: string;
  /** Legacy 0..1 fraction. Server-side accepts either this OR percent_allocated. */
  new_weight?: number;
  /** Canonical 0..100 percent. Post-Migration-128 the RPC reads ONLY this field;
   *  the route imperatively normalises new_weight → percent_allocated when needed. */
  percent_allocated?: number;
}

export interface BridgeRecommendedDiff extends ScenarioCommitDiffBase {
  kind: "bridge_recommended";
  /** REQUIRED — the holding being substituted out. NOT NULL on the SQL side
   *  per migration 20260516160600; without it the route rejects with 400. */
  holding_ref: string;
  strategy_id: string;
  /** Required for bridge_recommended (0..100). Collected by ScenarioCommitDrawer. */
  percent_allocated?: number;
}

export type ScenarioCommitDiff =
  | VoluntaryRemoveDiff
  | VoluntaryAddDiff
  | VoluntaryModifyDiff
  | BridgeRecommendedDiff;

/**
 * pr189-followup H6 (type-design-analyzer HIGH/8) — narrower union for the
 * composer→drawer hand-off. The wider four-arm `ScenarioCommitDiff` is the WIRE
 * contract for the server, not the producer contract for the composer.
 *
 * Read-only-tokens model: live holdings are FIXED context — they cannot be
 * toggled off or reweighted — so the composer no longer emits voluntary_remove
 * or voluntary_modify. The ONLY diff `handleCommit` produces is voluntary_add
 * (for an added strategy). (Prior revisions produced voluntary_remove on a
 * holding toggle-off and voluntary_modify on a holding reweight; both controls
 * were removed with the per-token UI.)
 *
 * The drawer still consumes the full `ScenarioCommitDiff[]` because it has to
 * render and submit any kind (including future kinds wired by other producers).
 * The seam is producer-side narrowness, not consumer-side narrowness.
 */
export type ComposerProducedDiff = VoluntaryAddDiff;

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
 *
 * NEW-C18-09 (B1, audit-2026-05-07): `equity_curve` is left EMPTY here on
 * purpose. The producer convention for `ComputedMetrics.equity_curve` is
 * cumulative-RETURN form (0.18 = +18%), but `baseline.equity` is already
 * in cumulative-WEALTH form (the SSR producer converted via `value + 1`).
 * Stuffing the wealth-form array into the return-form field would silently
 * mis-scale any future chart that reads `ComputedMetrics.equity_curve`
 * directly. The chart pipeline already consumes `scenarioWealthSeries`
 * (composer-level, post-`toWealth()`) separately, so this field is dead
 * weight on the live-baseline path — better empty than mis-typed.
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
    equity_curve: [],
    effective_start: baseline.equity[0]?.date ?? null,
    effective_end: baseline.equity[baseline.equity.length - 1]?.date ?? null,
  };
}

/** Read-only-tokens model: live holdings display their USD value (no editable
 *  weight). Whole-dollar USD; a non-finite value (sold-down / coingecko_fallback
 *  rows can surface null) renders an em dash rather than "$NaN". */
function formatUsd0(n: number): string {
  return Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })
    : "—";
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
    lastSyncAt,
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
  // B11 / NEW-C18-10: the holdings fingerprint the committed diffs were built
  // against, FROZEN at handleCommit time alongside commitDiffs. Sent to the
  // server so the RPC rejects (409) if the portfolio changed between drawer-
  // open and submit. Frozen (not read live at submit time): if holdings change
  // during drawer-dwell the draft rebases to the new shape, so a live read
  // would send the CURRENT fingerprint and the stale diffs would pass — the
  // whole hole this closes. The at-build-time shape is what makes the server
  // reject the stale commit.
  const [commitFingerprint, setCommitFingerprint] = useState<string | null>(
    null,
  );
  // Inline error surfaced for two distinct rejection paths:
  //   (a) the commit pipeline refuses to open — either scenarioAum<=0 with
  //       voluntary_adds present (division-by-zero downstream in the daily
  //       delta cron), or any computed size_at_decision_usd lands non-finite
  //   (b) the weight input received a non-finite value (Infinity, NaN from
  //       a paste). Controlled inputs don't auto-snap-back when the change
  //       handler short-circuits, so a silent drop leaves the user with a
  //       displayed value that doesn't match underlying state.
  const [commitError, setCommitError] = useState<string | null>(null);

  // R4 — per-strategy leverage multipliers (ref → L). Ephemeral exploration
  // state: NOT persisted to the draft and NOT part of the commit diff. Leverage
  // is a what-if overlay on the projection, so it resets on reload and is never
  // recorded as a mandate decision (default 1.0 when a ref is absent).
  // ponytail: ephemeral useState; promote to the persisted draft only if
  // allocators ask for leverage to survive a reload.
  const [leverageByRef, setLeverageByRef] = useState<Record<string, number>>({});

  function handleWeightChange(scopeRef: string, weight: number) {
    if (!Number.isFinite(weight)) {
      // F-08: log non-finite weight so a regression (broken input component,
      // computation producing NaN/Infinity) is visible in production console
      // rather than silently swallowed.
      console.warn("[ScenarioComposer] handleWeightChange received non-finite weight", { scopeRef, weight });
      setCommitError(
        "Invalid weight — enter a value between 0 and 1. The previous value was kept.",
      );
      return;
    }
    // NEW-C18-07: surface an explicit error when the user enters a value >1
    // (e.g. via paste). The state layer (setWeightOverride → clampWeight) silently
    // clamps to 1, so without this check a weight of 1.5 appears to commit at 100%
    // AUM with no feedback. Showing the error makes the clamping visible and
    // consistent with the non-finite path above. The value is still forwarded so
    // the input snaps to the clamped value instead of freezing.
    if (weight > 1) {
      setCommitError(
        "Weight clamped to 1 — the maximum allocation is 100% of portfolio AUM.",
      );
    } else {
      // IMP-3: unconditionally clear any stale clamp-error on in-range weights
      // (including weight === 1). The `else if (commitError)` pattern was
      // insufficient: after a >1 paste the state layer clamps to 1.0, triggering
      // another handleWeightChange(ref, 1.0) — weight > 1 is false, but the stale
      // "clamped" error message would persist until the next input event.
      setCommitError(null);
    }
    scenario.setWeightOverride(scopeRef, weight);
  }

  // R4 — leverage input change handler. Mirrors handleWeightChange's fail-loud
  // contract: a non-finite paste is rejected (the prior value is kept), and an
  // out-of-range value is clamped to [0, MAX_LEVERAGE] with a visible message so
  // the clamp is never silent. A value of exactly 1 IS stored (not treated as
  // absent) so the controlled input stays in sync after a clamp.
  function handleLeverageChange(scopeRef: string, leverage: number) {
    if (!Number.isFinite(leverage)) {
      console.warn(
        "[ScenarioComposer] handleLeverageChange received non-finite leverage",
        { scopeRef, leverage },
      );
      setCommitError(
        `Invalid leverage — enter a number between 0 and ${MAX_LEVERAGE}. The previous value was kept.`,
      );
      return;
    }
    if (leverage < 0) {
      setCommitError(
        "Leverage can't be negative — shorting isn't modeled in this projection. Clamped to 0.",
      );
    } else if (leverage > MAX_LEVERAGE) {
      setCommitError(`Leverage clamped to ${MAX_LEVERAGE}× — the maximum modeled leverage.`);
    } else {
      setCommitError(null);
    }
    const clamped = Math.min(MAX_LEVERAGE, Math.max(0, leverage));
    setLeverageByRef((prev) => ({ ...prev, [scopeRef]: clamped }));
  }

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
  // M-0100: index the catalog by strategy id ONCE so the two added-strategy
  // lookups below do O(1) Map.get per added strategy instead of an O(M)
  // `strategies.find(...)` over the full SSR-lifted catalog (the twin loops
  // were O(K·M) per run, re-scanning the whole catalog on every draft change).
  const strategyById = useMemo(
    () => new Map(strategies.map((s) => [s.strategy.id, s])),
    [strategies],
  );

  const addedStrategyReturnsLookup = useMemo<Record<string, DailyPoint[]>>(
    () => {
      const map: Record<string, DailyPoint[]> = {};
      for (const a of scenario.draft.addedStrategies) {
        const found = strategyById.get(a.id);
        const raw = found?.strategy.strategy_analytics?.daily_returns;
        // Runtime defensiveness: only accept a DailyPoint[]-shaped array.
        const arr = Array.isArray(raw) ? (raw as unknown as DailyPoint[]) : [];
        map[a.id] = arr;
      }
      return map;
    },
    [scenario.draft.addedStrategies, strategyById],
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
      const found = strategyById.get(a.id);
      if (found) {
        map[a.id] = {
          disclosure_tier: found.strategy.disclosure_tier,
          cagr: found.strategy.strategy_analytics?.cagr ?? null,
          sharpe: found.strategy.strategy_analytics?.sharpe ?? null,
        };
      }
    }
    return map;
  }, [scenario.draft.addedStrategies, strategyById]);

  // -------------------------------------------------------------------------
  // Build scenario projection via adapter + frozen scenario.ts engine
  // (B4-pinned positional signature).
  // -------------------------------------------------------------------------
  // Read-only-tokens model: live holdings are FIXED context — there is no
  // per-holding toggle in the UI, so in a current-schema (v2) draft a holding is
  // never disabled. Legacy v1 drafts that disabled a holding are dropped on load
  // by the SCENARIO_SCHEMA_VERSION bump, not papered over here — so this set is
  // genuinely always empty (the adapter path stays neutral too).
  // ponytail: empty set, not a derived memo — holdings are never disabled here.
  const disabledHoldingRefs = useMemo(() => new Set<string>(), []);

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

  // H-0487/H-0493 — map each holding scopeRef to its bare symbol so aliased
  // multi-venue/instrument holdings (identical symbol-keyed series) can be
  // collapsed before computeScenario, keeping avg_pairwise_correlation honest.
  const symbolByHoldingId = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of holdingsSummary as Array<{
      venue: string;
      symbol: string;
      holding_type: "spot" | "derivative";
    }>) {
      map.set(buildHoldingRef(h), h.symbol);
    }
    return map;
  }, [holdingsSummary]);

  // -------------------------------------------------------------------------
  // H-0133 — wire the draft's weight + toggle state INTO the projection.
  // The adapter computes value-proportional default weights and marks every
  // added strategy weight 0 / selected=true; the user's slider edits live in
  // `scenario.draft.weightOverrides` and only ever reached the COMMIT diff, so
  // "the slider did not move the projection" (reweighting silently no-op'd).
  // Overlay the draft state — the canonical sum-to-1 map the CompositionList
  // input already DISPLAYS — onto the adapter strategies BEFORE the collapse so
  // computeScenario reflects exactly what the UI shows. `selected` reads the
  // toggle map for ALL refs; in the read-only-tokens model holdings have no
  // toggle UI, so a current-schema (v2) draft never carries a disabled holding
  // (legacy v1 drafts that did are dropped on load by the SCENARIO_SCHEMA_VERSION
  // bump) — a holding therefore resolves selected=true, and only ADDED strategies
  // can be toggled off, which now actually excludes them (they carry a real weight
  // post-fix). R4 leverage rides the SAME projection state; holdings have no
  // leverage UI so their multiplier is always 1, while an added strategy's
  // multiplier flows through here. The collapse weight-averages leverage across
  // aliased venues and computeScenario applies `wᵢ·Lᵢ·rᵢ`.
  const projectionState = useMemo(() => {
    const selected: Record<string, boolean> = {};
    const weights: Record<string, number> = {};
    const leverage: Record<string, number> = {};
    for (const s of adapterOutput.strategies) {
      const toggle = scenario.draft.toggleByScopeRef[s.id];
      selected[s.id] =
        toggle === undefined ? (adapterOutput.state.selected[s.id] ?? true) : toggle;
      const ov = scenario.draft.weightOverrides[s.id];
      weights[s.id] = Number.isFinite(ov)
        ? (ov as number)
        : (adapterOutput.state.weights[s.id] ?? 0);
      const L = leverageByRef[s.id];
      leverage[s.id] = Number.isFinite(L) ? (L as number) : 1;
    }
    return { selected, weights, startDates: adapterOutput.state.startDates, leverage };
  }, [
    adapterOutput,
    scenario.draft.toggleByScopeRef,
    scenario.draft.weightOverrides,
    leverageByRef,
  ]);

  // M-0102: hoist the de-alias collapse and the per-strategy date→index cache
  // into their own memos. Previously buildDateMapCache ran inside the
  // scenarioMetrics body, rebuilding the cache on every recompute. Each memo is
  // keyed on the exact value it derives from, so the cache can never go stale
  // relative to the strategies computeScenario receives (worst case it rebuilds
  // as often as before; it never returns a cache mismatched to its strategies).
  const deAliased = useMemo(
    () =>
      collapseAliasedHoldingStrategies(
        adapterOutput.strategies,
        projectionState,
        symbolByHoldingId,
      ),
    [adapterOutput.strategies, projectionState, symbolByHoldingId],
  );
  const dateMapCache = useMemo(
    () => buildDateMapCache(deAliased.strategies),
    [deAliased],
  );
  const scenarioMetrics = useMemo(
    () => computeScenario(deAliased.strategies, deAliased.state, dateMapCache),
    [deAliased, dateMapCache],
  );

  // R4 — show the leverage caveat only when a non-default multiplier ACTUALLY
  // moves the projection: derive it from `projectionState` (the state fed to the
  // collapse + computeScenario) rather than the raw `leverageByRef`, so a stale
  // multiplier on a row that is toggled off or carries zero weight — which
  // contributes nothing to the curve — never surfaces a misleading caveat.
  const leverageApplied = Object.entries(projectionState.leverage).some(
    ([id, L]) =>
      Number.isFinite(L) &&
      L !== 1 &&
      projectionState.selected[id] === true &&
      (projectionState.weights[id] ?? 0) > 0,
  );

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
  //
  // NEW-C04-03: use toWealth() to produce a WealthPoint[] so the branded
  // type propagates to EquityChart.scenarioSeries, preventing raw
  // RETURN-form arrays from compiling at that boundary.
  // -------------------------------------------------------------------------
  const scenarioWealthSeries = useMemo(
    () =>
      toWealth(
        scenarioMetrics.equity_curve.map((p) => ({
          date: p.date,
          value: p.value + 1,
        })),
      ),
    [scenarioMetrics.equity_curve],
  );

  // audit-2026-05-07 H-0105 c9 performance — the previous body called
  // `holdingsSummary.find(x => buildHoldingRef({…}) === scopeRef)` inside
  // the outer loop, giving O(N²) string-formatting + Array.prototype.find
  // per render. Every toggle keystroke and every server-action parent
  // re-render (which produces a new `holdingsSummary` array reference)
  // busted the memo and re-ran the quadratic loop. Pre-build a
  // `Map<scopeRef, holding>` once per holdingsSummary so the lookup is
  // O(1) — same pattern as `flaggedByRef` (L863) and the
  // ScenarioCommitDrawer adapter Maps. The memo deps are unchanged.
  //
  // retro audit (red-team L9 c7): split into TWO memos so the O(N)
  // Map-build only re-runs when `holdingsSummary` reference identity
  // actually changes, while the cheap sum-loop re-runs on the much more
  // frequent toggleByScopeRef change. Pre-fix, both deps shared one
  // memo and the parent-rerender pattern (where holdingsSummary is a
  // new reference on every server-action settle) defeated the memo on
  // the hot path. Two memos > one big memo when the deps have different
  // cardinalities.
  const holdingByRef = useMemo(() => {
    const byRef = new Map<string, (typeof holdingsSummary)[number]>();
    for (const x of holdingsSummary) {
      byRef.set(
        buildHoldingRef({
          venue: x.venue,
          symbol: x.symbol,
          holding_type: x.holding_type,
        }),
        x,
      );
    }
    return byRef;
  }, [holdingsSummary]);
  const scenarioAum = useMemo(() => {
    let sum = 0;
    for (const [scopeRef, on] of Object.entries(scenario.draft.toggleByScopeRef)) {
      if (!on) continue;
      if (!scopeRef.startsWith("holding:")) continue;
      const h = holdingByRef.get(scopeRef);
      if (h) sum += h.value_usd;
    }
    return sum;
  }, [scenario.draft.toggleByScopeRef, holdingByRef]);

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
  // Build commit diffs and route to the ScenarioCommitDrawer (Plan 07).
  // -------------------------------------------------------------------------
  function handleCommit() {
    // Read-only-tokens model: live holdings are FIXED context — they cannot be
    // toggled off or reweighted in the UI, so they never produce a
    // voluntary_remove or voluntary_modify decision. (Adding a strategy still
    // renormalizes holding weights for the blend, but that dilution is a
    // mechanical consequence of the add, not a holding decision the allocator
    // made.) The only committable decision is adding a strategy → voluntary_add.
    const diffs: ComposerProducedDiff[] = [];

    // Refuse the commit when scenarioAum<=0 with voluntary_adds present:
    // every add row would land with size_at_decision_usd:0 and the
    // downstream daily-delta cron divides realized PnL by that size →
    // division-by-zero. The setWeightOverride clamp + this gate together
    // guarantee a finite, non-negative product below.
    const hasVoluntaryAdds = scenario.draft.addedStrategies.length > 0;
    if (hasVoluntaryAdds && (!Number.isFinite(scenarioAum) || scenarioAum <= 0)) {
      setCommitError(
        "Can't record a scenario commit: portfolio AUM is zero. Connect an exchange API key or toggle on a live holding before submitting.",
      );
      return;
    }

    for (const a of scenario.draft.addedStrategies) {
      const weight = scenario.draft.weightOverrides[a.id] ?? 0;
      // NEW-C18-05: per-row size gate — reject a voluntary_add whose computed
      // size is zero or non-finite. The existing scenarioAum>0 guard prevents
      // division-by-zero in the cron, but a weight=0 add still lands with
      // size:0. Gate on the product to close that specific gap.
      const size = weight * scenarioAum;
      if (!Number.isFinite(size) || size <= 0) {
        setCommitError(
          `Can't record a scenario commit: strategy "${a.name}" has a zero allocation size. Set a non-zero weight before submitting.`,
        );
        return;
      }
      diffs.push({
        kind: "voluntary_add",
        strategy_id: a.id,
        size_at_decision_usd: size,
      });
    }

    // NEW-C18-13: guard empty diff set — nothing to commit.
    // F-01: replace the silent return with a user-facing error. A zero-diff
    // commit can happen legitimately (e.g. all weight changes within epsilon),
    // but if scenario.diffCount > 0 the footer reported pending changes that
    // handleCommit computed as empty — that specific case is a data-model
    // inconsistency worth surfacing to the user.
    if (diffs.length === 0) {
      setCommitError(
        "Nothing to commit — add a strategy to record a scenario change. (If a stale draft is stuck, use Reset to start from your current holdings.)",
      );
      return;
    }

    // Review-pass P2 fix — single-source the commit-drawer surface. When
    // `useInternalCommitDrawer === true` (default) the composer owns the
    // drawer and SUPPRESSES the legacy onCommitRequested callback so a
    // host that wires onCommitRequested to also open a modal cannot stack
    // two confirmation surfaces on top of each other. When `false`, the
    // host is signalling "I own the commit UI" — fire onCommitRequested
    // and skip opening the internal drawer.
    setCommitError(null);
    setCommitDiffs(diffs);
    // B11 / NEW-C18-10: freeze the draft's holdings fingerprint with the diffs.
    // scenario.draft is the working draft the diffs were derived from; its
    // init_holdings_fingerprint identifies the holdings shape those diffs
    // correspond to. Capturing it HERE (not at POST time) is load-bearing — a
    // holdings refresh during drawer-dwell must not retroactively make the
    // stale commit look current.
    setCommitFingerprint(scenario.draft.init_holdings_fingerprint);
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
          id="scenario-fingerprint-mismatch-banner"
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

      {leverageApplied && (
        <p
          data-testid="scenario-leverage-caveat"
          className="mt-2 text-[11px] text-text-muted"
        >
          Leverage modeled as daily-return scaling; excludes borrow / funding
          cost. The correlation matrix is leverage-invariant; risk-adjusted
          ratios (Sharpe, Sortino) shift when you lever individual legs, since
          per-leg leverage re-tilts the blend. This is an exploration-only
          what-if overlay; it is not recorded when you commit this scenario.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* B14 / NEW-C09-04 (H-1226): the Scenario-tab chart renders the inner
            header (no `hideHeader`), so plumb the real sync state. Without it
            the header stamp showed "sync just now" / "no sync yet" to a synced
            allocator — a lie. `stale`/`lastSyncAt` come from the live baseline
            the scenario projects from. */}
        <EquityChart
          equityDailyPoints={equityDailyPoints}
          scenarioSeries={scenarioWealthSeries}
          stale={allKeysStale}
          lastSyncAt={lastSyncAt}
        />
        <div className="h-[300px] relative">
          {/* DrawdownChart extends WidgetProps (data + timeframe + width + height
              required for the legacy widget-grid path). On the Scenario tab
              we feed the f7 parallel-prop (`equityDailyPoints`) so the
              widget-data fields default to empty / safe values. */}
          <DrawdownChart
            data={{}}
            timeframe="ALL"
            width={6}
            height={4}
            equityDailyPoints={equityDailyPoints}
            scenarioDailyPoints={scenarioDailyPointsForDrawdown}
          />
          {/* NEW-C18-14: when scenarioAum=0 the drawdown is scaled against a
              synthetic $1 baseline so the chart still renders the projected
              SHAPE rather than a flat zero. Disclose this to the allocator so
              they don't mistake an illustrative curve for one backed by real
              capital. */}
          {scenarioAum <= 0 && (
            <div
              aria-live="polite"
              className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[11px] text-text-muted"
            >
              Illustrative shape only — no live capital connected
            </div>
          )}
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
        onSetWeight={handleWeightChange}
        leverageByRef={leverageByRef}
        onSetLeverage={handleLeverageChange}
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

      {commitError && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="scenario-commit-error"
          className="mt-4 rounded-md border border-negative bg-[rgba(220,38,38,0.05)] p-3 text-sm text-negative"
        >
          {commitError}
        </div>
      )}

      <ScenarioFooter
        diffCount={scenario.diffCount}
        deltaSummary={deltaSummary}
        onResetRequested={() => setResetModalOpen(true)}
        onCommitRequested={handleCommit}
        // NEW-C18-10: block commit while a fingerprint mismatch is unresolved.
        // The user has been shown a banner and must choose Reset or Keep before
        // committing against a potentially stale snapshot.
        commitBlocked={scenario.fingerprintMismatch}
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
        scenarioAum={scenarioAum}
        // B11 / NEW-C18-10: the holdings fingerprint frozen with these diffs.
        initHoldingsFingerprint={commitFingerprint}
        onSubmitSuccess={() => {
          // NEW-C18-13: clear stale commitDiffs so a subsequent drawer open
          // does not re-submit already-committed rows under a fresh key.
          setCommitDiffs([]);
          // B11 / NEW-C18-10: clear the frozen fingerprint alongside the diffs.
          setCommitFingerprint(null);
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
  /** R4 — ref → leverage multiplier (default 1.0 when absent). */
  leverageByRef: Record<string, number>;
  onSetLeverage: (scopeRef: string, leverage: number) => void;
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
  leverageByRef,
  onSetLeverage,
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

  // M-0101: precompute symbol → venues ONCE so each row's "merged across
  // venues" note is an O(1) Map.get + a tiny same-symbol filter, instead of an
  // O(N) holdingsSummary.filter scan per row (O(N²) across the list). The
  // venue list preserves holdingsSummary order so the rendered join is byte-
  // identical to the previous filter().map().
  const venuesBySymbol = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const h of holdingsSummary) {
      const list = map.get(h.symbol);
      if (list) list.push(h.venue);
      else map.set(h.symbol, [h.venue]);
    }
    return map;
  }, [holdingsSummary]);

  return (
    <div className="mt-8 rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 text-base font-semibold text-text-primary">
        Composition
      </div>
      <ul className="grid gap-2">
        {/* Read-only-tokens model: live holdings are FIXED context. They render
            read-only (symbol · venue · USD value) with no toggle / weight /
            leverage — those controls live only on the added-strategy rows below.
            The multi-venue caveat and the Bridge "Compare →" deep-link stay
            because both are read-only affordances. */}
        {holdingsSummary.map((h) => {
          const ref = buildHoldingRef({
            venue: h.venue,
            symbol: h.symbol,
            holding_type: h.holding_type,
          });
          const flagged = flaggedByRef.get(ref);
          const sharedSym = sharedSymbols.has(h.symbol);
          const otherVenuesForSym = sharedSym
            ? (venuesBySymbol.get(h.symbol) ?? []).filter(
                (v) => v !== h.venue,
              )
            : [];
          return (
            <li
              key={ref}
              data-scope-ref={ref}
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
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
                <span className="font-mono text-xs text-text-secondary">
                  {formatUsd0(h.value_usd)}
                </span>
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
                  onChange={(e) => onSetWeight(a.id, Number(e.target.value))}
                  className="w-20 rounded border border-border bg-surface px-2 py-1 text-right font-mono text-xs disabled:opacity-50"
                />
                <label className="sr-only" htmlFor={`leverage-${a.id}`}>
                  {a.name} leverage
                </label>
                <input
                  id={`leverage-${a.id}`}
                  type="number"
                  step="0.1"
                  min="0"
                  max={MAX_LEVERAGE}
                  value={(leverageByRef[a.id] ?? 1).toString()}
                  disabled={!enabled}
                  title="Leverage multiplier (1× = unlevered; excludes borrow cost)"
                  aria-label={`${a.name} leverage multiplier`}
                  onChange={(e) => onSetLeverage(a.id, Number(e.target.value))}
                  className="w-16 rounded border border-border bg-surface px-2 py-1 text-right font-mono text-xs disabled:opacity-50"
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
          added strategies and their weight / leverage changes in the draft will
          be lost. This can&apos;t be undone.
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
