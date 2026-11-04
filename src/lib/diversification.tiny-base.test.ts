/**
 * Phase 188 (TINYBASE) plan 10, D-07, T-KL1-CORR: the diversification panel is built on the same
 * day set as the engine's `correlation_matrix`, so a key's tiny-base day is left out there too,
 * never read as r = 0.
 *
 * Plan 09 made `computeScenario` measure EVERY correlation pair on one day set: the axis days no
 * member names in `undefined_return_days`. The diversification panel rebuilds rho, DR, ENB and PCR
 * from `alignConstituentReturns`'s arrays through ONE covariance matrix, so it can only reproduce
 * the engine's matrix if the arrays sit on that same set. Before this plan the alignment kept the
 * full axis and zero-filled a member's missing day, so a left-out day entered the panel as a flat
 * 0% day and the panel disagreed with the matrix it sits beside.
 *
 * Arithmetic (typed here, never taken from the code under test). Fixture: 12 days
 * 2026-03-01..2026-03-12; unit A has all 12; unit B lacks 2026-03-07 and 2026-03-08 and names them;
 * unit K has all 12. The axis (`commonDates`) is still 12 days, because A and K have a return on the
 * two named days; the correlation day set (`correlationDates`) is the 10 days no member names. Each
 * aligned array is therefore the member's typed values on those 10 days. rho is checked against the
 * engine's `correlation_matrix` to 3 dp for every pair (the consistency pin of
 * `diversification.test.ts`, on a named day) AND against a Pearson written out in this file.
 *
 * Each arm can fail: against an alignment that keeps the full axis (0-filled) the length arms, the
 * values arm and the rebuilt-rho arm all go RED (the neuter drill of plan 10 task 2).
 */
import { describe, it, expect } from "vitest";
import {
  alignConstituentReturns,
  constituentVols,
  covarianceMatrix,
} from "./diversification";
import {
  buildDateMapCache,
  computeScenario,
  type ScenarioState,
  type StrategyForBuilder,
} from "./scenario";

const DAYS = [
  "2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06",
  "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12",
];
const NAMED = ["2026-03-07", "2026-03-08"];
const KEPT_DAYS = DAYS.filter((d) => !NAMED.includes(d));

const A = [0.01, -0.005, 0.02, 0.0, 0.015, -0.01, 0.02, -0.01, 0.005, 0.01, -0.02, 0.012];
const B_DAYS = KEPT_DAYS;
const B = [0.03, -0.02, 0.01, 0.005, -0.015, 0.025, 0.02, -0.01, 0.015, -0.005];
const K = [0.004, 0.011, -0.008, 0.012, -0.003, 0.009, -0.03, 0.04, 0.002, -0.006, 0.007, -0.001];

// The same three series on the 10 days no member names (the indexes of 03-07 and 03-08 are 6 and 7).
const withoutNamed = (xs: number[]) => xs.filter((_, i) => i !== 6 && i !== 7);
const A10 = withoutNamed(A);
const K10 = withoutNamed(K);

function unit(
  id: string,
  days: string[],
  values: number[],
  extra: Partial<StrategyForBuilder> = {},
): StrategyForBuilder {
  return {
    id,
    name: `Unit ${id}`,
    codename: null,
    disclosure_tier: "exploratory",
    strategy_types: [],
    markets: [],
    start_date: null,
    daily_returns: days.map((date, i) => ({ date, value: values[i] })),
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
    asset_class: "crypto",
    ...extra,
  };
}

const aUnit = () => unit("A", DAYS, A);
const kUnit = () => unit("K", DAYS, K);
const bNamed = (days: string[] = NAMED) => unit("B", B_DAYS, B, { undefined_return_days: days });
const bPlain = () => unit("B", B_DAYS, B);

