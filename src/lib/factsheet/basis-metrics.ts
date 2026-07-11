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
 * STRICT per-basis overlay for the seven {@link BASIS_KPI_MAP} headline scalars.
 *
 * Behaviour (Round-2 H-1 — every displayed by-basis scalar comes from the
 * persisted basis, never the client-computed value):
 *   - `serverScalars` ABSENT (`undefined`/`null`) → returns `base` UNCHANGED.
 *     This is the single-key / non-composite path: no persisted by-basis object,
 *     so the client-computed `base` is the coherent value (byte-identical).
 *   - `serverScalars` PRESENT → each of the seven mapped keys is rewritten to the
 *     persisted value when FINITE, else `NaN` (→ "—" via the formatters). A
 *     degenerate `calmar:null` / `sortino:null` (Python `_safe_float` persists
 *     JSON null for max_dd==0 / no-loss / zero-variance) therefore renders an
 *     honest "—", NOT the client-geometric value it would silently inherit under
 *     a lenient overlay (no-invented-data).
 *
 * Used three ways, all now strict:
 *   - CASH overlay (server, build-payload.ts): `serverScalars =
 *     cash_settlement` — only passed when present (composite), so the absent
 *     branch keeps single-key byte-identical.
 *   - MTM overlay (client, basis-context.tsx): `serverScalars = mark_to_market
 *     ?? {}` — an absent MTM object becomes `{}` → all seven "—", never cash.
 *
 * Only the seven mapped keys are rewritten; every other key on `base` (the
 * observation count `n`, cash-only distributional stats) is preserved.
 */
export function overlayBasisScalars<T extends Record<string, unknown>>(
  base: T,
  serverScalars: Record<string, unknown> | undefined | null,
): T {
  if (!serverScalars) return base;
  const out: Record<string, unknown> = { ...base };
  for (const { tsKey, serverKey } of BASIS_KPI_MAP) {
    const v = serverScalars[serverKey];
    out[tsKey] = typeof v === "number" && Number.isFinite(v) ? v : NaN;
  }
  return out as T;
}

/**
 * Round-2 H-1/M-1 — the ONE availability criterion for a by-basis scalar object.
 *
 * True iff `obj` is a non-null object with ALL seven mapped {@link BASIS_KPI_MAP}
 * KEYS structurally present AND a FINITE `cumulative_return`. It deliberately
 * distinguishes two failure modes:
 *   - STRUCTURAL absence (object missing entirely, a mapped key missing, or a
 *     non-finite `cumulative_return`) → false. `cumulative_return` is the
 *     invariance-critical headline scalar that must equal the chart endpoint /
 *     drive Cum. Return; if it can't be trusted the whole basis can't.
 *   - DEGENERATE per-scalar null (`calmar:null` on a zero-drawdown book,
 *     `sortino:null` with no losing day) → still true. Those keys are PRESENT
 *     (JSON null), and the strict {@link overlayBasisScalars} renders them "—".
 *
 * Trusted by BOTH server gates:
 *   - F1/H-1 (page.tsx cash gate): a composite whose `cash_settlement` fails
 *     this is a real data defect → still-computing placeholder. A degenerate-but-
 *     valid composite (finite `cumulative_return`, some other scalar null) RENDERS.
 *   - F2/M-1 (page.tsx MTM gate): restores locked D1 intent (key-presence, not
 *     all-seven-finite) while guarding a non-finite headline — a degenerate
 *     `sortino:null` no longer wrongly disables a displayable MTM basis.
 */
export function hasBasisHeadline(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const rec = obj as Record<string, unknown>;
  if (!BASIS_KPI_MAP.every(({ serverKey }) => serverKey in rec)) return false;
  const cr = rec["cumulative_return"];
  return typeof cr === "number" && Number.isFinite(cr);
}
