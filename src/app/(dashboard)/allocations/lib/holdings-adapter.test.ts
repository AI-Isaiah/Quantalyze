/**
 * Phase 09.1 Plan 04 / D-18. RED tests for the pure holdings-adapter.
 *
 * Locks the contract for `toDesignHoldings`:
 *   - PURE transform (no fetches, no localStorage, no Date.now())
 *   - Output row count == input holdingsSummary row count
 *   - Identity tuple {venue, symbol, holding_type} preserved per row
 *   - Status derivation from flaggedHoldings.composite_score
 *     (>=50 → underperform, [40,50) → watch, else ok)
 *   - bridgeCandidate = matchDecisionsByHoldingRef[ref] != null
 *   - weight = value_usd / Σ value_usd (0 when Σ === 0)
 *   - Strategy resolution via caller-supplied holdingToStrategyId map ONLY
 *     (no symbol-string heuristic, no fabricated joins)
 *
 * Per Plan §RULE: tests reference `composite_score` on the adapter's input
 * shape (D-18 declared contract), NOT the live `FlaggedHolding.top_candidate_composite`
 * — the call site (HoldingsTabPanel, Plan 08) is responsible for mapping.
 */
import { describe, it, expect } from "vitest";
import { toDesignHoldings, type HoldingsAdapterInputs } from "./holdings-adapter";
import { buildHoldingRef } from "./holding-outcome-adapter";

type AdapterFlag = HoldingsAdapterInputs["flaggedHoldings"][number];
type AdapterHolding = HoldingsAdapterInputs["holdingsSummary"][number];
type AdapterStrategy = HoldingsAdapterInputs["strategies"][number];

function makeHolding(partial: Partial<AdapterHolding> = {}): AdapterHolding {
  return {
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    quantity: 1,
    value_usd: 100,
    ...partial,
  };
}

function makeFlag(partial: Partial<AdapterFlag> = {}): AdapterFlag {
  return {
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    composite_score: 55,
    top_candidate_strategy_id: null,
    ...partial,
  };
}

function makeStrategy(partial: Partial<AdapterStrategy> = {}): AdapterStrategy {
  return {
    id: "strat-1",
    name: "Default Strategy",
    alias: null,
    codename: null,
    // audit-2026-05-07 G8.A.10 (P43) — adapter routes through
    // `displayStrategyName`, which only surfaces `name` for institutional
    // tier. Tests that don't care about disclosure default to institutional
    // so the legacy "name appears verbatim" assertions still pass; tests
    // that exercise exploratory-tier redaction set their own tier.
    disclosure_tier: "institutional",
    strategy_types: null,
    strategy_analytics: null,
    ...partial,
  };
}

function makeInputs(partial: Partial<HoldingsAdapterInputs> = {}): HoldingsAdapterInputs {
  return {
    holdingsSummary: [],
    flaggedHoldings: [],
    matchDecisionsByHoldingRef: {},
    strategies: [],
    analyticsByStrategyId: undefined,
    holdingToStrategyId: undefined,
    now: undefined,
    ...partial,
  };
}

