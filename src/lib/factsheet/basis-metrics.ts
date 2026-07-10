/**
 * Phase 90 (D5) — the ONE server↔TS basis-KPI mapping module.
 *
 * REACT-FREE by design: this is imported by the SERVER-SIDE payload builder
 * (`build-payload.ts`) for the D3 cash-scalar overlay AND by the client
 * `useBasisMetrics()` hook (lands in 90-05's `basis-context.tsx`). Keeping the
 * map here — not inside a `"use client"` module — means a single source of
 * truth for the seven guaranteed by-basis headline scalars with zero
 * duplication (D5). Do NOT import React / any client module into this file.
 *
 * Server `metrics_json_by_basis[basis]` top-level scalars use the Python
 * quantstats key names (`cumulative_return`/`volatility`/`max_drawdown`); the
 * TS `StrategyMetrics` shape uses shortened keys (`cum_ret`/`ann_vol`/`max_dd`).
 * The other four (cagr/sharpe/sortino/calmar) are 1:1. These SEVEN are the only
 * scalars guaranteed present per basis — everything else renders "—" under MTM
 * (no-invented-data, D5).
 */
export const BASIS_KPI_MAP: { tsKey: string; serverKey: string }[] = [
  { tsKey: "cum_ret", serverKey: "cumulative_return" },
  { tsKey: "ann_vol", serverKey: "volatility" },
  { tsKey: "max_dd", serverKey: "max_drawdown" },
  { tsKey: "cagr", serverKey: "cagr" },
  { tsKey: "sharpe", serverKey: "sharpe" },
  { tsKey: "sortino", serverKey: "sortino" },
  { tsKey: "calmar", serverKey: "calmar" },
];

/**
 * Return a shallow copy of `base` with ONLY the seven {@link BASIS_KPI_MAP}
 * keys overlaid from `serverScalars`, and only where the server value is a
 * FINITE number. An absent / null / non-finite server scalar leaves the base
 * (client-computed) value untouched — never overlay a hole (no-invented-data).
 *
 * Used two ways:
 *   - D3 cash overlay (server, build-payload.ts): base = client `strategyMetrics`,
 *     serverScalars = persisted `metrics_json_by_basis.cash_settlement`, so the
 *     headline reads the persisted arithmetic scalars the discovery/ranking
 *     surfaces already show (KpiStrip AND MetricsColumn agree).
 *   - MTM relabel (client, 90-05): serverScalars = `mark_to_market`.
 */
export function overlayBasisScalars<T extends Record<string, unknown>>(
  base: T,
  serverScalars: Record<string, number> | undefined | null,
): T {
  if (!serverScalars) return base;
  const out: Record<string, unknown> = { ...base };
  for (const { tsKey, serverKey } of BASIS_KPI_MAP) {
    const v = serverScalars[serverKey];
    if (typeof v === "number" && Number.isFinite(v)) out[tsKey] = v;
  }
  return out as T;
}
