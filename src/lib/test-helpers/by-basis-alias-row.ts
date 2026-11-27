/**
 * Phase 243 plan 03 - test-side twin of `src/lib/factsheet/by-basis-projection.ts`.
 *
 * `PINNED_BY_BASIS_ALIAS_NAMES` is HAND-TYPED on purpose. It is not derived from
 * `BY_BASIS_ALIASES` or `BASIS_KPI_MAP`, so a pin compared against it cannot pass tautologically:
 * adding or removing a key in the production literal makes the pin fail until a person edits this
 * list as well.
 *
 * `byBasisAliasRow` flattens a writer-shaped `metrics_json_by_basis` object into the alias
 * fields PostgREST answers for `BY_BASIS_ALIASES`, so a test fake can seed the alias shape.
 */

export const PINNED_BY_BASIS_ALIAS_NAMES: readonly string[] = [
  "by_basis_cash_settlement_cumulative_return", "by_basis_cash_settlement_volatility", "by_basis_cash_settlement_max_drawdown", "by_basis_cash_settlement_cagr", "by_basis_cash_settlement_sharpe", "by_basis_cash_settlement_sortino", "by_basis_cash_settlement_calmar",
  "by_basis_mark_to_market_cumulative_return", "by_basis_mark_to_market_volatility", "by_basis_mark_to_market_max_drawdown", "by_basis_mark_to_market_cagr", "by_basis_mark_to_market_sharpe", "by_basis_mark_to_market_sortino", "by_basis_mark_to_market_calmar",
  "by_basis_smoothed_mtm_cumulative_return", "by_basis_smoothed_mtm_volatility", "by_basis_smoothed_mtm_max_drawdown", "by_basis_smoothed_mtm_cagr", "by_basis_smoothed_mtm_sharpe", "by_basis_smoothed_mtm_sortino", "by_basis_smoothed_mtm_calmar",
];

/**
 * An absent basis gives null for each of its seven fields; an absent or non-object value gives
 * null for every field. Values are copied as-is (a test may seed a string to exercise the
 * rebuild's finite-number check).
 */
export function byBasisAliasRow(metricsJsonByBasis: unknown): Record<string, unknown> {
  const root =
    metricsJsonByBasis && typeof metricsJsonByBasis === "object"
      ? (metricsJsonByBasis as Record<string, unknown>)
      : {};
  const out: Record<string, unknown> = {};
  for (const name of PINNED_BY_BASIS_ALIAS_NAMES) {
    const m = /^by_basis_(cash_settlement|mark_to_market|smoothed_mtm)_(.+)$/.exec(name);
    if (!m) throw new Error(`byBasisAliasRow: unparsable pinned alias name ${name}`);
    const basisObj = root[m[1]];
    const v =
      basisObj && typeof basisObj === "object"
        ? (basisObj as Record<string, unknown>)[m[2]]
        : undefined;
    out[name] = v === undefined ? null : v;
  }
  return out;
}
