"use client";

import { useEffect } from "react";
import type React from "react";
import { formatPercent, formatNumber } from "@/lib/utils";
import { captureToSentry } from "@/lib/sentry-capture";
import { drawdownTone, formatFixedSigned, signTone } from "@/lib/factsheet/display-sign";
import type { ComputedMetrics } from "@/lib/scenario";
import { KpiPanel, type KpiPanelCell } from "@/components/kpi/KpiPanel";

/**
 * Phase 09.1 / Plan 06 (D-09): designer-aligned KPI strip.
 * Phase 64 / PRESENT-01: return-form only — the AUM cell is gone (4 cells).
 *
 * Shape (left → right): YTD TWR / Sharpe / Max DD 12m / Avg |ρ|.
 * Each cell renders { label, formatted value, sub helper line }.
 *
 * **Phase 07 / 07-03 invariants preserved verbatim:**
 *   - `warmupCopy(snapshotCount)`: the generic "Warming up — need N more days
 *     of synced data." countdown. Phase 176 (D-07) removed the venue-specific
 *     retention branch with the legacy `history_depth_months` column it read.
 *   - `warmingUp = snapshotCount !== null && snapshotCount < 30 && !allKeysStale`
 *     gate: stale state suppresses the per-cell warm-up helper so the
 *     page-level WarningBanner can carry the stale copy once. Phase 176: the
 *     count is the drawn derived curve's days, and `null` (a rebuilding book)
 *     never warms up, so no countdown shows over a held-back history.
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
   * still pass it; not currently rendered in the 4-cell shape (the designer
   * panel surfaces timeframe at the page header instead).
   */
  timeframe?: string;
  /**
   * Phase 07 / 07-03, Phase 176. The day count of the drawn derived curve.
   * When it is < 30 and the allocator is NOT stale, render the warm-up helper
   * sub-line beneath every null KPI cell. `null` means the history is
   * rebuilding: no countdown and no suppression of the scenario primary.
   * Defaults to 30 so untouched callers see no warm-up render.
   */
  snapshotCount?: number | null;
  /**
   * Phase 07 / 07-03. When true, every null KPI renders plain em-dash
   * AND a stale sub-copy ("Last sync stale — awaiting next update") on
   * every cell so the user sees a consistent staleness signal.
   */
  allKeysStale?: boolean;
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
  /**
   * Phase 170 / SC1-LAYERS. Passed through to KpiPanel. Omitted keeps the
   * panel's own default ("cards"), so every existing caller stays
   * byte-identical. The scenario composer passes "panel".
   */
  variant?: "cards" | "panel";
}

interface Cell {
  label: string;
  raw: number | null;
  formatted: string;
  sub: string | null;
  /**
   * Phase 10 / 10-04. Metric key used to look up the corresponding value
   * on a `ComputedMetrics` object for scenario-mode delta computation.
   * Nullable defensively; every current cell is a return-form metric with a
   * real key (Phase 64 / PRESENT-01 removed the only metricKey:null cell, AUM).
   */
  metricKey: string | null;
}

/**
 * Phase 07 / 07-03 — the warm-up helper copy: the standard 30-day countdown.
 * Phase 176 (D-07) removed the venue-specific branch that read the legacy
 * per-venue retention depth.
 */
function warmupCopy(snapshotCount: number): string {
  return `Warming up — need ${30 - snapshotCount} more days of synced data.`;
}

const STALE_SUB = "Last sync stale — awaiting next update";
const AVG_RHO_HONEST_NULL_SUB =
  "Requires per-holding correlation data (pending)";
const AVG_RHO_LOADED_SUB = "average pairwise correlation across holdings";

/**
 * Phase 166.2 round 2 (SFH-R2-M3): how many off-diagonal pairs an engine
 * correlation matrix measured, out of how many exist. Under founder decision D7
 * a pair with no correlation (a leg with no dispersion) has no cell and is left
 * out of `avg_pairwise_correlation`, so the average covers `measured` pairs, not
 * `total`. Counts cells exactly as `CorrelationHeatmap`'s caption does; it never
 * computes the average. Null when there is no matrix or fewer than 2 members.
 */
