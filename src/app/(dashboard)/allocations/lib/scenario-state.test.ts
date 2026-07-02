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
  setWindow,
  renormalizeWeights,
  scenarioDraftCodec,
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
  it("T1.1 enables every holding and weights = value_usd / total; schema_version = current", () => {
    const draft = defaultDraftFromHoldings(HOLDINGS_2);
    expect(draft.schema_version).toBe(SCENARIO_SCHEMA_VERSION);
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

  // M-0152 — the "Toggle ON" branch must restore a preserved weight of EXACTLY
  // 1.0 (boundary) as the source of truth, scaling the others to 0. The pre-B7
  // guard `w > 0 && w < 1` excluded w === 1 and fell into equal-distribution,
  // silently discarding the 100% intent.
  it("M-0152 toggle ON restores a preserved weight of EXACTLY 1.0 (others → 0), not equal-distribution", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    // Drive BTC to 1.0 (ETH renormalizes to 0).
    const btcFull = setWeightOverride(initial, "holding:binance:BTC:spot", 1.0);
    expect(btcFull.weightOverrides["holding:binance:BTC:spot"]).toBeCloseTo(1.0, 9);
    // Toggle BTC OFF — its 1.0 is preserved; ETH (sole remaining) → 1.0.
    const btcOff = toggleHolding(btcFull, "holding:binance:BTC:spot");
    expect(btcOff.toggleByScopeRef["holding:binance:BTC:spot"]).toBe(false);
    expect(btcOff.weightOverrides["holding:binance:BTC:spot"]).toBeCloseTo(1.0, 9);
    // Toggle BTC back ON — preserved 1.0 is the source of truth: BTC=1.0,
    // ETH scaled by (1 - 1) = 0. Pre-fix this lost the intent (BTC→0, ETH→1.0).
    const btcOn = toggleHolding(btcOff, "holding:binance:BTC:spot");
    expect(btcOn.toggleByScopeRef["holding:binance:BTC:spot"]).toBe(true);
    expect(btcOn.weightOverrides["holding:binance:BTC:spot"]).toBeCloseTo(1.0, 9);
    expect(btcOn.weightOverrides["holding:binance:ETH:spot"]).toBeCloseTo(0, 9);
    expect(sumEnabled(btcOn)).toBeCloseTo(1.0, 9);
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

  // M-0151 (pr-test-analyzer) — the dedupe no-op above asserts via reference
  // identity (`second).toBe(first)`), which is brittle: a future defensive
  // clone (`return { ...draft }`) would break the assertion even though the
  // dedupe SEMANTICS still hold. Pin the behavior independently of reference
  // identity so the contract survives such a refactor:
  //   - no new addedStrategies entry (length + ids unchanged),
  //   - weightOverrides + toggleByScopeRef values unchanged,
  //   - lastEditedAt unchanged (proves no mutation path ran — a real add
  //     bumps lastEditedAt via new Date().toISOString()).
  it("M-0151: addStrategyBrowse dedupe is behaviorally a no-op (independent of reference identity)", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const first = addStrategyBrowse(initial, STRAT_A);
    const second = addStrategyBrowse(first, STRAT_A);
    // No new strategy pushed — ids set is identical.
    expect(second.addedStrategies.map((s) => s.id)).toEqual(
      first.addedStrategies.map((s) => s.id),
    );
    // Weight + toggle maps unchanged in VALUE (not just reference).
    expect(second.weightOverrides).toEqual(first.weightOverrides);
    expect(second.toggleByScopeRef).toEqual(first.toggleByScopeRef);
    // lastEditedAt unchanged — the real add path would bump it, so equality
    // here proves the mutating branch never ran.
    expect(second.lastEditedAt).toBe(first.lastEditedAt);
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

  // M-0151 (pr-test-analyzer) — behavioral no-op assertion for the Bridge
  // dedupe path, mirroring the Browse case: survives a defensive-clone
  // refactor that would break the `.toBe()` reference check.
  it("M-0151: addStrategyBridge dedupe is behaviorally a no-op (independent of reference identity)", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const first = addStrategyBridge(initial, "holding:binance:BTC:spot", STRAT_B);
    const second = addStrategyBridge(first, "holding:binance:BTC:spot", STRAT_B);
    expect(second.addedStrategies.map((s) => s.id)).toEqual(
      first.addedStrategies.map((s) => s.id),
    );
    expect(second.weightOverrides).toEqual(first.weightOverrides);
    expect(second.toggleByScopeRef).toEqual(first.toggleByScopeRef);
    expect(second.lastEditedAt).toBe(first.lastEditedAt);
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

  it("P1936 clamping BTC=1.5 → 1 also drives ETH renormalize to 0 (remainingMass = 0)", () => {
    // Without the renormalize step the clamp alone would leave ETH at 0.4
    // and the enabled sum would land at 1.4, breaking the wire schema. The
    // clamp + renormalize together must produce a valid sum-to-1 draft.
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    const out = setWeightOverride(initial, "holding:binance:BTC:spot", 1.5);
    expect(out.weightOverrides["holding:binance:BTC:spot"]).toBe(1);
    expect(out.weightOverrides["holding:binance:ETH:spot"]).toBeCloseTo(0, 9);
    expect(sumEnabled(out)).toBeCloseTo(1.0, 9);
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

  // H-0126 — setWeightOverride is the ONLY writer of `userWeightOverrides`; it
  // records exactly the user-touched ref (not the renormalized siblings), which
  // is what lets diffCount count a pure-rebalance without double-counting
  // toggle-off renormalization.
  it("H-0126 setWeightOverride records the touched ref in userWeightOverrides (only that ref)", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    expect(initial.userWeightOverrides).toBeUndefined();
    const out = setWeightOverride(initial, "holding:binance:BTC:spot", 0.8);
    expect(out.userWeightOverrides).toEqual({ "holding:binance:BTC:spot": 0.8 });
    // ETH was renormalized to 0.2 (a side-effect), NOT user-touched → unrecorded.
    expect(out.userWeightOverrides?.["holding:binance:ETH:spot"]).toBeUndefined();
  });

  it("H-0126 toggle/add do NOT write userWeightOverrides (renormalization never inflates diffCount)", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    expect(
      toggleHolding(initial, "holding:binance:BTC:spot").userWeightOverrides,
    ).toBeUndefined();
    expect(addStrategyBrowse(initial, STRAT_A).userWeightOverrides).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setWindow — v1.5 PERSIST-01 (review CR-01): the ONE production writer of
// draft.window. A user-applied coverage window must land IN the draft (so
// autosave / save / share / compare carry it), while a never-touched window
// stays absent — the transform is only ever invoked from the gesture path.
// ---------------------------------------------------------------------------
describe("setWindow", () => {
  const WINDOW = { start: "2026-01-02", end: "2026-01-05" };

  it("writes the window onto the draft (new object, input not mutated) and stamps lastEditedAt", () => {
    const initial = defaultDraftFromHoldings(HOLDINGS_2);
    expect(initial.window).toBeUndefined();
    const out = setWindow(initial, WINDOW);
    expect(out).not.toBe(initial);
    expect(out.window).toEqual(WINDOW);
    // Defensive copy — mutating the caller's range object later can't reach in.
    expect(out.window).not.toBe(WINDOW);
    // The input draft is untouched (immutability contract of every transform).
    expect(initial.window).toBeUndefined();
    // lastEditedAt is refreshed (an applied window is a real draft edit).
    expect(out.lastEditedAt >= initial.lastEditedAt).toBe(true);
  });

  it("M9-style no-op: setting the SAME window returns the SAME draft reference (no autosave churn)", () => {
    const withWindow = setWindow(defaultDraftFromHoldings(HOLDINGS_2), WINDOW);
    const again = setWindow(withWindow, { ...WINDOW });
    expect(again).toBe(withWindow);
  });

  it("replaces a previously-set window (a second gesture wins)", () => {
    const first = setWindow(defaultDraftFromHoldings(HOLDINGS_2), WINDOW);
    const second = setWindow(first, { start: "2026-01-01", end: "2026-01-12" });
    expect(second.window).toEqual({ start: "2026-01-01", end: "2026-01-12" });
  });

  it("the windowed draft round-trips the codec at the current schema version", () => {
    const def = defaultDraftFromHoldings(HOLDINGS_2);
    const withWindow = setWindow(def, WINDOW);
    const codec = scenarioDraftCodec(def);
    const r = codec.decode(codec.encode(withWindow));
    expect(r.outcome).toBe("ok");
    expect(r.value.window).toEqual(WINDOW);
  });
});

// ---------------------------------------------------------------------------
// scenarioDraftCodec — B7a-2 zod parse + version trichotomy (M-0153)
// ---------------------------------------------------------------------------
describe("scenarioDraftCodec", () => {
  const def = defaultDraftFromHoldings(HOLDINGS_2);
  const codec = scenarioDraftCodec(def);
  const validV1 = (): ScenarioDraft => ({
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: "fp",
    toggleByScopeRef: { "holding:binance:BTC:spot": true },
    addedStrategies: [],
    weightOverrides: { "holding:binance:BTC:spot": 1 },
    lastEditedAt: "2026-04-25T00:00:00.000Z",
  });

  it("null → default, outcome ok", () => {
    const r = codec.decode(null);
    expect(r.outcome).toBe("ok");
    expect(r.value).toBe(def);
  });

  it("valid v1 → adopt, outcome ok", () => {
    const r = codec.decode(JSON.stringify(validV1()));
    expect(r.outcome).toBe("ok");
    expect(r.value.weightOverrides["holding:binance:BTC:spot"]).toBe(1);
  });

  it("corrupt JSON → reset(parse_failed) → default (fail-loud, was silent pre-B7)", () => {
    const r = codec.decode("{not json");
    expect(r.outcome).toBe("reset");
    expect(r.reason).toBe("parse_failed");
    expect(r.value).toBe(def);
  });

  // M-0153 — the pre-B7 `JSON.parse(raw) as ScenarioDraft` flowed a wrong-typed
  // toggleByScopeRef straight through (localStorage.test.ts M-0150 pins that for
  // the legacy helper). The codec zod-rejects it → reset → default.
  it("M-0153 schema-invalid v1 (toggleByScopeRef is an array) → reset(schema_invalid) → default", () => {
    const bad = { ...validV1(), toggleByScopeRef: ["not", "an", "object"] };
    const r = codec.decode(JSON.stringify(bad));
    expect(r.outcome).toBe("reset");
    expect(r.reason).toBe("schema_invalid");
    expect(r.value).toBe(def);
  });

  it("missing schema_version → reset(version_mismatch)", () => {
    const noVer: Partial<ScenarioDraft> = { ...validV1() };
    delete noVer.schema_version;
    const r = codec.decode(JSON.stringify(noVer));
    expect(r.outcome).toBe("reset");
    expect(r.reason).toBe("version_mismatch");
  });

  // Forward-compat: a newer build wrote a higher version. Show the data
  // read-only; never down-convert (the pre-B7 path reset → default → next save
  // silently down-converted the newer blob to v1).
  it("forward version (schema_version=2) → readonly(version_ahead), shows the user's data", () => {
    const ahead = { ...validV1(), schema_version: SCENARIO_SCHEMA_VERSION + 1 };
    const r = codec.decode(JSON.stringify(ahead));
    expect(r.outcome).toBe("readonly");
    expect(r.reason).toBe("version_ahead");
    expect(r.value.weightOverrides["holding:binance:BTC:spot"]).toBe(1);
  });

  it("encode is byte-compatible with the pre-B7 JSON.stringify(draft)", () => {
    const d = validV1();
    expect(codec.encode(d)).toBe(JSON.stringify(d));
  });

  // -------------------------------------------------------------------------
  // v1.5 PERSIST-01 — the NON-DESTRUCTIVE v2→v3 upgrade (Phase 59 Plan 01).
  //
  // WHY these tests exist (Rule 9 — intent, not behavior): the 2→3 version
  // bump collides with the codec's reset-on-mismatch trichotomy. A naive bump
  // makes EVERY stored v2 (pre-v1.5, windowless) draft fall into the final
  // `reset` return (scenario-state.ts:653) → the user's saved scenario is
  // SILENTLY DELETED (reopen → fresh live book; share → honest-absence/404;
  // compare → older-format stamp + NULL_METRICS). Test A pins "no saved
  // scenario is dropped on the bump"; Test C pins "forward-compat is not
  // collateral damage of the bump". Written RED-first — Test A FAILS against
  // the un-bumped (constant=2) code because a schema_version:2 blob decodes
  // `ok` today (it equals the current version) rather than carrying the
  // `upgraded_v2_windowless` provenance marker.
  // -------------------------------------------------------------------------

  // A windowless v2 draft: a valid ScenarioDraft shape hard-coded at the PRIOR
  // schema_version (2, NOT relative to the constant) with NO `window` field.
  // Hard-coded 2 because the test targets the specific pre-v1.5 stored version.
  const windowlessV2 = () => ({
    schema_version: 2,
    init_holdings_fingerprint: "fp",
    toggleByScopeRef: { "holding:binance:BTC:spot": true },
    addedStrategies: [],
    weightOverrides: { "holding:binance:BTC:spot": 1 },
    lastEditedAt: "2026-04-25T00:00:00.000Z",
  });

  it("PERSIST-01 Test A — v2 windowless draft decodes ok (NEVER reset) with the upgraded_v2_windowless provenance marker", () => {
    const r = codec.decode(JSON.stringify(windowlessV2()));
    // The load-bearing assertion: a valid v2 draft must NOT be dropped.
    expect(r.outcome).toBe("ok");
    expect(r.reason).toBe("upgraded_v2_windowless");
    // Upgraded in-memory to the current version; next save re-persists at 3.
    expect(r.value.schema_version).toBe(SCENARIO_SCHEMA_VERSION);
    // Window intentionally left undefined — consumers default it via
    // defaultWindowFor() on open (the provenance note then renders).
    expect(r.value.window).toBeUndefined();
    // The draft's real content survived the upgrade unchanged.
    expect(r.value.weightOverrides["holding:binance:BTC:spot"]).toBe(1);
  });

  it("PERSIST-01 Test B — genuinely-corrupt v2 blob still resets (schema_invalid), NOT ok", () => {
    // A v2 draft whose shape fails scenarioDraftSchema.safeParse (toggleByScopeRef
    // is an array, mirroring the M-0153 corruption case). Malformed data must
    // NOT be adopted by the non-destructive branch — it falls through to reset.
    const corruptV2 = { ...windowlessV2(), toggleByScopeRef: ["not", "an", "object"] };
    const r = codec.decode(JSON.stringify(corruptV2));
    expect(r.outcome).toBe("reset");
    expect(r.reason).toBe("schema_invalid");
    expect(r.value).toBe(def);
  });

  it("PERSIST-01 Test C — a current+1 (==4) draft still decodes readonly(version_ahead) after the bump", () => {
    // Pitfall 2: the trichotomy is relative to SCENARIO_SCHEMA_VERSION, so the
    // existing `ahead` fixture at SCENARIO_SCHEMA_VERSION + 1 self-adjusts to 4.
    // Assert the explicit 4 too so the forward-compat path is pinned by value.
    const ahead = { ...validV1(), schema_version: SCENARIO_SCHEMA_VERSION + 1 };
    expect(SCENARIO_SCHEMA_VERSION + 1).toBe(4);
    const r = codec.decode(JSON.stringify(ahead));
    expect(r.outcome).toBe("readonly");
    expect(r.reason).toBe("version_ahead");
    expect(r.value.weightOverrides["holding:binance:BTC:spot"]).toBe(1);
  });

  it("PERSIST-01 Test D — a fresh v3 draft WITH a window decodes ok(reason null) and round-trips the window", () => {
    // A genuine current-version draft carrying a window: the provenance marker
    // is v2-UPGRADE-ONLY, so a v3-with-window decodes reason:null, NOT the
    // marker. The window value survives verbatim.
    const window = { start: "2024-01-01", end: "2024-12-31" };
    const v3WithWindow: ScenarioDraft = { ...validV1(), window };
    const r = codec.decode(JSON.stringify(v3WithWindow));
    expect(r.outcome).toBe("ok");
    expect(r.reason).toBeNull();
    expect(r.value.window).toEqual(window);
  });

  // Pre-landing review I5 — the window shape pins. DECISION: the codec keeps
  // its established corrupt-v3 handling for a malformed window (regex-fail →
  // safeParse fail → reset). Every first-party writer emits exact `YYYY-MM-DD`
  // bounds, so a non-ISO window only exists via corruption/tampering — resetting
  // it is consistent with the M-0153 schema_invalid path, not destructive to
  // any draft our own code can produce. (The rejected alternative — keep
  // .max(32) + a normalizing decode — would silently adopt garbage bounds.)
  it("I5 pin (a) — a v3 draft with a NON-ISO window string → reset(schema_invalid), the codec's corrupt-v3 path", () => {
    const badWindow = {
      ...validV1(),
      window: { start: "not-a-date", end: "2024-12-31" },
    };
    const r = codec.decode(JSON.stringify(badWindow));
    expect(r.outcome).toBe("reset");
    expect(r.reason).toBe("schema_invalid");
    expect(r.value).toBe(def);
  });

  // Deliberately NO start<=end refine: a refine failure on a v3 draft would
  // route to reset and could DELETE a user's draft over an inverted-but-well-
  // formed window. The codec adopts it verbatim; the ENGINE degrades honestly
  // downstream (no strategy covers an inverted window → member_count 0 class,
  // never a fabricated curve).
  it("I5 pin (b) — an INVERTED (start > end) well-formed window decodes ok and round-trips verbatim (engine degrades honestly downstream)", () => {
    const inverted = { start: "2024-12-31", end: "2024-01-01" };
    const r = codec.decode(JSON.stringify({ ...validV1(), window: inverted }));
    expect(r.outcome).toBe("ok");
    expect(r.reason).toBeNull();
    expect(r.value.window).toEqual(inverted);
  });

  // Review-hardening (pr-test-analyzer) — pin every non-canonical schema_version
  // branch. Only a legit higher INTEGER version is forward-compat (readonly);
  // a string / 0 / negative / float / NaN version is malformed → reset, NOT
  // trusted as a future build.
  it.each([
    ["string '1'", "1"],
    ["zero", 0],
    ["negative", -1],
    ["float 1.5 (malformed, NOT a real future build)", 1.5],
    ["float 2.5", 2.5],
  ])("non-canonical schema_version (%s) → reset, never readonly/ok", (_label, version) => {
    const blob = { ...validV1(), schema_version: version };
    const r = codec.decode(JSON.stringify(blob));
    expect(r.outcome).toBe("reset");
    expect(r.value).toBe(def);
  });

  // userWeightOverrides is an additive optional field (H-0126). Pin that it
  // survives a full encode→decode round-trip so diffCount's dependency on it
  // can't silently break.
  it("round-trips userWeightOverrides through encode → decode", () => {
    const withOverrides: ScenarioDraft = {
      ...validV1(),
      userWeightOverrides: { "holding:binance:BTC:spot": 0.8 },
    };
    const r = codec.decode(codec.encode(withOverrides));
    expect(r.outcome).toBe("ok");
    expect(r.value.userWeightOverrides).toEqual({
      "holding:binance:BTC:spot": 0.8,
    });
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
