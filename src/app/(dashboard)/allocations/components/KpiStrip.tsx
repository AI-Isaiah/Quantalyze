"use client";

import type React from "react";
import { formatPercent, formatNumber, formatCurrency } from "@/lib/utils";
import type { ComputedMetrics } from "@/lib/scenario";

/**
 * Phase 09.1 / Plan 06 (D-09): designer-aligned 5-cell KPI strip.
 *
 * Shape (left → right): AUM / YTD TWR / Sharpe / Max DD 12m / Avg |ρ|.
 * Each cell renders { label, formatted value, sub helper line }.
 *
 * **Phase 07 / 07-03 invariants preserved verbatim:**
 *   - `warmupCopy(snapshotCount, minHistoryDepthMonths, activeVenues)`:
 *     when MIN history depth ≤ 3 months AND a venue is named, returns the
 *     venue-specific "Only N months of history available on {venues}"
 *     copy; otherwise the generic "Warming up — need N more days of synced
 *     data." countdown.
 *   - `warmingUp = snapshotCount < 30 && !allKeysStale` gate: stale state
 *     suppresses the per-cell warm-up helper so the page-level WarningBanner
 *     can carry the stale copy once.
 *   - `formatPercent` / `formatNumber` / `formatCurrency` already render `—`
 *     for null inputs (Phase 07 f8 invariant).
 *
 * **R4 honest copy (Plan 06 §threat T-09.1-06-03):** Avg |ρ| has no real
 * source field on the production payload yet — `MyAllocationDashboardPayload`
 * does not carry a portfolio-wide average correlation. Rather than label the
 * em-dash as "average pairwise correlation across holdings" (which would
 * deceive the user into thinking the value is a computed zero), the null
 * path renders "Requires per-holding correlation data (pending)" so the
 * user knows what's missing. Stale and warm-up branches still take
 * precedence per the precedence rules below.
 */

/**
 * 09.1-REVIEW IN-06 — narrow the analytics prop to the exact denormalized
 * shape this component reads. The shape is NOT `PortfolioAnalytics` from
 * `@/lib/types` (that's a different DB-row mirror with `return_ytd` etc.);
 * production callers either pass `{}` (ScenarioComposer) or skip mounting
 * the bare `KpiStrip` entirely in favor of the per-widget `KpiStripWidget`
 * adapter. The fields below are the union of what `cells[]` consults.
 *
 * All fields are optional + nullable: callers may pass partial objects or
 * `null`, and a missing field is treated identically to an explicit null
 * via the `analytics?.field ?? metrics?.fallback ?? null` chain.
 */
export interface KpiStripAnalytics {
  total_aum?: number | null;
  ytd_twr?: number | null;
  sharpe?: number | null;
  max_drawdown_12m?: number | null;
  avg_correlation?: number | null;
}