function pairCoverage(
  matrix: ComputedMetrics["correlation_matrix"] | undefined,
): { measured: number; total: number } | null {
  if (!matrix) return null;
  const ids = Object.keys(matrix);
  if (ids.length < 2) return null;
  let measured = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const v = matrix[ids[i]]?.[ids[j]];
      if (v != null && Number.isFinite(v)) measured++;
    }
  }
  return { measured, total: (ids.length * (ids.length - 1)) / 2 };
}

/** Color-token className for the value text — green/red for signed metrics.
 * Uses DESIGN.md tokens (text-positive / text-negative) so the strip stays
 * in lockstep with the rest of the dashboard's signed-value rendering.
 *
 * Phase 170.6 D-03: the tone follows the sign of the value ROUNDED to the 2 dp every
 * cell prints at (`scale` is 100 for the percent cells, 1 for the unitless ones), so a
 * figure printed "0.00%" is never red or green.
 *
 * D-04: the Max DD cell (`drawdown`) goes through `drawdownTone`, which can only be red or
 * neutral. A drawdown is non-positive by construction, so a positive value there is an
 * upstream sign bug and must not read as good news. The cell does not print it either:
 * `isImpossibleDrawdown` sends it to the dash (R2-SFH-2). */
function valueColorClass(raw: number | null, scale: number, drawdown = false): string {
  const tone = drawdown ? drawdownTone(raw, 2, scale) : signTone(raw, 2, scale);
  if (tone === "positive") return "text-positive";
  if (tone === "negative") return "text-negative";
  return "";
}

/**
 * R2-SFH-2 (170.6 round 2): a max drawdown that PRINTS above zero is impossible data. A
 * drawdown is `cumulative / peak - 1`, so it is at most 0 by construction (scenario.ts); a
 * positive one means the sign convention flipped upstream (the scenario engine or the
 * analytics service). Painting it neutral and plus-signed ("+4.00%") hid the fault, and
 * painting it green sold it as good news. It is treated as uncomputable instead: the cell
 * prints the dash it prints for a missing value, and the component reports it once.
 *
 * The test is on the value ROUNDED to the 2 dp the cell prints at (D-03), so float noise
 * that prints "0.00%" is a zero, not a violation.
 */
function isImpossibleDrawdown(raw: number | null): boolean {
  return signTone(raw, 2, 100) === "positive";
}

/**
 * Phase 10 / 10-04 D-16. Per-KPI improvement direction.
 *   - "up-good": higher is better (TWR, CAGR, Sharpe, Sortino, score)
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
};

/**
 * Whether a delta that is ALREADY past the noise floor is an improvement. The floor
 * (0.01) is at least the unit the pill prints at (2 dp unitless, 1 dp of percent), so a
 * delta that reaches this call never rounds to zero and its rounded sign is its sign.
 * The sign is read through display-sign (170.6 D-03/D-05), not compared with zero here.
 */
function isImprovement(delta: number, direction: KpiDirection): boolean {
  return (signTone(delta, 2) === "positive") === (direction === "up-good");
}

/** Phase 10 / 10-04. Direction-aware delta pill color token. */
function deltaPillClass(
  delta: number | null,
  direction: KpiDirection,
  noiseFloor: number,
): string {
  if (delta == null || Math.abs(delta) < noiseFloor) return "text-text-muted";
  return isImprovement(delta, direction) ? "text-positive" : "text-negative";
}

/** Phase 10 / 10-04. Direction-aware accessibility word for aria-label. */
function deltaSign(
  delta: number | null,
  direction: KpiDirection,
  noiseFloor: number,
): "improved" | "regressed" | "no change" {
  if (delta == null || Math.abs(delta) < noiseFloor) return "no change";
  return isImprovement(delta, direction) ? "improved" : "regressed";
}

