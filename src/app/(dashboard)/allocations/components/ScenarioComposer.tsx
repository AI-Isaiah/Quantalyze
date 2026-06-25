"use client";

/**
 * Phase 10 Plan 06b — full Scenario tab body assembly.
 *
 * Composes Plan 06a's `useScenarioState` hook + `ScenarioFooter` with
 * the Wave 2-5 component primitives (KpiStrip mode=scenario,
 * ScenarioFactsheetChart fed the scenario wealth series, StrategyBrowseDrawer,
 * BridgeDrawer onAddToScenario, ScenarioFlaggedHoldingsList). Phase 38-03
 * swapped the legacy EquityChart + DrawdownChart render to the
 * factsheet-backed ScenarioFactsheetChart (PARITY-01).
 *
 * Sections (top→bottom):
 *   1. Header — "Scenario" + subtitle
 *   2. Fingerprint-mismatch banner (when stored fingerprint != current)
 *   3. KpiStrip in mode="scenario" with scenarioMetrics + liveMetrics
 *   4. ScenarioFactsheetChart (factsheet-engine equity + drawdown) fed the
 *      scenario wealth series — Phase 38-03 (was EquityChart + DrawdownChart)
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
 * at 1.0) via `toWealth` before passing it to ScenarioFactsheetChart, which
 * derives the drawdown series internally from that wealth curve (the prior
 * USD-scale-for-DrawdownChart step was dropped in Phase 38-03).
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  buildDateMapCache,
  computeScenario,
  computeStrategyCurve,
  type ComputedMetrics,
  type DailyPoint,
  type StrategyForBuilder,
} from "@/lib/scenario";
import { collapseAliasedHoldingStrategies } from "@/lib/scenario-dealias";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import { buildBlendPanels } from "@/lib/scenario-blend-panels";
import { CorrelationHeatmap } from "@/components/portfolio/CorrelationHeatmap";
import { ReturnHistogram } from "@/components/charts/ReturnHistogram";
import { ReturnQuantiles } from "@/components/charts/ReturnQuantiles";
import { RollingMetrics } from "@/components/charts/RollingMetrics";
import { RollingVolatilityChart } from "@/components/charts/RollingVolatilityChart";
import { RollingSortinoChart } from "@/components/charts/RollingSortinoChart";
import { SegmentedControl } from "@/components/strategy-v2/SegmentedControl";
import { PartialDataBanner } from "@/components/strategy-v2/PartialDataBanner";
import { Card } from "@/components/ui/Card";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { EmptyStateCard } from "@/components/ui/EmptyStateCard";
import { methodologyLine, shortestHistoryName } from "@/lib/scenario-history";
import { Button } from "@/components/ui/Button";
import {
  defaultDraftFromHoldings,
  scenarioDraftCodec,
  type AddedStrategy,
} from "../lib/scenario-state";
import { useScenarioState } from "../hooks/useScenarioState";
import {
  buildStrategyForBuilderSet,
  buildPerKeyStrategyForBuilderSet,
} from "../lib/scenario-adapter";
import {
  buildHoldingRef,
  type FlaggedHolding,
} from "../lib/holding-outcome-adapter";
import { KpiStrip } from "./KpiStrip";
// `toWealth` stays (the scenario wealth series builder, imported from
// ../widgets/performance/EquityChart); EquityChart +
// DrawdownChart are no longer rendered here — Phase 38-03 swaps the composer's
// two chart call sites to the factsheet-backed ScenarioFactsheetChart (PARITY-01).
// The Overview EquityChartWidget keeps the legacy EquityChart render (out of scope).
import { toWealth } from "../widgets/performance/EquityChart";
import { ScenarioFactsheetChart } from "../widgets/performance/ScenarioFactsheetChart";
import { StrategyBrowseDrawer } from "./StrategyBrowseDrawer";
import { BridgeDrawer } from "./BridgeDrawer";
import { ScenarioCommitDrawer } from "./ScenarioCommitDrawer";
import { ScenarioFooter } from "./ScenarioFooter";
import { ScenarioFlaggedHoldingsList } from "../ScenarioFlaggedHoldingsList";
import { ScenarioBenchmarkSection } from "./ScenarioBenchmarkSection";
import { StressVarSection } from "./StressVarSection";
import { MonteCarloSection } from "./MonteCarloSection";
import { WeightOptimizerSection } from "./WeightOptimizerSection";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import type { AllocatorMandateForFit } from "../lib/mandate-fit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * R4 — leverage v1 bounds. No shorting (L ≥ 0); a 10× ceiling keeps the
 * projection in a sane range. Module-scoped so the composer's fail-loud change
 * handler and the CompositionList input share a single source of truth.
 */
const MAX_LEVERAGE = 10;

/**
 * GRAPH-03 — single source of truth for the rolling-window set: maps each
 * trading-day window length (63/126/252) to its human label. Drives BOTH the
 * SegmentedControl options and the below-floor empty-banner copy ("…for the
 * {label} rolling window."), so the window set and its labels can never drift
 * between the two. The window itself stays the trading-day count everywhere
 * the math runs.
 */
const WINDOW_LABEL: Record<number, string> = {
  63: "3M",
  126: "6M",
  252: "12M",
};

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

/**
 * Phase 23 / PERSIST-02 — a saved-scenario row as it arrives from the
 * `/api/allocator/scenario/saved` list / DB row. The `draft` is the persisted
 * JSONB blob; the composer decodes it through `scenarioDraftCodec` (never a
 * bare cast — M-0153) before hydrating, so an older-format (`reset`) blob shows
 * an honest notice and a newer-version (`readonly`) blob blocks edits.
 */
export interface SavedScenarioRow {
  id: string;
  name: string;
  /** The persisted draft JSONB. Decoded through the codec, NOT cast. */
  draft: unknown;
}

