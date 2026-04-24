"use client";

import type React from "react";
import { formatPercent, formatNumber, formatCurrency } from "@/lib/utils";
import type { ComputedMetrics } from "@/lib/scenario";

/**
 * Phase 09.1 / Plan 06 (D-09): designer-aligned 5-cell KPI strip.
 *
 * Shape (left → right): AUM / YTD TWR / Sharpe / Max DD 12m / Avg ρ.
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
 * **R4 honest copy (Plan 06 §threat T-09.1-06-03):** Avg ρ has no real
 * source field on the production payload yet — `MyAllocationDashboardPayload`
 * does not carry a portfolio-wide average correlation. Rather than label the
 * em-dash as "average pairwise correlation across holdings" (which would
 * deceive the user into thinking the value is a computed zero), the null
 * path renders "Requires per-holding correlation data (pending)" so the
 * user knows what's missing. Stale and warm-up branches still take
 * precedence per the precedence rules below.
 */

interface KpiStripProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analytics: any;
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
}

interface Cell {
  label: string;
  raw: number | null;
  formatted: string;
  sub: string | null;
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

/** Inline color hint for the value text — green/red for signed metrics. */
function valueColor(raw: number | null): React.CSSProperties | undefined {
  if (raw == null) return undefined;
  if (raw > 0) return { color: "#16A34A" };
  if (raw < 0) return { color: "#DC2626" };
  return undefined;
}

export function KpiStrip({
  analytics,
  metrics,
  aum,
  snapshotCount = 30,
  allKeysStale = false,
  minHistoryDepthMonths = null,
  activeVenues = [],
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
  //  - Avg ρ: analytics.avg_correlation. The production payload doesn't
  //    yet carry this — it resolves to undefined → null, which triggers
  //    the honest pending-copy below.
  const aumValue: number | null = aum ?? analytics?.total_aum ?? null;
  const ytdValue: number | null =
    analytics?.ytd_twr ?? metrics?.twr ?? null;
  const sharpeValue: number | null =
    analytics?.sharpe ?? metrics?.sharpe ?? null;
  const maxDdValue: number | null =
    analytics?.max_drawdown_12m ?? metrics?.max_drawdown ?? null;
  const avgRhoValue: number | null = analytics?.avg_correlation ?? null;

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
   * Avg ρ has its own precedence because the "honest pending" copy is
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
      sub: resolveSub(aumValue, true, null),
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
    },
    {
      label: "Sharpe",
      raw: allKeysStale ? null : sharpeValue,
      formatted: formatNumber(allKeysStale ? null : sharpeValue, 2),
      sub: resolveSub(sharpeValue, false, "12-month risk-adjusted return"),
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
    },
    {
      label: "Avg ρ",
      raw: allKeysStale ? null : avgRhoValue,
      formatted: formatNumber(allKeysStale ? null : avgRhoValue, 2),
      sub: resolveAvgRhoSub(avgRhoValue),
    },
  ];

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
      role="group"
      aria-label="Portfolio KPIs"
    >
      {cells.map(({ label, raw, formatted, sub }) => (
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
            className="mt-1 font-mono text-lg font-medium tabular-nums"
            style={valueColor(label === "AUM" ? null : raw)}
          >
            {formatted}
          </div>
          {sub ? (
            <div className="mt-1 text-xs text-text-secondary">{sub}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
