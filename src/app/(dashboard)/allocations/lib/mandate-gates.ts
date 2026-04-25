/**
 * Phase 09.1 PR1 (dashboard parity) — derive the 5 mandate gate rows the V2
 * Overview MandateSnapshot widget renders.
 *
 * Designer source: `Allocator Dashboard.html` MandateSnapshot
 * (prototype `app.jsx:481-514`). The prototype hardcodes its 5 gate rows; this
 * helper computes the same shape from real production data:
 *
 *   1. Max single allocation — `mandate.max_weight` cap vs.
 *      max(`strategies[*].current_weight`).
 *   2. Min Sharpe (90d)      — `mandate.min_sharpe` floor vs.
 *      `analytics.portfolio_sharpe`. Label retained verbatim from prototype
 *      even though `portfolio_sharpe` is not strictly a 90d window — the
 *      analytics service computes whatever sharpe window it ships; mandate
 *      semantics are "this is the floor we hold to."
 *   3. Max DD floor          — `mandate.max_drawdown_tolerance` floor vs.
 *      `analytics.portfolio_max_drawdown`. Mandate field stores a positive
 *      fraction (e.g. `0.075` for "max 7.5% drawdown"); the display shows it
 *      negative-signed to match the prototype "Max DD floor -7.5%".
 *   4. Min AUM               — `LIQUIDITY_TO_MIN_AUM[mandate.liquidity_preference]`
 *      vs. sum(`holdingsSummary[*].value_usd`). The mandate widget renames
 *      `liquidity_preference` to "Minimum AUM" in the UI; the underlying
 *      enum values stay `high|medium|low` for zero schema impact (matching
 *      engine, RPC, schema-sync tests untouched).
 *   5. Style concentration   — `mandate.max_aum_concentration` cap vs.
 *      max(group(`strategies[*].current_weight`, by:
 *      `strategy.strategy_types[0]`)).
 *
 * Each gate's `ok` is `null` when the threshold is unset (no mandate row yet,
 * or the specific column is `null`) — the renderer paints a muted dot in that
 * case. `current` is `"—"` when the underlying analytics field is null.
 */

import type { PortfolioAnalytics } from "@/lib/types";
import type { AllocatorPreferences } from "@/lib/preferences";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { formatPercent, formatNumber, formatCurrency } from "@/lib/utils";

/**
 * Liquidity-preference tier → minimum AUM threshold (USD).
 *
 *   - `high`   → $10M+ (institutional / deep-liquidity strategies).
 *   - `medium` → $1M+  (mid-tier capacity).
 *   - `low`    → $100K+ (small-cap / illiquid acceptable).
 *
 * The mapping is the source of truth for the Min AUM gate. Lives here (not
 * `lib/preferences.ts`) so the matching engine never picks it up by accident
 * — gate semantics belong to the dashboard surface, not the matching path.
 */
export const LIQUIDITY_TO_MIN_AUM: Record<"high" | "medium" | "low", number> = {
  high: 10_000_000,
  medium: 1_000_000,
  low: 100_000,
};

export type MandateGateKey =
  | "max_single_allocation"
  | "min_sharpe"
  | "max_dd_floor"
  | "min_aum"
  | "style_concentration";

export interface GateRow {
  /** Stable key for React keying + test assertions. */
  key: MandateGateKey;
  /** Display label, byte-equivalent to prototype `app.jsx:482-488`. */
  label: string;
  /** Threshold cell (right-most monospace value), pre-formatted for display. */
  gate: string;
  /** Current portfolio value cell, pre-formatted for display. */
  current: string;
  /**
   * Gate status:
   *   - `true`  → pass (positive dot)
   *   - `false` → fail (negative dot)
   *   - `null`  → indeterminate (threshold unset OR current value missing)
   */
  ok: boolean | null;
}

type DashboardStrategy = MyAllocationDashboardPayload["strategies"][number];
type DashboardHolding = MyAllocationDashboardPayload["holdingsSummary"][number];

/**
 * Compute the 5 mandate gates. Pure derivation: zero I/O, deterministic.
 *
 * The function never throws on missing fields — every gate degrades to a
 * sensible empty-state cell (gate "—" when threshold is null, current "—"
 * when the source value is null, `ok: null` when either side is unknown).
 */
export function deriveMandateGates(
  mandate: AllocatorPreferences | null,
  analytics: PortfolioAnalytics | null,
  holdingsSummary: DashboardHolding[],
  strategies: DashboardStrategy[],
): GateRow[] {
  return [
    maxSingleAllocationGate(mandate, strategies),
    minSharpeGate(mandate, analytics),
    maxDdFloorGate(mandate, analytics),
    minAumGate(mandate, holdingsSummary),
    styleConcentrationGate(mandate, strategies),
  ];
}

/**
 * Count of `ok === true` over the total number of gates that have a defined
 * status (`ok !== null`). Used by the widget header copy: e.g.
 * "Auto-saved · 4/5 gates pass" (or "3/4 gates pass" when one is muted).
 */
