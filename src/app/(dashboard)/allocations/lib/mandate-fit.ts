/**
 * Phase 10 Plan 05 Task 1 — mandate-fit.ts pure module.
 *
 * Pure TypeScript — no fetch, no DOM, no React. Phase 10 D-08 + RESEARCH
 * Pitfall 7. Computes an APPROXIMATE mandate-fit tier client-side from
 * allocator mandate preferences + strategy attributes. The authoritative
 * `mandate_fit_score` is engine-computed against a specific allocator's
 * universe at score time (lives in `match_candidates.score_breakdown`
 * JSONB) — that source is not directly available to the browse drawer
 * without an extra round-trip. This pill is INFORMATIONAL only (D-08);
 * allocators are NEVER blocked from adding any verified strategy.
 *
 * Threshold rubric (L2 — pinned to D-08 0.7/0.4 verbatim for grep-consistency
 * with the Phase 10 CONTEXT decision):
 *   - HARD-RED: any strategy_type matches an excluded type → red
 *   - GREEN  : market overlap fraction >= 0.7
 *   - YELLOW : 0.4 <= fraction < 0.7  OR mandate is missing/empty (informational fallback)
 *   - RED    : fraction < 0.4 (including zero overlap when mandate has prefs)
 *
 * "Fraction" = overlap of strategy.markets with mandate.preferred_markets,
 * divided by strategy.markets.length. Empty strategy.markets with non-empty
 * preferred_markets → red (no overlap possible).
 */

export type MandateFitTier = "green" | "yellow" | "red";

export interface BrowseStrategyForFit {
  id: string;
  markets: string[];
  strategy_types: string[];
}

export interface AllocatorMandateForFit {
  preferred_markets?: string[] | null;
  excluded_strategy_types?: string[] | null;
  // Other mandate fields available but not used by the v0.15 approximation:
  max_weight?: number | null;
  min_aum_tier?: string | null;
}

export function computeMandateFitApprox(
  strategy: BrowseStrategyForFit,
  mandate: AllocatorMandateForFit | null | undefined,
): MandateFitTier {
  // T5 — informational fallback when no mandate signal.
  if (!mandate) return "yellow";

  // T4 — hard-red: any excluded strategy_type wins regardless of market match.
  const excludedTypes = new Set(mandate.excluded_strategy_types ?? []);
  for (const t of strategy.strategy_types) {
    if (excludedTypes.has(t)) return "red";
  }

  const prefs = mandate.preferred_markets;
  if (!prefs || prefs.length === 0) return "yellow"; // T5c — no signal.

  const stratMarkets = strategy.markets ?? [];
  if (stratMarkets.length === 0) return "red"; // T6 — no overlap possible.

  const prefSet = new Set(prefs);
  const overlap = stratMarkets.filter((m) => prefSet.has(m)).length;
  const fraction = overlap / stratMarkets.length;

  // L2 — pinned to D-08 thresholds (0.7 / 0.4) for grep-consistency.
  if (fraction >= 0.7) return "green"; // T1
  if (fraction >= 0.4) return "yellow"; // T3 — partial fit
  return "red"; // T2 — minimal overlap (incl. fraction=0)
}
