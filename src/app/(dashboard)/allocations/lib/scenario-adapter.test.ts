/**
 * Phase 10 Plan 01 / Task 2 — RED tests for scenario-adapter.ts
 *
 * Pins the contract for `buildStrategyForBuilderSet` (B4 lookup-map signature):
 *   - Holdings → StrategyForBuilder via flatMap; warm-up gate excludes < 30 days
 *   - id = buildHoldingRef(h) for holdings; UUID strategy.id for added strategies
 *   - No UUID/scope_ref collision (Pitfall 2)
 *   - state.selected from disabledHoldingRefs Set (B4 input)
 *   - state.weights default = h.value_usd / total; 0 for added strategies
 *   - state.startDates from strategy.start_date (fallback "2022-01-01")
 *   - addedStrategies are AddedStrategy[] (lightweight) — adapter consults
 *     addedStrategyReturnsLookup + addedStrategyMetadataLookup to project them
 *     into StrategyForBuilder
 *   - H5 brand: lookup-map keys use StrategyForBuilderId; hand-rolled strings
 *     and pre-cast StrategyForBuilder literals are rejected at compile time
 */
import { describe, it, expect } from "vitest";
import {
  buildStrategyForBuilderSet,
  type StrategyForBuilderId,
} from "./scenario-adapter";
import type { DailyPoint } from "@/lib/scenario";
import type { AddedStrategy, HoldingForDefault } from "./scenario-state";

const HOLDINGS_2: HoldingForDefault[] = [
  { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 60000 },
  { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 40000 },
];

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

describe("buildStrategyForBuilderSet — happy paths", () => {
  it("T1 empty holdings + empty addedStrategies → empty result", () => {
    const result = buildStrategyForBuilderSet(
      [],
      new Set<string>(),
      [],
      {},
      {},
      {},
    );
    expect(result.strategies).toEqual([]);
    expect(result.state).toEqual({ selected: {}, weights: {}, startDates: {} });
  });

  it("T2 two holdings with full return series → 2 strategies, weights sum 1.0, both selected true", () => {
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    expect(result.strategies.length).toBe(2);
    for (const s of result.strategies) {
      expect(s.id).toMatch(/^holding:binance:(BTC|ETH):spot$/);
      expect(s.daily_returns.length).toBe(60);
    }
    expect(result.state.selected["holding:binance:BTC:spot"]).toBe(true);
    expect(result.state.selected["holding:binance:ETH:spot"]).toBe(true);
    const sum =
      result.state.weights["holding:binance:BTC:spot"] +
      result.state.weights["holding:binance:ETH:spot"];
    expect(sum).toBeCloseTo(1.0, 9);
  });

  it("T3 holding with < 30 days warm-up is excluded entirely", () => {
    const shortReturns = makeReturns(15);
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": shortReturns, // < 30 days → excluded
      },
      {},
      {},
    );
    expect(result.strategies.length).toBe(1);
    expect(result.strategies[0].id).toBe("holding:binance:BTC:spot");
  });

  it("T4 holdings + added strategy → 3 entries; UUID id is not a scope_ref", () => {
    const added: AddedStrategy[] = [
      {
        id: "00000000-0000-0000-0000-000000000001" as StrategyForBuilderId,
        name: "Strat A",
        markets: ["binance"],
        strategy_types: ["momentum"],
      },
    ];
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      added,
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {
        ["00000000-0000-0000-0000-000000000001" as StrategyForBuilderId]: RETURNS_60D,
      },
      {
        ["00000000-0000-0000-0000-000000000001" as StrategyForBuilderId]: {
          disclosure_tier: "public",
          cagr: 0.12,
          sharpe: 1.4,
        },
      },
    );
    expect(result.strategies.length).toBe(3);
    const uuidEntry = result.strategies.find((s) =>
      /^[0-9a-f]{8}-/.test(s.id),
    );
    expect(uuidEntry).toBeDefined();
    expect(uuidEntry!.id).not.toMatch(/^holding:/);
  });

  it("T5 disabledHoldingRefs Set marks holdings as not selected", () => {
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set(["holding:binance:BTC:spot"]),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    expect(result.state.selected["holding:binance:BTC:spot"]).toBe(false);
    expect(result.state.selected["holding:binance:ETH:spot"]).toBe(true);
  });

  it("T6 weightOverrides applied when supplied (composer applies these post-adapter; but the adapter still defaults to value_usd/total when none supplied)", () => {
    // Under B4, weightOverrides is NOT an adapter input — the composer applies them
    // after the adapter. We verify that the default weight derivation is correct
    // (value_usd / total).
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    expect(result.state.weights["holding:binance:BTC:spot"]).toBeCloseTo(0.6, 9);
    expect(result.state.weights["holding:binance:ETH:spot"]).toBeCloseTo(0.4, 9);
  });

  it("T7 minReturnDays override allows shorter series through", () => {
    const shortReturns = makeReturns(15);
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": shortReturns,
      },
      {},
      {},
      10, // minReturnDays = 10
    );
    expect(result.strategies.length).toBe(2);
  });

  it("T8 ID uniqueness invariant — no id is BOTH UUID and scope_ref (Pitfall 2)", () => {
    const added: AddedStrategy[] = [
      {
        id: "00000000-0000-0000-0000-000000000001" as StrategyForBuilderId,
        name: "Strat A",
        markets: ["binance"],
        strategy_types: ["momentum"],
      },
    ];
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      added,
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {
        ["00000000-0000-0000-0000-000000000001" as StrategyForBuilderId]: RETURNS_60D,
      },
      {},
    );
    const uuidRe = /^[0-9a-f]{8}-/;
    for (const s of result.strategies) {
      const isUuid = uuidRe.test(s.id);
      const isScopeRef = s.id.startsWith("holding:");
      expect(isUuid && isScopeRef).toBe(false);
    }
  });

  it("T9 startDates assignment — strategy.start_date or fallback '2022-01-01'", () => {
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    for (const s of result.strategies) {
      const expected = s.start_date ?? "2022-01-01";
      expect(result.state.startDates[s.id]).toBe(expected);
    }
  });

  it("T10 totalValue=0 edge case → all default weights = 0 (no division-by-zero crash)", () => {
    const zeros: HoldingForDefault[] = [
      { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 0 },
      { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 0 },
    ];
    const result = buildStrategyForBuilderSet(
      zeros,
      new Set<string>(),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    expect(result.state.weights["holding:binance:BTC:spot"]).toBe(0);
    expect(result.state.weights["holding:binance:ETH:spot"]).toBe(0);
  });
});