interface KpiStripProps {
  analytics: KpiStripAnalytics | null;
  metrics: ComputedMetrics;
  /**
   * Selected timeframe label. Retained for forward-compat with callers that
   * still pass it; not currently rendered in the 5-cell shape (the designer
   * panel surfaces timeframe at the page header instead).
   */
  timeframe?: string;
  aum: number | null;
  /**
   * Phase 07 / 07-03. When the allocator has < 30 snapshot rows and is
   * NOT stale, render the warm-up helper sub-line beneath every null KPI
   * cell. Defaults to 30 so untouched callers see no warm-up render.
   */
  snapshotCount?: number;
  /**
   * Phase 07 / 07-03. When true, every null KPI renders plain em-dash
   * AND a stale sub-copy ("Last sync stale — awaiting next update") on
   * every cell so the user sees a consistent staleness signal.
   */
  allKeysStale?: boolean;
  /**
   * Per VOICES-ACCEPTED f9. Min(history_depth_months) across the
   * allocator's snapshots. When `<= 3` AND activeVenues is non-empty,
   * the warm-up copy switches to the venue-specific "Only {N} months of
   * history available on {venues}" message.
   */
  minHistoryDepthMonths?: number | null;
  /**
   * Per VOICES-ACCEPTED f9. Display-cased venues (e.g. ["Binance", "OKX"]).
   * Consumed by the venue-specific warm-up copy.
   */
  activeVenues?: string[];
  /**
   * Phase 10 / 10-04 D-13. Render mode:
   *   - "live" (default) — preserves Phase 07 / 09.1 behavior verbatim.
   *   - "scenario" — primary number is `scenarioMetrics[k]`; a delta pill
   *     renders below in a direction-aware color token (positive/negative/
   *     muted-neutral per D-16). When `warmingUp` is also true, the
   *     warmup branch wins and delta pills are SUPPRESSED — preserves
   *     KpiStrip.warmup.test.tsx Phase 07 D-09 invariants.
   */
  mode?: "live" | "scenario";
  /**
   * Phase 10 / 10-04. Required when mode="scenario": the projected
   * `ComputedMetrics` from `computeScenario()`. Null suppresses the
   * scenario primary + delta pills (cells fall back to the live path).
   */
  scenarioMetrics?: ComputedMetrics | null;
  /**
   * Phase 10 / 10-04. Required when mode="scenario": the live baseline
   * `ComputedMetrics` for delta computation (`scenarioMetrics[k] - liveMetrics[k]`).
   * Null suppresses the delta pill (graceful degradation) but the scenario
   * primary still renders.
   */
  liveMetrics?: ComputedMetrics | null;
}

interface Cell {
  label: string;
  raw: number | null;
  formatted: string;
  sub: string | null;
  /**
   * Phase 10 / 10-04. Metric key used to look up the corresponding value
   * on a `ComputedMetrics` object for scenario-mode delta computation.
   * `null` for cells with no `ComputedMetrics` field (currently AUM —
   * sourced from `analytics.total_aum`, not the scenario engine).
   */
  metricKey: string | null;
}

/**
 * Phase 07 / 07-03 — resolve the warm-up helper copy per VOICES-ACCEPTED f9.
 *
 * When the allocator's dominant venue has ≤ 3 months of retention (i.e.
 * OKX via ccxt's 90-day trade-history cap), the default "30 days of synced
 * data" copy is misleading because the backfill will never reach 30 days.
 * Switch to a venue-specific explanation. Otherwise render the standard
 * 30-day countdown copy.
 */
function warmupCopy(
  snapshotCount: number,
  minHistoryDepthMonths: number | null,
  activeVenues: string[],
): string {
  // The condition is inclusive of 3 months because OKX's trade-history
  // cap IS 3 months — an allocator sitting AT that boundary needs the
  // venue-specific explanation, not the generic countdown. Matches the
  // Test-E/F specs in KpiStrip.warmup.test.tsx.
  if (
    minHistoryDepthMonths != null &&
    minHistoryDepthMonths <= 3 &&
    activeVenues.length > 0
  ) {
    return `Only ${minHistoryDepthMonths} months of history available on ${activeVenues.join(", ")}`;
  }
  return `Warming up — need ${30 - snapshotCount} more days of synced data.`;
}

const STALE_SUB = "Last sync stale — awaiting next update";
const AVG_RHO_HONEST_NULL_SUB =
  "Requires per-holding correlation data (pending)";
const AVG_RHO_LOADED_SUB = "average pairwise correlation across holdings";

/** Color-token className for the value text — green/red for signed metrics.
 * Uses DESIGN.md tokens (text-positive / text-negative) so the strip stays
 * in lockstep with the rest of the dashboard's signed-value rendering. */
function valueColorClass(raw: number | null): string {
  if (raw == null) return "";
  if (raw > 0) return "text-positive";
  if (raw < 0) return "text-negative";
  return "";
}

