/**
 * Phase 10 Plan 01 / Task 2 — tests for scenario-adapter.ts
 *
 * Phase 63 Plan 04 (ENGINE-04, stage 3) retired every block that drove the
 * deleted holdings→units builder (its old happy-path
 * + B4-signature suites and the H-0132 commit-oracle round-trip): their subject
 * no longer exists in production (both call sites — composer, compare — were
 * deleted in Plans 02/03, and the SSR baseline repointed in Plan 04). The
 * surviving pins below cover the series-space builders that replaced it:
 *   - the H5 brand's runtime-erasure invariant (compile-time + runtime halves)
 *   - `buildPerKeyStrategyForBuilderSet` per-key keying (DSRC-01)
 *   - `buildAddedOnlySet` — the ONE added-only engine-set construction, proven
 *     equal to the empty-per-key reduction of `mergeAddedIntoPerKeySet`, plus the
 *     ENGINE-04 no-alias precondition and the ENGINE-05 id-format precursor.
 */
import { describe, it, expect } from "vitest";
import {
  buildPerKeyStrategyForBuilderSet,
  buildAddedOnlySet,
  mergeAddedIntoPerKeySet,
  type StrategyForBuilderId,
} from "./scenario-adapter";
import type { DailyPoint, ScenarioState, StrategyForBuilder } from "@/lib/scenario";
import type { AddedStrategy } from "./scenario-state";

function makeReturns(n: number): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000)
      .toISOString()
      .slice(0, 10);
    out.push({ date: d, value: 0.001 });
  }
  return out;
}

const RETURNS_60D = makeReturns(60);

