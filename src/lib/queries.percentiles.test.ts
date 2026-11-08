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

import { getPercentiles, getOwnRowPercentiles } from "./queries";

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

/**
 * Phase 159 / RANK-01 — the owner surface rides the SAME gate.
 *
 * `getOwnRowPercentiles` backs /my-strategies and had no behavioural coverage
 * before this phase (only the structural pins in
 * src/__tests__/phase-149-my-strategies-parity.test.ts, which scan source text
 * rather than call it). Its whole documented contract is that both `< 5`
 * thresholds mirror `getPercentiles`, so if the gate landed on only one of the
 * two callers the owner's "ranked against N strategies" copy would name a
 * population that includes dead rows the public surface already dropped.
 *
 * `ownRows` is deliberately `[]` here: the gate acts on the PUBLISHED
 * population, which is what these pins are about.
 */
describe("getOwnRowPercentiles — RANK-01 gate parity with getPercentiles", () => {
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

  it("drops a failed-with-KPIs row from the comparison population it reports", async () => {
    strategiesResolver.data = [
      { id: "c1", strategy_analytics: analyticsRow("complete", 0.1) },
      { id: "c2", strategy_analytics: analyticsRow("complete", 0.2) },
      { id: "c3", strategy_analytics: analyticsRow("complete_with_warnings", 0.3) },
      { id: "c4", strategy_analytics: analyticsRow("complete", 0.4) },
      { id: "c5", strategy_analytics: analyticsRow("complete", 0.5) },
      { id: "fossil", strategy_analytics: analyticsRow("failed", 0.35) },
    ];

    const result = await getOwnRowPercentiles([]);
    expect(result).not.toBeNull();

    // The fossil is neither ranked nor counted. populationSize is the number the
    // page's "ranked against N strategies" copy prints — it must be the honest
    // gated denominator, not the raw embed count.
    expect(Object.keys(result!.publishedMap).sort()).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
    ]);
    expect(result!.populationSize).toBe(5);
  });

  it("applies the gated <5 floor exactly as getPercentiles does", async () => {
    const population = [
      { id: "c1", strategy_analytics: analyticsRow("complete", 0.1) },
      { id: "c2", strategy_analytics: analyticsRow("complete", 0.2) },
      { id: "c3", strategy_analytics: analyticsRow("complete", 0.3) },
      { id: "c4", strategy_analytics: analyticsRow("complete_with_warnings", 0.4) },
      { id: "f1", strategy_analytics: analyticsRow("failed", 0.5) },
      { id: "f2", strategy_analytics: analyticsRow("failed", 0.6) },
    ];

    // Same fixture, both callers, same verdict — the mirror contract in
    // getOwnRowPercentiles' docblock, made observable.
    strategiesResolver.data = population;
    expect(await getOwnRowPercentiles([])).toBeNull();

    strategiesResolver.data = population;
    expect(await getPercentiles()).toBeNull();
  });
});

/**
 * Phase 159 red-team / RANK-01, SUBJECT side.
 *
 * The gate above proves a dead row cannot ENTER the comparison set. This one
 * proves it cannot RECEIVE a score from it either. Pre-fix, the gate ran only
 * while building `populationRows`; `ownSubjects` was built from the caller's
 * rows unfiltered, so a `failed` row still carrying stale KPIs — the census
 * counted 17 of them in PROD — was scored against a population it had just
 * been excluded from and shown a percentile on /my-strategies, while
 * /discovery already refused to rank it.
 *
 * The DRAFT case pins the deliberate design point the fix must NOT break: the
 * gate is on `computation_status`, not on published status, so an unpublished
 * strategy with `complete` analytics still gets its "if published, this would
 * sit at Pnn" preview.
 */
