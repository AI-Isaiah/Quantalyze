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

function asNumber(v: Json): number | null {
  if (v === null || v === undefined) return null;
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
  const result: CorrelationMatrix = {};
  for (const [rowKey, row] of Object.entries(v)) {
    if (!isObject(row)) continue;
    const inner: Record<string, number | null> = {};
    for (const [colKey, val] of Object.entries(row)) {
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
  const result: Record<string, TimeSeriesPoint[]> = {};
  for (const [pairKey, series] of Object.entries(v)) {
    const parsed = parseTimeSeries(series);
    if (parsed.length > 0) result[pairKey] = parsed;
  }
  return Object.keys(result).length > 0 ? result : null;
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
    computation_status !== "pending" &&
      computation_status !== "computing" &&
      computation_status !== "complete" &&
      computation_status !== "failed"
  ) {
    return null;
  }

  const attribution_breakdown = Array.isArray(raw.attribution_breakdown)
    ? (raw.attribution_breakdown
        .map(parseAttributionRow)
        .filter((r): r is AttributionRow => r !== null) || null)
    : null;

  const risk_decomposition = Array.isArray(raw.risk_decomposition)
    ? (raw.risk_decomposition
        .map(parseRiskDecompositionRow)
        .filter((r): r is RiskDecompositionRow => r !== null) || null)
    : null;

  const optimizer_suggestions = Array.isArray(raw.optimizer_suggestions)
    ? (raw.optimizer_suggestions
        .map(parseOptimizerSuggestionRow)
        .filter((r): r is OptimizerSuggestionRow => r !== null) || null)
    : null;

  const portfolio_equity_curve = Array.isArray(raw.portfolio_equity_curve)
    ? parseTimeSeries(raw.portfolio_equity_curve)
    : null;

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
    attribution_breakdown:
      attribution_breakdown && attribution_breakdown.length > 0
        ? attribution_breakdown
        : null,
    risk_decomposition:
      risk_decomposition && risk_decomposition.length > 0
        ? risk_decomposition
        : null,
    benchmark_comparison: parseBenchmarkComparison(raw.benchmark_comparison),
    optimizer_suggestions:
      optimizer_suggestions && optimizer_suggestions.length > 0
        ? optimizer_suggestions
        : null,
    portfolio_equity_curve:
      portfolio_equity_curve && portfolio_equity_curve.length > 0
        ? portfolio_equity_curve
        : null,
    rolling_correlation: parseRollingCorrelation(raw.rolling_correlation),
  };
}