/**
 * Phase 10 / 10-04 D-16. Per-KPI improvement direction.
 *   - "up-good": higher is better (TWR, CAGR, Sharpe, Sortino, AUM, score)
 *   - "down-good": lower is better (Volatility, Avg |ρ| — diversification)
 *
 * **Deviation from 10-04 plan (Rule 1 — bug fix):** the plan listed
 * `max_drawdown: "down-good"` but `src/lib/scenario.ts` stores
 * `max_drawdown` as a NEGATIVE number (computed as `cumulative/peak - 1`,
 * always ≤ 0). Going from -8% to -4% is an IMPROVEMENT (smaller
 * drawdown), and the raw delta is `+0.04`. Marking the cell as
 * `up-good` correctly maps positive deltas to "improved" / text-positive
 * — matches the design intent and the existing `valueColorClass`
 * convention (positive raw = good).
 */
type KpiDirection = "up-good" | "down-good";
const KPI_DIRECTION: Record<string, KpiDirection> = {
  twr: "up-good",
  cagr: "up-good",
  sharpe: "up-good",
  sortino: "up-good",
  aum: "up-good",
  score: "up-good",
  max_drawdown: "up-good", // see deviation note above
  volatility: "down-good",
  avg_correlation: "down-good",
  avg_pairwise_correlation: "down-good",
};

/**
 * Phase 10 / 10-04 D-16. Per-KPI noise floor — below this absolute delta
 * the pill renders neutral gray (text-text-muted). Sharpe/Sortino are
 * unitless; pp-style metrics (TWR/CAGR/MaxDD/Vol) use their natural
 * fraction units, e.g. 0.01 = 1pp delta for a percentage metric.
 */
const KPI_NOISE_FLOOR: Record<string, number> = {
  sharpe: 0.01,
  sortino: 0.01,
  score: 0.01,
  avg_correlation: 0.01,
  avg_pairwise_correlation: 0.01,
  twr: 0.01,
  cagr: 0.01,
  max_drawdown: 0.01,
  volatility: 0.01,
  aum: 0.01,
};

/** Phase 10 / 10-04. Direction-aware delta pill color token. */
function deltaPillClass(
  delta: number | null,
  direction: KpiDirection,
  noiseFloor: number,
): string {
  if (delta == null || Math.abs(delta) < noiseFloor) return "text-text-muted";
  const improved = direction === "up-good" ? delta > 0 : delta < 0;
  return improved ? "text-positive" : "text-negative";
}

/** Phase 10 / 10-04. Direction-aware accessibility word for aria-label. */
function deltaSign(
  delta: number | null,
  direction: KpiDirection,
  noiseFloor: number,
): "improved" | "regressed" | "no change" {
  if (delta == null || Math.abs(delta) < noiseFloor) return "no change";
  const improved = direction === "up-good" ? delta > 0 : delta < 0;
  return improved ? "improved" : "regressed";
}

/**
 * Phase 10 / 10-04. Format a signed delta for display in the pill body
 * AND for the aria-label. Mirrors the per-cell formatter shape:
 *   - Sharpe / Sortino / score / Avg |ρ| → unitless 2-decimal number
 *   - twr / cagr / max_drawdown / volatility → percent with sign
 *   - aum → currency
 */
function formatSignedDelta(delta: number | null, key: string): string {
  if (delta == null) return "—";
  const sign = delta >= 0 ? "+" : "−";
  const abs = Math.abs(delta);
  if (
    key === "sharpe" ||
    key === "sortino" ||
    key === "score" ||
    key === "avg_correlation" ||
    key === "avg_pairwise_correlation"
  ) {
    return `${sign}${abs.toFixed(2)}`;
  }
  if (key === "aum") {
    return `${sign}${formatCurrency(abs)}`;
  }
  // Default: percent (twr, cagr, max_drawdown, volatility)
  return `${sign}${(abs * 100).toFixed(1)}%`;
}

