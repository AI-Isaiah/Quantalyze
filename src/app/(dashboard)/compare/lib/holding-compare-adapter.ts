/**
 * Phase 09 / D-15 + LIVE-03 + findings f6 (charset) + g4 (render branch).
 * /compare parser extension for holding ids.
 *
 * Detects "holding:{venue}:{symbol}:{holding_type}" prefix BEFORE the
 * strategies .in("id", ids) fetch per RESEARCH Pitfall 8. Validates that
 * each of venue / symbol / holding_type matches /^[A-Za-z0-9_-]+$/ per
 * finding f6 — enforcing the Phase 08 D-08 scope_ref invariant that
 * notes + audit entity_id rely on. Holding-side access is RLS-gated on
 * allocator_equity_snapshots — unauthorized reads return zero rows which
 * we surface as a generic "not available" message with no existence leak.
 *
 * Metrics math mirrors analytics-service/services/equity_reconstruction.py
 * reconstruct_symbol_returns (Plan 09-02) — same dropna convention,
 * same cumulative-product semantics.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ParsedHoldingCompareId = {
  venue: string;
  symbol: string;
  holding_type: string;
};

/** Charset invariant per Phase 08 D-08 / finding f6. */
const SAFE_PART = /^[A-Za-z0-9_-]+$/;

/**
 * Parse a holding compare id of the form "holding:{venue}:{symbol}:{holding_type}".
 *
 * Returns null when:
 * - id does not start with "holding:"
 * - parts count after the prefix is not exactly 3
 * - any part is empty
 * - any part contains characters outside /^[A-Za-z0-9_-]+$/ (finding f6)
 */
export function parseHoldingCompareId(id: string): ParsedHoldingCompareId | null {
  if (!id || typeof id !== "string") return null;
  if (!id.startsWith("holding:")) return null;
  const parts = id.slice("holding:".length).split(":");
  if (parts.length !== 3) return null;
  const [venue, symbol, holding_type] = parts;
  if (!venue || !symbol || !holding_type) return null;
  // Finding f6: enforce Phase 08 D-08 scope_ref charset invariant.
  // Each segment (venue, symbol, holding_type) must match /^[A-Za-z0-9_-]+$/
  // — same character set as Phase 08 notes + audit entity_id scope_refs.
  if (!SAFE_PART.test(venue)) return null;
  if (!SAFE_PART.test(symbol)) return null;
  if (!SAFE_PART.test(holding_type)) return null;
  return { venue, symbol, holding_type };
}

export type HoldingCompareAnalytics = {
  cumulative_return: number | null;
  sharpe: number | null;
  max_drawdown: number | null;
  vol: number | null;
};

export type HoldingCompareItem = {
  kind: "holding";
  holding_ref: string;
  venue: string;
  symbol: string;
  holding_type: string;
  analytics: HoldingCompareAnalytics;
};

/**
 * Reconstruct per-symbol daily returns from breakdown jsonb + compute institutional metrics.
 * Mirrors Python reconstruct_symbol_returns (analytics-service/services/equity_reconstruction.py):
 * - Drop absent/zero days (RESEARCH Pitfall 2 — no forward-fill)
 * - pct_change semantics: return[i] = value[i] / value[i-1] - 1
 * - cumulative_return = product(1 + r) - 1
 * - sharpe = mean(returns) / std(returns) * sqrt(365) [population std]
 * - max_drawdown via cumulative-product running-peak
 * - vol = std(returns) * sqrt(365)
 * Returns null metrics when fewer than 2 symbol-present data points exist.
 */
function reconstructAndAnalyze(
  snapshots: Array<{ asof: string; breakdown: Record<string, number> | null }>,
  symbol: string,
): HoldingCompareAnalytics {
  // Extract non-zero, finite values for the symbol
  const values: number[] = [];
  for (const s of snapshots) {
    const v = s.breakdown?.[symbol];
    if (v == null || typeof v !== "number" || !Number.isFinite(v) || v === 0) continue;
    values.push(v);
  }
  if (values.length < 2) {
    return { cumulative_return: null, sharpe: null, max_drawdown: null, vol: null };
  }

  // Compute daily returns: (value[i] / value[i-1]) - 1
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    returns.push(values[i] / values[i - 1] - 1);
  }
  if (returns.length === 0) {
    return { cumulative_return: null, sharpe: null, max_drawdown: null, vol: null };
  }

  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  // Population variance (matches numpy ddof=0 default)
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const ANNUAL = 365;

  const cumulative_return = returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
  const vol = std * Math.sqrt(ANNUAL);
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(ANNUAL) : null;

  // Max drawdown via running peak on the raw value series
  let peak = values[0];
  let maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  return {
    cumulative_return: Number.isFinite(cumulative_return) ? cumulative_return : null,
    sharpe: sharpe != null && Number.isFinite(sharpe) ? sharpe : null,
    max_drawdown: Number.isFinite(maxDD) ? maxDD : null,
    vol: Number.isFinite(vol) ? vol : null,
  };
}

/**
 * Fetch a holding's comparison item via user-scoped supabase client.
 *
 * Returns null when:
 * - parse fails (incl. charset rejection per finding f6)
 * - zero snapshot rows (RLS-blocked or no data — D-15 no existence leak)
 * - symbol absent from all breakdowns
 * - fewer than 2 data points (cannot compute any return)
 *
 * Per D-15: caller cannot distinguish "unowned holding" from "nonexistent
 * holding" — both return null with no additional error information.
 */
export async function fetchHoldingCompareItem(params: {
  allocator_id: string;
  holding_ref: string;
  supabase: SupabaseClient;
}): Promise<HoldingCompareItem | null> {
  const parsed = parseHoldingCompareId(params.holding_ref);
  if (!parsed) return null;

  const { data, error } = await params.supabase
    .from("allocator_equity_snapshots")
    .select("asof, breakdown")
    .eq("allocator_id", params.allocator_id)
    .order("asof", { ascending: true })
    .limit(730);

  if (error || !data || data.length === 0) return null;

  const analytics = reconstructAndAnalyze(
    data as Array<{ asof: string; breakdown: Record<string, number> | null }>,
    parsed.symbol,
  );

  // If all metrics are null the symbol had insufficient data — treat as not available
  if (
    analytics.cumulative_return === null &&
    analytics.sharpe === null &&
    analytics.max_drawdown === null &&
    analytics.vol === null
  ) {
    return null;
  }

  return {
    kind: "holding",
    holding_ref: params.holding_ref,
    venue: parsed.venue,
    symbol: parsed.symbol,
    holding_type: parsed.holding_type,
    analytics,
  };
}
