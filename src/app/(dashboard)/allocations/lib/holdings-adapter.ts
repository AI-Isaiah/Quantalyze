/**
 * Phase 09.1 Plan 04 / D-18. Pure read-side adapter joining holdingsSummary +
 * flaggedHoldings + matchDecisionsByHoldingRef + strategies[] (+ optional
 * per-strategy analytics) into the designer's HoldingsTable row shape.
 *
 * NO server-side payload widening (D-18). The adapter is a PURE transform:
 *   - no network calls
 *   - no browser-storage / DOM access
 *   - no implicit time reads — `now` is an injectable input for age math
 *
 * Strategy resolution: the adapter does NOT invent a holding→strategy join.
 * It consumes an OPTIONAL `holdingToStrategyId` map (caller-supplied, keyed
 * by `buildHoldingRef(venue, symbol, holding_type)`). When absent or when
 * a row's ref has no entry, `strategy` + every strategy-derived field fall
 * through to `null`. No symbol-string matching, no synthetic joins —
 * HoldingsTabPanel (Plan 08) is responsible for building this map from
 * whatever legacy correspondence produces strategy ids today.
 *
 * Threat model (09.1-04 §T-09.1-04-04): fabricated joins would silently
 * mis-attribute analytics to the wrong holding. The caller-supplied-map
 * contract is the mitigation.
 */
import { buildHoldingRef } from "./holding-outcome-adapter";
import { displayStrategyName } from "@/lib/strategy-display";
import type { DisclosureTier } from "@/lib/types";

/**
 * Composite-score thresholds (Phase 09 D-06; see flag-threshold.ts + D-05
 * of this plan). Scale: 0..100 (match_engine.py final_score).
 *   >= 50 → underperform  (flagged with a breach)
 *   [40, 50) → watch       (near-threshold, monitor)
 *   < 40 OR not flagged → ok
 */
export const FLAG_COMPOSITE_THRESHOLD = 50 as const;
export const WATCH_COMPOSITE_THRESHOLD = 40 as const;

export interface HoldingsAdapterInputs {
  holdingsSummary: Array<{
    venue: string;
    symbol: string;
    holding_type: "spot" | "derivative";
    quantity: number;
    value_usd: number;
    api_key_id?: string;
    /** ISO date (if present in payload). Drives age (days). */
    allocated_at?: string | null;
  }>;
  /**
   * Local flag shape for the adapter. Mirrors the fields we consume.
   * The LIVE `FlaggedHolding` type exposes `top_candidate_composite` —
   * the call site (HoldingsTabPanel, Plan 08) maps that value into the
   * `composite_score` field declared here. Keeping the adapter's input
   * shape independent of the live payload type keeps the boundary
   * narrow (D-18: no server widening).
   */
  flaggedHoldings: Array<{
    venue: string;
    symbol: string;
    holding_type: "spot" | "derivative";
    composite_score: number;
    top_candidate_strategy_id?: string | null;
  }>;
  /** Keyed by `buildHoldingRef(h)`. Drives bridgeCandidate boolean. */
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>;
  strategies: Array<{
    id: string;
    /**
     * audit-2026-05-07 G8.A.2 (P35): `name` is `null` server-side for
     * non-institutional rows (the canonical name is no longer shipped to
     * the client). Resolution falls through to alias → codename →
     * synthetic id (see `displayStrategyName`); the adapter mirrors that
     * priority.
     */
    name: string | null;
    alias?: string | null;
    codename?: string | null;
    disclosure_tier?: string | null;
    strategy_types?: string[] | null;
    strategy_analytics?: {
      sharpe?: number | null;
      max_drawdown?: number | null;
      mtd?: number | null;
    } | null;
  }>;
  /**
   * Optional pre-keyed analytics. If provided, takes precedence over
   * strategies[].strategy_analytics for resolved strategies.
   */
  analyticsByStrategyId?: Record<
    string,
    { sharpe: number | null; max_drawdown: number | null; mtd: number | null }
  >;
  /**
   * D-18 (R1 accepted): caller-supplied holding→strategy correspondence,
   * keyed by `buildHoldingRef(venue, symbol, holding_type)`. When absent
   * OR when a row's ref has no entry, `strategy` resolves to null. The
   * adapter NEVER invents a join. There is no holding→strategy join on
   * the dashboard payload today (apiKeys are joined for sync_status only),
   * so defaulting to null matches the current UI behavior exactly.
   */
  holdingToStrategyId?: Record<string, string>;
  /** Injectable "now" for age computation. Defaults to `new Date()`. */
  now?: Date;
}

