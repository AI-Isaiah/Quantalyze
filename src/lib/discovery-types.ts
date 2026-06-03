/**
 * Discovery / strategy-browse UI enums — single source of truth (M-0514).
 *
 * These string-literal unions are consumed by BOTH the client component
 * `@/components/strategy/StrategyFilters` (which re-exports them for back-compat)
 * AND the lib-layer preference codec `@/lib/discovery-prefs`. Hosting them here
 * in `src/lib` removes the prior lib→component type-import inversion (a `src/lib`
 * module should not depend on a `"use client"` component for its types) and the
 * latent import cycle that came with it.
 *
 * SortKey mirrors the sortable columns surfaced in the discovery filter bar.
 */
export type SortKey =
  | "computed_at"
  | "cumulative_return"
  | "cagr"
  | "sharpe"
  | "max_drawdown"
  | "volatility"
  | "aum";

export type SortDir = "asc" | "desc";

export type ViewMode = "table" | "grid";
