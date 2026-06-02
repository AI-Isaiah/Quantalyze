import { describe, it, expect } from "vitest";
import {
  computeScenario,
  buildDateMapCache,
  type DailyPoint,
  type ScenarioState,
  type StrategyForBuilder,
} from "@/lib/scenario";
import { collapseAliasedHoldingStrategies } from "@/lib/scenario-dealias";
import { buildStrategyForBuilderSet } from "@/app/(dashboard)/allocations/lib/scenario-adapter";
import { buildHoldingRef } from "@/app/(dashboard)/allocations/lib/holding-outcome-adapter";

// computeScenario requires n >= 10 common dates or it returns null KPIs.
const DATES = [
  "2026-01-02",
  "2026-01-05",
  "2026-01-06",
  "2026-01-07",
  "2026-01-08",
  "2026-01-09",
  "2026-01-12",
  "2026-01-13",
  "2026-01-14",
  "2026-01-15",
  "2026-01-16",
  "2026-01-20",
] as const;

function series(values: number[]): DailyPoint[] {
  return values.map((value, i) => ({ date: DATES[i], value }));
}

function mkStrat(id: string, values: number[]): StrategyForBuilder {
  return {
    id,
    name: id,
    codename: null,
    disclosure_tier: "exploratory",
    strategy_types: [],
    markets: [],
    start_date: DATES[0],
    daily_returns: series(values),
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
  };
}

const BTC = [
  0.02, -0.01, 0.03, -0.02, 0.01, 0.0, 0.015, -0.005, 0.02, -0.01, 0.005, 0.01,
];
const ETH = [
  -0.01, 0.02, -0.015, 0.025, -0.005, 0.01, -0.02, 0.015, -0.01, 0.02, -0.008,
  0.012,
];

// Holding scopeRefs (`holding:{venue}:{symbol}:{holding_type}`) for an
// allocator holding BTC on two venues + ETH on one.
const BTC_BINANCE = "holding:binance:BTC:spot";
const BTC_OKX = "holding:okx:BTC:spot";
const BTC_PERP = "holding:binance:BTC:derivative";
const ETH_BINANCE = "holding:binance:ETH:spot";