function stateFor(
  strategies: StrategyForBuilder[],
  window?: { start: string; end: string },
): ScenarioState {
  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = { A: 1, B: 3, K: 1 };
  const startDates: Record<string, string> = {};
  for (const s of strategies) {
    selected[s.id] = true;
    startDates[s.id] = "2026-01-01";
  }
  return { selected, weights, startDates, ...(window ? { window } : {}) };
}

/** Pearson written out here, so the oracle never calls the code under test. */
function pearsonRef(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return cov / Math.sqrt(va * vb);
}

/** rho rebuilt the way the panel does: covarianceMatrix and constituentVols over the aligned arrays. */
function rebuiltRho(
  ids: string[],
  returnsById: Record<string, number[]>,
): Record<string, Record<string, number>> {
  const cov = covarianceMatrix(returnsById, ids)!;
  const vols = constituentVols(returnsById, ids)!;
  const out: Record<string, Record<string, number>> = {};
  ids.forEach((a, i) => {
    out[a] = {};
    ids.forEach((b, j) => {
      const sa = vols[a];
      const sb = vols[b];
      out[a][b] = i === j ? 1 : sa > 0 && sb > 0 ? Number((cov[i][j] / (sa * sb)).toFixed(3)) : 0;
    });
  });
  return out;
}

describe("alignConstituentReturns - a named day is left out of the correlation day set (188 D-07)", () => {
  it("the axis stays the engine's 12 days; the arrays sit on the 10 days no member names", () => {
    const strategies = [aUnit(), bNamed(), kUnit()];
    const state = stateFor(strategies);
    const aligned = alignConstituentReturns(strategies, state);
    const engine = computeScenario(strategies, state, buildDateMapCache(strategies), 365);

    expect(aligned.ids).toEqual(["A", "B", "K"]);
    // commonDates is still the engine's axis (A and K have a return on the two named days).
    expect(aligned.commonDates).toEqual(DAYS);
    expect(aligned.commonDates).toHaveLength(engine.n);
    // correlationDates is the axis without the days a member names.
    expect(aligned.correlationDates).toEqual(KEPT_DAYS);
    expect(aligned.correlationDates).toHaveLength(10);
    // Every array is on correlationDates: A and K are their typed values without the two days, and
    // B is its own 10 typed values - the two left-out days are not 0s inside it.
    expect(aligned.returnsById.A).toEqual(A10);
    expect(aligned.returnsById.K).toEqual(K10);
    expect(aligned.returnsById.B).toEqual(B);
    for (const id of aligned.ids) expect(aligned.returnsById[id]).toHaveLength(10);
  });

  it("rebuilt rho equals the engine correlation_matrix to 3 dp for every pair, and a Pearson written out here", () => {
    const strategies = [aUnit(), bNamed(), kUnit()];
    const state = stateFor(strategies);
    const engineMatrix = computeScenario(strategies, state, buildDateMapCache(strategies), 365)
      .correlation_matrix!;
    const { ids, returnsById } = alignConstituentReturns(strategies, state);
    const rho = rebuiltRho(ids, returnsById);

    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        expect(rho[a][b]).toBeCloseTo(engineMatrix[a][b], 3);
      }
    }
    // Independent of both: the Pearson of the typed 10-day series.
    expect(rho.A.B).toBeCloseTo(Number(pearsonRef(A10, B).toFixed(3)), 3);
    expect(rho.A.K).toBeCloseTo(Number(pearsonRef(A10, K10).toFixed(3)), 3);
    expect(rho.B.K).toBeCloseTo(Number(pearsonRef(B, K10).toFixed(3)), 3);
  });

  it("non-vacuity: reading the two days as 0 gives a different rho, so the pin above can fail", () => {
    // The same series without the field: the alignment 0-fills B on 03-07 and 03-08 over 12 days.
    const strategies = [aUnit(), bPlain(), kUnit()];
    const state = stateFor(strategies);
    const aligned = alignConstituentReturns(strategies, state);
    expect(aligned.correlationDates).toBeUndefined();
    expect(aligned.returnsById.B).toHaveLength(12);
    const zeroFilled = rebuiltRho(aligned.ids, aligned.returnsById);
    const namedStrategies = [aUnit(), bNamed(), kUnit()];
    const engineMatrix = computeScenario(
      namedStrategies,
      stateFor(namedStrategies),
      buildDateMapCache(namedStrategies),
      365,
    ).correlation_matrix!;
    const gap = Math.max(
      Math.abs(zeroFilled.A.B - engineMatrix.A.B),
      Math.abs(zeroFilled.B.K - engineMatrix.B.K),
      Math.abs(zeroFilled.A.K - engineMatrix.A.K),
    );
    expect(gap).toBeGreaterThan(0.001);
  });

  it("a day only the naming member has is not on the axis at all (engine parity), so commonDates stays the engine's n", () => {
    // B carries a stored point on 2026-03-13 that it also names; A and K have nothing there. The
    // engine builds the axis without it, so n is 12, and so must the alignment (no 13th day). The
    // two other named days are still on the axis, so correlationDates is the same 10 days.
    const bExtra = unit("B", [...B_DAYS, "2026-03-13"], [...B, 0.5], {
      undefined_return_days: [...NAMED, "2026-03-13"],
    });
    const strategies = [aUnit(), bExtra, kUnit()];
    const state = stateFor(strategies);
    const engine = computeScenario(strategies, state, buildDateMapCache(strategies), 365);
    const aligned = alignConstituentReturns(strategies, state);
    expect(engine.n).toBe(12);
    expect(aligned.commonDates).toEqual(DAYS);
    expect(aligned.correlationDates).toEqual(KEPT_DAYS);
    for (const id of aligned.ids) expect(aligned.returnsById[id]).toHaveLength(10);
    expect(aligned.returnsById.B).toEqual(B);
  });

  it("the windowed path follows the same rule: rebuilt rho equals the engine's inside a window", () => {
    const strategies = [aUnit(), bNamed(), kUnit()];
    const state = stateFor(strategies, { start: "2026-03-01", end: "2026-03-12" });
    const engineMatrix = computeScenario(strategies, state, buildDateMapCache(strategies), 365)
      .correlation_matrix!;
    const aligned = alignConstituentReturns(strategies, state);
    expect(aligned.correlationDates).toEqual(KEPT_DAYS);
    const rho = rebuiltRho(aligned.ids, aligned.returnsById);
    for (const a of aligned.ids) {
      for (const b of aligned.ids) {
        if (a !== b) expect(rho[a][b]).toBeCloseTo(engineMatrix[a][b], 3);
      }
    }
  });
});

