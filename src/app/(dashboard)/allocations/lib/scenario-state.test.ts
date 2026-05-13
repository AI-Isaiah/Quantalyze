/**
 * Phase 10 Plan 01 / Task 1 — RED tests for scenario-state.ts
 *
 * Pins the contract for the pure draft-state module:
 *   - defaultDraftFromHoldings — initial draft from live holdings (every holding enabled,
 *     weights = value_usd / total)
 *   - toggleHolding — flips toggleByScopeRef[ref], renormalizes remaining enabled to sum 1.0
 *   - addStrategyBrowse — new strategy = 1/(n+1), existing scaled by 1 - 1/(n+1)
 *     (M9 dedupe: second add of same id is a no-op)
 *   - addStrategyBridge — new strategy takes flagged holding's current weight; renormalize
 *     (M9 dedupe: second add of same id is a no-op)
 *   - removeAddedStrategy — removes from addedStrategies + toggle + weights, renormalize
 *   - setWeightOverride — sets weight for one ref, scales others so sum = 1.0
 *   - renormalizeWeights — sum-zero fallback to equal distribution
 *   - computeHoldingsFingerprint — order-invariant deterministic fingerprint
 *   - L5 (arity pin) defaultDraftFromHoldings(holdings, fingerprint?: string) — 2-arg form
 *
 * The sibling localStorage tests live in scenario-state.localStorage.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  computeHoldingsFingerprint,
  defaultDraftFromHoldings,
  toggleHolding,
  addStrategyBrowse,
  addStrategyBridge,
  removeAddedStrategy,
  setWeightOverride,
  renormalizeWeights,
  SCENARIO_SCHEMA_VERSION,
  type ScenarioDraft,
  type AddedStrategy,
  type HoldingForDefault,
} from "./scenario-state";

const TOL = 1e-9;

function sumEnabled(draft: ScenarioDraft): number {
  let s = 0;
  for (const [ref, on] of Object.entries(draft.toggleByScopeRef)) {
    if (on) s += draft.weightOverrides[ref] ?? 0;
  }
  return s;
}

const HOLDINGS_2: HoldingForDefault[] = [
  { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 60000 },
  { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 40000 },
];

const STRAT_A: AddedStrategy = {
  // Cast required because StrategyForBuilderId is a phantom branded type;
  // outside scenario-state.ts the cast acknowledges minting at the boundary.
  id: "uuid-1" as AddedStrategy["id"],
  name: "Strat A",
  markets: ["binance"],
  strategy_types: ["momentum"],
};

const STRAT_B: AddedStrategy = {
  id: "uuid-2" as AddedStrategy["id"],
  name: "Strat B",
  markets: ["binance"],
  strategy_types: ["mean_reversion"],
};

describe("defaultDraftFromHoldings", () => {
  it("T1.1 enables every holding and weights = value_usd / total; schema_version = 1", () => {
    const draft = defaultDraftFromHoldings(HOLDINGS_2);
    expect(draft.schema_version).toBe(SCENARIO_SCHEMA_VERSION);
    expect(draft.schema_version).toBe(1);
    expect(draft.toggleByScopeRef).toEqual({
      "holding:binance:BTC:spot": true,
      "holding:binance:ETH:spot": true,
    });
    expect(draft.addedStrategies).toEqual([]);
    expect(draft.weightOverrides["holding:binance:BTC:spot"]).toBeCloseTo(0.6, 9);
    expect(draft.weightOverrides["holding:binance:ETH:spot"]).toBeCloseTo(0.4, 9);
    expect(typeof draft.lastEditedAt).toBe("string");
  });

  it("T1.12 (L5 arity pin) accepts optional fingerprint as 2nd arg", () => {
    // 1-arg form computes fingerprint internally
    const draftA = defaultDraftFromHoldings(HOLDINGS_2);
    expect(draftA.init_holdings_fingerprint).toBe(
      computeHoldingsFingerprint(HOLDINGS_2),
    );
    // 2-arg form trusts the caller-supplied fingerprint verbatim
    const draftB = defaultDraftFromHoldings(HOLDINGS_2, "abc123");
    expect(draftB.init_holdings_fingerprint).toBe("abc123");
  });

  it("totalValue=0 edge case → all default weights = 0 (no division-by-zero crash)", () => {
    const zeros: HoldingForDefault[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 0 },
      { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 0 },
    ];
    const draft = defaultDraftFromHoldings(zeros);
    expect(draft.weightOverrides["holding:binance:BTC:spot"]).toBe(0);
    expect(draft.weightOverrides["holding:binance:ETH:spot"]).toBe(0);
  });
});

describe("toggleHolding", () => {
  it("T1.2 flips toggle to false, removes from weights, renormalizes other enabled to 1.0", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const toggled = toggleHolding(initial, "holding:binance:BTC:spot");
    expect(toggled.toggleByScopeRef["holding:binance:BTC:spot"]).toBe(false);
    expect(toggled.toggleByScopeRef["holding:binance:ETH:spot"]).toBe(true);
    expect(toggled.weightOverrides["holding:binance:ETH:spot"]).toBeCloseTo(1.0, 9);
    expect(sumEnabled(toggled)).toBeCloseTo(1.0, 9);
  });

  it("T1.3 toggle twice returns to original weight set within tolerance 1e-9", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const once = toggleHolding(initial, "holding:binance:BTC:spot");
    const twice = toggleHolding(once, "holding:binance:BTC:spot");
    expect(twice.toggleByScopeRef["holding:binance:BTC:spot"]).toBe(true);
    expect(twice.weightOverrides["holding:binance:BTC:spot"]).toBeCloseTo(0.6, 9);
    expect(twice.weightOverrides["holding:binance:ETH:spot"]).toBeCloseTo(0.4, 9);
    expect(sumEnabled(twice)).toBeCloseTo(1.0, 9);
  });

  it("returns a NEW draft (immutable transform)", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const next = toggleHolding(initial, "holding:binance:BTC:spot");
    expect(next).not.toBe(initial);
    // Original untouched
    expect(initial.toggleByScopeRef["holding:binance:BTC:spot"]).toBe(true);
  });
});

describe("addStrategyBrowse", () => {
  it("T1.4 sets new strategy weight = 1/(n+1); existing scaled by 1 - 1/(n+1); enabled sum = 1.0", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    // n = 2 enabled holdings; n+1 = 3 → new weight = 1/3
    const next = addStrategyBrowse(initial, STRAT_A);
    expect(next.addedStrategies.length).toBe(1);
    expect(next.addedStrategies[0].id).toBe("uuid-1");
    expect(next.toggleByScopeRef["uuid-1"]).toBe(true);
    expect(next.weightOverrides["uuid-1"]).toBeCloseTo(1 / 3, 9);
    // BTC was 0.6; scaled by 2/3 → 0.4
    expect(next.weightOverrides["holding:binance:BTC:spot"]).toBeCloseTo(0.4, 9);
    // ETH was 0.4; scaled by 2/3 → 0.2666...
    expect(next.weightOverrides["holding:binance:ETH:spot"]).toBeCloseTo(0.4 * (2 / 3), 9);
    expect(sumEnabled(next)).toBeCloseTo(1.0, 9);
  });

  it("T01_addStrategy_dedupe (M9) — second add of same id is a no-op", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const first = addStrategyBrowse(initial, STRAT_A);
    const second = addStrategyBrowse(first, STRAT_A);
    expect(second).toBe(first);
    expect(second.addedStrategies.length).toBe(1);
  });

  it("T1.4_R1 addStrategyBrowse preserves disabled-row weights (regression — review-pass P2)", () => {
    // Setup: two holdings, BTC at 0.6, ETH at 0.4. Toggle ETH OFF — its
    // 0.4 weight is preserved in weightOverrides (toggleHolding stores the
    // off-row's weight so a future toggle-on can restore it).
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const ethOff = toggleHolding(initial, "holding:binance:ETH:spot");
    const ethStoredWeight = ethOff.weightOverrides["holding:binance:ETH:spot"];
    expect(ethStoredWeight).toBeCloseTo(0.4, 9);
    expect(ethOff.toggleByScopeRef["holding:binance:ETH:spot"]).toBe(false);

    // Add a strategy via Browse. Pre-fix this would have built nextWeights
    // from {} and only carried over the ENABLED rows, dropping ETH's
    // preserved 0.4. Post-fix nextWeights starts from a copy of the full
    // weightOverrides map so the disabled-row weight survives.
    const withStrat = addStrategyBrowse(ethOff, STRAT_A);
    expect(withStrat.weightOverrides["holding:binance:ETH:spot"]).toBeCloseTo(
      0.4,
      9,
    );
    expect(withStrat.toggleByScopeRef["holding:binance:ETH:spot"]).toBe(false);

    // Now toggle ETH back ON. toggleHolding's "Toggle ON" branch restores
    // the original 0.4 only when the stored weight is in (0, 1) — pre-fix
    // the stored weight was 0 (dropped) and the path would fall back to
    // equal-distribution. Post-fix the original 0.4 survives, and toggling
    // ON scales the OTHER enabled rows by (1 - 0.4) so they re-balance to
    // 0.6 in aggregate while ETH's slot is exactly 0.4.
    const ethOn = toggleHolding(withStrat, "holding:binance:ETH:spot");
    expect(ethOn.weightOverrides["holding:binance:ETH:spot"]).toBeCloseTo(
      0.4,
      9,
    );
    // Sum of enabled weights still totals 1.0 within tolerance.
    expect(sumEnabled(ethOn)).toBeCloseTo(1.0, 9);
  });
});

describe("addStrategyBridge", () => {
  it("T1.5 new strategy takes flagged holding's current weight; renormalize so enabled sum = 1.0", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    // BTC weight = 0.6; new strategy takes 0.6; total before renorm = 1.6
    // After renorm: each is divided by 1.6 → BTC: 0.375, ETH: 0.25, STRAT_B: 0.375
    const next = addStrategyBridge(initial, "holding:binance:BTC:spot", STRAT_B);
    expect(next.addedStrategies[0].id).toBe("uuid-2");
    expect(next.toggleByScopeRef["holding:binance:BTC:spot"]).toBe(true);
    expect(next.toggleByScopeRef["uuid-2"]).toBe(true);
    expect(next.weightOverrides["holding:binance:BTC:spot"]).toBeCloseTo(0.6 / 1.6, 9);
    expect(next.weightOverrides["holding:binance:ETH:spot"]).toBeCloseTo(0.4 / 1.6, 9);
    expect(next.weightOverrides["uuid-2"]).toBeCloseTo(0.6 / 1.6, 9);
    expect(sumEnabled(next)).toBeCloseTo(1.0, 9);
  });

  it("T01_addStrategy_dedupe_bridge (M9) — second add of same id is a no-op", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const first = addStrategyBridge(initial, "holding:binance:BTC:spot", STRAT_B);
    const second = addStrategyBridge(first, "holding:binance:BTC:spot", STRAT_B);
    expect(second).toBe(first);
    expect(second.addedStrategies.length).toBe(1);
  });
});

describe("removeAddedStrategy", () => {
  it("T1.6 removes from addedStrategies + toggle + weights, renormalizes remaining enabled to 1.0", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const withStrategy = addStrategyBrowse(initial, STRAT_A);
    const removed = removeAddedStrategy(withStrategy, "uuid-1");
    expect(removed.addedStrategies).toEqual([]);
    expect(removed.toggleByScopeRef["uuid-1"]).toBeUndefined();
    expect(removed.weightOverrides["uuid-1"]).toBeUndefined();
    // After removal, only the two holdings remain; renormalized to original ratios.
    expect(removed.weightOverrides["holding:binance:BTC:spot"]).toBeCloseTo(0.6, 9);
    expect(removed.weightOverrides["holding:binance:ETH:spot"]).toBeCloseTo(0.4, 9);
    expect(sumEnabled(removed)).toBeCloseTo(1.0, 9);
  });
});

describe("setWeightOverride", () => {
  it("T1.7 sets BTC=0.8; scales other enabled rows so total sum = 1.0", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const next = setWeightOverride(initial, "holding:binance:BTC:spot", 0.8);
    expect(next.weightOverrides["holding:binance:BTC:spot"]).toBeCloseTo(0.8, 9);
    expect(next.weightOverrides["holding:binance:ETH:spot"]).toBeCloseTo(0.2, 9);
    expect(sumEnabled(next)).toBeCloseTo(1.0, 9);
  });

  // P1936 HIGH — audit-2026-05-07 Block C / Task C.4. The wire schema only
  // accepts weights in [0,1]; an unclamped value flows straight into
  // weightOverrides + downstream computeScenario, producing NaN/negative
  // metrics or 100%+ allocations. NaN/Infinity inputs must be a no-op so
  // an out-of-range numeric coercion can't blow up the running draft.
  it("P1936 clamps newWeight > 1 to 1", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const out = setWeightOverride(initial, "holding:binance:BTC:spot", 1.5);
    expect(out.weightOverrides["holding:binance:BTC:spot"]).toBe(1);
  });

  it("P1936 clamps newWeight < 0 to 0", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const out = setWeightOverride(initial, "holding:binance:BTC:spot", -0.2);
    expect(out.weightOverrides["holding:binance:BTC:spot"]).toBe(0);
  });

  it("P1936 rejects NaN as a no-op (returns the input draft by reference)", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const out = setWeightOverride(initial, "holding:binance:BTC:spot", Number.NaN);
    expect(out).toBe(initial);
  });

  it("P1936 rejects Infinity as a no-op (returns the input draft by reference)", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const out = setWeightOverride(
      initial,
      "holding:binance:BTC:spot",
      Number.POSITIVE_INFINITY,
    );
    expect(out).toBe(initial);
  });
});

describe("renormalizeWeights", () => {
  it("T1.8 already-summing-to-1 weights pass through unchanged", () => {
    const result = renormalizeWeights({ a: 0.6, b: 0.4, c: 0.5 }, ["a", "b"]);
    expect(result.a).toBeCloseTo(0.6, 9);
    expect(result.b).toBeCloseTo(0.4, 9);
    // c is not in enabled, excluded
    expect(result.c).toBeUndefined();
  });

  it("T1.9 sum-zero fallback to equal distribution", () => {
    const result = renormalizeWeights({ a: 0, b: 0 }, ["a", "b"]);
    expect(result.a).toBeCloseTo(0.5, 9);
    expect(result.b).toBeCloseTo(0.5, 9);
  });

  it("scales weights proportionally when sum != 1.0", () => {
    const result = renormalizeWeights({ a: 1.0, b: 1.0 }, ["a", "b"]);
    expect(result.a).toBeCloseTo(0.5, 9);
    expect(result.b).toBeCloseTo(0.5, 9);
  });
});

describe("computeHoldingsFingerprint", () => {
  it("T1.10 order-invariant — same set in different order produces same fingerprint", () => {
    const a = computeHoldingsFingerprint([
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
      { symbol: "ETH", venue: "binance", holding_type: "spot" },
    ]);
    const b = computeHoldingsFingerprint([
      { symbol: "ETH", venue: "binance", holding_type: "spot" },
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
    ]);
    expect(a).toBe(b);
  });

  it("T1.11 different holding sets produce different fingerprints", () => {
    const a = computeHoldingsFingerprint([
      { symbol: "BTC", venue: "binance", holding_type: "spot" },
    ]);
    const b = computeHoldingsFingerprint([
      { symbol: "ETH", venue: "binance", holding_type: "spot" },
    ]);
    expect(a).not.toBe(b);
  });

  it("empty array produces a stable empty-fingerprint", () => {
    const a = computeHoldingsFingerprint([]);
    const b = computeHoldingsFingerprint([]);
    expect(a).toBe(b);
    expect(typeof a).toBe("string");
  });

  // Reference TOL constant so the linter doesn't flag the import as unused.
  it("tolerance constant is reasonable", () => {
    expect(TOL).toBe(1e-9);
  });
});