export interface DesignHoldingRow {
  id: string;
  venue: string;
  symbol: string;
  holding_type: "spot" | "derivative";
  strategy: string | null;
  manager: string | null;
  tag: string | null;
  alloc: number;
  weight: number;
  mtd: number | null;
  sharpe: number | null;
  dd: number | null;
  age: number | null;
  status: "underperform" | "watch" | "ok";
  bridgeCandidate: boolean;
}

/**
 * Pure transform: holdingsSummary[] → DesignHoldingRow[].
 * Output length == input length. Row order preserved.
 */
export function toDesignHoldings(inputs: HoldingsAdapterInputs): DesignHoldingRow[] {
  const {
    holdingsSummary,
    flaggedHoldings,
    matchDecisionsByHoldingRef,
    strategies,
    analyticsByStrategyId,
    holdingToStrategyId,
    now,
  } = inputs;

  // Σ value_usd for weight denominator. Non-finite values treated as 0.
  const total = holdingsSummary.reduce(
    (sum, h) => sum + (Number.isFinite(h.value_usd) ? h.value_usd : 0),
    0,
  );

  // Index flaggedHoldings by ref for O(1) lookup.
  type AdapterFlag = HoldingsAdapterInputs["flaggedHoldings"][number];
  const flaggedByRef = new Map<string, AdapterFlag>();
  for (const f of flaggedHoldings) {
    flaggedByRef.set(buildHoldingRef(f), f);
  }

  // Index strategies by id for O(1) lookup.
  type AdapterStrategy = HoldingsAdapterInputs["strategies"][number];
  const strategiesById = new Map<string, AdapterStrategy>();
  for (const s of strategies) {
    strategiesById.set(s.id, s);
  }

  /**
   * Strategy join: caller-supplied map ONLY (D-18, R1 accepted).
   * No heuristic matching. No synthetic joins.
   */
  function findStrategy(ref: string): AdapterStrategy | null {
    const sid = holdingToStrategyId?.[ref];
    if (!sid) return null;
    return strategiesById.get(sid) ?? null;
  }

  const nowMs = (now ?? new Date()).getTime();

  return holdingsSummary.map((h): DesignHoldingRow => {
    const ref = buildHoldingRef(h);
    const flag = flaggedByRef.get(ref);
    const strat = findStrategy(ref);

    // Analytics resolution: analyticsByStrategyId wins when present,
    // otherwise fall through to strategies[].strategy_analytics. When
    // no strategy resolved, every analytic field is null.
    const analytics = strat
      ? analyticsByStrategyId?.[strat.id] ?? {
          sharpe: strat.strategy_analytics?.sharpe ?? null,
          max_drawdown: strat.strategy_analytics?.max_drawdown ?? null,
          mtd: strat.strategy_analytics?.mtd ?? null,
        }
      : { sharpe: null, max_drawdown: null, mtd: null };

    const weight = total > 0 ? h.value_usd / total : 0;

    // Status: ok by default. Flagged → underperform (>=50) / watch ([40,50)) / ok (< 40).
    let status: DesignHoldingRow["status"] = "ok";
    if (flag) {
      if (flag.composite_score >= FLAG_COMPOSITE_THRESHOLD) {
        status = "underperform";
      } else if (flag.composite_score >= WATCH_COMPOSITE_THRESHOLD) {
        status = "watch";
      } else {
        status = "ok";
      }
    }

    // Age in whole days since allocated_at. Null-safe + negative-safe
    // (age=null when allocated_at missing OR date is in the future).
    const ageMs = h.allocated_at ? nowMs - new Date(h.allocated_at).getTime() : null;
    const age = ageMs != null && ageMs >= 0 ? Math.floor(ageMs / 86_400_000) : null;

    const bridgeCandidate = matchDecisionsByHoldingRef[ref] != null;

    return {
      id: ref,
      venue: h.venue,
      symbol: h.symbol,
      holding_type: h.holding_type,
      // audit-2026-05-07 G8.A.10 (P43): route through `displayStrategyName`
      // so a non-institutional row (where P35 sets `name = null`) falls
      // back to codename → synthetic id rather than rendering as null.
      // Allocator-supplied alias still wins.
      strategy: strat
        ? strat.alias?.trim() ||
          displayStrategyName({
            id: strat.id,
            name: strat.name,
            codename: strat.codename ?? null,
            disclosure_tier: (strat.disclosure_tier ?? null) as DisclosureTier | null,
          })
        : null,
      manager: strat?.codename ?? null,
      tag: strat?.strategy_types?.[0] ?? null,
      alloc: h.value_usd,
      weight,
      mtd: analytics.mtd,
      sharpe: analytics.sharpe,
      dd: analytics.max_drawdown,
      age,
      status,
      bridgeCandidate,
    };
  });
}