export interface ScenarioComposerProps {
  payload: MyAllocationDashboardPayload;
  allocatorId: string;
  allocatorMandate: AllocatorMandateForFit | null;
  /**
   * Phase 23 / PERSIST-02 — the saved-scenarios list (a later plan) registers
   * to receive the composer's imperative Open handler. Calling it with a saved
   * row decodes the row's draft through the codec trichotomy and hydrates
   * (ok / readonly) or shows an honest notice (reset). Optional — when absent
   * the composer simply never receives an Open request.
   */
  onRegisterOpen?: (open: (row: SavedScenarioRow) => void) => void;
  /**
   * Phase 23 / PERSIST-03 — fired after a scenario Save (POST) or Update (PUT)
   * succeeds, so a host that renders the saved-scenarios list (Plan 05) can
   * refetch and stay consistent. Optional — absent hosts simply don't refetch.
   */
  onScenarioSaved?: () => void;
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
  baseline: MyAllocationDashboardPayload["liveBaselineMetrics"] | null | undefined,
): ComputedMetrics {
  // WR-05 (Phase 21 review): the type says liveBaselineMetrics is non-optional,
  // but this component receives `payload` prop-drilled across a "use client"
  // boundary + a runtime cast (see the `payload as ...` coercion below), so a
  // stale client cache or a partial SSR payload could omit it or send a null
  // equity array. Defensively default to an empty-but-valid ComputedMetrics so
  // a missing baseline degrades (empty strip + delta) instead of throwing
  // `Cannot read properties of undefined` and crashing the whole Scenario tab.
  const eq = baseline?.equity ?? [];
  return {
    n: eq.length,
    twr: baseline?.ytdTwr ?? null,
    cagr: null,
    volatility: null,
    sharpe: baseline?.sharpe ?? null,
    sortino: null,
    max_drawdown: baseline?.maxDd ?? null,
    max_dd_days: null,
    correlation_matrix: null,
    avg_pairwise_correlation: baseline?.avgRho ?? null,
    equity_curve: [],
    effective_start: eq[0]?.date ?? null,
    effective_end: eq[eq.length - 1]?.date ?? null,
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

/**
 * WR-05 (Phase 29 review) — book-returns boundary normalizer.
 *
 * `StrategyAnalytics.daily_returns` is TYPED as a year-keyed nested record
 * (`Record<string, Record<string, number>>`, types.ts:304) but the runtime
 * payload from queries.ts SOMETIMES surfaces it as a flat `DailyPoint[]`. A bare
 * `raw as unknown as DailyPoint[]` cast silently dropped the nested shape to
 * `[]` (the book strategy's REAL returns warm-up-gated out of the projection,
 * no signal). Delegate to the CANONICAL `normalizeDailyReturns` so this book
 * trust boundary and the lazy `/api/strategies/[id]/returns` route boundary
 * parse the column through ONE tested parser and cannot drift — it handles
 * array + flat-dict + nested year-record (reconstructing `YYYY-MM-DD` from
 * `MM-DD` inner keys, which a hand-rolled `Object.values` flatten dropped the
 * year off of), validates every point, and date-sorts.
 *
 * Returns the normalized `DailyPoint[]`, or `null` ONLY when `raw` is absent —
 * the caller's `?? lazy ?? []` chain depends on `null` (NOT `[]`, which would
 * short-circuit `??`) to fall through to the lazily-fetched series.
 */
function normalizeBookReturns(raw: unknown): DailyPoint[] | null {
  if (raw == null) return null;
  const normalized = normalizeDailyReturns(raw);
  // Fail-loud (Rule 12): a NON-array raw that yields zero usable points is a
  // genuine shape regression (a primitive, or an object with no finite
  // returns) — surface it instead of silently feeding [] into the projection.
  // An empty/short array is a legitimate "no data yet", so it stays quiet.
  if (normalized.length === 0 && !Array.isArray(raw)) {
    console.warn(
      "[ScenarioComposer] book daily_returns has an unexpected shape; degraded to [] (WR-05)",
      { rawType: typeof raw },
    );
  }
  return normalized;
}

/**
 * DSRC-02 (D2) — per-holding equity contribution, the per-key WEIGHT source.
 *
 * Mirrors the SSR `holdingEquityContribution` (queries.ts:2113) EXACTLY:
 *   - derivative → `unrealized_pnl_usd` (the actual equity at stake; `value_usd`
 *     is the leveraged NOTIONAL contract size, which would inflate the weight by
 *     the leverage factor), null/non-finite → 0.
 *   - spot       → `value_usd` (marked fair value = the equity contribution),
 *     non-finite → 0.
 *
 * Duplicated locally rather than imported: `@/lib/queries` is `server-only`, so
 * importing its export into this "use client" module crosses the client/server
 * boundary (and the per-key adapter sibling already duplicates the per-key loop
 * locally for the same reason — PATTERNS §"No Analog Found"). Keep this in
 * lockstep with the SSR helper so the client weight matches the server's.
 */
function holdingEquityContributionLocal(
  h: MyAllocationDashboardPayload["holdingsSummary"][number],
): number {
  if (h.holding_type === "derivative") {
    const pnl = h.unrealized_pnl_usd ?? 0;
    return Number.isFinite(pnl) ? pnl : 0;
  }
  return Number.isFinite(h.value_usd) ? h.value_usd : 0;
}

/**
 * DSRC-02 — exchange display-name lookup for the Data-sources row labels.
 *
 * Copied locally from the SyncBadge recipe (SyncBadge.tsx:21-35): a lower-cased
 * lookup with `?? exchange` fallback. The shared `EXCHANGE_DISPLAY`
 * (closed-sets.ts) carries identical values but is typed
 * `Record<SupportedExchange, string>` — a CLOSED key union — so it cannot be
 * indexed by the arbitrary `string` exchange code without a cast that defeats
 * its narrowing; the open-keyed `?? fallback` recipe stays local, matching the
 * existing local copies in SyncBadge + VerificationForm + AllocatorSyncStatus
 * rather than introducing a cast or a new shared module (surgical-change rule,
 * PATTERNS §"No Analog Found").
 */
const EXCHANGE_LABELS: Record<string, string> = {
  binance: "Binance",
  okx: "OKX",
  bybit: "Bybit",
};

/**
 * DSRC-02 — resolve a connected exchange api_key to its row label
 * `{Exchange} — {nickname}`, falling back to `{Exchange} — ••••{id.slice(-4)}`
 * when the key has no nickname. The masked tail never reveals the full id and
 * never any secret/ciphertext (T-37-03-01). Returns the structured parts so the
 * caller can render the masked tail in font-mono per UI-SPEC.
 */
function dataSourceLabel(k: { exchange: string; label: string; id: string }): {
  exchange: string;
  /** nickname when present, else null (caller renders the masked tail). */
  nickname: string | null;
  /** masked id tail (last 4) — only meaningful when nickname is null. */
  maskedTail: string;
} {
  const exchange = EXCHANGE_LABELS[k.exchange.toLowerCase()] ?? k.exchange;
  const nick = k.label?.trim();
  return {
    exchange,
    nickname: nick ? nick : null,
    maskedTail: `••••${k.id.slice(-4)}`,
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
  onRegisterOpen,
  onScenarioSaved,
}: ScenarioComposerProps) {
  const {
    holdingsSummary: rawHoldingsSummary,
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

  // UNIFY-01/02 — entry mode. One composer surface, two front doors:
  //   "book"  — seed the working composition from the allocator's live holdings.
  //   "blank" — start from an empty working composition (no live-book holdings
  //             seeded); the allocator composes purely from catalog adds.
  // A no-book allocator (rawHoldingsSummary empty) has only one sensible
  // option — "blank" — so we default there and never render a dead "From my
  // book" default (29-UI-SPEC §1). The mode is pure UI state: it chooses which
  // initial draft renders by gating which holdings flow into the hook/adapter/
  // composition below. The frozen adapter + engine path is untouched.
  const hasLiveBook = rawHoldingsSummary.length > 0;
  const [entryMode, setEntryMode] = useState<"book" | "blank">(
    hasLiveBook ? "book" : "blank",
  );

  // The holdings the composer actually presents this render. In "blank" mode we
  // feed [] so the draft seeds empty (only added strategies contribute) — every
  // downstream `holdingsSummary` reference (hook, adapter, composition list,
  // fingerprint, empty-state gate) flows through this single switch, so the
  // mode is honored everywhere with no per-site change. The narrowed cast is
  // re-applied so the array literal matches the destructured element type.
  const holdingsSummary = useMemo(
    () => (entryMode === "blank" ? [] : rawHoldingsSummary),
    [entryMode, rawHoldingsSummary],
  ) as typeof rawHoldingsSummary;

  // Bugfix — blank-slate live-data leak. `equityDailyPoints` is the live book's
  // server-blended equity baseline: a SEPARATE payload field the entryMode
  // switch above does not reach. In "blank" mode the allocator chose to start
  // from nothing, so the live curve + its sync stamp must NOT render — only the
  // (empty-until-added) scenario overlay. Gate the baseline + stamps the same
  // single-switch way. A no-book allocator already renders with an empty
  // baseline, so blank mode just reproduces that already-handled state.
  const isBlankMode = entryMode === "blank";
  const baselineEquityDailyPoints = useMemo(
    () => (isBlankMode ? [] : equityDailyPoints),
    [isBlankMode, equityDailyPoints],
  ) as typeof equityDailyPoints;

  const scenario = useScenarioState({
    holdingsSummary: holdingsSummary as { symbol: string; venue: string; holding_type: string; value_usd: number }[],
    allocatorId,
  });

  // UNIFY-02 / Pitfall 5 — a mode switch that would DISCARD a dirty draft must
  // route through the existing reset-confirmation discipline, never a silent
  // wipe. The parked target segment is only ever READ inside the `handleReset`
  // functional updater (apply-on-confirm) — the rendered control derives its
  // selected state from `entryMode`, never from the pending value — so the
  // state value is intentionally unread here (only the setter is used). A
  // clean draft (diffCount === 0) switches immediately (nothing to lose).
  const [_pendingMode, setPendingMode] = useState<"book" | "blank" | null>(
    null,
  );

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

  // DSRC-02/03 — per-data-source include/exclude map (api_key_id → included?).
  // Ephemeral exploration state, modeled EXACTLY on R4 `leverageByRef` above:
  // NOT persisted to scenario.draft, NOT routed through
  // `scenario.draft.toggleByScopeRef`, NOT part of the commit diff, and resets on
  // reload (Pitfall 5). `{}` = all included (default). A key resolves to included
  // via `includeByApiKeyId[id] ?? true` wherever it is read. Threaded into the
  // existing `projectionState.selected` channel keyed by api_key_id so the frozen
  // engine honestly recomputes the curve + every KPI on exclusion (DSRC-03) —
  // never a cosmetic hide.
  const [includeByApiKeyId, setIncludeByApiKeyId] = useState<
    Record<string, boolean>
  >({});

  // DSRC-02 — fail-loud, visible-state toggle handler. Mirrors
  // handleLeverageChange's "state visible immediately, never silent" posture; a
  // boolean toggle has no invalid value so it never clamps. The row's
  // aria-checked reflects the change synchronously and the projection recomputes.
  function handleDataSourceToggle(apiKeyId: string, include: boolean) {
    setIncludeByApiKeyId((prev) => ({ ...prev, [apiKeyId]: include }));
  }

  // -------------------------------------------------------------------------
  // UNIFY-04 — lazy-returns plumbing (29-RESEARCH "SSR-LIFT vs LAZY-FETCH").
  // -------------------------------------------------------------------------
  // `payload.strategies` is BOOK-ONLY (the allocator's portfolio_strategies
  // join). A strategy added from the Browse drawer — verified OR example — is
  // not already in the book, so it has no daily_returns in the SSR payload and
  // would contribute [] (warm-up-gated out → a no-op add, the H-0133 / example
  // gap). On add we lazily fetch GET /api/strategies/<id>/returns (Plan 01's
  // RLS-scoped, published-only route) and stash the series here keyed by id;
  // `addedStrategyReturnsLookup` below merges it (payload wins when present —
  // Open Question #1). The series flows through the UNCHANGED adapter + frozen
  // engine; no second annualization path, no scenario.ts edit.
  const [addedReturnsById, setAddedReturnsById] = useState<
    Record<string, DailyPoint[]>
  >({});
  // Ids whose lazy fetch is in flight — drives the honest "loading returns…"
  // affordance on the added row. While loading, the strategy contributes []
  // (warm-up-gated), NEVER a fabricated flat/zero series (Pitfall 4).
  const [loadingReturnsIds, setLoadingReturnsIds] = useState<Set<string>>(
    () => new Set(),
  );
  // AbortControllers for in-flight lazy fetches, keyed by id, so reset/unmount
  // can cancel them (mirrors the btc-effect cancelled-guard posture).
  const lazyAbortRef = useRef<Map<string, AbortController>>(new Map());

  // -------------------------------------------------------------------------
  // Phase 23 / PERSIST-02 — Save / Update / Save-as-new toolbar + reopen state.
  // -------------------------------------------------------------------------
  // The id of the saved scenario currently open in the composer (null = a fresh
  // unsaved draft). Open() sets it; handleReset() clears it. Drives the
  // Save-vs-Update toolbar split.
  const [loadedScenarioId, setLoadedScenarioId] = useState<string | null>(null);
  // The open scenario's name — sent unchanged on Update (PUT requires a name).
  const [loadedScenarioName, setLoadedScenarioName] = useState<string | null>(null);
  // A readonly (newer-version) scenario hydrates but blocks the Update gesture —
  // the user may only fork it via "Save as new scenario".
  const [loadedReadonly, setLoadedReadonly] = useState(false);
  // The honest reopen notice (reset → "older format"; readonly → "read-only").
  const [openNotice, setOpenNotice] = useState<string | null>(null);
  // Inline name input (NOT a modal). Opened by "Save scenario" (first save) and
  // by "Save as new scenario" (fork) — both POST a new row, so no mode flag is
  // needed; the success handler adopts the returned id either way.
  const [nameInputOpen, setNameInputOpen] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  // A hard save/open failure → the canonical error copy (separate from the
  // weight/leverage commitError surface).
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);

  // BENCH-01 — the BTC benchmark daily-returns series, fetched once from the
  // shared market-data route. `btcAvailable` is false until a non-empty series
  // arrives; a failed/empty fetch leaves it false so the benchmark section
  // renders the honest "unavailable" empty state and the overlay is suppressed
  // (24-RESEARCH Pitfall 5: a transport failure degrades to the empty state,
  // never a red alert). The series is RAW daily returns — the section consumes
  // them for the metrics, and the chart overlay derives a cumulative-WEALTH
  // curve from the SAME series (Pitfall 3).
  const [btcDaily, setBtcDaily] = useState<DailyPoint[]>([]);
  const [btcAvailable, setBtcAvailable] = useState(false);
  // Overlay toggle, default ON per UI-SPEC §Component Inventory.
  const [showBenchmark, setShowBenchmark] = useState(true);

  // GRAPH-03 — rolling-metrics window. 3M/6M/12M map to 63/126/252 trading-day
  // windows (client-side, 252-annualization basis — NOT the per-strategy panel's
  // 90/180/365 backend keys). Default 6M=126 per UI-SPEC §Component Inventory.
  const [rollingWindow, setRollingWindow] = useState(126);

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
    // (e.g. via paste). Showing the error makes the clamping visible and
    // consistent with the non-finite path above.
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
    // WR-03 (Phase 21 review): clamp authoritatively at THIS boundary — the
    // boundary the "clamped to 1" message describes — instead of trusting the
    // state layer's clampWeight to use the same bound. Mirrors handleLeverageChange,
    // which clamps locally before dispatch. Keeps the message and the stored value
    // in lockstep even if the downstream clamp bound ever changes.
    const clampedWeight = Math.min(1, Math.max(0, weight));
    scenario.setWeightOverride(scopeRef, clampedWeight);
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

  // -------------------------------------------------------------------------
  // UNIFY-04 — lazy-fetch an added strategy's daily_returns on add.
  // -------------------------------------------------------------------------
  // Mirrors the btc-effect's honest-degrade posture: a non-ok response, a
  // non-array body, an abort, or a thrown fetch all leave the entry [] and log
  // — never a fabricated series, never a wedge. The series is stashed in
  // `addedReturnsById` keyed by id; the lookup memo merges it (payload wins).
  const fetchAddedReturns = useCallback((id: string) => {
    // Already resolved or in flight — don't refetch (idempotent multi-add).
    if (lazyAbortRef.current.has(id)) return;
    const controller = new AbortController();
    lazyAbortRef.current.set(id, controller);
    setLoadingReturnsIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // Clear the in-flight bookkeeping (loading flag + abort ref) WITHOUT writing
    // an `addedReturnsById` entry. Used on every failure path so the entry stays
    // `undefined` — see WR-01 below.
    const clearInflight = () => {
      setLoadingReturnsIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      lazyAbortRef.current.delete(id);
    };
    // Settle a GENUINE result (a 200 with a real DailyPoint[] body, possibly
    // empty). Writes `addedReturnsById[id]` so the memo merges it and a re-add
    // reuses it (idempotent) rather than re-fetching.
    const settle = (series: DailyPoint[]) => {
      setAddedReturnsById((prev) => ({ ...prev, [id]: series }));
      clearInflight();
    };
    fetch(`/api/strategies/${encodeURIComponent(id)}/returns`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) {
          // WR-01: a non-ok response (404 / 500 / transient) is a FAILURE, not a
          // genuine "this strategy has no returns" empty. Do NOT settle([]) —
          // that poisons `addedReturnsById[id]` with a permanent [] that blocks
          // a retry on remove + re-add. Throw so the catch leaves the entry
          // `undefined` (retryable).
          throw new Error(`returns route responded ${r.status}`);
        }
        return r.json();
      })
      .then((d: { daily_returns?: unknown }) => {
        // A 200 with a non-array body is a malformed/failed response, NOT a
        // genuine empty series — treat it as a retryable failure (WR-01).
        if (!Array.isArray(d?.daily_returns)) {
          throw new Error("returns route body missing a daily_returns array");
        }
        // A genuine 200 with a real array (including an empty one) settles. An
        // empty array here means the strategy legitimately has no published
        // returns yet — distinct from a failure, so it is cached, not retried.
        settle(d.daily_returns as DailyPoint[]);
      })
      .catch((err: unknown) => {
        // An abort (remove / reset / unmount) is benign — the canceller already
        // owns the cleanup. Just drop the (possibly stale) abort ref and return.
        if (controller.signal.aborted) {
          lazyAbortRef.current.delete(id);
          return;
        }
        // WR-01: a real failure (network throw, non-ok, non-array body) leaves
        // `addedReturnsById[id]` UNDEFINED so the add seam's
        // `addedReturnsById[s.id] === undefined` guard re-fires the fetch on a
        // subsequent remove + re-add. Honest degrade: no fabricated series, the
        // strategy stays warm-up-gated out until a retry succeeds.
        console.warn(
          "[ScenarioComposer] /api/strategies/<id>/returns fetch failed",
          { id, err },
        );
        clearInflight();
      });
  }, []);

  // Cancel any in-flight lazy fetches on unmount (no setState after unmount).
  useEffect(() => {
    const inflight = lazyAbortRef.current;
    return () => {
      for (const c of inflight.values()) c.abort();
      inflight.clear();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Phase 23 / PERSIST-02 — Save / Update / Save-as-new + codec-trichotomy Open.
  // -------------------------------------------------------------------------

  // Reset wrapper — clears the loaded-scenario tracking alongside the hook's
  // localStorage clear so a fresh draft is no longer "the open saved scenario".
  // Every reset path (banner Reset, ResetConfirmationModal confirm, commit
  // success) routes through this so loadedScenarioId can never go stale.
  const handleReset = useCallback(() => {
    scenario.reset();
    setLoadedScenarioId(null);
    setLoadedScenarioName(null);
    setLoadedReadonly(false);
    setOpenNotice(null);
    setNameInputOpen(false);
    setSaveError(null);
    // Review WR-02 — clear the ephemeral per-source include map on every reset /
    // saved-scenario open. The toggle is NOT persisted to the draft, so a freshly
    // opened scenario must start with every data source included; without this a
    // prior exclusion would silently carry over and the loaded scenario's
    // projection would omit a source the user never excluded for it.
    setIncludeByApiKeyId({});
    // UNIFY-02 — if a dirty-draft mode switch parked a pending segment, apply
    // it now (on the SAME confirm that discards the draft). `reset()` re-inits
    // the draft from `holdingsSummary`, which itself depends on `entryMode`, so
    // flipping the mode here re-seeds against the newly-selected front door.
    setPendingMode((pending) => {
      if (pending !== null) setEntryMode(pending);
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.reset]);

  // UNIFY-02 / Pitfall 5 — segment click. A clean draft switches immediately;
  // a dirty draft (diffCount > 0) parks the target in `pendingMode` and opens
  // the existing reset confirmation. We NEVER call `scenario.reset()` / re-seed
  // directly here — the confirm path (`handleReset`) is the only mutator, so a
  // mode switch can never silently wipe in-progress edits.
  const handleEntryModeSelect = useCallback(
    (mode: "book" | "blank") => {
      if (mode === entryMode) return;
      if (scenario.diffCount > 0) {
        setPendingMode(mode);
        setResetModalOpen(true);
        return;
      }
      setEntryMode(mode);
    },
    [entryMode, scenario.diffCount],
  );

  // Open a saved scenario. The row's persisted draft is decoded through the
  // SAME codec the hook uses on a localStorage read (M-0153: never a bare
  // `row.draft as ScenarioDraft`). The default draft (current holdings) is the
  // codec's absent/corrupt fallback and the schema source of truth.
  //   ok       → hydrate + adopt the id (editable).
  //   readonly → hydrate (the user's real data) + adopt the id, but block the
  //              Update gesture and show the read-only notice.
  //   reset    → do NOT hydrate (never a silent empty composer) — show the
  //              honest "older format" notice; the open is refused.
  const openSavedScenario = useCallback(
    (row: SavedScenarioRow) => {
      setSaveError(null);
      const defaultDraft = defaultDraftFromHoldings(
        holdingsSummary as Parameters<typeof defaultDraftFromHoldings>[0],
      );
      // WR-04 (Phase 29 review): `row.draft` is `unknown`. The stringify→parse
      // roundtrip re-serializes data that was already a parsed object; a value
      // containing a BigInt throws a TypeError, and `JSON.stringify(undefined)`
      // returns the JS value `undefined` (not a string). The pre-fix code let
      // the TypeError escape and fed `undefined` into the codec's `string|null`
      // param (which treats null as "absent" → silently hydrates the DEFAULT
      // draft — masking the failure). Guard the serialization and route any
      // failure to the SAME honest "older format" reset notice (Rule 12: fail
      // loud, never a silent empty/default composer).
      let serializedDraft: string | undefined;
      try {
        serializedDraft = JSON.stringify(row.draft);
      } catch (err) {
        console.warn(
          "[ScenarioComposer] saved portfolio draft could not be serialized (WR-04)",
          err,
        );
        serializedDraft = undefined;
      }
      if (typeof serializedDraft !== "string") {
        setOpenNotice(
          "This saved portfolio uses an older format and can't be reopened.",
        );
        return;
      }
      const decoded = scenarioDraftCodec(defaultDraft).decode(serializedDraft);

      if (decoded.outcome === "reset") {
        // Older incompatible / corrupt format — honest notice, no hydrate.
        setOpenNotice(
          "This saved portfolio uses an older format and can't be reopened.",
        );
        return;
      }

      if (decoded.outcome === "readonly") {
        // Newer-version blob: hydrate the user's real data but block edits.
        scenario.hydrateFromSaved(decoded.value);
        // Review WR-02 — opening a saved scenario replaces the draft, so clear
        // the ephemeral per-source include map (it is not persisted) → the
        // opened scenario starts with every data source included.
        setIncludeByApiKeyId({});
        setLoadedScenarioId(row.id);
        setLoadedScenarioName(row.name);
        setLoadedReadonly(true);
        setOpenNotice(
          "This portfolio was saved by a newer version and is read-only here.",
        );
        setNameInputOpen(false);
        return;
      }

      // ok — adopt the draft + id; clear any prior notice / readonly flag. The
      // fingerprint-mismatch banner (drift) derives automatically from the
      // hydrated draft's fingerprint vs current holdings — no special-casing.
      scenario.hydrateFromSaved(decoded.value);
      // Review WR-02 — clear the ephemeral per-source include map on open (it is
      // not persisted) → the opened scenario starts with every source included.
      setIncludeByApiKeyId({});
      setLoadedScenarioId(row.id);
      setLoadedScenarioName(row.name);
      setLoadedReadonly(false);
      setOpenNotice(null);
      setNameInputOpen(false);
    },
    // hydrateFromSaved/reset are stable useCallbacks; holdingsSummary is the
    // only render-varying input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdingsSummary, scenario.hydrateFromSaved],
  );

  // Register the imperative Open handler with the parent (the saved-scenarios
  // list, a later plan). Re-registers when the handler identity changes.
  const onRegisterOpenRef = useRef(onRegisterOpen);
  onRegisterOpenRef.current = onRegisterOpen;
  useEffect(() => {
    onRegisterOpenRef.current?.(openSavedScenario);
  }, [openSavedScenario]);

  // BENCH-01 — fetch the shared BTC daily-returns series once on mount. The
  // route returns `[{date,value}]` (raw daily returns) and degrades to `[]` on
  // its own read errors, so any non-2xx / non-array / empty / thrown result
  // leaves `btcAvailable=false` → the benchmark section shows the honest empty
  // state and the overlay is hidden (never a red alert).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/benchmark/btc")
      .then((r) => {
        if (!r.ok) {
          // F-08: a persistent non-2xx (500 / CDN / route-contract break) is
          // otherwise invisible — the honest-degrade state hides it. Log so a
          // regression is visible in production console rather than silently
          // swallowed. Keep the degrade (return [] → btcAvailable=false).
          console.warn(
            "[ScenarioComposer] /api/benchmark/btc non-ok response",
            { status: r.status },
          );
          return [];
        }
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        const series = Array.isArray(d) ? (d as DailyPoint[]) : [];
        setBtcDaily(series);
        setBtcAvailable(series.length > 0);
      })
      .catch((err) => {
        if (cancelled) return;
        // F-08: a thrown fetch (network / abort / JSON parse) is also logged
        // so the silent degrade is observable. State stays honest.
        console.warn("[ScenarioComposer] /api/benchmark/btc fetch failed", err);
        setBtcDaily([]);
        setBtcAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // BENCH-01 — the chart overlay series. `EquityChart.benchmark` runs
  // `anchorFromFirstPositive` (divide-by-first), so it expects a CUMULATIVE-
  // WEALTH curve (~1.0 base), NOT raw daily returns — derive it via
  // `computeStrategyCurve` from the same BTC daily returns the metrics use
  // (24-RESEARCH Pitfall 3). Suppressed (undefined) when the toggle is off or
  // the benchmark is unavailable, which hides the overlay.
  const btcWealth = useMemo(
    () =>
      showBenchmark && btcAvailable
        ? computeStrategyCurve(btcDaily)
        : undefined,
    [showBenchmark, btcAvailable, btcDaily],
  );

  // Validate the trimmed name against the SQL CHECK (1..120) mirrored in the
  // save route. Returns the trimmed name on success, or null after setting the
  // inline error copy (UI-SPEC §Copywriting).
  function validateName(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed.length < 1) {
      setNameError("Enter a name to save this portfolio.");
      return null;
    }
    if (trimmed.length > 120) {
      setNameError("Portfolio names are limited to 120 characters.");
      return null;
    }
    setNameError(null);
    return trimmed;
  }

  // POST a new scenario (first save OR "save as new"). On success adopt the
  // returned id as the loaded scenario (editable, not readonly).
  async function postNewScenario(name: string) {
    setSavePending(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/allocator/scenario/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, draft: scenario.draft }),
      });
      if (!res.ok) {
        setSaveError(
          "Couldn't save this portfolio. Check your connection and try again.",
        );
        return;
      }
      const data: { id?: string; name?: string } = await res.json();
      if (data.id) {
        setLoadedScenarioId(data.id);
        setLoadedScenarioName(data.name ?? name);
        setLoadedReadonly(false);
        setOpenNotice(null);
      }
      setNameInputOpen(false);
      setNameValue("");
      // PERSIST-03 — let a host's saved-scenarios list refetch the new row.
      onScenarioSaved?.();
    } catch {
      setSaveError(
        "Couldn't save this portfolio. Check your connection and try again.",
      );
    } finally {
      setSavePending(false);
    }
  }

  // PUT the current draft back to the open scenario row (the "Update scenario"
  // gesture). Blocked when the loaded scenario is readonly.
  async function putUpdateScenario() {
    if (!loadedScenarioId || loadedReadonly) return;
    setSavePending(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/allocator/scenario/saved/${loadedScenarioId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: loadedScenarioName ?? "Scenario",
            draft: scenario.draft,
          }),
        },
      );
      if (!res.ok) {
        setSaveError(
          "Couldn't save this portfolio. Check your connection and try again.",
        );
      } else {
        // PERSIST-03 — let a host's saved-scenarios list refetch (name/order).
        onScenarioSaved?.();
      }
    } catch {
      setSaveError(
        "Couldn't save this portfolio. Check your connection and try again.",
      );
    } finally {
      setSavePending(false);
    }
  }

  // Submit the inline name input (first save or save-as-new fork).
  function handleNameSubmit() {
    const name = validateName(nameValue);
    if (name === null) return;
    void postNewScenario(name);
  }

  // M3 — Empty state computed flag. The early-return moves to the END of
  // the hook list so React's hook ordering invariant is preserved across
  // the empty → "added a strategy" transition (otherwise the second
  // render would call MORE hooks than the first, triggering React's
  // "Rendered more hooks than during the previous render" guard).
  //
  // UNIFY-02 — gate on the RAW book (`hasLiveBook`), NOT the mode-narrowed
  // `holdingsSummary`. The empty-state card is the front door for a genuinely
  // no-book allocator. A book allocator who toggles to "blank" mode with
  // nothing added yet must STILL reach the main body (so the entry-mode control
  // stays on-screen and they can toggle back) — otherwise blank mode would trap
  // them in the empty-state card with no way back to "From my book".
  const isEmptyState =
    !hasLiveBook && scenario.draft.addedStrategies.length === 0;

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
        // UNIFY-04 — payload (book) wins when present; otherwise the lazily-
        // fetched series fills the gap; otherwise [] (warm-up-gated out until a
        // real series arrives — NEVER a fabricated flat series). WR-05: normalize
        // the book series at this trust boundary via the canonical
        // normalizeDailyReturns (shared with the lazy /api/strategies/[id]/returns
        // route so the two boundaries can't drift) instead of a
        // `raw as unknown as DailyPoint[]` cast that silently dropped the
        // year-keyed shape to [].
        const fromBook = normalizeBookReturns(raw);
        map[a.id] = fromBook ?? addedReturnsById[a.id] ?? [];
      }
      return map;
    },
    [scenario.draft.addedStrategies, strategyById, addedReturnsById],
  );

  // UNIFY-04 — the display names of added strategies whose lazy returns fetch
  // is still in flight, for the honest "loading returns…" affordance. Derived
  // from the loading-id set ∩ the current added strategies (an id that was
  // removed mid-flight drops out of the message).
  const loadingReturnsAddedNames = useMemo(() => {
    if (loadingReturnsIds.size === 0) return [] as string[];
    return scenario.draft.addedStrategies
      .filter((a) => loadingReturnsIds.has(a.id))
      .map((a) => a.name);
  }, [loadingReturnsIds, scenario.draft.addedStrategies]);

  // UNIFY-04 — the single add seam for catalog adds (empty-state drawer,
  // main-body drawer, Bridge). Appends to the draft via the hook mutator, THEN
  // — when the id is not already in the book (its series isn't in
  // payload.strategies) and hasn't been fetched yet — fires the lazy returns
  // fetch so the projection moves once it resolves.
  const handleAddStrategy = useCallback(
    (s: AddedStrategy) => {
      scenario.addStrategyBrowse(s);
      if (!strategyById.has(s.id) && addedReturnsById[s.id] === undefined) {
        fetchAddedReturns(s.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strategyById, addedReturnsById, fetchAddedReturns, scenario.addStrategyBrowse],
  );

  // WR-02 — the single remove seam for added strategies. `scenario.removeAddedStrategy`
  // only mutates the draft; it does NOT touch the lazy-fetch bookkeeping. Wiring the
  // raw mutator into CompositionList's onRemoveAdded left three leaks: (1) an
  // in-flight fetch for the removed id was never aborted (only unmount aborted), so
  // the request ran to completion and wrote into state for a strategy no longer in
  // the draft; (2) `addedReturnsById` accumulated entries for removed ids across a
  // multi-add session; (3) a stale entry fed WR-01's poisoning on re-add. This
  // wrapper aborts the controller and purges all three structures for the id so a
  // subsequent re-add starts clean (and re-fetches via the add seam's
  // `addedReturnsById[s.id] === undefined` guard).
  const handleRemoveAdded = useCallback(
    (id: string) => {
      scenario.removeAddedStrategy(id);
      lazyAbortRef.current.get(id)?.abort();
      lazyAbortRef.current.delete(id);
      setLoadingReturnsIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setAddedReturnsById((prev) => {
        if (!(id in prev)) return prev;
        const { [id]: _drop, ...rest } = prev;
        return rest;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenario.removeAddedStrategy],
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

  // -------------------------------------------------------------------------
  // DSRC-01/02/03 — per-data-source projection units (one per connected
  // exchange api_key) built from Plan-01's payload via the Plan-02 sibling
  // builder. This path is selected ONLY in book mode when the Phase-36 D3
  // per-key-dailies gate is satisfied; otherwise the existing holdings
  // `adapterOutput` path above is used unchanged (snapshot fallback — both
  // paths coexist, RESEARCH §State-of-the-Art). The frozen
  // collapse→computeScenario pipeline below is shared by both.
  // -------------------------------------------------------------------------
  // Per-key equity share (D2): Σ holdingEquityContribution grouped by
  // api_key_id (mirror queries.ts:2303-2310). Uses the EXPORTED contribution
  // helper — never re-derives equity from value_usd (derivative notional ≠
  // equity). This is the RAW weight source; the engine renormalizes (Pitfall 1).
  const equityByApiKeyId = useMemo(() => {
    const out: Record<string, number> = {};
    for (const h of rawHoldingsSummary) {
      if (!h.api_key_id) continue;
      out[h.api_key_id] =
        (out[h.api_key_id] ?? 0) + holdingEquityContributionLocal(h);
    }
    return out;
  }, [rawHoldingsSummary]);

  // Per-key strategy set — wrapped in a useMemo on its inputs exactly like
  // `adapterOutput`. One StrategyForBuilder per api_key_id (id === api_key_id),
  // RAW equity-share weights, default selected=true.
  const perKeyAdapterOutput = useMemo(() => {
    // `?? {}` — fail safe if the payload omits the per-key channel (a partial/
    // legacy payload). An empty map yields zero per-key units (the per-key path
    // is also gated off via perKeyDailiesGateSatisfied in that case). The
    // builder Object.entries its input, so it must never receive undefined.
    const all = payload.perKeyReturnsByApiKeyId ?? {};
    // DSRC-03 honesty fix (review RT1) — blend ONLY eligible keys, the SAME set
    // that gets a toggle row (dataSourceKeys below). A soft-disconnected key
    // keeps is_active=true and retains holdings + csv residue, so the
    // allocator-scoped SSR read still carries its series even though it is NOT
    // in eligibleApiKeyIds. Without this filter that key would ride the engine
    // with no toggle row, letting "exclude all sources → honest empty" be
    // falsely satisfied by an undisclosed, untoggleable source.
    const eligible = new Set(payload.eligibleApiKeyIds ?? []);
    const eligibleOnly = Object.fromEntries(
      Object.entries(all).filter(([id]) => eligible.has(id)),
    );
    return buildPerKeyStrategyForBuilderSet(eligibleOnly, equityByApiKeyId);
  }, [
    payload.perKeyReturnsByApiKeyId,
    payload.eligibleApiKeyIds,
    equityByApiKeyId,
  ]);

  // The per-key path is active only in book mode + D3 gate satisfied. When
  // active, the per-key strategy set feeds the projectionState/collapse/engine
  // pipeline; otherwise the holdings `adapterOutput` set does.
  const usePerKeySources =
    entryMode === "book" && payload.perKeyDailiesGateSatisfied;

  // The strategy set actually fed to the engine this render — the per-key units
  // when the per-source path is active, else the holdings/added units.
  const activeAdapterOutput = usePerKeySources
    ? perKeyAdapterOutput
    : adapterOutput;

  // DSRC-02 — render-gating for the "Data sources" control:
  //   showDataSources       → the per-key path is active → render the control.
  //   book mode + !gate      → render the calm InfoBanner fallback note.
  //   blank mode             → render nothing (no live book, no live keys).
  const showDataSources = usePerKeySources;
  // The fallback note explains that per-source modeling needs per-key history —
  // so it is only meaningful when the allocator actually HAS connected, eligible
  // keys whose series are incomplete. A book allocator with zero eligible keys
  // (e.g. keys removed but a holdings snapshot remains) has nothing to model per
  // source, so suppress the note there rather than show the misleading
  // "connected keys don't have a per-key series yet" copy (review WR-01).
  const showDataSourcesFallback =
    entryMode === "book" &&
    !payload.perKeyDailiesGateSatisfied &&
    (payload.eligibleApiKeyIds ?? []).length > 0;

  // The connected exchange keys eligible for per-source toggling — payload
  // apiKeys filtered to the SSR-computed eligible-key id set (SoT mirror; the
  // client never re-derives eligibility, RESEARCH §SoT-mirror). One row per key.
  const dataSourceKeys = useMemo(() => {
    const eligible = payload.eligibleApiKeyIds ?? [];
    return (payload.apiKeys ?? []).filter((k) => eligible.includes(k.id));
  }, [payload.apiKeys, payload.eligibleApiKeyIds]);

  // All-excluded honest-empty trigger (DSRC-03): every eligible key toggled off.
  // Derived from the ephemeral include map (default included), so re-including
  // any source instantly flips this back to false and restores the projection.
  const allDataSourcesExcluded =
    showDataSources &&
    dataSourceKeys.length > 0 &&
    dataSourceKeys.every((k) => includeByApiKeyId[k.id] === false);

  // H-0487/H-0493 — map each holding scopeRef to its bare symbol so aliased
  // multi-venue/instrument holdings (identical symbol-keyed series) can be
  // collapsed before computeScenario, keeping avg_pairwise_correlation honest.
  // ONLY holdings populate this map — per-key UUID unit ids are NOT in it, so
  // they pass through collapseAliasedHoldingStrategies untouched (Pitfall 3),
  // keeping avg-ρ across data sources honest.
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
    for (const s of activeAdapterOutput.strategies) {
      // DSRC-03 — the per-key path rides the SAME `selected` channel keyed by
      // api_key_id: `includeByApiKeyId[s.id] ?? true` (absent → included). The
      // ephemeral exclusion drops the key from the engine's activeStrategies and
      // the per-day weight mass; the engine renormalizes over the remaining
      // selected set (r / activeWeightSum) — an honest recompute, never a hide.
      // The holdings path keeps its draft `toggleByScopeRef` semantics unchanged.
      if (usePerKeySources) {
        selected[s.id] = includeByApiKeyId[s.id] ?? true;
      } else {
        const toggle = scenario.draft.toggleByScopeRef[s.id];
        selected[s.id] =
          toggle === undefined
            ? (activeAdapterOutput.state.selected[s.id] ?? true)
            : toggle;
      }
      // WR-04 (Phase 21 review): narrow with `typeof` instead of `Number.isFinite`
      // + `as number` so the compiler keeps protecting these reads against future
      // value-type drift (e.g. a `null` "cleared" sentinel) rather than the cast
      // silently swallowing it. Behavior is identical: an absent/NaN override
      // falls back; an explicit finite 0 is honored. Per-key weights stay RAW
      // (no weightOverride entries exist for api_key_id units) so the engine
      // renormalizes (Pitfall 1 — NO sum-to-1 here).
      const ov = scenario.draft.weightOverrides[s.id];
      weights[s.id] =
        typeof ov === "number" && Number.isFinite(ov)
          ? ov
          : (activeAdapterOutput.state.weights[s.id] ?? 0);
      const L = leverageByRef[s.id];
      leverage[s.id] = typeof L === "number" && Number.isFinite(L) ? L : 1;
    }
    return {
      selected,
      weights,
      startDates: activeAdapterOutput.state.startDates,
      leverage,
    };
  }, [
    activeAdapterOutput,
    usePerKeySources,
    includeByApiKeyId,
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
        activeAdapterOutput.strategies,
        projectionState,
        symbolByHoldingId,
      ),
    [activeAdapterOutput.strategies, projectionState, symbolByHoldingId],
  );
  const dateMapCache = useMemo(
    () => buildDateMapCache(deAliased.strategies),
    [deAliased],
  );
  const scenarioMetrics = useMemo(
    () => computeScenario(deAliased.strategies, deAliased.state, dateMapCache),
    [deAliased, dateMapCache],
  );

  // GRAPH-02 / GRAPH-03 — derive every blend-graph series from the SAME
  // unrounded `portfolio_daily_returns` the benchmark / stress / MC sections
  // read (never the rounded/downsampled `equity_curve`). `buildBlendPanels` is
  // the single pure-TS adapter (Plan 30-01); the host stays props-only. Both
  // memos key on the ENGINE output reference (`scenarioMetrics.portfolio_daily_returns`)
  // — NOT a `?? []` expression that allocates a fresh array each render and would
  // defeat the memoization (react-hooks/exhaustive-deps).
  const portfolioDaily = useMemo(
    () => scenarioMetrics.portfolio_daily_returns ?? [],
    [scenarioMetrics.portfolio_daily_returns],
  );
  const blendPanels = useMemo(
    () => buildBlendPanels(portfolioDaily, rollingWindow),
    [portfolioDaily, rollingWindow],
  );

  // CORR-01 — de-aliased axis labels for the CorrelationHeatmap. Keyed on the
  // SAME de-aliased set computeScenario consumes, so the heatmap labels always
  // match the matrix the engine produced (no stale alias surviving the collapse).
  const strategyNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of deAliased.strategies) out[s.id] = s.name;
    return out;
  }, [deAliased]);

  // IMPACT-01 — the shortest-history strategy name for the coverage caveat.
  // Pure helper (unit-tested in scenario-history.test.ts); reads only the
  // de-aliased set the composer already holds. null when the set is empty.
  const coverageShortestName = useMemo(
    () => shortestHistoryName(deAliased.strategies),
    [deAliased],
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
  // O(1) — same pattern as `flaggedByRef` (in `CompositionList`) and the
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
        className="mx-auto max-w-[1440px] py-12"
      >
        <div className="rounded-lg border border-border bg-surface p-12 text-center">
          <h2
            className="mb-2 text-2xl text-text-primary"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Start a portfolio
          </h2>
          <p className="mx-auto max-w-md text-sm text-text-secondary">
            Connect a read-only exchange API key to project portfolio scenarios
            from your live book — or start from a blank slate and browse
            strategies to compose one.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href="/profile?tab=exchanges"
              className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              Connect Exchange →
            </Link>
            <button
              type="button"
              onClick={() => setBrowseOpen(true)}
              className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              Browse strategies
            </button>
          </div>
        </div>
        <StrategyBrowseDrawer
          isOpen={browseOpen}
          onClose={() => setBrowseOpen(false)}
          onAdd={(s) =>
            handleAddStrategy({
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
      className="mx-auto flex max-w-[1440px] flex-col"
    >
      {/* IMPACT-01 — persistent PROJECTED honesty pill. Always rendered (NOT a
          tooltip/hover), plain text, NO role="alert". Neutral-outline token per
          UI-SPEC §4 — calm "label/metadata" signal, deliberately NOT bg-accent
          (= verified/action), NOT warning-amber (= transient error), NOT the
          filled <Badge> primitive. A projection is a hypothetical, not your
          live book — the badge says so unconditionally. */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold text-text-primary">Portfolio</h2>
        <span
          data-testid="scenario-projected-badge"
          className="inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-muted"
        >
          PROJECTED — hypothetical, not your live book
        </span>

        {/* UNIFY-01/02 — entry-mode segmented control (29-UI-SPEC §1). Two
            segments: "From my book" (seed from live holdings) / "Blank slate"
            (empty working composition). Active = border-accent text-accent (NO
            accent FILL — accent = action/verified; a mode toggle is neither;
            mirrors the drawer FilterPill recipe). Inactive = neutral. A
            radiogroup with arrow-key navigation + a visible accent focus ring.
            "From my book" is offered only when a live book exists (a no-book
            allocator gets Blank-slate-only — never a dead default). A
            dirty-draft switch routes through the reset confirmation
            (handleEntryModeSelect), never a silent wipe. */}
        <div
          role="radiogroup"
          aria-label="Composition entry mode"
          data-testid="scenario-entry-mode"
          className="inline-flex items-center gap-1 rounded-md border border-border p-0.5"
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            if (!hasLiveBook) return; // only one option — nothing to arrow to
            e.preventDefault();
            handleEntryModeSelect(entryMode === "book" ? "blank" : "book");
          }}
        >
          {hasLiveBook && (
            <button
              type="button"
              role="radio"
              aria-checked={entryMode === "book"}
              tabIndex={entryMode === "book" ? 0 : -1}
              data-testid="scenario-entry-mode-book"
              onClick={() => handleEntryModeSelect("book")}
              className={`rounded-sm px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                entryMode === "book"
                  ? "border border-accent text-accent"
                  : "border border-transparent text-text-secondary"
              }`}
            >
              From my book
            </button>
          )}
          <button
            type="button"
            role="radio"
            aria-checked={entryMode === "blank"}
            tabIndex={entryMode === "blank" || !hasLiveBook ? 0 : -1}
            data-testid="scenario-entry-mode-blank"
            onClick={() => handleEntryModeSelect("blank")}
            className={`rounded-sm px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
              entryMode === "blank"
                ? "border border-accent text-accent"
                : "border border-transparent text-text-secondary"
            }`}
          >
            Blank slate
          </button>
        </div>

        {/* Phase 23 / PERSIST-02 — Save / Update / Save-as-new toolbar. Lives
            in this same header row per UI-SPEC §Component Inventory 1. Inline
            name input (NOT a modal). The control set keys off loadedScenarioId:
            no scenario open → "Save scenario"; a saved scenario open → "Update
            scenario" + "Save as new scenario" (a readonly open omits the
            editable Update and offers only the fork). */}
        <div
          data-testid="scenario-save-toolbar"
          className="ml-auto flex flex-wrap items-center gap-2"
        >
          {loadedScenarioId === null ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                setNameError(null);
                setNameValue("");
                setNameInputOpen(true);
              }}
            >
              Save portfolio
            </Button>
          ) : (
            <>
              {!loadedReadonly && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={savePending}
                  onClick={() => {
                    void putUpdateScenario();
                  }}
                >
                  Update portfolio
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setNameError(null);
                  setNameValue("");
                  setNameInputOpen(true);
                }}
              >
                Save as new portfolio
              </Button>
            </>
          )}
        </div>
      </div>

      {nameInputOpen && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            placeholder="Name this portfolio"
            aria-label="Name this portfolio"
            className="min-w-[220px] rounded-md border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={savePending}
            onClick={handleNameSubmit}
          >
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setNameInputOpen(false);
              setNameError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      )}
      {nameError && (
        <p className="mt-1 text-xs text-negative">{nameError}</p>
      )}
      {openNotice && (
        <p
          data-testid="scenario-open-notice"
          className="mt-2 text-xs text-text-muted"
        >
          {openNotice}
        </p>
      )}
      {saveError && (
        <div
          role="alert"
          data-testid="scenario-save-error"
          className="mt-2 rounded-md border border-negative bg-[rgba(220,38,38,0.05)] p-3 text-sm text-negative"
        >
          {saveError}
        </div>
      )}

      <p className="mt-1 text-sm text-text-muted">
        Compose a draft portfolio and project KPI / equity / drawdown impact vs
        your live baseline.
      </p>

      {/* IMPACT-01 — coverage caveat. Names the live overlapping-day count
          (scenarioMetrics.n) AND the shortest-history strategy via the
          unit-tested shortestHistoryName helper — no invented numbers, no
          re-implemented helper. Reuses the leverage-caveat typography. The
          "Shortest history" half is omitted when the de-aliased set is empty
          (helper → null), so the caveat never names a phantom strategy. */}
      <p
        data-testid="scenario-coverage-caveat"
        className="mt-2 text-[11px] text-text-muted"
      >
        {methodologyLine(scenarioMetrics.n)}
        {coverageShortestName !== null
          ? ` Shortest history: ${coverageShortestName}.`
          : ""}
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
                handleReset();
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

      {/* DSRC-02 — "Data sources" control. Book mode + D3 gate satisfied → one
          include/exclude row per connected exchange api_key, each toggle
          honestly re-blends the curve + every KPI via the frozen engine
          (DSRC-03). Book mode + gate NOT satisfied → a calm InfoBanner honest
          note (per-key history incomplete). Blank mode → nothing. Reuses the
          entry-mode pill recipe + existing tokens only (no new design token).
          The included state = accent outline (no fill); excluded = neutral
          outline; never red (excluding a source is a normal modeling action). */}
      {showDataSources && (
        <div
          role="group"
          aria-label="Data sources"
          data-testid="scenario-data-sources"
          className="mt-4 flex flex-col gap-2"
        >
          <div className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
            Data sources
          </div>
          <p className="text-[12px] text-text-muted">
            Toggle a source off to model the book without it. Resets on reload.
          </p>
          <div className="flex flex-col">
            {dataSourceKeys.map((k) => {
              const included = includeByApiKeyId[k.id] ?? true;
              const { exchange, nickname, maskedTail } = dataSourceLabel(k);
              const labelText = nickname ?? maskedTail;
              return (
                <div
                  key={k.id}
                  data-data-source-id={k.id}
                  className="flex min-h-[44px] items-center gap-2 border-b border-border last:border-b-0"
                >
                  <button
                    type="button"
                    role="switch"
                    aria-checked={included}
                    aria-label={`Include ${exchange} — ${labelText} in projection`}
                    onClick={() => handleDataSourceToggle(k.id, !included)}
                    className={`rounded-sm px-3 py-1 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                      included
                        ? "border border-accent text-accent"
                        : "border border-border text-text-secondary"
                    }`}
                  >
                    {included ? "Included" : "Excluded"}
                  </button>
                  <span className="text-sm text-text-secondary">
                    {exchange}
                    {" — "}
                    {nickname ? (
                      nickname
                    ) : (
                      <span className="font-mono text-text-muted">
                        {maskedTail}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showDataSourcesFallback && (
        <div className="mt-4" data-testid="scenario-data-sources-fallback">
          <InfoBanner>
            <span className="font-semibold text-text-primary">
              Per-source modeling needs per-key history.
            </span>{" "}
            One or more connected keys don&apos;t have a per-key return series
            yet, so this projection blends your whole book. Per-source toggles
            appear once every key has its own history.
          </InfoBanner>
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

      {/* DSRC-03 — all-excluded honest empty. When every data source is toggled
          off the engine returns null KPIs + an empty curve (KpiStrip above
          falls to its degenerate "—" convention, never a stale number), and the
          projection region renders this honest-absence card. Re-including any
          source instantly restores the live projection. Neutral/calm, no
          role="alert", no red (honesty-color rule, UI-SPEC §4). */}
      {allDataSourcesExcluded && (
        <div className="mt-4" data-testid="scenario-data-sources-empty">
          <EmptyStateCard
            heading="Select at least one data source"
            body="Every data source is excluded — there's nothing to project. Re-include a source to see the curve and metrics."
          />
        </div>
      )}

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

      {/* Phase 38-03 (PARITY-01): the scenario equity + drawdown now render
          through the REAL factsheet TimeSeriesChart + MasterBrush under ONE
          provider (ScenarioFactsheetChart) — "the scenario should look exactly
          the same and use the same factsheet assets." The two panels share ONE
          brush-zoom window (Q4); the SegmentedControl drives it (Q3). The mount
          is persist=false so a scenario pan never rewrites the dashboard URL or
          writes a factsheet-v2: localStorage blob. The Overview EquityChartWidget
          stays on the legacy render (scope boundary). */}
      <div className="relative mt-6">
        {/* BENCH-01 — the BTC overlay rides the synth payload's `benchmark`
            (cumulative-WEALTH form via `btcWealth`). `btcWealth` is undefined
            when the toggle is off or the benchmark is unavailable, which hides
            the overlay. */}
        <ScenarioFactsheetChart
          equityDailyPoints={baselineEquityDailyPoints}
          scenarioSeries={scenarioWealthSeries}
          benchmark={btcWealth}
        />
        {/* Overlay toggle — verbatim "BTC Benchmark" copy + a muted line
            swatch via the `--color-chart-benchmark` token (UI-SPEC §Copywriting
            / §Color). Disabled when the
            benchmark series is unavailable so the control can't promise an
            overlay there is no data for. Composer-owned chrome — NOT pushed
            into the factsheet engine. */}
        <label className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={showBenchmark}
            disabled={!btcAvailable}
            onChange={(e) => setShowBenchmark(e.target.checked)}
          />
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-4"
            style={{ backgroundColor: "var(--color-chart-benchmark)" }}
          />
          BTC Benchmark
        </label>
        {/* NEW-C18-14: the factsheet-backed chart renders the projected SHAPE
            from the normalized scenario wealth (no live capital scaling). When
            scenarioAum=0 there is no real book behind the curve, so disclose
            that it is illustrative — allocators must not mistake the shape for
            one backed by real capital. */}
        {scenarioAum <= 0 && (
          <div
            aria-live="polite"
            className="mt-2 text-center text-[11px] text-text-muted"
          >
            Illustrative shape only — no live capital connected
          </div>
        )}
      </div>

      {/* BENCH-01 — "vs BTC" active-return section. Reads the active scenario's
          full daily portfolio returns (`scenarioMetrics.portfolio_daily_returns`
          — OPTIONAL, so `?? []`) + the fetched BTC daily returns, inner-joins
          by date, and renders TE/IR/alpha/beta over the intersection window OR
          the honest "unavailable" empty state (below the 30-day floor, no
          overlap, or a failed fetch via `btcAvailable=false`). */}
      <Card className="mt-6">
        <ScenarioBenchmarkSection
          portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}
          btcDaily={btcDaily}
          benchmarkAvailable={btcAvailable}
        />
      </Card>

      {/* STRESS-01 / STRESS-02 (Plan 26-02) — the "Stress & VaR" section on the
          own-book scenario surface. A sibling of the benchmark section above:
          props-only over the same already-leveraged portfolio_daily_returns + the
          fetched BTC factor series, it lets the allocator pick a BTC shock preset
          and read the β-propagated projected impact + historical VaR(95%)/CVaR with
          a mandatory inline disclosure, OR the honest empty state (degenerate
          scenario / BTC unavailable / below the Phase-22 sample floor). Own-book
          composer ONLY — stress/VaR over an arbitrary example universe is
          deferred. Every prop is already in scope; no new state/fetch/memo. */}
      <Card className="mt-6">
        <StressVarSection
          portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}
          btcDaily={btcDaily}
          btcAvailable={btcAvailable}
          n={scenarioMetrics.n}
          strategyCount={deAliased.strategies.length}
        />
      </Card>

      {/* SIM-01 (Plan 27-02) — the "Forward uncertainty" Monte-Carlo section on
          the own-book scenario surface. A sibling of the Stress & VaR section
          above: it block-bootstraps the same already-leveraged
          portfolio_daily_returns OFF THE MAIN THREAD (a Web Worker) into forward
          confidence bands with a mandatory method/paths/N disclosure, OR the
          honest empty/computing/error state (degenerate scenario / below the
          Phase-22 sample floor / worker failure). Own-book composer ONLY —
          forward bands over an arbitrary example universe are deferred. Every prop is
          already in scope; the section owns the worker lifecycle internally. */}
      <Card className="mt-6">
        <MonteCarloSection
          portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}
          n={scenarioMetrics.n}
          strategyCount={deAliased.strategies.length}
        />
      </Card>

      {/* OPT-01 / OPT-02 (Plan 28-02) — the "Suggested weights" optimizer on the
          own-book scenario surface. Allocates long-only across the ACTIVE
          de-aliased strategies (the same set the projection blends) via the
          Python analytics-service (min-vol default / max-Sharpe gated, Ledoit-Wolf
          shrinkage). Suggested weights write to the editable DRAFT only on an
          explicit Apply (via scenario.setWeightOverride) — never auto-committed.
          Own-book composer ONLY; the example-universe Sandbox optimizer is
          deferred. */}
      <Card className="mt-6">
        <WeightOptimizerSection
          strategies={deAliased.strategies
            .filter((s) => deAliased.state.selected[s.id])
            .map((s) => ({ id: s.id, name: s.name, dailyReturns: s.daily_returns }))}
          onApply={(weights) => {
            // Atomic full-vector apply — NOT a loop of setWeightOverride (which
            // renormalizes the others on each call and would land a different
            // allocation than the optimizer suggested).
            scenario.applyWeightOverrides(weights);
          }}
        />
      </Card>

      {/* CORR-01 / CORR-03 — pairwise correlation heatmap on the own-book
          scenario surface. The matrix + single-sourced Avg |ρ| come straight from
          scenarioMetrics (the same value KpiStrip reads), and the axis labels
          are the de-aliased strategy names — the heatmap never computes its own
          average and the <2-strategy / <10-day cases delegate to its honest
          reason-routed empty state (never a 1×1 grid). */}
      <Card className="mt-6">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Pairwise correlation
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Live-computed from the scenario&apos;s daily returns. Teal =
            diversifying, orange = concentrated.
          </p>
        </div>
        <CorrelationHeatmap
          correlationMatrix={scenarioMetrics.correlation_matrix}
          strategyNames={strategyNames}
          overlappingDays={scenarioMetrics.n}
          avgAbsCorrelation={scenarioMetrics.avg_pairwise_correlation}
        />
      </Card>

      {/* GRAPH-02 — Returns distribution of the BLEND. Histogram (fed the
          CUMULATIVE-wealth series the adapter builds — ReturnHistogram derives
          daily internally) + 5-number quantile box, both off the same
          `portfolio_daily_returns` the sections above read. Owns its own
          method/overlap-N/horizon disclosure (the page PROJECTED badge is NOT
          sufficient — GRAPH-04); below the 10-point floor the body swaps to a
          neutral role="status" PartialDataBanner (never role="alert" — absence
          on a derived-client panel is honest-neutral, not an error). LEAF charts
          only — no per-strategy panel wrapper, no factsheet body / metrics
          column / allocator-portfolio payload builder / percentile-rank badge,
          no api-ingest literal (LOCKED honesty invariant — a what-if has no
          verified track record to peer-rank). */}
      <Card className="mt-6" data-panel="blend-returns-distribution" aria-label="Returns distribution">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-text-primary">
            Returns distribution
          </h2>
        </div>
        {blendPanels.histogramSeries.length === 0 ? (
          // WR-02 — gate on the ADAPTER's actual degenerate verdict, not a
          // re-derived `portfolioDaily.length < 10`. The adapter collapses every
          // series on a STRICTER condition (`hasNonFinite || length < MIN_USABLE
          // || length < window`), so a ≥10-length series carrying a non-finite
          // point (realistic at the 10x leverage ceiling) yields an empty
          // histogramSeries. Keying the empty branch off that signal keeps the
          // two predicates from ever diverging into a headed-but-empty panel.
          <PartialDataBanner
            heading="Awaiting more data"
            body="This portfolio needs at least 10 overlapping daily returns to chart its distribution."
          />
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
                Return histogram
              </h3>
              <ReturnHistogram returns={blendPanels.histogramSeries} bins={20} />
            </div>
            <div>
              <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
                Return quantiles
              </h3>
              <ReturnQuantiles data={blendPanels.quantiles} />
            </div>
            <p className="text-xs text-text-muted">
              Distribution of {scenarioMetrics.n} overlapping daily returns ·
              historical realized · not a forecast.
            </p>
          </div>
        )}
      </Card>

      {/* GRAPH-03 — Rolling metrics of the BLEND. SegmentedControl (3M/6M/12M →
          63/126/252-day windows, default 6M=126; an option is disabled when the
          usable history is shorter than its window) + rolling Sharpe (keyed
          sharpe_365d so RollingMetrics resolves the CHART_ACCENT stroke; we pass
          daysOfHistory={usableN} so the avg reference line self-suppresses below
          365 days rather than disabling the whole chart) + rolling volatility +
          rolling Sortino, all from the same adapter. Owns its own
          window/method/horizon disclosure (GRAPH-04); below the selected window's
          floor the body swaps to the neutral role="status" PartialDataBanner —
          never role="alert". */}
      <Card className="mt-6" data-panel="blend-rolling" aria-label="Rolling metrics">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-text-primary">
            Rolling metrics
          </h2>
          <SegmentedControl
            ariaLabel="Rolling window"
            activeId={String(rollingWindow)}
            onChange={(id) => setRollingWindow(Number(id))}
            options={Object.keys(WINDOW_LABEL).map((w) => ({
              id: w,
              label: WINDOW_LABEL[Number(w)],
              disabled: blendPanels.usableN < Number(w),
            }))}
          />
        </div>
        {blendPanels.usableN < rollingWindow ? (
          <PartialDataBanner
            heading="Awaiting more data"
            body={`This portfolio needs at least ${rollingWindow} overlapping daily returns for the ${WINDOW_LABEL[rollingWindow] ?? `${rollingWindow}-day`} rolling window.`}
          />
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
                Rolling Sharpe
              </h3>
              <RollingMetrics
                data={blendPanels.rollingSharpe}
                daysOfHistory={blendPanels.usableN}
                // WR-01 — the series is keyed `sharpe_365d` ONLY so RollingMetrics
                // resolves the CHART_ACCENT stroke; that key's default LABELS text
                // ("365d") would lie about the selected window. Override the visible
                // legend/tooltip label with the true window count (matches the
                // "{rollingWindow}-day rolling window" disclosure below).
                seriesLabels={{ sharpe_365d: `${rollingWindow}d` }}
              />
            </div>
            <div>
              <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
                Rolling volatility
              </h3>
              <RollingVolatilityChart data={blendPanels.rollingVol} />
            </div>
            <div>
              <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
                Rolling Sortino
              </h3>
              <RollingSortinoChart data={blendPanels.rollingSortino} />
            </div>
            <p className="text-xs text-text-muted">
              {rollingWindow}-day rolling window · 252-day annualized ·{" "}
              {scenarioMetrics.n} overlapping days · not a forecast.
            </p>
          </div>
        )}
      </Card>

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

      {/* UNIFY-04 — honest in-flight affordance. While an added strategy's
          daily_returns are still being fetched it contributes [] (warm-up-gated
          out of the projection) — we say so plainly rather than render a
          fabricated flat curve (Pitfall 4). role="status" + aria-live polite:
          a non-blocking transition, never a red alert. */}
      {loadingReturnsAddedNames.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          data-testid="scenario-loading-returns"
          className="mt-4 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs text-text-muted"
        >
          Loading returns… {loadingReturnsAddedNames.join(", ")} not yet in the
          projection.
        </div>
      )}

      {/* LAYOUT-01 / LAYOUT-02 (Pitfall 5) — the composition controls
          (toggle / weight / leverage) become the collapsible section so the
          factsheet-grade graphs rendered ABOVE in DOM order lead the surface
          when an allocator collapses to focus on the projection. The lifted
          CollapsibleSection is a native <details>: CompositionList stays MOUNTED
          when collapsed (the browser only HIDES it), and every in-progress edit
          survives collapse→expand because the edit state (`leverageByRef`,
          `scenario.draft.weightOverrides`) lives in THIS parent, ABOVE the
          collapsible boundary — never moved down into CompositionList. The list
          is an UNCONDITIONAL child: never gate it behind an open-flag conditional
          (that would unmount it on collapse and wipe the edits — the
          silent-failure surface the phase-31 guard enforces against).
          Default-EXPANDED — an allocator composing needs the
          controls visible; hiding to focus on the graphs is opt-in. Composer-
          scoped storageKey (independent of the factsheet `factsheet-collapse:`
          namespace) persists the choice across reloads. No onToggle — composer
          collapse analytics are out of scope this phase. */}
      <CollapsibleSection
        id="composer-composition-controls"
        title="Strategies & weights"
        defaultOpen
        storageKey="composer-collapse:controls"
      >
        <CompositionList
          draft={scenario.draft}
          holdingsSummary={holdingsSummary}
          flaggedHoldings={flaggedHoldings}
          sharedSymbols={sharedSymbols}
          onToggle={scenario.toggleHolding}
          onSetWeight={handleWeightChange}
          leverageByRef={leverageByRef}
          onSetLeverage={handleLeverageChange}
          onRemoveAdded={handleRemoveAdded}
          onCompare={(scopeRef, candidateId) =>
            router.push(
              `/compare?ids=${encodeURIComponent(scopeRef)},${candidateId}`,
            )
          }
        />
      </CollapsibleSection>

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
          handleAddStrategy({
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
          const id = candidate.id as AddedStrategy["id"];
          scenario.addStrategyBridge(holdingScopeRef, {
            id,
            name: candidate.name,
            markets: candidate.markets,
            strategy_types: candidate.strategy_types,
          });
          // UNIFY-04 — a Bridge candidate is also a catalog strategy not in the
          // book; lazy-fetch its series so the projection moves on add.
          if (!strategyById.has(id) && addedReturnsById[id] === undefined) {
            fetchAddedReturns(id);
          }
        }}
      />

      {resetModalOpen && (
        <ResetConfirmationModal
          onConfirm={() => {
            handleReset();
            setResetModalOpen(false);
          }}
          onCancel={() => {
            // UNIFY-02 — cancelling the confirmation abandons any parked mode
            // switch so a later footer-Reset never silently flips the mode.
            setPendingMode(null);
            setResetModalOpen(false);
          }}
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
          handleReset();
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
    <div className="rounded-lg border border-border bg-surface p-4">
      {/* No inner "Composition" heading: the enclosing CollapsibleSection summary
          ("Strategies & weights") is the single section label — a second synonym
          here double-labels the same content. No top margin on the card either:
          the list is the sole child inside the collapsible's <details> body, so
          spacing comes from the summary's border + mb-4, not a sibling-era mt-8. */}
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
