import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 239 (CACHE-04) — Discovery ranks a BTC-unit strategy beside USD strategies as
 * pure performance, with no BTC price conversion and no separate group.
 *
 * Founder ruling, 2026-11-24 (239-CONTEXT.md):
 *   Q1: "That is correct, As BTC Strategies usually just have a different collateral."
 *   Q2: "This is correct. Inportantly, When comparinh BTC to USaf Strategies. Dont include
 *        BTC Price conversion. Just compare pure Performance"
 *
 * Today's behaviour is the ruled behaviour, so this file pins it as BEHAVIOUR: a native-unit
 * row's figures leave list shaping unconverted, and the row is scored in the SAME percentile
 * population as the USD rows. It does not pin projection bytes;
 * `queries.percentile-columns.test.ts` already does that and is not duplicated here.
 */

const strategiesResolver = vi.hoisted(() => ({
  data: null as unknown,
  error: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      // getPercentiles awaits the chain directly (no .single()). Make the
      // chain thenable so `await query` resolves to the seeded payload.
      chain.then = (
        onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
      ) =>
        Promise.resolve({
          data: strategiesResolver.data,
          error: strategiesResolver.error,
        }).then(onFulfilled);
      return chain;
    },
  }),
}));

// admin client is imported by queries.ts (`import "server-only"` lives there);
// mock it so the module loads inside vitest's jsdom env.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({}) }),
}));

import { getOwnRowPercentiles, getPercentiles, shapeRowAnalytics } from "./queries";

beforeEach(() => {
  strategiesResolver.data = null;
  strategiesResolver.error = null;
});

/** A complete analytics row; every KPI but cagr and cumulative_return is held equal. */
function analytics(cagr: number, cumulative_return: number, extra: Record<string, unknown> = {}) {
  return {
    computation_status: "complete",
    max_drawdown: -0.1,
    cagr,
    sharpe: 1,
    sortino: 1,
    calmar: 1,
    volatility: 0.2,
    cumulative_return,
    ...extra,
  };
}

const BTC = { native_unit: "BTC", data_quality_flags: { native_unit: "BTC" } };

describe("Discovery list shaping — no BTC price conversion (CACHE-04)", () => {
  it("a native-unit row's figures reach the list unconverted", () => {
    const btc = shapeRowAnalytics(analytics(0.9, 3.2, BTC) as never, "btc-1");
    expect(btc.cagr).toBe(0.9);
    expect(btc.cumulative_return).toBe(3.2);
    expect(btc.native_unit).toBe("BTC");

    const usd = shapeRowAnalytics(analytics(0.4, 1.1) as never, "usd-1");
    expect(usd.cagr).toBe(0.4);
    expect(usd.cumulative_return).toBe(1.1);
    expect(usd.native_unit).toBeNull();
  });
});

describe("Discovery percentiles — one population (CACHE-04)", () => {
  it("a BTC row is scored in the same population as the USD rows", async () => {
    // Six rows, so a unit partition would leave five: the map stays non-null and the
    // failure names the missing BTC row instead of a null map.
    strategiesResolver.data = [
      { id: "usd-1", strategy_analytics: analytics(0.1, 0.2) },
      { id: "usd-2", strategy_analytics: analytics(0.2, 0.4) },
      { id: "usd-3", strategy_analytics: analytics(0.3, 0.6) },
      { id: "usd-4", strategy_analytics: analytics(0.4, 0.8) },
      { id: "usd-5", strategy_analytics: analytics(0.5, 1.0) },
      { id: "btc-1", strategy_analytics: analytics(0.9, 3.2, BTC) },
    ];

    const result = await getPercentiles();
    expect(result).not.toBeNull();
    const ranks = result!;
    expect(Object.keys(ranks).sort()).toEqual(["btc-1", "usd-1", "usd-2", "usd-3", "usd-4", "usd-5"]);
    // The raw BTC figures are the highest of the six, so unconverted they top both metrics.
    expect(ranks["btc-1"].cagr).toBe(100);
    expect(ranks["btc-1"].cumulative_return).toBe(100);
    // The discriminating pair: 5 of the six values are <= usd-5's, so one population gives 83.
    // A USD-only cohort of five would give 100, so this fails when the BTC row is scored in
    // its own group or dropped, not only when it is missing.
    expect(ranks["usd-5"].cagr).toBe(83);
    expect(ranks["usd-5"].cumulative_return).toBe(83);
  });

  it("an own BTC row is scored against the USD and BTC published rows together", async () => {
    strategiesResolver.data = [
      { id: "usd-1", strategy_analytics: analytics(0.1, 0.2) },
      { id: "usd-2", strategy_analytics: analytics(0.2, 0.4) },
      { id: "usd-3", strategy_analytics: analytics(0.3, 0.6) },
      { id: "usd-4", strategy_analytics: analytics(0.4, 0.8) },
      { id: "usd-5", strategy_analytics: analytics(0.5, 1.0) },
      { id: "btc-1", strategy_analytics: analytics(0.9, 3.2, BTC) },
    ];
    // An unpublished BTC own row that sits mid-pack: three of the seven values (six published
    // plus itself) are <= it, so one population gives 43. Scored among BTC rows alone (its own
    // cohort) it would be 50 against btc-1, and scored against the USD rows only it would be 50.
    const own = shapeRowAnalytics(analytics(0.25, 0.5, BTC) as never, "own-btc");

    const result = await getOwnRowPercentiles([{ id: "own-btc", analytics: own }]);
    expect(result).not.toBeNull();
    expect(result!.ownMap["own-btc"].cagr).toBe(43);
    expect(result!.ownMap["own-btc"].cumulative_return).toBe(43);
    // The published map is the one population too: usd-5 is 5 of 6.
    expect(result!.publishedMap["usd-5"].cagr).toBe(83);
  });
});