describe("getOwnRowPercentiles — RANK-01 gate on the SUBJECTS, not just the population", () => {
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

  const publishedPopulation = () => [
    { id: "c1", strategy_analytics: analyticsRow("complete", 0.1) },
    { id: "c2", strategy_analytics: analyticsRow("complete", 0.2) },
    { id: "c3", strategy_analytics: analyticsRow("complete", 0.3) },
    { id: "c4", strategy_analytics: analyticsRow("complete", 0.4) },
    { id: "c5", strategy_analytics: analyticsRow("complete", 0.5) },
  ];

  // The own rows the page hands over: whatever getMyStrategies returned, i.e.
  // every non-archived strategy regardless of computation_status.
  const ownRow = (id: string, status: string, sharpe: number) => ({
    id,
    analytics: analyticsRow(status, sharpe) as never,
  });

  it("gives a failed own row with stale KPIs NO percentile, while its terminal-success siblings keep theirs", async () => {
    strategiesResolver.data = publishedPopulation();

    const result = await getOwnRowPercentiles([
      ownRow("own-failed", "failed", 0.45),
      ownRow("own-warned", "complete_with_warnings", 0.45),
      ownRow("own-draft", "complete", 0.45),
    ]);

    expect(result).not.toBeNull();
    // The dead row is absent entirely — not present-with-nulls, absent. The
    // page reads presence, so an entry of ANY shape is a rendered rank.
    expect(result!.ownMap["own-failed"]).toBeUndefined();
    // Terminal success stays ranked: `complete_with_warnings` is a SUCCESS
    // status, and a DRAFT with complete analytics keeps its preview rank.
    expect(result!.ownMap["own-warned"]?.sharpe).toBeTypeOf("number");
    expect(result!.ownMap["own-draft"]?.sharpe).toBeTypeOf("number");
  });

  it("drops pending/computing own rows too, and never shrinks the published denominator", async () => {
    strategiesResolver.data = publishedPopulation();

    const result = await getOwnRowPercentiles([
      ownRow("own-pending", "pending", 0.45),
      ownRow("own-computing", "computing", 0.45),
    ]);

    expect(result).not.toBeNull();
    expect(Object.keys(result!.ownMap)).toEqual([]);
    // Subject-side gating must not touch the population the copy names.
    expect(result!.populationSize).toBe(5);
  });
});

/**
 * Phase 194 plan 18 (D-11 as superseded by D-15, founder-decided 2026-11-07) - a strategy
 * whose TOTAL record fails D-15's minimum (crypto: spans under 90 days; non-crypto: under 60
 * return observations) gets no rank for the five annualised metrics AND is left out of every
 * other strategy's population for them. Max drawdown and cumulative return are not
 * annualised and are unaffected. A row whose record cannot be determined keeps its ranks.
 *
 * Expected percentiles are computed BY HAND below from the fixture values with the
 * documented formula (count of values <= v over n, times 100, inverted for
 * max_drawdown/volatility, rounded); `scoreAgainstPopulation` is never called to find them.
 */
