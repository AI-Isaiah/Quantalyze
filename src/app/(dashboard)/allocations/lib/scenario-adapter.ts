/**
 * Pure TypeScript — no fetch, no side effects.
 * No network calls, no browser-storage / DOM access, no implicit time reads.
 *
 * Phase 10 Plan 01 — projects (holdings, addedStrategies, lookup maps) into the
 * unified `StrategyForBuilder[]` shape that the frozen `src/lib/scenario.ts`
 * engine consumes verbatim. Zero changes to scenario.ts allowed (SCENARIO-05
 * regression-pinned).
 *
 * The adapter is the pure projection layer. The composer (Plan 06) calls
 * `computeScenario(strategies, state, dateMapCache)` with this output. Weight
 * overrides — when present — are applied by the composer AFTER the adapter
 * returns; the adapter's job is shape projection only.
 *
 * B4-pinned signature: positional args, NOT a single inputs object. The
 * `addedStrategies` arg is `AddedStrategy[]` (lightweight; minted by
 * scenario-state.ts's add* helpers — H5 brand) and the lookup-map keys use
 * `StrategyForBuilderId` (the same brand). A hand-rolled `StrategyForBuilder`
 * literal cannot pass through as an AddedStrategy at compile time.
 */
import type { DailyPoint, ScenarioState, StrategyForBuilder } from "@/lib/scenario";
import { buildHoldingRef, type HoldingType } from "./holding-outcome-adapter";

/** Narrow holding shape for buildHoldingRef. The state-layer HoldingForDefault
 *  carries `holding_type: string` (it's the persisted draft type, intentionally
 *  loose so localStorage round-trip never narrows). The adapter narrows it to
 *  the `HoldingType` union here at the boundary so buildHoldingRef can accept
 *  the value without a cast. Production callers always pass spot|derivative;
 *  any other value would already be invalid upstream. */
type HoldingRefInput = { venue: string; symbol: string; holding_type: HoldingType };
import {
  type AddedStrategy,
  type HoldingForDefault,
} from "./scenario-state";

/**
 * H5 — phantom branded type. Re-exported here so adapter callers can use it
 * without importing from the state module directly. The brand is the same
 * underlying `string & { readonly __brand: "scenario-builder-id" }` declared
 * in scenario-state.ts; this declaration is structurally identical so values
 * minted there carry the brand through to this adapter's lookup-map keys.
 *
 * Compile-time guarantee: a hand-rolled `string` literal cannot be used as a
 * key in `Record<StrategyForBuilderId, ...>` without an explicit cast, and a
 * fully-constructed `StrategyForBuilder` cannot be passed where the adapter
 * expects an `AddedStrategy[]` because `AddedStrategy.id` carries the brand.
 */
export type StrategyForBuilderId = string & {
  readonly __brand: "scenario-builder-id";
};

/**
 * Optional inputs object alias for callers preferring object-spread. The
 * canonical export is the positional-args function.
 */
export interface ScenarioAdapterInputs {
  holdings: HoldingForDefault[];
  disabledHoldingRefs: Set<string>;
  addedStrategies: AddedStrategy[];
  holdingReturnsByScopeRef: Record<string, DailyPoint[]>;
  addedStrategyReturnsLookup: Record<StrategyForBuilderId, DailyPoint[]>;
  addedStrategyMetadataLookup: Record<
    StrategyForBuilderId,
    Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
  >;
  minReturnDays?: number;
}

/**
 * B4-pinned function signature — positional args. Returns the unified
 * `StrategyForBuilder[]` and a `ScenarioState` ready for `computeScenario()`.
 *
 * Default `minReturnDays` = 30 (Phase 07 D-03 warmup-gate mirror).
 */
export function buildStrategyForBuilderSet(
  holdings: HoldingForDefault[],
  disabledHoldingRefs: Set<string>,
  addedStrategies: AddedStrategy[],
  holdingReturnsByScopeRef: Record<string, DailyPoint[]>,
  addedStrategyReturnsLookup: Record<StrategyForBuilderId, DailyPoint[]>,
  addedStrategyMetadataLookup: Record<
    StrategyForBuilderId,
    Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
  >,
  minReturnDays: number = 30,
): { strategies: StrategyForBuilder[]; state: ScenarioState } {
  // Holdings → StrategyForBuilder via flatMap; warm-up gate excludes < minReturnDays.
  const holdingStrategies: StrategyForBuilder[] = holdings.flatMap((h) => {
    const scopeRef = buildHoldingRef(h as HoldingRefInput);
    const dailyReturns = holdingReturnsByScopeRef[scopeRef] ?? [];
    if (dailyReturns.length < minReturnDays) return [];
    return [
      {
        id: scopeRef, // "holding:{venue}:{symbol}:{holding_type}"
        name: h.symbol,
        codename: null,
        disclosure_tier: "public",
        strategy_types: [],
        markets: [h.venue],
        start_date: dailyReturns[0]?.date ?? null,
        daily_returns: dailyReturns,
        cagr: null,
        sharpe: null,
        volatility: null,
        max_drawdown: null,
      },
    ];
  });

  // Added strategies — built INSIDE the adapter from the lookup maps.
  const addedAsBuilder: StrategyForBuilder[] = addedStrategies.map((a) => {
    const meta = addedStrategyMetadataLookup[a.id] ?? {
      disclosure_tier: "public" as const,
      cagr: null,
      sharpe: null,
    };
    const returns = addedStrategyReturnsLookup[a.id] ?? [];
    return {
      id: a.id,
      name: a.name,
      codename: null,
      disclosure_tier: meta.disclosure_tier,
      strategy_types: a.strategy_types,
      markets: a.markets,
      start_date: returns[0]?.date ?? null,
      daily_returns: returns,
      cagr: meta.cagr,
      sharpe: meta.sharpe,
      volatility: null,
      max_drawdown: null,
    };
  });

  const allStrategies = [...holdingStrategies, ...addedAsBuilder];

  // Σ value_usd for default holding weights (composer applies overrides post-adapter).
  const totalValue = holdings.reduce(
    (s, h) => s + (Number.isFinite(h.value_usd) ? h.value_usd : 0),
    0,
  );

  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  const startDates: Record<string, string> = {};

  // Index holdings by scopeRef for O(1) value_usd lookup when computing default weights.
  const holdingByRef = new Map<string, HoldingForDefault>();
  for (const h of holdings) holdingByRef.set(buildHoldingRef(h as HoldingRefInput), h);

  for (const s of allStrategies) {
    const isHolding = holdingByRef.has(s.id);
    selected[s.id] = isHolding ? !disabledHoldingRefs.has(s.id) : true;
    if (isHolding) {
      const h = holdingByRef.get(s.id)!;
      weights[s.id] = totalValue > 0 ? h.value_usd / totalValue : 0;
    } else {
      weights[s.id] = 0;
    }
    startDates[s.id] = s.start_date ?? "2022-01-01";
  }

  return {
    strategies: allStrategies,
    state: { selected, weights, startDates },
  };
}
