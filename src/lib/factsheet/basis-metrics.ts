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

/**
 * Phase 90 (F1/F2) — the ONE availability criterion for a by-basis scalar set.
 *
 * True iff `obj` is a non-null object carrying a FINITE number for ALL seven
 * mapped {@link BASIS_KPI_MAP} scalars. This is the single predicate trusted by
 * BOTH server gates:
 *   - F1 (page.tsx): a composite whose persisted `cash_settlement` fails this
 *     is a DATA DEFECT — the page refuses to render the client-geometric
 *     headline (which would silently disagree with the arithmetic acceptance
 *     number) and shows the "still computing" placeholder instead.
 *   - F2 (page.tsx MTM gate): `mark_to_market` must pass this for the toggle to
 *     ENABLE. A null / empty / partial object ⇒ toggle DISABLED — never a
 *     cash-value-under-an-MTM-label leak.
 *
 * Using ONE criterion for the gate and the display overlay ({@link overlayMtmScalars})
 * closes the "gate trusts key-presence, display trusts value-finiteness" skew
 * that let a partial persist show cash as MTM (no-invented-data, D5).
 */
export function hasAllBasisScalars(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const rec = obj as Record<string, unknown>;
  return BASIS_KPI_MAP.every(({ serverKey }) => {
    const v = rec[serverKey];
    return typeof v === "number" && Number.isFinite(v);
  });
}

/**
 * Phase 90 (F2) — STRICT MTM display overlay for the KpiStrip.
 *
 * UNLIKE {@link overlayBasisScalars} (which leaves the base value untouched for
 * an absent/non-finite server scalar — correct for the CASH overlay, whose base
 * is already the coherent cash value), this overlay is used when the reader has
 * switched to the MARK-TO-MARKET label: any mapped scalar absent / non-finite in
 * the persisted MTM object renders `NaN` (→ "—" via the formatters), NEVER the
 * cash fallback. Displaying a cash number under an MTM eyebrow is the exact
 * no-invented-data violation D5 forbids.
 *
 * Only the seven mapped keys are rewritten; every other key on `base` (e.g. the
 * observation count `n`, and the cash-only distributional stats) is preserved.
 */
export function overlayMtmScalars<T extends Record<string, unknown>>(
  base: T,
  mtmScalars: Record<string, unknown> | undefined | null,
): T {
  const out: Record<string, unknown> = { ...base };
  for (const { tsKey, serverKey } of BASIS_KPI_MAP) {
    const v = mtmScalars?.[serverKey];
    out[tsKey] = typeof v === "number" && Number.isFinite(v) ? v : NaN;
  }
  return out as T;
}