describe("H5 brand — compile-time guards", () => {
  it("T17 unbranded string CANNOT be used as a key in addedStrategyReturnsLookup", () => {
    const lookup: Record<StrategyForBuilderId, DailyPoint[]> = {};
    // Branded keys: this is the only legal write path.
    lookup["uuid-1" as StrategyForBuilderId] = [];
    // @ts-expect-error — H5 brand: unbranded string cannot index Record<StrategyForBuilderId, ...>
    lookup["unbranded-string"] = [];
    expect(Object.keys(lookup).length).toBeGreaterThan(0);
  });

  // M-0149 (pr-test-analyzer) — T15/T16/T17 are compile-time guards: their
  // real assertion is the `@ts-expect-error` directive (enforced by
  // `tsc --noEmit`, NOT by vitest), and the `expect(typeof _compileOnly).
  // toBe("function")` line is a tautology that runs but cannot catch a type
  // regression. (The protection is genuine — removing the brand makes the
  // `@ts-expect-error` "unused", a tsc error — but it lives in the type
  // checker, not here.) This adds the missing RUNTIME-behavioral counterpart
  // vitest CAN catch: the H5 brand must be a zero-cost phantom type —
  // `string & { __brand }` — that is fully erased at runtime, so a branded id
  // is `===` its underlying string and indexes a plain-object lookup
  // identically. If the brand were ever reified into a runtime wrapper
  // (boxing the string), every `Record<StrategyForBuilderId, ...>` lookup the
  // adapter performs would silently miss. This pins that invariant.
  it("M-0149: StrategyForBuilderId brand is runtime-erased — branded id indexes a plain lookup identically to its raw string", () => {
    const RAW = "00000000-0000-0000-0000-000000000001";
    const branded = RAW as StrategyForBuilderId;
    // Brand is compile-only: at runtime the value is the unchanged string.
    expect(branded).toBe(RAW);
    expect(typeof branded).toBe("string");

    // A branded write is readable via the raw string key (and vice-versa),
    // proving the brand adds no runtime key transformation.
    const lookup: Record<StrategyForBuilderId, DailyPoint[]> = {};
    const sentinel: DailyPoint[] = [{ date: "2026-01-01", value: 1 }];
    lookup[branded] = sentinel;
    expect((lookup as Record<string, DailyPoint[]>)[RAW]).toBe(sentinel);
    expect(Object.keys(lookup)).toEqual([RAW]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 37 Plan 02 (DSRC-01) — the per-key builder. One
// StrategyForBuilder per api_key_id (id === api_key_id), weight = each key's
// RAW clamped equity share, default selected=true, empty-series keys skipped.
// This is the data-source-keyed projection (per api_key, not per blended book).
//
// CRITICAL (Pitfall 1): weights are RAW equity-share USD — NOT renormalized to
// sum-to-1. The frozen computeScenario engine renormalizes per-day over the
// selected set (r / activeWeightSum, scenario.ts). The raw-weight assertion
// below is the falsifiability guard: adding any sum-to-1 normalize to the
// builder turns it red.
// ─────────────────────────────────────────────────────────────────────────
describe("buildPerKeyStrategyForBuilderSet — per-key keying (DSRC-01)", () => {
  it("PK1 empty inputs → empty strategies + empty state", () => {
    const result = buildPerKeyStrategyForBuilderSet({}, {});
    expect(result.strategies).toEqual([]);
    expect(result.state).toEqual({ selected: {}, weights: {}, startDates: {} });
  });

  it("PK2 two keys with full series → id === api_key_id, both selected true, weights = clamped equity-share", () => {
    const result = buildPerKeyStrategyForBuilderSet(
      { "key-A": RETURNS_60D, "key-B": RETURNS_60D },
      { "key-A": 70, "key-B": 30 },
    );
    expect(result.strategies.length).toBe(2);
    // id keying: the strategy ids ARE the api_key_ids.
    expect(result.strategies.map((s) => s.id).sort()).toEqual([
      "key-A",
      "key-B",
    ]);
    for (const s of result.strategies) {
      expect(s.daily_returns.length).toBe(60);
      expect(s.disclosure_tier).toBe("exploratory");
    }
    // default included
    expect(result.state.selected["key-A"]).toBe(true);
    expect(result.state.selected["key-B"]).toBe(true);
    // weight = clamped equity-share for that key
    expect(result.state.weights["key-A"]).toBe(70);
    expect(result.state.weights["key-B"]).toBe(30);
  });

  it("PK3 RAW equity-share weights — NOT renormalized to sum-to-1 (Pitfall 1 guard)", () => {
    // With equity { A: 70, B: 30 } the raw weights MUST be 70 and 30, NOT the
    // 0.7 / 0.3 fractions a sum-to-1 normalize would produce. The frozen engine
    // owns renormalization (r / activeWeightSum) — the builder must not.
    const result = buildPerKeyStrategyForBuilderSet(
      { A: RETURNS_60D, B: RETURNS_60D },
      { A: 70, B: 30 },
    );
    expect(result.state.weights.A).toBe(70);
    expect(result.state.weights.B).toBe(30);
    // Mutation guard: a normalized builder would make these sum to 1.
    expect(result.state.weights.A + result.state.weights.B).toBe(100);
  });

  it("PK4 a key whose series is [] is skipped entirely (not in strategies, not in state)", () => {
    const result = buildPerKeyStrategyForBuilderSet(
      { "key-A": RETURNS_60D, "key-empty": [] },
      { "key-A": 70, "key-empty": 30 },
    );
    expect(result.strategies.map((s) => s.id)).toEqual(["key-A"]);
    expect(result.state.selected["key-empty"]).toBeUndefined();
    expect(result.state.weights["key-empty"]).toBeUndefined();
    expect(result.state.startDates["key-empty"]).toBeUndefined();
  });

  it("PK5 a key with negative equity share → weight clamped to 0 (never negative)", () => {
    const result = buildPerKeyStrategyForBuilderSet(
      { "key-neg": RETURNS_60D },
      { "key-neg": -500 },
    );
    expect(result.state.weights["key-neg"]).toBe(0);
  });

  it("PK6 a key absent from equityByApiKeyId → weight 0 (?? 0 default)", () => {
    const result = buildPerKeyStrategyForBuilderSet(
      { "key-A": RETURNS_60D },
      {}, // no equity entry for key-A
    );
    expect(result.state.weights["key-A"]).toBe(0);
    expect(result.state.selected["key-A"]).toBe(true);
  });

  it("PK7 startDates = returns[0].date when present", () => {
    const result = buildPerKeyStrategyForBuilderSet(
      { "key-A": RETURNS_60D },
      { "key-A": 100 },
    );
    expect(result.state.startDates["key-A"]).toBe(RETURNS_60D[0].date);
    expect(result.strategies[0].start_date).toBe(RETURNS_60D[0].date);
  });

  it("PK8 startDates falls back to '2022-01-01' when returns[0].date is absent", () => {
    // A non-empty series whose first point carries no date (defensive) → the
    // builder must fall back to the engine's "2022-01-01" sentinel, not undefined.
    const noDateSeries = [{ value: 0.001 } as unknown as DailyPoint];
    const result = buildPerKeyStrategyForBuilderSet(
      { "key-A": noDateSeries },
      { "key-A": 100 },
    );
    expect(result.state.startDates["key-A"]).toBe("2022-01-01");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 63 Plan 01 (ENGINE-04 precondition b, Wave-0) — buildAddedOnlySet is
// the ONE shared added-only engine-set construction every later deletion stage
// (Plans 02–04) replaces the holdings paths with. It MUST be provably the
// empty-per-key reduction of the surviving `mergeAddedIntoPerKeySet` — i.e.
// today's blank-mode output — so the equivalence oracle below is the load-
// bearing pin: if the wrapper ever drifts from the merge survivor, a later
// stage that swaps a holdings path for `buildAddedOnlySet` would silently
// change the gate=false / blank-mode numbers. This is NOT a single-source
// tautology: the two functions are INDEPENDENT code paths (the wrapper builds
// the added trio directly; the merge folds added into a supplied per-key set
// then early-returns on empty added) — feeding both the same inputs and
// asserting deep-equality catches any divergence in the weight-0 / warm-up /
// "2022-01-01" sentinel defaults (F9 H-0133 invariants).
//
// Also the explicit no-alias assertion (ENGINE-04 precondition b): a per-key
// unit id is an api_keys UUID (adapter:261) and an added id is a strategies
// UUID — disjoint by construction, so a merge never silently collapses two
// units. And the ENGINE-05 runtime precursor: NO builder output id is ever a
// "holding:" scope_ref (falsifiable — inject a "holding:"-prefixed fixture and
// it goes red).
// ─────────────────────────────────────────────────────────────────────────
describe("buildAddedOnlySet — the added-only engine set (ENGINE-04 precondition b)", () => {
  const EMPTY_PER_KEY: { strategies: StrategyForBuilder[]; state: ScenarioState } = {
    strategies: [],
    state: { selected: {}, weights: {}, startDates: {} },
  };

  const A_ID = "aaaaaaaa-0000-0000-0000-000000000001" as StrategyForBuilderId;
  const B_ID = "bbbbbbbb-0000-0000-0000-000000000002" as StrategyForBuilderId;
  // Two added strategies — A carries a real return series, B has none (its
  // series is warm-up-gated out to [] → start_date null → "2022-01-01" sentinel).
  const ADDED_2: AddedStrategy[] = [
    {
      id: A_ID,
      name: "Added A",
      markets: ["binance"],
      strategy_types: ["momentum"],
    },
    {
      id: B_ID,
      name: "Added B",
      markets: ["okx"],
      strategy_types: ["trend"],
    },
  ];
  const ADDED_RETURNS: Record<StrategyForBuilderId, DailyPoint[]> = {
    [A_ID]: RETURNS_60D, // A has returns; B intentionally absent
  };
  const ADDED_META: Record<
    StrategyForBuilderId,
    Pick<StrategyForBuilder, "disclosure_tier" | "cagr" | "sharpe">
  > = {
    [A_ID]: { disclosure_tier: "public", cagr: 0.1, sharpe: 1.1 },
  };

  it("BAO1 equivalence oracle — buildAddedOnlySet output deep-equals mergeAddedIntoPerKeySet with an empty per-key set (non-empty added)", () => {
    const wrapper = buildAddedOnlySet(ADDED_2, ADDED_RETURNS, ADDED_META);
    const mergeReduction = mergeAddedIntoPerKeySet(
      EMPTY_PER_KEY,
      ADDED_2,
      ADDED_RETURNS,
      ADDED_META,
    );
    expect(wrapper).toEqual(mergeReduction);
  });

  it("BAO2 empty added → the empty blank set shape (matches today's empty blank output)", () => {
    const wrapper = buildAddedOnlySet([], {}, {});
    expect(wrapper).toEqual({
      strategies: [],
      state: { selected: {}, weights: {}, startDates: {} },
    });
    // And still equal to the merge survivor's empty-added early-return.
    expect(wrapper).toEqual(
      mergeAddedIntoPerKeySet(EMPTY_PER_KEY, [], {}, {}),
    );
  });

  it("BAO3 added unit invariants — selected=true, weight=0, startDate = returns[0]?.date ?? '2022-01-01' (F9 H-0133, inherited via buildAddedUnits)", () => {
    const out = buildAddedOnlySet(ADDED_2, ADDED_RETURNS, ADDED_META);
    expect(out.strategies.length).toBe(2);
    expect(out.state.selected[A_ID]).toBe(true);
    expect(out.state.selected[B_ID]).toBe(true);
    expect(out.state.weights[A_ID]).toBe(0);
    expect(out.state.weights[B_ID]).toBe(0);
    // A carries a real series → its first date; B has no series → the engine sentinel.
    expect(out.state.startDates[A_ID]).toBe(RETURNS_60D[0].date);
    expect(out.state.startDates[B_ID]).toBe("2022-01-01");
  });

  it("BAO4 no-alias (ENGINE-04 precondition b) — merging a per-key set with added strategies preserves the strategy COUNT and every output id is unique", () => {
    // per-key unit ids are api-key UUIDs; added ids are distinct strategy UUIDs.
    const perKey = buildPerKeyStrategyForBuilderSet(
      { "key-A": RETURNS_60D, "key-B": RETURNS_60D },
      { "key-A": 70, "key-B": 30 },
    );
    const merged = mergeAddedIntoPerKeySet(
      perKey,
      ADDED_2,
      ADDED_RETURNS,
      ADDED_META,
    );
    // Count is preserved exactly — no unit silently absorbs another.
    expect(merged.strategies.length).toBe(
      perKey.strategies.length + ADDED_2.length,
    );
    const ids = merged.strategies.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("BAO5 id-format pin (ENGINE-05 precursor) — no builder output id is a 'holding:' scope_ref", () => {
    const perKey = buildPerKeyStrategyForBuilderSet(
      { "key-A": RETURNS_60D },
      { "key-A": 70 },
    );
    const addedOnly = buildAddedOnlySet(ADDED_2, ADDED_RETURNS, ADDED_META);
    const merged = mergeAddedIntoPerKeySet(
      perKey,
      ADDED_2,
      ADDED_RETURNS,
      ADDED_META,
    );
    for (const set of [addedOnly, merged, perKey]) {
      for (const s of set.strategies) {
        expect(s.id.startsWith("holding:")).toBe(false);
      }
    }
  });
});