describe("buildStrategyForBuilderSet — B4 lookup-map signature", () => {
  it("T11 added strategy with lookup hits → daily_returns from lookup; metadata fields propagate", () => {
    const added: AddedStrategy[] = [
      {
        id: "uuid-1" as StrategyForBuilderId,
        name: "Strat A",
        markets: ["binance"],
        strategy_types: ["momentum"],
      },
    ];
    const result = buildStrategyForBuilderSet(
      [],
      new Set<string>(),
      added,
      {},
      { ["uuid-1" as StrategyForBuilderId]: RETURNS_60D },
      {
        ["uuid-1" as StrategyForBuilderId]: {
          disclosure_tier: "public",
          cagr: 0.12,
          sharpe: 1.4,
        },
      },
    );
    expect(result.strategies.length).toBe(1);
    const s = result.strategies[0];
    expect(s.daily_returns).toBe(RETURNS_60D);
    expect(s.disclosure_tier).toBe("public");
    expect(s.cagr).toBe(0.12);
    expect(s.sharpe).toBe(1.4);
    expect(s.codename).toBeNull();
    expect(s.volatility).toBeNull();
    expect(s.max_drawdown).toBeNull();
  });

  it("T12 added strategy missing both lookups → daily_returns=[]; defaults applied", () => {
    const added: AddedStrategy[] = [
      {
        id: "uuid-2" as StrategyForBuilderId,
        name: "Strat B",
        markets: ["binance"],
        strategy_types: ["momentum"],
      },
    ];
    const result = buildStrategyForBuilderSet(
      [],
      new Set<string>(),
      added,
      {},
      {},
      {},
    );
    expect(result.strategies.length).toBe(1);
    const s = result.strategies[0];
    expect(s.daily_returns).toEqual([]);
    expect(s.disclosure_tier).toBe("public");
    expect(s.cagr).toBeNull();
    expect(s.sharpe).toBeNull();
  });

  it("T13 disabledHoldingRefs Set marks the holding state.selected = false", () => {
    const result = buildStrategyForBuilderSet(
      [HOLDINGS_2[0]],
      new Set(["holding:binance:BTC:spot"]),
      [],
      { "holding:binance:BTC:spot": RETURNS_60D },
      {},
      {},
    );
    expect(result.state.selected["holding:binance:BTC:spot"]).toBe(false);
  });

  it("T14 holdings NOT in disabledHoldingRefs default to selected = true", () => {
    const result = buildStrategyForBuilderSet(
      HOLDINGS_2,
      new Set(["holding:binance:BTC:spot"]),
      [],
      {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      {},
      {},
    );
    expect(result.state.selected["holding:binance:ETH:spot"]).toBe(true);
  });

  it("T15 (B4 signature regression) old object-literal signature is a TypeScript error", () => {
    // @ts-expect-error — B4 pinned signature uses positional args; an object
    // literal with the OLD shape is rejected at compile time.
    buildStrategyForBuilderSet({
      holdingsSummary: HOLDINGS_2,
      holdingReturnsByScopeRef: {
        "holding:binance:BTC:spot": RETURNS_60D,
        "holding:binance:ETH:spot": RETURNS_60D,
      },
      addedStrategies: [],
      toggleByScopeRef: {},
      weightOverrides: {},
    });
  });
});

describe("H5 brand — compile-time guards", () => {
  it("T16 hand-rolled StrategyForBuilder literal CANNOT be passed where AddedStrategy is expected", () => {
    // @ts-expect-error — H5 brand prevents pre-cast StrategyForBuilder from passing as an AddedStrategy
    const handRolled = {
      id: "abc",
      name: "Strat A",
      codename: null,
      disclosure_tier: "public",
      strategy_types: [],
      markets: [],
      start_date: null,
      daily_returns: [],
      cagr: null,
      sharpe: null,
      volatility: null,
      max_drawdown: null,
    };
    // @ts-expect-error — H5 brand prevents pre-cast StrategyForBuilder from passing as an AddedStrategy
    buildStrategyForBuilderSet(HOLDINGS_2, new Set(), [handRolled], {}, {}, {});
  });

  it("T17 unbranded string CANNOT be used as a key in addedStrategyReturnsLookup", () => {
    const lookup: Record<StrategyForBuilderId, DailyPoint[]> = {};
    // Branded keys: this is the only legal write path.
    lookup["uuid-1" as StrategyForBuilderId] = [];
    // @ts-expect-error — H5 brand: unbranded string cannot index Record<StrategyForBuilderId, ...>
    lookup["unbranded-string"] = [];
    expect(Object.keys(lookup).length).toBeGreaterThan(0);
  });
});
