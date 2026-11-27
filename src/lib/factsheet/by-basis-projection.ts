/**
 * Phase 243 (DBBACKSTOP) plan 03, DBACC-01 half (a) - the factsheet builder reads
 * `strategy_analytics.metrics_json_by_basis` as 21 NAMED `->` aliases, never as the whole column.
 *
 * Why (DBACC-01 / TODOS RANK-SPLAT-01): a basis object in that column carries whole series
 * arrays, and the only values any reader of the factsheet payload needs are the seven headline
 * scalars per basis (`BASIS_KPI_MAP` in `basis-metrics.ts`) for each of the three bases. Reading
 * the column whole would hand every key the analytics writer ever adds to every signed-out
 * visitor of a published strategy. This module is the ONE select fragment and the ONE rebuild
 * rule; the builder imports both, and plan 04 moves the OG route onto the same fragment.
 *
 * Alias form: `by_basis_<basis>_<serverKey>:metrics_json_by_basis-><basis>-><serverKey>`.
 *
 * `->` (jsonb) and never the text-returning double-arrow operator: `->` keeps a KPI a number.
 * A text value would fail the finite-number check, become NaN and render as the em-dash.
 *
 * ONE DIVERGENCE from reading the raw column: a basis that is present but whose seven KPI values
 * are all null is OMITTED by the rebuild (the aliases cannot tell "object with seven nulls" from
 * "no object"). PROD frequency of that shape: 0 rows (orchestrator read Q6, 2026-11-26). The
 * divergence is pinned by a test in `by-basis-projection.test.ts`.
 *
 * Plan 09 (PR-B) revokes anon's SELECT on the column. A column grant covers every expression
 * over the column, so `anon` cannot read even these aliases; only a client holding the grant
 * (the admin client the builder uses) reads them.
 *
 * Adding a key means editing, together: the literal below, the hand-typed
 * `PINNED_BY_BASIS_ALIAS_NAMES` in `src/lib/test-helpers/by-basis-alias-row.ts`, and the
 * RESEARCH-derived consumer census. The literal is hand-written, not built with `.join()`, so
 * the builder's interpolating template stays literal-typed for postgrest-js's select parser.
 *
 * No `server-only` import, for the same reason `figure-record-scalars.ts` gives: a client or
 * test module may need the fragment or the rebuild.
 */

export const BY_BASIS_BASES = ["cash_settlement", "mark_to_market", "smoothed_mtm"] as const;

/** The seven server keys per basis, in `BASIS_KPI_MAP` order. */
const BY_BASIS_KEYS = [
  "cumulative_return",
  "volatility",
  "max_drawdown",
  "cagr",
  "sharpe",
  "sortino",
  "calmar",
] as const;

export const BY_BASIS_ALIASES =
  "by_basis_cash_settlement_cumulative_return:metrics_json_by_basis->cash_settlement->cumulative_return, by_basis_cash_settlement_volatility:metrics_json_by_basis->cash_settlement->volatility, by_basis_cash_settlement_max_drawdown:metrics_json_by_basis->cash_settlement->max_drawdown, by_basis_cash_settlement_cagr:metrics_json_by_basis->cash_settlement->cagr, by_basis_cash_settlement_sharpe:metrics_json_by_basis->cash_settlement->sharpe, by_basis_cash_settlement_sortino:metrics_json_by_basis->cash_settlement->sortino, by_basis_cash_settlement_calmar:metrics_json_by_basis->cash_settlement->calmar, " +
  "by_basis_mark_to_market_cumulative_return:metrics_json_by_basis->mark_to_market->cumulative_return, by_basis_mark_to_market_volatility:metrics_json_by_basis->mark_to_market->volatility, by_basis_mark_to_market_max_drawdown:metrics_json_by_basis->mark_to_market->max_drawdown, by_basis_mark_to_market_cagr:metrics_json_by_basis->mark_to_market->cagr, by_basis_mark_to_market_sharpe:metrics_json_by_basis->mark_to_market->sharpe, by_basis_mark_to_market_sortino:metrics_json_by_basis->mark_to_market->sortino, by_basis_mark_to_market_calmar:metrics_json_by_basis->mark_to_market->calmar, " +
  "by_basis_smoothed_mtm_cumulative_return:metrics_json_by_basis->smoothed_mtm->cumulative_return, by_basis_smoothed_mtm_volatility:metrics_json_by_basis->smoothed_mtm->volatility, by_basis_smoothed_mtm_max_drawdown:metrics_json_by_basis->smoothed_mtm->max_drawdown, by_basis_smoothed_mtm_cagr:metrics_json_by_basis->smoothed_mtm->cagr, by_basis_smoothed_mtm_sharpe:metrics_json_by_basis->smoothed_mtm->sharpe, by_basis_smoothed_mtm_sortino:metrics_json_by_basis->smoothed_mtm->sortino, by_basis_smoothed_mtm_calmar:metrics_json_by_basis->smoothed_mtm->calmar";

/**
 * Rebuilds the writer-shaped per-basis object from the alias fields of one `strategy_analytics`
 * row. A value that is not a finite number becomes null. A basis whose seven values are all
 * null or undefined is OMITTED (the documented divergence); any other basis is emitted with all
 * seven keys. Returns undefined when no basis is emitted.
 */
export function rebuildMetricsJsonByBasis(
  row: Record<string, unknown> | null | undefined,
): Record<string, Record<string, number | null>> | undefined {
  if (!row) return undefined;
  const out: Record<string, Record<string, number | null>> = {};
  for (const basis of BY_BASIS_BASES) {
    const obj: Record<string, number | null> = {};
    let anyValue = false;
    for (const key of BY_BASIS_KEYS) {
      const v = row[`by_basis_${basis}_${key}`];
      const n = typeof v === "number" && Number.isFinite(v) ? v : null;
      if (n !== null) anyValue = true;
      obj[key] = n;
    }
    if (anyValue) out[basis] = obj;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
