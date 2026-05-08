import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for the audit finding that `getPercentiles` ranked
 * catastrophic max_drawdown strategies into the top quartile.
 *
 * max_drawdown is stored as a NEGATIVE percentage (quantstats convention,
 * see analytics-service/services/metrics.py:133). The percentile helper
 * inverts the rank for LOWER_IS_BETTER metrics, but on negative values the
 * inversion produces the wrong ordering: -0.50 (worst) ends up with a
 * higher percentile than -0.05 (best). The fix is to take Math.abs of
 * max_drawdown before ranking so the inversion treats "small drawdown =
 * low value = good" the same way it does for volatility.
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

import { getPercentiles } from "./queries";

beforeEach(() => {
  strategiesResolver.data = null;
  strategiesResolver.error = null;
});

describe("getPercentiles — max_drawdown sign convention", () => {
  it("ranks the smallest drawdown as the highest percentile and the largest as the lowest", async () => {
    // Five strategies with the audit-described distribution:
    //   -0.50 = worst (50% drawdown)
    //   -0.01 = best  (1% drawdown)
    // All other metrics held at neutral values to keep the test focused
    // on max_drawdown.
    strategiesResolver.data = [
      { id: "worst", strategy_analytics: { max_drawdown: -0.50, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, volatility: 0.2, cumulative_return: 0 } },
      { id: "bad",   strategy_analytics: { max_drawdown: -0.25, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, volatility: 0.2, cumulative_return: 0 } },
      { id: "ok",    strategy_analytics: { max_drawdown: -0.10, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, volatility: 0.2, cumulative_return: 0 } },
      { id: "good",  strategy_analytics: { max_drawdown: -0.05, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, volatility: 0.2, cumulative_return: 0 } },
      { id: "best",  strategy_analytics: { max_drawdown: -0.01, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, volatility: 0.2, cumulative_return: 0 } },
    ];

    const result = await getPercentiles();
    expect(result).not.toBeNull();
    const ranks = result!;

    // The smallest-magnitude drawdown must rank ABOVE the largest.
    expect(ranks.best.max_drawdown).toBeGreaterThan(ranks.worst.max_drawdown);

    // Concrete percentiles: with N=5, magnitudes [0.01, 0.05, 0.10, 0.25, 0.50],
    // raw_percentile(best=0.01) = 1/5*100 = 20 → invert → 80
    // raw_percentile(worst=0.50) = 5/5*100 = 100 → invert → 0
    expect(ranks.best.max_drawdown).toBe(80);
    expect(ranks.worst.max_drawdown).toBe(0);
  });

  it("still ranks volatility (positive lower-is-better) correctly", async () => {
    // Sanity check: the fix must not break the volatility path, which
    // shares the LOWER_IS_BETTER inversion but is stored as positive
    // values where smaller IS better.
    strategiesResolver.data = [
      { id: "calm",   strategy_analytics: { volatility: 0.05, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, max_drawdown: -0.10, cumulative_return: 0 } },
      { id: "low",    strategy_analytics: { volatility: 0.10, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, max_drawdown: -0.10, cumulative_return: 0 } },
      { id: "mid",    strategy_analytics: { volatility: 0.20, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, max_drawdown: -0.10, cumulative_return: 0 } },
      { id: "high",   strategy_analytics: { volatility: 0.40, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, max_drawdown: -0.10, cumulative_return: 0 } },
      { id: "wild",   strategy_analytics: { volatility: 0.80, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, max_drawdown: -0.10, cumulative_return: 0 } },
    ];

    const result = await getPercentiles();
    expect(result).not.toBeNull();
    const ranks = result!;

    expect(ranks.calm.volatility).toBeGreaterThan(ranks.wild.volatility);
    expect(ranks.calm.volatility).toBe(80);
    expect(ranks.wild.volatility).toBe(0);
  });
});
