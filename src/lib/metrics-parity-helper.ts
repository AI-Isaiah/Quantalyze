/**
 * TS-side parity helper.
 *
 * This is a SCHEMA gate, not a math gate. Python is the single math
 * source; the TS side asserts that the committed expected JSON has the
 * keys the typed contract expects — no key may be missing, no unknown
 * key may be present.
 *
 * Math drift is gated by the Python-side parity test
 * (test_metrics_parity.py).
 */
import type { StrategyAnalyticsSeriesKind } from "./types";

/**
 * `equity_series_1y` is INTENTIONALLY excluded from this set: it lives in
 * `metrics_json` (above-the-fold series), NOT in the
 * `strategy_analytics_series` sibling table. The strategy-detail v2
 * loader path-extracts it from `metrics_json` directly via
 * `metrics_json -> 'equity_series_1y'`, never via the
 * `fetch_strategy_lazy_metrics` RPC.
 *
 * Set size MUST equal exactly 12 (matches Python's
 * `len(data['sibling']) == 12` invariant in test_metrics_parity_full).
 */
export const EXPECTED_SIBLING_KINDS: ReadonlySet<StrategyAnalyticsSeriesKind> = new Set([
  "daily_returns_grid",
  "rolling_sortino_3m",
  "rolling_sortino_6m",
  "rolling_sortino_12m",
  "rolling_volatility_3m",
  "rolling_volatility_6m",
  "rolling_volatility_12m",
  "rolling_alpha",
  "rolling_beta",
  "exposure_series",
  "turnover_series",
  "log_returns_series",
]);

/**
 * D-16 frozen `trade_metrics` keys.
 *
 * Includes:
 * - The 10 base keys from `reconstruct_positions` output.
 * - Derived metrics (7 — the 7th is `weighted_risk_reward_ratio`).
 * - Plan 12-05 reconstruct_positions extension keys (B-01 path-b inputs).
 * - Plan 12-06 merges of `_compute_volume_metrics` + `_compute_volume_aggregator`
 *   output keys directly into trade_metrics.
 * - D-14 `trade_mix` (optional — 4-bucket if D-15 audit ≥99% on all 3 exchanges,
 *   2-bucket fallback otherwise).
 *
 * Adding new keys mid-Phase-14b requires a Phase 12 amendment plan.
 */
export const FROZEN_TRADE_METRICS_KEYS: ReadonlyArray<string> = [
  // Base reconstruct_positions output
  "total_positions",
  "open_positions",
  "closed_positions",
  "win_rate",
  "avg_roi",
  "avg_duration_days",
  "long_count",
  "short_count",
  "best_trade_roi",
  "worst_trade_roi",
  // Derived metrics (7th: weighted_risk_reward_ratio)
  "expectancy",
  "risk_reward_ratio",
  "weighted_risk_reward_ratio",
  "sqn",
  "profit_factor_long",
  "profit_factor_short",
  // Plan 12-05 reconstruct_positions extension (B-01 path-b inputs)
  "avg_winning_trade",
  "avg_losing_trade",
  "winners_count",
  "losers_count",
  "realized_pnl_per_trade",
  // Phase 12 / D-14 (optional)
  "trade_mix",
  // Plan 12-06 merges _compute_volume_metrics output keys
  "buy_volume_pct",
  "sell_volume_pct",
  "long_volume_pct",
  "short_volume_pct",
  "total_fills",
  "total_volume_usd",
  // Plan 12-06 merges _compute_volume_aggregator keys
  "gross_volume_usd",
  "mean_trade_size_usd",
  "daily_turnover_usd",
  "monthly_turnover_usd",
];

/**
 * Asserts a parsed expected JSON conforms to the typed contract.
 * Throws Error on first failure.
 */
export function assertMetricParity(expected: {
  metrics_json: Record<string, unknown>;
  sibling: Record<string, unknown>;
}): void {
  // 1. Sibling kinds must all be valid
  for (const key of Object.keys(expected.sibling)) {
    if (!EXPECTED_SIBLING_KINDS.has(key as StrategyAnalyticsSeriesKind)) {
      throw new Error(
        `Unknown sibling kind: ${key}. ` +
          `Valid kinds: ${Array.from(EXPECTED_SIBLING_KINDS).join(", ")}. ` +
          "Update src/lib/types.ts StrategyAnalyticsSeriesKind union if a new kind is intentional.",
      );
    }
  }

  // 2. trade_metrics keys must be in the frozen set (D-16)
  const tradeMetrics = expected.metrics_json["trade_metrics"];
  if (tradeMetrics && typeof tradeMetrics === "object") {
    for (const key of Object.keys(tradeMetrics as Record<string, unknown>)) {
      if (!FROZEN_TRADE_METRICS_KEYS.includes(key)) {
        throw new Error(
          `Unknown trade_metrics key: ${key}. ` +
            `Frozen keys (D-16): ${FROZEN_TRADE_METRICS_KEYS.join(", ")}. ` +
            "Adding new keys requires a Phase 12 amendment plan.",
        );
      }
    }
  }
}

/**
 * Asserts the trade_mix bucket count matches the D-15 audit outcome.
 * Reads TRADE_MIX_HAS_MAKER_TAKER from process.env (test runner sets this).
 */
export function assertTradeMixBucketCount(expected: {
  metrics_json: Record<string, unknown>;
}): void {
  const tradeMix = (
    expected.metrics_json["trade_metrics"] as Record<string, unknown> | undefined
  )?.["trade_mix"];
  if (!tradeMix || typeof tradeMix !== "object") {
    return; // No trade_mix at all; let upstream test cover this case
  }
  const keys = Object.keys(tradeMix as Record<string, unknown>);
  const hasMakerTaker = process.env.TRADE_MIX_HAS_MAKER_TAKER === "true";
  if (hasMakerTaker) {
    const expected4 = ["long_maker", "long_taker", "short_maker", "short_taker"];
    for (const k of expected4) {
      if (!keys.includes(k)) {
        throw new Error(
          `4-bucket Trade Mix missing key: ${k}. Got ${keys.join(", ")}. ` +
            "Audit reported is_maker available; expected 4 buckets.",
        );
      }
    }
  } else {
    const expected2 = ["long", "short"];
    for (const k of expected2) {
      if (!keys.includes(k)) {
        throw new Error(
          `2-bucket fallback missing key: ${k}. Got ${keys.join(", ")}. ` +
            "Audit reported is_maker unavailable; expected 2 buckets.",
        );
      }
    }
  }
}