/**
 * Phase 10 / 10-04. Format a signed delta for display in the pill body
 * AND for the aria-label. Mirrors the per-cell formatter shape:
 *   - Sharpe / Sortino / score / Avg |ρ| → unitless 2-decimal number
 *   - twr / cagr / max_drawdown / volatility → percent with sign
 */
export function formatSignedDelta(delta: number | null, key: string): string {
  if (delta == null) return "—";
  if (
    key === "sharpe" ||
    key === "sortino" ||
    key === "score" ||
    key === "avg_correlation" ||
    key === "avg_pairwise_correlation"
  ) {
    return formatFixedSigned(delta, { dp: 2, plus: true, minus: "−" });
  }
  // Default: percent (twr, cagr, max_drawdown, volatility)
  return formatFixedSigned(delta, { dp: 1, scale: 100, suffix: "%", plus: true, minus: "−" });
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
  // Default: percent (twr, cagr, max_drawdown, volatility)
  return formatPercent(value);
}

export function KpiStrip({
  analytics,
  metrics,
  snapshotCount = 30,
  allKeysStale = false,
  mode = "live",
  scenarioMetrics = null,
  liveMetrics = null,
  variant,
}: KpiStripProps) {
  // Phase 07 / 07-03 — the warm-up helper line renders for each null KPI
  // cell when the allocator is still backfilling AND not globally stale.
  // Stale suppresses the helper so the stale sub-copy can carry the
  // signal instead of mixing two messages.
  // `null` is a rebuilding book (Phase 176): `null < 30` is true in JS, so the
  // guard is explicit and a held-back history never shows a countdown.
  const warmingUp =
    snapshotCount !== null && snapshotCount < 30 && !allKeysStale;
  const warmupHelper = warmingUp ? warmupCopy(snapshotCount) : null;

  // 4-cell return-form sources (D-09 · Phase 64 / PRESENT-01 removed the AUM
  // cell — a position-space dollar figure — so the strip is return-form only):
  //  - YTD TWR: prefer analytics.ytd_twr; fall back to ComputedMetrics.twr
  //    so the existing legacy caller's `metrics` payload still wires in.
  //  - Sharpe: prefer analytics.sharpe; fall back to metrics.sharpe.
  //  - Max DD 12m: prefer analytics.max_drawdown_12m; fall back to
  //    metrics.max_drawdown so the legacy "all-time max DD" still renders
  //    if the 12m field isn't present yet.
  //  - Avg |ρ|: prefer analytics.avg_correlation, then fall back to
  //    metrics.avg_pairwise_correlation (review-pass P2 fix — parallel to
  //    Plan 10's `metricKey: "avg_pairwise_correlation"` scenario-mode
  //    lookup, so the tooltip "Current book: X" pill in scenario mode reads the
  //    same value the live-mode strip displayed). The production payload
  //    doesn't carry analytics.avg_correlation yet; the metrics fallback
  //    surfaces the engine-computed value when present, otherwise both
  //    paths resolve to null → honest pending-copy below.
  const ytdValue: number | null =
    analytics?.ytd_twr ?? metrics?.twr ?? null;
  const sharpeValue: number | null =
    analytics?.sharpe ?? metrics?.sharpe ?? null;
  const maxDdValue: number | null =
    analytics?.max_drawdown_12m ?? metrics?.max_drawdown ?? null;
  const avgRhoValue: number | null =
    analytics?.avg_correlation ?? metrics?.avg_pairwise_correlation ?? null;

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

  // SFH-R2-M3: the pair coverage of the Avg |ρ| the cell DISPLAYS — the
  // scenario engine's matrix when the scenario primary shows, else the live
  // metrics' matrix when the live value came from it (analytics carries no
  // matrix, so its average has no coverage to state).
  const avgRhoCoverage = scenarioActive
    ? pairCoverage(scenarioMetrics?.correlation_matrix)
    : analytics?.avg_correlation != null
      ? null
      : pairCoverage(metrics?.correlation_matrix);

  /**
   * Resolve the sub-copy for a single cell with the documented precedence:
   *   1. allKeysStale → STALE_SUB (every cell)
   *   2. warmupHelper && raw == null → warmupHelper
   *   3. cell-specific default
   *
   * Phase 64 / PRESENT-01: the AUM warm-up exemption param is gone — its
   * only subject was the AUM cell (a dollar figure, almost always present
   * during warm-up), which no longer exists. Every surviving cell is a
   * return-form metric that takes the standard warm-up copy when null.
   */
  function resolveSub(
    raw: number | null,
    defaultSub: string | null,
  ): string | null {
    if (allKeysStale) return STALE_SUB;
    if (warmupHelper && raw == null) return warmupHelper;
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
    // An average over fewer than all pairs says so, in the heatmap caption's
    // words, so the KPI never reads as covering pairs it left out.
    if (avgRhoCoverage && avgRhoCoverage.measured < avgRhoCoverage.total) {
      return `${AVG_RHO_LOADED_SUB} · ${avgRhoCoverage.measured} of ${avgRhoCoverage.total} pairs measured`;
    }
    return AVG_RHO_LOADED_SUB;
  }

  // When stale, every numeric cell collapses to em-dash regardless of
  // the underlying value — matches the Phase 07 / 07-03 behavior of the
  // previous KpiStrip (formatters return "—" for null).
  const cells: Cell[] = [
    {
      label: "YTD TWR",
      raw: allKeysStale ? null : ytdValue,
      formatted: formatPercent(allKeysStale ? null : ytdValue),
      sub: resolveSub(ytdValue, "year-to-date time-weighted return"),
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
      sub: resolveSub(sharpeValue, "risk-adjusted return (selected period)"),
      metricKey: "sharpe",
    },
    {
      label: "Max DD 12m",
      raw: allKeysStale ? null : maxDdValue,
      formatted: formatPercent(allKeysStale ? null : maxDdValue),
      sub: resolveSub(maxDdValue, "worst peak-to-trough in last 12 months"),
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

  // R2-SFH-2 / R3-SFH-1: the positive max drawdowns the strip is about to hide (the figure the
  // cell prints, the scenario value and the live baseline), collected while the cells resolve
  // and reported once by the effect below.
  const impossibleDrawdowns: { value: number; side: "scenario" | "live" }[] = [];

  // Phase 100 / 100-03 (PI-06) — resolve each cell to a KpiPanel descriptor.
  // ALL warmup / stale / scenario / delta logic stays HERE; the shared
  // KpiPanel primitive renders the (render-tree-neutral) presentational shell.
  // The delta pill + sub-copy are passed as `children` verbatim so the emitted
  // DOM is byte-identical to the pre-extraction strip.
  const panelCells: KpiPanelCell[] = cells.map(
    ({ label, raw, formatted, sub, metricKey }) => {
      // Resolve scenario primary + delta for this cell when the gate
      // is open AND the cell has a metricKey (all 4 return-form cells
      // carry one since Phase 64 removed the metricKey-less AUM cell).
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
      // R3-SFH-1: the impossible-drawdown test covers BOTH operands, not only the one the cell
      // prints. A scenario value or a live baseline that PRINTS above zero is impossible data, so
      // no delta is derived from it and the tooltip does not print it.
      const isDd = metricKey === "max_drawdown";
      const scenImpossible = isDd && showScenarioPrimary && isImpossibleDrawdown(scenVal);
      const liveImpossible = isDd && showScenarioPrimary && isImpossibleDrawdown(liveVal);
      const liveCellImpossible = isDd && !showScenarioPrimary && isImpossibleDrawdown(raw);
      if (scenImpossible) impossibleDrawdowns.push({ value: scenVal!, side: "scenario" });
      if (liveImpossible) impossibleDrawdowns.push({ value: liveVal!, side: "live" });
      if (liveCellImpossible) impossibleDrawdowns.push({ value: raw!, side: "live" });
      const drawdownImpossible = scenImpossible || liveCellImpossible;
      // An impossible drawdown is uncomputable: no figure, and (tone needs a finite value) no tone.
      const primaryRaw = drawdownImpossible ? null : showScenarioPrimary ? scenVal : raw;

      // Delta pill renders only when both scenario AND live values are
      // available — graceful degradation when liveMetrics is null.
      const showDeltaPill =
        showScenarioPrimary && liveMetrics != null && metricKey != null;
      // An impossible operand makes the delta uncomputable: the pill prints the dash it prints
      // for a missing value, never a figure derived from the impossible one.
      const delta =
        showDeltaPill && scenVal != null && liveVal != null && !scenImpossible && !liveImpossible
          ? scenVal - liveVal
          : null;
      const direction =
        metricKey != null
          ? (KPI_DIRECTION[metricKey] ?? "up-good")
          : "up-good";
      const noiseFloor =
        metricKey != null ? (KPI_NOISE_FLOOR[metricKey] ?? 0.01) : 0.01;
      const sign = deltaSign(delta, direction, noiseFloor);

      return {
        key: label,
        label,
        value: drawdownImpossible ? "—" : primaryFormatted,
        valueClassName: valueColorClass(
          primaryRaw,
          metricKey === "sharpe" || metricKey === "avg_pairwise_correlation" ? 1 : 100,
          metricKey === "max_drawdown",
        ),
        children: (
          <>
            {/* Phase 10 / 10-04 D-13. Delta pill renders BELOW the primary
                value when the scenario gate is open. Suppressed during
                warmup (the gate is closed), preserving Phase 07 D-09
                invariants verbatim. */}
            {showDeltaPill ? (
              <div
                className="mt-1 flex flex-wrap items-baseline gap-x-1 font-mono text-xs tabular-nums"
                title={`Current book: ${formatLiveValue(liveImpossible ? null : liveVal, metricKey!)}`}
                aria-label={`${label} delta vs current book: ${formatSignedDelta(delta, metricKey!)} (${sign})`}
              >
                {/* Phase 170.1 (D-11, UI-SPEC V-2): the baseline is named on the
                    line itself. Both spans are whitespace-nowrap so a signed
                    figure never wraps mid-number at 390 px; only the suffix may
                    drop to its own line. The tone stays on the figure alone. */}
                <span
                  className={`whitespace-nowrap ${deltaPillClass(delta, direction, noiseFloor)}`}
                >
                  {formatSignedDelta(delta, metricKey!)}
                </span>
                <span className="whitespace-nowrap text-text-muted">vs current book</span>
              </div>
            ) : null}
            {sub ? (
              <div className="mt-1 text-xs text-text-secondary">{sub}</div>
            ) : null}
          </>
        ),
      };
    },
  );

  // R2-SFH-2 / R3-SFH-1: report an impossible drawdown ONCE per distinct set of values, through
  // the Sentry path the allocations surface already uses (ScenarioCommitDrawer, ScenarioComposer).
  // The effect keys on a string of the values and their sides, so a re-render with the same
  // figures stays silent. It covers the scenario value and the live baseline, not only the one
  // the cell prints, so a bad live baseline is reported whichever mode the allocator is viewing.
  const impossibleKey = impossibleDrawdowns.map((d) => `${d.side}:${d.value}`).join("|");
  useEffect(() => {
    if (impossibleKey === "") return;
    captureToSentry(
      new Error("KpiStrip: positive max drawdown (sign convention violated upstream)"),
      {
        tags: { component: "KpiStrip", check: "max-drawdown-sign" },
        extra: { max_drawdown: impossibleDrawdowns[0].value, impossible: impossibleKey, mode },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `impossibleKey` carries every value read; `mode` is context for the report, not a trigger
  }, [impossibleKey]);

  return (
    <KpiPanel cells={panelCells} ariaLabel="Portfolio KPIs" variant={variant} />
  );
}