describe("collapseAliasedHoldingStrategies", () => {
  it("passes added (non-holding) strategy ids through untouched", () => {
    const strategies = [mkStrat("added:abc", BTC), mkStrat("added:def", ETH)];
    const state: ScenarioState = {
      selected: { "added:abc": true, "added:def": true },
      weights: { "added:abc": 0.5, "added:def": 0.5 },
      startDates: { "added:abc": DATES[0], "added:def": DATES[0] },
    };
    // Empty symbol map → nothing is a holding → identity.
    const out = collapseAliasedHoldingStrategies(strategies, state, new Map());
    expect(out.strategies.map((s) => s.id).sort()).toEqual([
      "added:abc",
      "added:def",
    ]);
    expect(out.state).toEqual(state);
  });

  it("leaves a single-holding symbol untouched", () => {
    const strategies = [mkStrat(BTC_BINANCE, BTC), mkStrat(ETH_BINANCE, ETH)];
    const state: ScenarioState = {
      selected: { [BTC_BINANCE]: true, [ETH_BINANCE]: true },
      weights: { [BTC_BINANCE]: 0.6, [ETH_BINANCE]: 0.4 },
      startDates: { [BTC_BINANCE]: DATES[0], [ETH_BINANCE]: DATES[0] },
    };
    const symbolMap = new Map([
      [BTC_BINANCE, "BTC"],
      [ETH_BINANCE, "ETH"],
    ]);
    const out = collapseAliasedHoldingStrategies(strategies, state, symbolMap);
    expect(out.strategies).toHaveLength(2);
    expect(out.state.weights[BTC_BINANCE]).toBe(0.6);
    expect(out.state.weights[ETH_BINANCE]).toBe(0.4);
  });

  it("collapses two same-symbol venue holdings into one summed-weight slot", () => {
    const strategies = [
      mkStrat(BTC_BINANCE, BTC),
      mkStrat(BTC_OKX, BTC),
      mkStrat(ETH_BINANCE, ETH),
    ];
    const state: ScenarioState = {
      selected: { [BTC_BINANCE]: true, [BTC_OKX]: true, [ETH_BINANCE]: true },
      weights: { [BTC_BINANCE]: 0.3, [BTC_OKX]: 0.2, [ETH_BINANCE]: 0.5 },
      startDates: {
        [BTC_BINANCE]: DATES[0],
        [BTC_OKX]: DATES[0],
        [ETH_BINANCE]: DATES[0],
      },
    };
    const symbolMap = new Map([
      [BTC_BINANCE, "BTC"],
      [BTC_OKX, "BTC"],
      [ETH_BINANCE, "ETH"],
    ]);
    const out = collapseAliasedHoldingStrategies(strategies, state, symbolMap);
    // Two BTC scopeRefs → one representative; ETH untouched.
    expect(out.strategies).toHaveLength(2);
    const ids = out.strategies.map((s) => s.id);
    expect(ids).toContain(ETH_BINANCE);
    // Representative is the first BTC member; its weight is the group sum.
    expect(out.state.weights[BTC_BINANCE]).toBeCloseTo(0.5, 10);
    expect(out.state.selected[BTC_BINANCE]).toBe(true);
    // The other venue's scopeRef is gone from the collapsed set.
    expect(ids).not.toContain(BTC_OKX);
  });

  it("collapses spot + derivative of the same symbol (both alias the symbol series)", () => {
    const strategies = [mkStrat(BTC_BINANCE, BTC), mkStrat(BTC_PERP, BTC)];
    const state: ScenarioState = {
      selected: { [BTC_BINANCE]: true, [BTC_PERP]: true },
      weights: { [BTC_BINANCE]: 0.4, [BTC_PERP]: 0.6 },
      startDates: { [BTC_BINANCE]: DATES[0], [BTC_PERP]: DATES[0] },
    };
    const symbolMap = new Map([
      [BTC_BINANCE, "BTC"],
      [BTC_PERP, "BTC"],
    ]);
    const out = collapseAliasedHoldingStrategies(strategies, state, symbolMap);
    expect(out.strategies).toHaveLength(1);
    expect(out.state.weights[BTC_BINANCE]).toBeCloseTo(1.0, 10);
  });

  it("weight = sum of SELECTED members only; selected = any member", () => {
    const strategies = [mkStrat(BTC_BINANCE, BTC), mkStrat(BTC_OKX, BTC)];
    const symbolMap = new Map([
      [BTC_BINANCE, "BTC"],
      [BTC_OKX, "BTC"],
    ]);
    // OKX toggled off → merged weight is binance's only, still selected.
    const partial = collapseAliasedHoldingStrategies(
      strategies,
      {
        selected: { [BTC_BINANCE]: true, [BTC_OKX]: false },
        weights: { [BTC_BINANCE]: 0.3, [BTC_OKX]: 0.2 },
        startDates: { [BTC_BINANCE]: DATES[0], [BTC_OKX]: DATES[0] },
      },
      symbolMap,
    );
    expect(partial.strategies).toHaveLength(1);
    expect(partial.state.selected[BTC_BINANCE]).toBe(true);
    expect(partial.state.weights[BTC_BINANCE]).toBeCloseTo(0.3, 10);

    // Both toggled off → exposure excluded from the scenario.
    const none = collapseAliasedHoldingStrategies(
      strategies,
      {
        selected: { [BTC_BINANCE]: false, [BTC_OKX]: false },
        weights: { [BTC_BINANCE]: 0.3, [BTC_OKX]: 0.2 },
        startDates: { [BTC_BINANCE]: DATES[0], [BTC_OKX]: DATES[0] },
      },
      symbolMap,
    );
    expect(none.strategies).toHaveLength(1);
    expect(none.state.selected[BTC_BINANCE]).toBe(false);
    expect(none.state.weights[BTC_BINANCE]).toBe(0);
  });
});

describe("avg_pairwise_correlation honesty end-to-end (H-0487/H-0493)", () => {
  const strategies = [
    mkStrat(BTC_BINANCE, BTC),
    mkStrat(BTC_OKX, BTC), // identical series to BTC_BINANCE (symbol-keyed alias)
    mkStrat(ETH_BINANCE, ETH),
  ];
  const state: ScenarioState = {
    selected: { [BTC_BINANCE]: true, [BTC_OKX]: true, [ETH_BINANCE]: true },
    weights: { [BTC_BINANCE]: 0.3, [BTC_OKX]: 0.2, [ETH_BINANCE]: 0.5 },
    startDates: {
      [BTC_BINANCE]: DATES[0],
      [BTC_OKX]: DATES[0],
      [ETH_BINANCE]: DATES[0],
    },
  };
  const symbolMap = new Map([
    [BTC_BINANCE, "BTC"],
    [BTC_OKX, "BTC"],
    [ETH_BINANCE, "ETH"],
  ]);

  function run(s: StrategyForBuilder[], st: ScenarioState) {
    return computeScenario(s, st, buildDateMapCache(s));
  }

  it("WITHOUT collapse, the aliased pair fabricates rho=1.0 into the average (the bug)", () => {
    const buggy = run(strategies, state);
    // The BTC@binance/BTC@okx pair is a perfect 1.0; its presence pulls the
    // average toward 1.0 — a number the venue series were never independently
    // measured to have.
    expect(buggy.correlation_matrix?.[BTC_BINANCE]?.[BTC_OKX]).toBe(1);
  });

  it("WITH collapse, avgRho reflects only genuine distinct-symbol exposures", () => {
    const buggy = run(strategies, state);
    const deAliased = collapseAliasedHoldingStrategies(
      strategies,
      state,
      symbolMap,
    );
    const fixed = run(deAliased.strategies, deAliased.state);

    // Reference: the honest 2-strategy set (BTC at the summed 0.5 weight, ETH
    // at 0.5) — what the allocator's real distinct exposures are.
    const reference = run(
      [mkStrat(BTC_BINANCE, BTC), mkStrat(ETH_BINANCE, ETH)],
      {
        selected: { [BTC_BINANCE]: true, [ETH_BINANCE]: true },
        weights: { [BTC_BINANCE]: 0.5, [ETH_BINANCE]: 0.5 },
        startDates: { [BTC_BINANCE]: DATES[0], [ETH_BINANCE]: DATES[0] },
      },
    );

    // Fixed avgRho == the genuine single BTC↔ETH correlation, NOT the
    // 1.0-inflated buggy value, and not a fabricated 1.0.
    expect(fixed.avg_pairwise_correlation).toBe(
      reference.avg_pairwise_correlation,
    );
    expect(fixed.avg_pairwise_correlation).not.toBe(
      buggy.avg_pairwise_correlation,
    );
    expect(fixed.avg_pairwise_correlation).not.toBe(1);
  });

  it("collapse changes ONLY correlation — equity curve / Sharpe / TWR / max-DD are identical", () => {
    const buggy = run(strategies, state);
    const deAliased = collapseAliasedHoldingStrategies(
      strategies,
      state,
      symbolMap,
    );
    const fixed = run(deAliased.strategies, deAliased.state);

    // Merging two identical-series weighted slots into one summed-weight slot
    // is the same weighted sum: the composite curve and its derived risk
    // metrics must be byte-identical. This is the safety guarantee that the
    // de-alias touches nothing but the spurious correlation.
    expect(fixed.equity_curve).toEqual(buggy.equity_curve);
    expect(fixed.twr).toBe(buggy.twr);
    expect(fixed.sharpe).toBe(buggy.sharpe);
    expect(fixed.max_drawdown).toBe(buggy.max_drawdown);
  });
});