describe("toDesignHoldings (D-18 pure adapter)", () => {
  it("returns empty array for empty holdingsSummary", () => {
    expect(toDesignHoldings(makeInputs())).toEqual([]);
  });

  it("preserves row count exactly (2 holdings → 2 rows)", () => {
    const inputs = makeInputs({
      holdingsSummary: [
        makeHolding({ symbol: "BTC", value_usd: 100 }),
        makeHolding({ symbol: "ETH", value_usd: 200 }),
      ],
    });
    const out = toDesignHoldings(inputs);
    expect(out).toHaveLength(2);
  });

  it("preserves {venue, symbol, holding_type} identity per row", () => {
    const inputs = makeInputs({
      holdingsSummary: [
        makeHolding({ venue: "binance", symbol: "BTC", holding_type: "spot" }),
        makeHolding({ venue: "okx", symbol: "ETHUSDT", holding_type: "derivative" }),
      ],
    });
    const out = toDesignHoldings(inputs);
    expect(out[0]).toMatchObject({ venue: "binance", symbol: "BTC", holding_type: "spot" });
    expect(out[1]).toMatchObject({ venue: "okx", symbol: "ETHUSDT", holding_type: "derivative" });
  });

  it("assigns status='ok' when holding is not flagged", () => {
    const inputs = makeInputs({
      holdingsSummary: [makeHolding({ symbol: "BTC" }), makeHolding({ symbol: "ETH" })],
    });
    const out = toDesignHoldings(inputs);
    expect(out.every((r) => r.status === "ok")).toBe(true);
  });

  it("assigns status='underperform' when in flaggedHoldings with composite >= 50", () => {
    const h = makeHolding({ symbol: "BTC" });
    const inputs = makeInputs({
      holdingsSummary: [h],
      flaggedHoldings: [makeFlag({ symbol: "BTC", composite_score: 55 })],
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].status).toBe("underperform");
  });

  it("assigns status='watch' when in flaggedHoldings with 40 <= composite < 50", () => {
    const h = makeHolding({ symbol: "BTC" });
    const inputs = makeInputs({
      holdingsSummary: [h],
      flaggedHoldings: [makeFlag({ symbol: "BTC", composite_score: 42 })],
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].status).toBe("watch");
  });

  it("sets bridgeCandidate=true when matchDecisionsByHoldingRef[ref] != null", () => {
    const h = makeHolding({ symbol: "BTC" });
    const ref = buildHoldingRef(h);
    const inputs = makeInputs({
      holdingsSummary: [h],
      matchDecisionsByHoldingRef: { [ref]: { id: "decision-uuid" } },
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].bridgeCandidate).toBe(true);
  });

  it("sets bridgeCandidate=false when matchDecisionsByHoldingRef[ref] === null or missing", () => {
    const h = makeHolding({ symbol: "BTC" });
    const h2 = makeHolding({ symbol: "ETH" });
    const ref = buildHoldingRef(h);
    const inputs = makeInputs({
      holdingsSummary: [h, h2],
      matchDecisionsByHoldingRef: { [ref]: null },
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].bridgeCandidate).toBe(false);
    expect(out[1].bridgeCandidate).toBe(false);
  });

  it("computes weight = value_usd / Σ value_usd (0.25, 0.75 for 100/300 total=400)", () => {
    const inputs = makeInputs({
      holdingsSummary: [
        makeHolding({ symbol: "BTC", value_usd: 100 }),
        makeHolding({ symbol: "ETH", value_usd: 300 }),
      ],
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].weight).toBeCloseTo(0.25, 6);
    expect(out[1].weight).toBeCloseTo(0.75, 6);
  });

  it("returns weight=0 for every row when Σ value_usd === 0 (no division-by-zero)", () => {
    const inputs = makeInputs({
      holdingsSummary: [
        makeHolding({ symbol: "BTC", value_usd: 0 }),
        makeHolding({ symbol: "ETH", value_usd: 0 }),
      ],
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].weight).toBe(0);
    expect(out[1].weight).toBe(0);
  });

  it("resolves strategy from strategies[].alias with fallback to .name via caller-supplied holdingToStrategyId map", () => {
    const h1 = makeHolding({ symbol: "BTC" });
    const h2 = makeHolding({ symbol: "ETH" });
    const ref1 = buildHoldingRef(h1);
    const ref2 = buildHoldingRef(h2);
    const inputs = makeInputs({
      holdingsSummary: [h1, h2],
      strategies: [
        makeStrategy({ id: "strat-1", name: "Long BTC", alias: "BTC Hodl" }),
        makeStrategy({ id: "strat-2", name: "ETH Stake", alias: null }),
      ],
      holdingToStrategyId: { [ref1]: "strat-1", [ref2]: "strat-2" },
    });
    const out = toDesignHoldings(inputs);
    // alias preferred when present
    expect(out[0].strategy).toBe("BTC Hodl");
    // falls back to name when alias is null
    expect(out[1].strategy).toBe("ETH Stake");
  });

  it("produces strategy=null when holdingToStrategyId has no entry for the row's ref", () => {
    const h = makeHolding({ symbol: "BTC" });
    const inputs = makeInputs({
      holdingsSummary: [h],
      strategies: [makeStrategy({ id: "strat-1", name: "Long BTC" })],
      holdingToStrategyId: {}, // empty map → no entry for BTC ref
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].strategy).toBeNull();
  });

  it("produces strategy=null when mapped strategy id is not in strategies[]", () => {
    const h = makeHolding({ symbol: "BTC" });
    const ref = buildHoldingRef(h);
    const inputs = makeInputs({
      holdingsSummary: [h],
      strategies: [makeStrategy({ id: "strat-1", name: "Long BTC" })],
      holdingToStrategyId: { [ref]: "strat-MISSING" },
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].strategy).toBeNull();
  });

  it("produces strategy=null when holdingToStrategyId is undefined entirely (no heuristic fabrication)", () => {
    const h1 = makeHolding({ symbol: "BTC" });
    const h2 = makeHolding({ symbol: "ETH" });
    const inputs = makeInputs({
      holdingsSummary: [h1, h2],
      strategies: [
        makeStrategy({ id: "strat-1", name: "Long BTC", alias: "BTC Hodl" }),
        makeStrategy({ id: "strat-2", name: "ETH Stake" }),
      ],
      // holdingToStrategyId left undefined — adapter MUST NOT invent a join
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].strategy).toBeNull();
    expect(out[1].strategy).toBeNull();
    // Strategy-derived columns must also fall through to null
    expect(out[0].manager).toBeNull();
    expect(out[0].tag).toBeNull();
    expect(out[0].mtd).toBeNull();
    expect(out[0].sharpe).toBeNull();
    expect(out[0].dd).toBeNull();
  });

  it("copies mtd/sharpe/dd from strategy_analytics when strategy resolves", () => {
    const h = makeHolding({ symbol: "BTC" });
    const ref = buildHoldingRef(h);
    const inputs = makeInputs({
      holdingsSummary: [h],
      strategies: [
        makeStrategy({
          id: "strat-1",
          name: "Long BTC",
          codename: "BTC-Codename",
          strategy_types: ["market-neutral", "trend"],
          strategy_analytics: { sharpe: 1.2, max_drawdown: -0.18, mtd: 0.034 },
        }),
      ],
      holdingToStrategyId: { [ref]: "strat-1" },
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].sharpe).toBe(1.2);
    expect(out[0].dd).toBe(-0.18);
    expect(out[0].mtd).toBe(0.034);
    // Other strategy-derived columns also wired
    expect(out[0].manager).toBe("BTC-Codename");
    expect(out[0].tag).toBe("market-neutral");
  });

  it("prefers analyticsByStrategyId over strategies[].strategy_analytics when supplied", () => {
    const h = makeHolding({ symbol: "BTC" });
    const ref = buildHoldingRef(h);
    const inputs = makeInputs({
      holdingsSummary: [h],
      strategies: [
        makeStrategy({
          id: "strat-1",
          strategy_analytics: { sharpe: 0.1, max_drawdown: -0.5, mtd: 0.0 },
        }),
      ],
      holdingToStrategyId: { [ref]: "strat-1" },
      analyticsByStrategyId: {
        "strat-1": { sharpe: 2.5, max_drawdown: -0.05, mtd: 0.1 },
      },
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].sharpe).toBe(2.5);
    expect(out[0].dd).toBe(-0.05);
    expect(out[0].mtd).toBe(0.1);
  });

  it("alloc field equals value_usd verbatim", () => {
    const inputs = makeInputs({
      holdingsSummary: [
        makeHolding({ symbol: "BTC", value_usd: 12345.67 }),
      ],
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].alloc).toBe(12345.67);
  });

  it("id equals buildHoldingRef(h) for stable React key", () => {
    const h = makeHolding({ venue: "binance", symbol: "BTC", holding_type: "spot" });
    const inputs = makeInputs({ holdingsSummary: [h] });
    const out = toDesignHoldings(inputs);
    expect(out[0].id).toBe(buildHoldingRef(h));
    expect(out[0].id).toBe("holding:binance:BTC:spot");
  });

  it("computes age in whole days from allocated_at using injectable now", () => {
    const now = new Date("2026-04-24T00:00:00Z");
    const inputs = makeInputs({
      holdingsSummary: [
        // 30-day-old position
        makeHolding({ symbol: "BTC", allocated_at: "2026-03-25T00:00:00Z" }),
        // No allocated_at → age=null
        makeHolding({ symbol: "ETH", allocated_at: null }),
      ],
      now,
    });
    const out = toDesignHoldings(inputs);
    expect(out[0].age).toBe(30);
    expect(out[1].age).toBeNull();
  });
});
