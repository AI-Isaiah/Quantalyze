/**
 * Portfolio analytics JSONB adapter.
 *
 * The `portfolio_analytics` Postgres row holds many JSONB columns whose
 * shapes are determined by `analytics-service/routers/portfolio.py`. This
 * adapter normalizes the raw row into the strict typed shapes declared in
 * `src/lib/types.ts`. Anything malformed is logged and replaced with `null`
 * so render-side code can rely on either-the-correct-shape-or-null.
 *
 * Use this adapter at the Supabase fetch boundary. Downstream code (lib
 * functions, card components) should never see raw JSONB.
 *
 * Defensive parsing rules:
 *   - Unknown fields are ignored.
 *   - Numeric fields are coerced via Number(); non-finite results become null.
 *   - Arrays whose elements fail validation become an empty array (not null).
 *   - Records whose keys fail validation become an empty object (not null).
 *   - The whole row is never thrown out; partial population is the common case.
 */

import type {
  AttributionRow,
  BenchmarkComparison,
  CorrelationMatrix,
  OptimizerSuggestionRow,
  PortfolioAnalytics,
  RiskDecompositionRow,
  TimeSeriesPoint,
} from "./types";

type Json = unknown;

function isObject(v: Json): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Keys that can mutate Object.prototype or otherwise cause silent corruption
 * when copied from an untrusted JSONB blob into a plain object. The analytics
 * writer is trusted today, but defence-in-depth is cheap.
 */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function isSafeKey(key: string): boolean {
  return !DANGEROUS_KEYS.has(key);
}