describe("alignConstituentReturns - only the days a member names change anything (SC-4)", () => {
  // Today's output for A and B with B lacking two days, typed: the axis is the union (12 days) and
  // the missing days are 0-filled.
  const B_ZERO_FILLED = [0.03, -0.02, 0.01, 0.005, -0.015, 0.025, 0, 0, 0.02, -0.01, 0.015, -0.005];

  it("no unit names a day: the output is exactly today's (no correlationDates key, arrays the length of commonDates)", () => {
    const strategies = [aUnit(), bPlain()];
    const out = alignConstituentReturns(strategies, stateFor(strategies));
    expect(out).toStrictEqual({
      ids: ["A", "B"],
      commonDates: DAYS,
      returnsById: { A, B: B_ZERO_FILLED },
    });
  });

  it("an empty list, or a list whose days are not on the axis, is the same output", () => {
    const empty = [aUnit(), bNamed([])];
    const off = [aUnit(), bNamed(["2025-01-01"])];
    const expected = {
      ids: ["A", "B"],
      commonDates: DAYS,
      returnsById: { A, B: B_ZERO_FILLED },
    };
    expect(alignConstituentReturns(empty, stateFor(empty))).toStrictEqual(expected);
    expect(alignConstituentReturns(off, stateFor(off))).toStrictEqual(expected);
  });
});