/** Phase 10 / 10-04. Format a live baseline value for the tooltip. */
function formatLiveValue(value: number | null, key: string): string {
  if (value == null) return "—";
  if (
    key === "sharpe" ||
    key === "sortino" ||
    key === "score" ||
    key === "avg_correlation" ||
    key === "avg_pairwise_correlation"
  ) {
    return formatNumber(value, 2);
  }
  if (key === "aum") {
    return formatCurrency(value);
  }
  // Default: percent (twr, cagr, max_drawdown, volatility)
  return formatPercent(value);
}

export function KpiStrip({
  analytics,
  metrics,
  aum,
  snapshotCount = 30,
  allKeysStale = false,
  minHistoryDepthMonths = null,
  activeVenues = [],
  mode = "live",
  scenarioMetrics = null,
  liveMetrics = null,
}: KpiStripProps) {
  // Phase 07 / 07-03 — the warm-up helper line renders for each null KPI
  // cell when the allocator is still backfilling AND not globally stale.
  // Stale suppresses the helper so the stale sub-copy can carry the
  // signal instead of mixing two messages.
  const warmingUp = snapshotCount < 30 && !allKeysStale;
  const warmupHelper = warmingUp
    ? warmupCopy(snapshotCount, minHistoryDepthMonths, activeVenues)
    : null;

  // 5-cell sources (D-09):
  //  - AUM: caller's `aum` prop (server-provided), falling back to a
  //    legacy analytics.total_aum path if present.
  //  - YTD TWR: prefer analytics.ytd_twr; fall back to ComputedMetrics.twr
  //    so the existing legacy caller's `metrics` payload still wires in.
  //  - Sharpe: prefer analytics.sharpe; fall back to metrics.sharpe.
  //  - Max DD 12m: prefer analytics.max_drawdown_12m; fall back to
  //    metrics.max_drawdown so the legacy "all-time max DD" still renders
  //    if the 12m field isn't present yet.
  //  - Avg |ρ|: prefer analytics.avg_correlation, then fall back to
  //    metrics.avg_pairwise_correlation (review-pass P2 fix — parallel to
  //    Plan 10's `metricKey: "avg_pairwise_correlation"` scenario-mode
  //    lookup, so the tooltip "Live: X" pill in scenario mode reads the
  //    same value the live-mode strip displayed). The production payload
  //    doesn't carry analytics.avg_correlation yet; the metrics fallback
  //    surfaces the engine-computed value when present, otherwise both
  //    paths resolve to null → honest pending-copy below.
  const aumValue: number | null = aum ?? analytics?.total_aum ?? null;
  const ytdValue: number | null =
    analytics?.ytd_twr ?? metrics?.twr ?? null;
  const sharpeValue: number | null =
    analytics?.sharpe ?? metrics?.sharpe ?? null;
  const maxDdValue: number | null =
    analytics?.max_drawdown_12m ?? metrics?.max_drawdown ?? null;
  const avgRhoValue: number | null =
    analytics?.avg_correlation ?? metrics?.avg_pairwise_correlation ?? null;

  /**
   * Resolve the sub-copy for a single cell with the documented precedence:
   *   1. allKeysStale → STALE_SUB (every cell)
   *   2. warmupHelper && raw == null && !isAum → warmupHelper
   *   3. cell-specific default
   *
   * AUM is exempt from the warm-up helper (Phase 07 / 07-03 f9) because
   * AUM is a dollar figure, not annualised — it's almost always present
   * even during warm-up.
   */
  function resolveSub(
    raw: number | null,
    isAum: boolean,
    defaultSub: string | null,
  ): string | null {
    if (allKeysStale) return STALE_SUB;
    if (warmupHelper && raw == null && !isAum) return warmupHelper;
    return defaultSub;
  }

  /**
   * Avg |ρ| has its own precedence because the "honest pending" copy is
   * what makes the null path safe per R4 / threat T-09.1-06-03:
   *   1. allKeysStale → STALE_SUB
   *   2. warmupHelper && null → warmupHelper  (warm-up beats pending)
   *   3. raw == null → AVG_RHO_HONEST_NULL_SUB  (pending copy)
   *   4. otherwise → AVG_RHO_LOADED_SUB
   */
  function resolveAvgRhoSub(raw: number | null): string | null {
    if (allKeysStale) return STALE_SUB;
    if (warmupHelper && raw == null) return warmupHelper;
    if (raw == null) return AVG_RHO_HONEST_NULL_SUB;
    return AVG_RHO_LOADED_SUB;
  }

  // When stale, every numeric cell collapses to em-dash regardless of
  // the underlying value — matches the Phase 07 / 07-03 behavior of the
  // previous KpiStrip (formatters return "—" for null).
  const cells: Cell[] = [
    {
      label: "AUM",
      raw: allKeysStale ? null : aumValue,
      formatted: formatCurrency(allKeysStale ? null : aumValue),
      // WR-02 (Phase 21 review): in scenario mode the AUM is the projected sum
      // of toggled-ON holdings, not live AUM, and the cell has no delta pill
      // (metricKey: null). Disclose that it is projected so a shrunk number
      // isn't mistaken for the allocator's real book size.
      sub: resolveSub(
        aumValue,
        true,
        mode === "scenario" ? "Projected — sum of enabled holdings" : null,
      ),
      // AUM is sourced from analytics.total_aum, NOT the scenario engine.
      // ComputedMetrics has no AUM field; suppress scenario rendering.
      metricKey: null,
    },
    {
      label: "YTD TWR",
      raw: allKeysStale ? null : ytdValue,
      formatted: formatPercent(allKeysStale ? null : ytdValue),
      sub: resolveSub(
        ytdValue,
        false,
        "year-to-date time-weighted return",
      ),
      metricKey: "twr",
    },
    {
      label: "Sharpe",
      raw: allKeysStale ? null : sharpeValue,
      formatted: formatNumber(allKeysStale ? null : sharpeValue, 2),
      // M-0086 label-truth: the value is computeScenario's annualized Sharpe
      // over the SELECTED timeframe / full holdings history (scenario.ts), NOT
      // a fixed trailing 12 months — the prior "12-month" sub-copy was a lie.
      // Honest window-copy, parallel to the Avg |ρ| honest-pending fix.
      sub: resolveSub(sharpeValue, false, "risk-adjusted return (selected period)"),
      metricKey: "sharpe",
    },
    {
      label: "Max DD 12m",
      raw: allKeysStale ? null : maxDdValue,
      formatted: formatPercent(allKeysStale ? null : maxDdValue),
      sub: resolveSub(
        maxDdValue,
        false,
        "worst peak-to-trough in last 12 months",
      ),
      metricKey: "max_drawdown",
    },
    {
      // CORR-03 — the label reads "Avg |ρ|" (off-diagonal ABSOLUTE mean) so the
      // strip names exactly the value avgRhoValue carries
      // (avg_pairwise_correlation, scenario.ts:399). Label-only change: the
      // value and the honest-pending semantics (AVG_RHO_*_SUB / stale → null)
      // are unchanged.
      label: "Avg |ρ|",
      raw: allKeysStale ? null : avgRhoValue,
      formatted: formatNumber(allKeysStale ? null : avgRhoValue, 2),
      sub: resolveAvgRhoSub(avgRhoValue),
      metricKey: "avg_pairwise_correlation",
    },
  ];

  // Phase 10 / 10-04 — scenario-mode rendering gate. Active ONLY when:
  //   - mode === "scenario"
  //   - !warmingUp  (Phase 07 D-09 invariant — warmup branch always wins)
  //   - !allKeysStale  (stale state suppresses scenario primary too — the
  //     stale data underlying the scenario projection makes the projected
  //     numbers untrustworthy)
  //   - scenarioMetrics != null
  // When this gate is closed, the cell renders the live path verbatim
  // (zero behavior change for existing call sites that pass no `mode`).
  const scenarioActive =
    mode === "scenario" &&
    !warmingUp &&
    !allKeysStale &&
    scenarioMetrics != null;

  return (
    // Phase 52-02 / TYPE-04 — the strip is its OWN container-query context
    // (`@container`, inline-size) so it reflows on ITS width, not the viewport.
    // The prime case: a KpiStrip dropped into the ~380px metrics rail must NOT
    // think it is at desktop width. Column count steps up by CONTAINER width via
    // `@`-prefixed variants (the StrategyTable @container idiom), replacing the
    // old `sm:`/`lg:` viewport breakpoints. Inline-size containment ONLY — the
    // size-containment variant would collapse the strip's block size to 0
    // (Pitfall 1), so the bare `@container` host is deliberate. Every numeric
    // value cell below keeps `font-mono … tabular-nums` so the fluid --text-*
    // tier never raggeds a KPI column (Pitfall 2 / 52-01 tabular-nums contract).
    <div
      className="@container grid grid-cols-1 gap-3 @sm:grid-cols-2 @lg:grid-cols-5"
      role="group"
      aria-label="Portfolio KPIs"
    >
      {cells.map(({ label, raw, formatted, sub, metricKey }) => {
        // Resolve scenario primary + delta for this cell when the gate
        // is open AND the cell has a metricKey (AUM has none → falls
        // back to the live path).
        const scenVal: number | null =
          scenarioActive && metricKey
            ? // ComputedMetrics is a plain record of nullable numbers — index
              // it by string key. The cast keeps TS happy without changing
              // the runtime behavior.
              ((scenarioMetrics as unknown as Record<string, number | null>)[
                metricKey
              ] ?? null)
            : null;
        const liveVal: number | null =
          scenarioActive && metricKey && liveMetrics != null
            ? ((liveMetrics as unknown as Record<string, number | null>)[
                metricKey
              ] ?? null)
            : null;
        const showScenarioPrimary = scenarioActive && metricKey != null;
        const primaryFormatted = showScenarioPrimary
          ? formatLiveValue(scenVal, metricKey!)
          : formatted;
        const primaryRaw = showScenarioPrimary ? scenVal : raw;

        // Delta pill renders only when both scenario AND live values are
        // available — graceful degradation when liveMetrics is null.
        const showDeltaPill =
          showScenarioPrimary && liveMetrics != null && metricKey != null;
        const delta =
          showDeltaPill && scenVal != null && liveVal != null
            ? scenVal - liveVal
            : null;
        const direction =
          metricKey != null
            ? (KPI_DIRECTION[metricKey] ?? "up-good")
            : "up-good";
        const noiseFloor =
          metricKey != null ? (KPI_NOISE_FLOOR[metricKey] ?? 0.01) : 0.01;
        const sign = deltaSign(delta, direction, noiseFloor);

        return (
          <div
            key={label}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {label}
            </div>
            {/* DESIGN.md: numeric data uses Geist Mono (font-mono) +
                tabular-nums. Designer reference (app.jsx:417-422) confirms
                this — the value is `font-mono tnum`, fontSize 18, weight 500.
                We DELIBERATELY do not use the serif here even though the
                plan literal suggested it; serif is reserved for display /
                page titles per DESIGN.md typography section. */}
            <div
              className={`mt-1 font-mono text-lg font-medium tabular-nums ${valueColorClass(label === "AUM" ? null : primaryRaw)}`}
            >
              {primaryFormatted}
            </div>
            {/* Phase 10 / 10-04 D-13. Delta pill renders BELOW the primary
                value when the scenario gate is open. Suppressed during
                warmup (the gate is closed), preserving Phase 07 D-09
                invariants verbatim. */}
            {showDeltaPill ? (
              <div
                className={`mt-1 font-mono text-xs tabular-nums ${deltaPillClass(delta, direction, noiseFloor)}`}
                title={`Live: ${formatLiveValue(liveVal, metricKey!)}`}
                aria-label={`${label} delta: ${formatSignedDelta(delta, metricKey!)} (${sign})`}
              >
                {formatSignedDelta(delta, metricKey!)}
              </div>
            ) : null}
            {sub ? (
              <div className="mt-1 text-xs text-text-secondary">{sub}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