export function countPassingGates(gates: GateRow[]): {
  passing: number;
  total: number;
} {
  const decided = gates.filter((g) => g.ok !== null);
  const passing = decided.filter((g) => g.ok === true).length;
  return { passing, total: decided.length };
}

// ---------------------------------------------------------------------------
// Per-gate computations
// ---------------------------------------------------------------------------

function maxSingleAllocationGate(
  mandate: AllocatorPreferences | null,
  strategies: DashboardStrategy[],
): GateRow {
  const cap = mandate?.max_weight ?? null;
  const currentMax = maxStrategyWeight(strategies);
  return {
    key: "max_single_allocation",
    label: "Max single allocation",
    gate: cap == null ? "—" : formatPercent(cap, 0, { signed: false }),
    current:
      currentMax == null ? "—" : formatPercent(currentMax, 1, { signed: false }),
    ok: cap == null || currentMax == null ? null : currentMax <= cap,
  };
}

function minSharpeGate(
  mandate: AllocatorPreferences | null,
  analytics: PortfolioAnalytics | null,
): GateRow {
  const floor = mandate?.min_sharpe ?? null;
  const current = analytics?.portfolio_sharpe ?? null;
  return {
    key: "min_sharpe",
    label: "Min Sharpe (90d)",
    gate: floor == null ? "—" : formatNumber(floor, 2),
    current: current == null ? "—" : formatNumber(current, 2),
    ok: floor == null || current == null ? null : current >= floor,
  };
}

function maxDdFloorGate(
  mandate: AllocatorPreferences | null,
  analytics: PortfolioAnalytics | null,
): GateRow {
  // mandate.max_drawdown_tolerance is stored as a positive magnitude
  // (validation: 0..1, see `validateSelfEditableInput`). The prototype
  // displays the gate negative-signed ("-7.5%") so we negate for display.
  const tolerance = mandate?.max_drawdown_tolerance ?? null;
  const current = analytics?.portfolio_max_drawdown ?? null;
  return {
    key: "max_dd_floor",
    label: "Max DD floor",
    gate:
      tolerance == null
        ? "—"
        : formatPercent(-Math.abs(tolerance), 1, { signed: false }),
    current:
      current == null ? "—" : formatPercent(current, 1, { signed: false }),
    ok:
      tolerance == null || current == null
        ? null
        : Math.abs(current) <= Math.abs(tolerance),
  };
}

function minAumGate(
  mandate: AllocatorPreferences | null,
  holdingsSummary: DashboardHolding[],
): GateRow {
  const tier = mandate?.liquidity_preference ?? null;
  const threshold = tier == null ? null : LIQUIDITY_TO_MIN_AUM[tier];
  const totalAum = holdingsSummary.reduce(
    (sum, h) => sum + (typeof h.value_usd === "number" ? h.value_usd : 0),
    0,
  );
  // When holdingsSummary is empty, totalAum is 0 — surface that as "—" rather
  // than "$0" so the empty-state allocator doesn't see a misleading "fails".
  const currentValue = holdingsSummary.length === 0 ? null : totalAum;
  return {
    key: "min_aum",
    label: "Min AUM",
    gate: threshold == null ? "—" : formatCurrency(threshold),
    current: currentValue == null ? "—" : formatCurrency(currentValue),
    ok:
      threshold == null || currentValue == null
        ? null
        : currentValue >= threshold,
  };
}

function styleConcentrationGate(
  mandate: AllocatorPreferences | null,
  strategies: DashboardStrategy[],
): GateRow {
  const cap = mandate?.max_aum_concentration ?? null;
  const currentMax = maxGroupedWeightByStyle(strategies);
  return {
    key: "style_concentration",
    label: "Style concentration",
    gate:
      cap == null ? "—" : `${formatPercent(cap, 0, { signed: false })} cap`,
    current:
      currentMax == null ? "—" : formatPercent(currentMax, 1, { signed: false }),
    ok: cap == null || currentMax == null ? null : currentMax <= cap,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function maxStrategyWeight(strategies: DashboardStrategy[]): number | null {
  let max: number | null = null;
  for (const s of strategies) {
    const w = s.current_weight;
    if (typeof w !== "number") continue;
    if (max == null || w > max) max = w;
  }
  return max;
}

/**
 * Group `current_weight` by the strategy's first declared `strategy_type` and
 * return the maximum group's total weight. Strategies with no
 * `strategy_types[0]` are bucketed under `"unknown"` so they still count
 * toward concentration.
 */
function maxGroupedWeightByStyle(
  strategies: DashboardStrategy[],
): number | null {
  if (strategies.length === 0) return null;
  const totals = new Map<string, number>();
  for (const s of strategies) {
    const w = s.current_weight;
    if (typeof w !== "number") continue;
    const tag = s.strategy.strategy_types?.[0] ?? "unknown";
    totals.set(tag, (totals.get(tag) ?? 0) + w);
  }
  if (totals.size === 0) return null;
  let max = 0;
  for (const v of totals.values()) if (v > max) max = v;
  return max;
}