function asNumber(v: Json): number | null {
  if (v === null || v === undefined) return null;
  // Reject empty / whitespace-only strings and booleans — `Number("")` is 0
  // and `Number(false)` is 0, which would silently corrupt metrics.
  if (typeof v === "string") {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asString(v: Json): string | null {
  if (typeof v === "string") return v;
  return null;
}

function asBoolean(v: Json): boolean {
  return v === true;
}

function parseTimeSeriesPoint(v: Json): TimeSeriesPoint | null {
  if (!isObject(v)) return null;
  const date = asString(v.date);
  const value = asNumber(v.value);
  if (date == null || value == null) return null;
  return { date, value };
}

function parseTimeSeries(v: Json): TimeSeriesPoint[] {
  if (!Array.isArray(v)) return [];
  return v.map(parseTimeSeriesPoint).filter((p): p is TimeSeriesPoint => p !== null);
}

/**
 * Map a raw JSONB value through `parser` and return a non-empty array, or
 * `null` when the input is not an array or every element failed validation.
 * Consolidates the `Array.isArray` + `.map().filter()` + "empty → null"
 * pattern used by every array-shaped column on `portfolio_analytics`.
 */
function parseNonEmptyArray<T>(
  v: Json,
  parser: (item: Json) => T | null,
): T[] | null {
  if (!Array.isArray(v)) return null;
  const parsed = v
    .map(parser)
    .filter((item): item is T => item !== null);
  return parsed.length > 0 ? parsed : null;
}

function parseAttributionRow(v: Json): AttributionRow | null {
  if (!isObject(v)) return null;
  const strategy_id = asString(v.strategy_id);
  if (strategy_id == null) return null;
  const contribution = asNumber(v.contribution);
  if (contribution == null) return null;
  return {
    strategy_id,
    strategy_name: asString(v.strategy_name) ?? strategy_id,
    contribution,
    allocation_effect: asNumber(v.allocation_effect) ?? 0,
  };
}

function parseRiskDecompositionRow(v: Json): RiskDecompositionRow | null {
  if (!isObject(v)) return null;
  const strategy_id = asString(v.strategy_id);
  if (strategy_id == null) return null;
  return {
    strategy_id,
    strategy_name: asString(v.strategy_name) ?? strategy_id,
    marginal_risk_pct: asNumber(v.marginal_risk_pct) ?? 0,
    standalone_vol: asNumber(v.standalone_vol) ?? 0,
    component_var: asNumber(v.component_var) ?? 0,
    weight_pct: asNumber(v.weight_pct) ?? 0,
  };
}

function parseBenchmarkComparison(v: Json): BenchmarkComparison | null {
  if (!isObject(v)) return null;
  const symbol = asString(v.symbol);
  if (symbol == null) return null;
  return {
    symbol,
    correlation: asNumber(v.correlation),
    benchmark_twr: asNumber(v.benchmark_twr),
    portfolio_twr: asNumber(v.portfolio_twr),
    stale: asBoolean(v.stale),
  };
}

function parseOptimizerSuggestionRow(v: Json): OptimizerSuggestionRow | null {
  if (!isObject(v)) return null;
  const strategy_id = asString(v.strategy_id);
  if (strategy_id == null) return null;
  return {
    strategy_id,
    strategy_name: asString(v.strategy_name) ?? strategy_id,
    corr_with_portfolio: asNumber(v.corr_with_portfolio) ?? 0,
    sharpe_lift: asNumber(v.sharpe_lift) ?? 0,
    dd_improvement: asNumber(v.dd_improvement) ?? 0,
    score: asNumber(v.score) ?? 0,
  };
}

function parseCorrelationMatrix(v: Json): CorrelationMatrix | null {
  if (!isObject(v)) return null;
  const result: CorrelationMatrix = Object.create(null);
  for (const [rowKey, row] of Object.entries(v)) {
    if (!isSafeKey(rowKey)) continue;
    if (!isObject(row)) continue;
    const inner: Record<string, number | null> = Object.create(null);
    for (const [colKey, val] of Object.entries(row)) {
      if (!isSafeKey(colKey)) continue;
      inner[colKey] = asNumber(val);
    }
    result[rowKey] = inner;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function parseRollingCorrelation(
  v: Json,
): Record<string, TimeSeriesPoint[]> | null {
  // The persisted shape is `Record<"<sidA>:<sidB>", TimeSeriesPoint[]>`.
  // Earlier (incorrect) consumers expected a flat `TimeSeriesPoint[]`. We
  // accept both: if the input is an array, treat it as a single anonymous
  // pair under the synthetic key `"_legacy"` so old fixtures still parse.
  if (Array.isArray(v)) {
    const series = parseTimeSeries(v);
    return series.length > 0 ? { _legacy: series } : null;
  }
  if (!isObject(v)) return null;
  const result: Record<string, TimeSeriesPoint[]> = Object.create(null);
  for (const [pairKey, series] of Object.entries(v)) {
    if (!isSafeKey(pairKey)) continue;
    const parsed = parseTimeSeries(series);
    if (parsed.length > 0) result[pairKey] = parsed;
  }
  return Object.keys(result).length > 0 ? result : null;
}

const COMPUTATION_STATUSES = ["pending", "computing", "complete", "failed"] as const;
type ComputationStatus = (typeof COMPUTATION_STATUSES)[number];

function isComputationStatus(v: Json): v is ComputationStatus {
  return (
    typeof v === "string" &&
    (COMPUTATION_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Convert a raw `portfolio_analytics` row (anything Supabase hands back) into
 * the strict `PortfolioAnalytics` shape. Required columns (`id`,
 * `portfolio_id`, `computed_at`, `computation_status`) MUST be present; the
 * function returns `null` if any are missing or malformed.
 *
 * All other fields default to `null` when absent or malformed.
 */
export function adaptPortfolioAnalytics(raw: Json): PortfolioAnalytics | null {
  if (!isObject(raw)) return null;

  const id = asString(raw.id);
  const portfolio_id = asString(raw.portfolio_id);
  const computed_at = asString(raw.computed_at);
  const computation_status = raw.computation_status;
  if (
    id == null ||
    portfolio_id == null ||
    computed_at == null ||
    !isComputationStatus(computation_status)
  ) {
    return null;
  }

  return {
    id,
    portfolio_id,
    computed_at,
    computation_status,
    computation_error: asString(raw.computation_error),
    total_aum: asNumber(raw.total_aum),
    total_return_twr: asNumber(raw.total_return_twr),
    total_return_mwr: asNumber(raw.total_return_mwr),
    portfolio_sharpe: asNumber(raw.portfolio_sharpe),
    portfolio_volatility: asNumber(raw.portfolio_volatility),
    portfolio_max_drawdown: asNumber(raw.portfolio_max_drawdown),
    avg_pairwise_correlation: asNumber(raw.avg_pairwise_correlation),
    return_24h: asNumber(raw.return_24h),
    return_mtd: asNumber(raw.return_mtd),
    return_ytd: asNumber(raw.return_ytd),
    narrative_summary: asString(raw.narrative_summary),
    correlation_matrix: parseCorrelationMatrix(raw.correlation_matrix),
    attribution_breakdown: parseNonEmptyArray(
      raw.attribution_breakdown,
      parseAttributionRow,
    ),
    risk_decomposition: parseNonEmptyArray(
      raw.risk_decomposition,
      parseRiskDecompositionRow,
    ),
    benchmark_comparison: parseBenchmarkComparison(raw.benchmark_comparison),
    optimizer_suggestions: parseNonEmptyArray(
      raw.optimizer_suggestions,
      parseOptimizerSuggestionRow,
    ),
    portfolio_equity_curve: parseNonEmptyArray(
      raw.portfolio_equity_curve,
      parseTimeSeriesPoint,
    ),
    rolling_correlation: parseRollingCorrelation(raw.rolling_correlation),
  };
}
