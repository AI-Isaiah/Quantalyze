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
      { id: "worst", strategy_analytics: { computation_status: "complete",max_drawdown: -0.50, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, volatility: 0.2, cumulative_return: 0 } },
      { id: "bad",   strategy_analytics: { computation_status: "complete",max_drawdown: -0.25, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, volatility: 0.2, cumulative_return: 0 } },
      { id: "ok",    strategy_analytics: { computation_status: "complete",max_drawdown: -0.10, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, volatility: 0.2, cumulative_return: 0 } },
      { id: "good",  strategy_analytics: { computation_status: "complete",max_drawdown: -0.05, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, volatility: 0.2, cumulative_return: 0 } },
      { id: "best",  strategy_analytics: { computation_status: "complete",max_drawdown: -0.01, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, volatility: 0.2, cumulative_return: 0 } },
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
      { id: "calm",   strategy_analytics: { computation_status: "complete",volatility: 0.05, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, max_drawdown: -0.10, cumulative_return: 0 } },
      { id: "low",    strategy_analytics: { computation_status: "complete",volatility: 0.10, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, max_drawdown: -0.10, cumulative_return: 0 } },
      { id: "mid",    strategy_analytics: { computation_status: "complete",volatility: 0.20, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, max_drawdown: -0.10, cumulative_return: 0 } },
      { id: "high",   strategy_analytics: { computation_status: "complete",volatility: 0.40, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, max_drawdown: -0.10, cumulative_return: 0 } },
      { id: "wild",   strategy_analytics: { computation_status: "complete",volatility: 0.80, cagr: 0, sharpe: 0, sortino: 0, calmar: 0, max_drawdown: -0.10, cumulative_return: 0 } },
    ];

    const result = await getPercentiles();
    expect(result).not.toBeNull();
    const ranks = result!;

    expect(ranks.calm.volatility).toBeGreaterThan(ranks.wild.volatility);
    expect(ranks.calm.volatility).toBe(80);
    expect(ranks.wild.volatility).toBe(0);
  });
});

/**
 * Phase 159 / RANK-01 — the computed-analytics rank gate.
 *
 * The defect these pin is a PROD fossil class enumerated in 159-CENSUS.md: 17 of
 * 18 published strategies carry a `computation_status = 'failed'` analytics row
 * that STILL holds sharpe/cagr values. `IS NOT NULL` predicates cannot see that —
 * only the status can — so those dead rows were both receiving published
 * percentiles and shifting everyone else's.
 *
 * ⚠️ MEMBERSHIP ONLY. No assertion here compares a percentile as higher/lower
 * across the gate. Removing polluted rows moves the survivors' percentiles BOTH
 * ways (the census measured the sole survivor improving on five KPIs and
 * worsening on two), so a "ranks improve" assertion would be false — ROADMAP 159
 * success criterion 2 forbids it.
 */
describe("getPercentiles — RANK-01 computed-analytics rank gate", () => {
  /** A neutral KPI row; only `id` and the gate status vary between fixtures. */
  const analyticsRow = (computation_status: string | null, sharpe: number) => ({
    computation_status,
    sharpe,
    cagr: sharpe / 10,
    sortino: sharpe,
    calmar: sharpe,
    max_drawdown: -0.1,
    volatility: 0.2,
    cumulative_return: sharpe / 10,
  });

  /** Five distinct, terminally-successful rows — a lawful ranking cohort. */
  const cleanCohort = () => [
    { id: "c1", strategy_analytics: analyticsRow("complete", 0.1) },
    { id: "c2", strategy_analytics: analyticsRow("complete", 0.2) },
    { id: "c3", strategy_analytics: analyticsRow("complete", 0.3) },
    { id: "c4", strategy_analytics: analyticsRow("complete", 0.4) },
    { id: "c5", strategy_analytics: analyticsRow("complete", 0.5) },
  ];

  it("excludes a failed row that STILL holds KPI values, and lets it move no one", async () => {
    // The census fossil class: computation_status='failed' WITH sharpe/cagr set.
    // A null-check gate cannot exclude this row — that is the whole defect.
    strategiesResolver.data = [
      ...cleanCohort(),
      { id: "fossil", strategy_analytics: analyticsRow("failed", 0.35) },
    ];
    const withFossil = await getPercentiles();

    strategiesResolver.data = cleanCohort();
    const withoutFossil = await getPercentiles();

    expect(withFossil).not.toBeNull();
    // (a) the fossil receives no published rank of its own
    expect(Object.keys(withFossil!)).not.toContain("fossil");
    // (b) it does not perturb anyone else's — scoring is byte-identical to a
    //     population where the row never existed. Direction-free by construction.
    expect(withFossil).toEqual(withoutFossil);
  });

  it("scores a complete_with_warnings row exactly like a complete one", async () => {
    // complete_with_warnings is a TERMINAL SUCCESS (closed-sets.ts SURFACING
    // CAVEAT). A single-value `=== 'complete'` gate is the Pitfall-1 defect: it
    // would silently drop a warned-but-valid strategy out of the public ranking.
    const warned = cleanCohort();
    warned[2] = { id: "c3", strategy_analytics: analyticsRow("complete_with_warnings", 0.3) };
    strategiesResolver.data = warned;
    const warnedMap = await getPercentiles();

    strategiesResolver.data = cleanCohort();
    const allCompleteMap = await getPercentiles();

    expect(warnedMap).not.toBeNull();
    expect(Object.keys(warnedMap!)).toContain("c3");
    expect(warnedMap).toEqual(allCompleteMap);
  });

  it("excludes pending, computing, null-status and absent-embed rows", async () => {
    strategiesResolver.data = [
      ...cleanCohort(),
      { id: "pending", strategy_analytics: analyticsRow("pending", 0.9) },
      { id: "computing", strategy_analytics: analyticsRow("computing", 0.9) },
      { id: "nullstatus", strategy_analytics: analyticsRow(null, 0.9) },
      { id: "noembed", strategy_analytics: null },
    ];

    const result = await getPercentiles();
    expect(result).not.toBeNull();
    // Exactly the five terminally-successful strategies are ranked.
    expect(Object.keys(result!).sort()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("counts only RANKABLE rows against the <5 floor", async () => {
    // 6 published strategies clears the raw population floor, but only 4 are
    // computed. The honest denominator is 4, which is below the floor — so the
    // surface must show no ranks at all rather than rank 4 strategies while
    // implying a cohort of 6. This mirrors the RPC's gated min-N denominator.
    strategiesResolver.data = [
      { id: "c1", strategy_analytics: analyticsRow("complete", 0.1) },
      { id: "c2", strategy_analytics: analyticsRow("complete", 0.2) },
      { id: "c3", strategy_analytics: analyticsRow("complete", 0.3) },
      { id: "c4", strategy_analytics: analyticsRow("complete_with_warnings", 0.4) },
      { id: "f1", strategy_analytics: analyticsRow("failed", 0.5) },
      { id: "f2", strategy_analytics: analyticsRow("failed", 0.6) },
    ];

    expect(await getPercentiles()).toBeNull();
  });
});