describe("getPercentiles - D-15 total-record rule on the peer set", () => {
  const ANNUALISED = ["cagr", "sharpe", "sortino", "calmar", "volatility"] as const;

  const kpis = (sharpe: number, maxDrawdown: number, cumulative: number) => ({
    computation_status: "complete",
    sharpe,
    cagr: sharpe / 10,
    sortino: sharpe,
    calmar: sharpe,
    volatility: 0.1 * sharpe,
    max_drawdown: maxDrawdown,
    cumulative_return: cumulative,
  });

  /** 2025-01-01 -> 2026-03-02 is 425 calendar days. */
  const LONG = {
    series_start: "2025-01-01",
    series_end: "2026-03-02",
    headline_since: null,
    record_observations: 300,
  };
  /** 2026-01-01 -> 2026-03-02 is 60 calendar days. */
  const SIXTY_DAYS = {
    series_start: "2026-01-01",
    series_end: "2026-03-02",
    headline_since: null,
    record_observations: 40,
  };
  /** 2026-01-01 -> 2026-03-26 is 84 calendar days, 60 observations. */
  const SIXTY_OBS_84_DAYS = {
    series_start: "2026-01-01",
    series_end: "2026-03-26",
    headline_since: null,
    record_observations: 60,
  };

  /**
   * Six published rows. F is a crypto record of 60 days (withheld); G a non-crypto record
   * of exactly 60 observations over 84 days (clears); D carries no dated series at all (a
   * record that cannot be determined keeps its ranks). F's Sharpe (10) is the largest so a
   * leaked F would visibly move every other row.
   */
  type SourceRow = { id: string; asset_class: string; strategy_analytics: Record<string, unknown> };
  const population = (): SourceRow[] => [
    { id: "A", asset_class: "equity", strategy_analytics: { ...kpis(1, -0.5, 0.1), ...LONG } },
    { id: "B", asset_class: "crypto", strategy_analytics: { ...kpis(2, -0.4, 0.2), ...LONG } },
    { id: "C", asset_class: "equity", strategy_analytics: { ...kpis(3, -0.3, 0.3), ...LONG } },
    { id: "D", asset_class: "crypto", strategy_analytics: kpis(4, -0.2, 0.4) },
    { id: "F", asset_class: "crypto", strategy_analytics: { ...kpis(10, -0.05, 0.6), ...SIXTY_DAYS } },
    { id: "G", asset_class: "equity", strategy_analytics: { ...kpis(5, -0.1, 0.5), ...SIXTY_OBS_84_DAYS } },
  ];

  it("gives the 60-day crypto row no annualised rank but keeps its max drawdown and cumulative return ranks", async () => {
    strategiesResolver.data = population();
    const map = (await getPercentiles())!;

    for (const metric of ANNUALISED) expect(map.F[metric], metric).toBeUndefined();
    // |max_drawdown| over all six rows = [0.5, 0.4, 0.3, 0.2, 0.1, 0.05]; F = 0.05 is the
    // smallest, so count(<=) = 1, 1/6*100 = 16.67, inverted 83.33 -> 83.
    expect(map.F.max_drawdown).toBe(83);
    // cumulative_return over all six = [0.1 .. 0.6]; F = 0.6 is the largest: 6/6*100 = 100.
    expect(map.F.cumulative_return).toBe(100);
  });

  it("ranks every other row against the five non-F rows only (hand-computed)", async () => {
    strategiesResolver.data = population();
    const map = (await getPercentiles())!;

    // Sharpe over the five non-F rows = [1, 2, 3, 4, 5] -> A 1/5, B 2/5, C 3/5, D 4/5, G 5/5.
    // With F leaked in (10) the six-value denominator would give A 17, B 33, C 50, D 67, G 83.
    expect(map.A.sharpe).toBe(20);
    expect(map.B.sharpe).toBe(40);
    expect(map.C.sharpe).toBe(60);
    expect(map.D.sharpe).toBe(80);
    expect(map.G.sharpe).toBe(100);
    // Volatility = 0.1 * sharpe, lower is better, same five values: A is the calmest (1/5 = 20,
    // inverted 80) and G the wildest (5/5 = 100, inverted 0).
    expect(map.A.volatility).toBe(80);
    expect(map.G.volatility).toBe(0);
  });

  it("keeps the 60-observation non-crypto row's ranks (D-15 minimum is 60) and the row with no dated series", async () => {
    strategiesResolver.data = population();
    const map = (await getPercentiles())!;

    for (const id of ["G", "D"]) {
      for (const metric of ANNUALISED) expect(map[id][metric], `${id} ${metric}`).toBeTypeOf("number");
    }
  });

  it("withholds a non-crypto row of 59 observations but not one of 60", async () => {
    const rows = population();
    rows[5] = {
      id: "G",
      asset_class: "equity",
      strategy_analytics: { ...kpis(5, -0.1, 0.5), ...SIXTY_OBS_84_DAYS, record_observations: 59 },
    };
    strategiesResolver.data = rows;
    const map = (await getPercentiles())!;

    expect(map.G.sharpe).toBeUndefined();
    expect(map.G.max_drawdown).toBeTypeOf("number");
  });

  it("judges crypto by the strategy's asset_class: 89 days is withheld and 90 days clears on a crypto row with no stored count", async () => {
    const rows = population();
    // 2026-01-01 -> 2026-03-30 covers 89 days; -> 2026-03-31 covers 90 (D-20 counts both ends).
    const at = (end: string) => ({ ...SIXTY_DAYS, series_end: end, record_observations: null });
    rows[4] = { id: "F", asset_class: "crypto", strategy_analytics: { ...kpis(10, -0.05, 0.6), ...at("2026-03-30") } };
    strategiesResolver.data = rows;
    expect((await getPercentiles())!.F.sharpe).toBeUndefined();

    rows[4] = { id: "F", asset_class: "crypto", strategy_analytics: { ...kpis(10, -0.05, 0.6), ...at("2026-03-31") } };
    strategiesResolver.data = rows;
    expect((await getPercentiles())!.F.sharpe).toBeTypeOf("number");
  });
});