describe("production adapter id ↔ symbol-map key alignment (H-0487/H-0493)", () => {
  // The collapse only fixes avgRho if the symbol-map keys (built with
  // buildHoldingRef in ScenarioComposer / holdingScopeKey in the SSR path)
  // byte-match the strategy .id the adapter assigns. If those derivations
  // ever drift, symbolByHoldingId.get(s.id) returns undefined, the collapse
  // silently no-ops, and avgRho is poisoned again — the EXACT failure mode
  // that got the prior sentinel attempt reverted as inert. This drives the
  // REAL adapter + the production key derivation so any such drift fails here
  // instead of silently re-inerting the fix.
  it("real adapter ids collapse — guards the silent re-inert regression", () => {
    const holdings = [
      { venue: "binance", symbol: "BTC", holding_type: "spot" as const, value_usd: 30000 },
      { venue: "okx", symbol: "BTC", holding_type: "spot" as const, value_usd: 20000 },
      { venue: "binance", symbol: "ETH", holding_type: "spot" as const, value_usd: 50000 },
    ];
    const returnsByScopeRef: Record<string, DailyPoint[]> = {
      [buildHoldingRef(holdings[0])]: series(BTC),
      [buildHoldingRef(holdings[1])]: series(BTC), // identical series (symbol-keyed alias)
      [buildHoldingRef(holdings[2])]: series(ETH),
    };

    // Drive the REAL adapter — it sets each holding strategy's id to
    // buildHoldingRef(h). minReturnDays=2 (our fixture has 12 days).
    const { strategies, state } = buildStrategyForBuilderSet(
      holdings,
      new Set<string>(),
      [],
      returnsByScopeRef,
      {},
      {},
      2,
    );
    expect(strategies).toHaveLength(3);

    // Production builds the symbol map the SAME way (buildHoldingRef).
    const symbolMap = new Map(holdings.map((h) => [buildHoldingRef(h), h.symbol]));
    // Alignment invariant: every adapter holding-strategy id IS a symbol-map key.
    for (const s of strategies) {
      expect(symbolMap.has(s.id)).toBe(true);
    }

    const cacheBuggy = buildDateMapCache(strategies);
    const buggy = computeScenario(strategies, state, cacheBuggy);
    const deAliased = collapseAliasedHoldingStrategies(strategies, state, symbolMap);
    const fixed = computeScenario(
      deAliased.strategies,
      deAliased.state,
      buildDateMapCache(deAliased.strategies),
    );

    // Without collapse: the two BTC venues fabricate a 1.0. With collapse:
    // BTC merges to one slot, ETH kept, and avgRho is no longer the 1.0-inflated value.
    expect(
      buggy.correlation_matrix?.[buildHoldingRef(holdings[0])]?.[
        buildHoldingRef(holdings[1])
      ],
    ).toBe(1);
    expect(deAliased.strategies).toHaveLength(2);
    expect(fixed.avg_pairwise_correlation).not.toBe(buggy.avg_pairwise_correlation);
    expect(fixed.avg_pairwise_correlation).not.toBe(1);
  });
});