/**
 * Phase 194 plan 18 (D-11 as superseded by D-15, founder-decided 2026-11-07), the owner
 * surface: /my-strategies applies the SAME total-record rule as discovery, on the published
 * population AND on the owner's own (draft, private) subjects. Expected percentiles are
 * computed by hand from the fixture values with the documented formula; the scorer is never
 * called to find them.
 */
describe("getOwnRowPercentiles - D-15 total-record rule, population and subjects", () => {
  const ANNUALISED = ["cagr", "sharpe", "sortino", "calmar", "volatility"] as const;

  const kpis = (sharpe: number, maxDrawdown: number | null, cumulative: number | null) => ({
    computation_status: "complete",
    sharpe,
    cagr: sharpe / 10,
    sortino: sharpe,
    calmar: sharpe,
    volatility: 0.1 * sharpe,
    max_drawdown: maxDrawdown,
    cumulative_return: cumulative,
  });

  /** 2025-01-01 -> 2026-03-02 is 425 calendar days. */
  const LONG = {
    series_start: "2025-01-01",
    series_end: "2026-03-02",
    headline_since: null,
    record_observations: 300,
  };
  /** 2026-01-01 -> 2026-03-02 is 60 calendar days. */
  const SIXTY_DAYS = {
    series_start: "2026-01-01",
    series_end: "2026-03-02",
    headline_since: null,
    record_observations: 40,
  };
  /** 2026-01-01 -> 2026-03-26 is 84 calendar days, 60 observations. */
  const SIXTY_OBS_84_DAYS = {
    series_start: "2026-01-01",
    series_end: "2026-03-26",
    headline_since: null,
    record_observations: 60,
  };
  /** 2025-09-01 -> 2026-03-20 is 200 calendar days. */
  const TWO_HUNDRED_DAYS = {
    series_start: "2025-09-01",
    series_end: "2026-03-20",
    headline_since: null,
    record_observations: 140,
  };

  type SourceRow = { id: string; asset_class: string; strategy_analytics: Record<string, unknown> };

  /**
   * Seven published rows: P1..P5 on long records (sharpe 1..5, |max drawdown| 0.1..0.5),
   * W a 60-day crypto record (sharpe 9, drawdown -0.05, cumulative 0.6: withheld for the five
   * annualised metrics only) and X a 60-day crypto record with no drawdown and no cumulative
   * return (withheld, and left with nothing to rank on at all).
   */
  const publishedPopulation = (): SourceRow[] => [
    { id: "P1", asset_class: "equity", strategy_analytics: { ...kpis(1, -0.1, 0.1), ...LONG } },
    { id: "P2", asset_class: "crypto", strategy_analytics: { ...kpis(2, -0.2, 0.2), ...LONG } },
    { id: "P3", asset_class: "equity", strategy_analytics: { ...kpis(3, -0.3, 0.3), ...LONG } },
    { id: "P4", asset_class: "crypto", strategy_analytics: { ...kpis(4, -0.4, 0.4), ...LONG } },
    { id: "P5", asset_class: "equity", strategy_analytics: { ...kpis(5, -0.5, 0.5), ...LONG } },
    { id: "W", asset_class: "crypto", strategy_analytics: { ...kpis(9, -0.05, 0.6), ...SIXTY_DAYS } },
    { id: "X", asset_class: "crypto", strategy_analytics: { ...kpis(8, null, null), ...SIXTY_DAYS } },
  ];

  /** An own row as `getMyStrategies` hands it over: the strategy's class plus shaped analytics. */
  const ownRow = (
    id: string,
    assetClass: string | null,
    sharpe: number,
    maxDrawdown: number,
    record: Record<string, unknown>,
  ) => ({
    id,
    asset_class: assetClass,
    analytics: { ...kpis(sharpe, maxDrawdown, 0.25), ...record } as never,
  });

  it("gates the published population as discovery does: a 60-day row neither ranks nor counts for the five metrics", async () => {
    strategiesResolver.data = publishedPopulation();
    const result = (await getOwnRowPercentiles([]))!;

    // Sharpe over the rows that stay in = [1..5]; P1 = 1/5*100 = 20, P5 = 100. W (9) and X (8)
    // would have made them 14 and 71 had they leaked in.
    expect(result.publishedMap.P1.sharpe).toBe(20);
    expect(result.publishedMap.P5.sharpe).toBe(100);
    for (const metric of ANNUALISED) expect(result.publishedMap.W[metric], metric).toBeUndefined();
    // W is still ranked on max drawdown (not annualised): |dd| = [.1,.2,.3,.4,.5,.05] (X has none),
    // W = 0.05 smallest -> 1/6*100 = 16.67, inverted 83.33 -> 83.
    expect(result.publishedMap.W.max_drawdown).toBe(83);
  });

  it("populationSize counts exactly the rows that entered the ranking", async () => {
    strategiesResolver.data = publishedPopulation();
    const result = (await getOwnRowPercentiles([]))!;

    // P1..P5 and W entered (W on two metrics). X had every annualised metric withheld and no
    // drawdown or cumulative return, so it has no rank anywhere and is not counted.
    expect(Object.keys(result.publishedMap).sort()).toEqual(["P1", "P2", "P3", "P4", "P5", "W"]);
    expect(result.populationSize).toBe(6);
  });

  it("gives an unpublished crypto own row spanning 60 days no annualised rank, but still ranks its drawdown", async () => {
    strategiesResolver.data = publishedPopulation();
    const result = (await getOwnRowPercentiles([ownRow("own60", "crypto", 3.5, -0.25, SIXTY_DAYS)]))!;

    for (const metric of ANNUALISED) expect(result.ownMap.own60[metric], metric).toBeUndefined();
    // |dd| population = [.1,.2,.3,.4,.5,.05(W)] plus the subject's own .25 = 7 values;
    // count(<= .25) = .05, .1, .2, .25 = 4 -> 4/7*100 = 57.14, inverted 42.86 -> 43.
    expect(result.ownMap.own60.max_drawdown).toBe(43);
  });

  it("keeps the ranks of an own crypto row spanning 200 days, a non-crypto row of 60 observations, and a row with no record fields", async () => {
    strategiesResolver.data = publishedPopulation();
    const result = (await getOwnRowPercentiles([
      ownRow("own200", "crypto", 3.5, -0.25, TWO_HUNDRED_DAYS),
      ownRow("ownObs60", "equity", 3.5, -0.25, SIXTY_OBS_84_DAYS),
      ownRow("ownBare", "crypto", 3.5, -0.25, {}),
    ]))!;

    // Sharpe population [1..5] plus the subject's 3.5 = 6 values; count(<= 3.5) = 1,2,3,3.5 = 4
    // -> 4/6*100 = 66.67 -> 67, the same for each (a subject never shifts another subject).
    for (const id of ["own200", "ownObs60", "ownBare"]) {
      expect(result.ownMap[id].sharpe, id).toBe(67);
      for (const metric of ANNUALISED) expect(result.ownMap[id][metric], `${id} ${metric}`).toBeTypeOf("number");
    }
  });

  it("withholds an own non-crypto row of 59 observations", async () => {
    strategiesResolver.data = publishedPopulation();
    const result = (await getOwnRowPercentiles([
      ownRow("ownObs59", "equity", 3.5, -0.25, { ...SIXTY_OBS_84_DAYS, record_observations: 59 }),
    ]))!;

    expect(result.ownMap.ownObs59.sharpe).toBeUndefined();
    expect(result.ownMap.ownObs59.max_drawdown).toBeTypeOf("number");
  });

  it("scores an own row that is also published as its already-gated population row, so its ranks equal discovery's", async () => {
    strategiesResolver.data = publishedPopulation();
    // The own copies carry DIFFERENT figures; identity by id must still resolve to the
    // population row, so the own map reads exactly the published map for those ids.
    const result = (await getOwnRowPercentiles([
      ownRow("P3", "equity", 99, -0.01, LONG),
      ownRow("W", "crypto", 99, -0.01, LONG),
    ]))!;

    expect(result.ownMap.P3).toEqual(result.publishedMap.P3);
    expect(result.ownMap.W).toEqual(result.publishedMap.W);
    expect(result.ownMap.W.sharpe).toBeUndefined();
  });
});
