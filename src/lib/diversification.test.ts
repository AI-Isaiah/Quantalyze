import { describe, it, expect } from "vitest";
import {
  buildDateMapCache,
  computeScenario,
  type ScenarioState,
  type StrategyForBuilder,
} from "@/lib/scenario";
import {
  alignConstituentReturns,
  constituentVols,
  covarianceMatrix,
} from "@/lib/diversification";

// ──────────────────────────────────────────────────────────────────────────
// Hand-computed 12-observation, 3-constituent fixture.
//   A,B  : strongly correlated (ρ≈0.998 ≥ 0.85 → "too similar")
//   C    : near-orthogonal (ρ≈−0.29 to both)
// n=12 is LOAD-BEARING for the consistency pin: a sample→population σ bleed
// shifts the rebuilt ρ by the (n−1)/n = 11/12 factor (e.g. AB: 0.998 → 1.089,
// a 0.091 shift ≫ the 3dp/0.001 tolerance), so a population bleed turns the
// pin RED. With far more observations the factor would be too small to detect.
// ──────────────────────────────────────────────────────────────────────────
const N_OBS = 12;
const DATES = Array.from({ length: N_OBS }, (_, i) =>
  `2024-01-${String(i + 1).padStart(2, "0")}`,
);

const A_VALUES = [
  0.01, -0.02, 0.015, 0.005, -0.01, 0.02, -0.005, 0.012, -0.018, 0.008, 0.003,
  -0.006,
];
const B_NOISE = [
  0.001, -0.0005, 0.0008, -0.0003, 0.0006, -0.0009, 0.0004, -0.0007, 0.0011,
  -0.0002, 0.0005, -0.0004,
];
const B_VALUES = A_VALUES.map((x, i) => x * 0.9 + B_NOISE[i]);
const C_VALUES = [
  0.02, 0.018, -0.022, -0.019, 0.021, 0.017, -0.02, -0.016, 0.023, 0.015,
  -0.024, -0.014,
];

function series(values: number[]) {
  return DATES.map((date, i) => ({ date, value: values[i] }));
}

function strat(
  id: string,
  values: number[],
  startDate: string | null = null,
): StrategyForBuilder {
  return {
    id,
    name: id,
    codename: null,
    disclosure_tier: "full",
    strategy_types: [],
    markets: [],
    start_date: startDate,
    daily_returns: series(values),
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
  };
}

const STRATS_3: StrategyForBuilder[] = [
  strat("A", A_VALUES),
  strat("B", B_VALUES),
  strat("C", C_VALUES),
];

function equalState(ids: string[]): ScenarioState {
  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  for (const id of ids) {
    selected[id] = true;
    weights[id] = 1;
  }
  return { selected, weights, startDates: {} };
}

const STATE_3 = equalState(["A", "B", "C"]);

// ──────────────────────────────────────────────────────────────────────────
describe("alignConstituentReturns", () => {
  it("returns one equal-length, zero-filled array per active id over the union axis", () => {
    const { ids, commonDates, returnsById } = alignConstituentReturns(
      STRATS_3,
      STATE_3,
    );
    expect(ids).toEqual(["A", "B", "C"]);
    expect(commonDates).toEqual(DATES);
    expect(returnsById.A).toEqual(A_VALUES);
    expect(returnsById.B).toEqual(B_VALUES);
    expect(returnsById.C).toEqual(C_VALUES);
    // all equal length
    const lens = ids.map((id) => returnsById[id].length);
    expect(new Set(lens).size).toBe(1);
    expect(lens[0]).toBe(N_OBS);
  });

  it("mirrors the engine's internal aligned series (staggered include-from, zero-fill)", () => {
    // Stagger: B included only from 2024-01-05 → its first 4 days zero-filled.
    const state: ScenarioState = {
      selected: { A: true, B: true, C: true },
      weights: { A: 1, B: 1, C: 1 },
      startDates: { B: "2024-01-05" },
    };
    const { commonDates, returnsById } = alignConstituentReturns(
      STRATS_3,
      state,
    );
    // Union axis is still all 12 dates (A and C span them all).
    expect(commonDates).toEqual(DATES);
    // B zero-filled before its include-from, raw value at/after.
    expect(returnsById.B.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(returnsById.B.slice(4)).toEqual(B_VALUES.slice(4));
  });

  it("falls back to 2022-01-01 when startDates and start_date are both absent", () => {
    // start_date null + no override → include-from "2022-01-01"; all 2024 dates ≥ it.
    const s = strat("A", A_VALUES, null);
    const state: ScenarioState = {
      selected: { A: true },
      weights: { A: 1 },
      startDates: {},
    };
    const { commonDates, returnsById } = alignConstituentReturns([s], state);
    expect(commonDates).toEqual(DATES); // nothing filtered out — fallback is far in the past
    expect(returnsById.A).toEqual(A_VALUES);
  });

  it("excludes inactive (unselected) strategies", () => {
    const state: ScenarioState = {
      selected: { A: true, B: false, C: true },
      weights: { A: 1, B: 1, C: 1 },
      startDates: {},
    };
    const { ids } = alignConstituentReturns(STRATS_3, state);
    expect(ids).toEqual(["A", "C"]);
  });
});

describe("covarianceMatrix (SAMPLE)", () => {
  it("computes the two-pass sample (÷T−1) covariance to 6dp", () => {
    const { ids, returnsById } = alignConstituentReturns(STRATS_3, STATE_3);
    const cov = covarianceMatrix(returnsById, ids);
    expect(cov).not.toBeNull();
    // Hand-computed sample covariances (÷11).
    expect(cov![0][1]).toBeCloseTo(1.481e-4, 7); // cov(A,B)
    expect(cov![0][2]).toBeCloseTo(-7.5258e-5, 8); // cov(A,C)
    expect(cov![1][2]).toBeCloseTo(-6.6312e-5, 8); // cov(B,C)
    // Diagonal = sample variance.
    expect(cov![0][0]).toBeCloseTo(1.6688e-4, 7); // var(A)
    expect(cov![1][1]).toBeCloseTo(1.3188e-4, 7); // var(B)
    expect(cov![2][2]).toBeCloseTo(4.0736e-4, 7); // var(C)
    // Symmetric.
    expect(cov![1][0]).toBe(cov![0][1]);
    expect(cov![2][0]).toBe(cov![0][2]);
  });

  it("returns null on T<2", () => {
    expect(covarianceMatrix({ A: [0.01], B: [0.02] }, ["A", "B"])).toBeNull();
    expect(covarianceMatrix({}, [])).toBeNull();
  });
});

describe("constituentVols (SAMPLE σ)", () => {
  it("is the per-id sample std (÷T−1)", () => {
    const { ids, returnsById } = alignConstituentReturns(STRATS_3, STATE_3);
    const vols = constituentVols(returnsById, ids);
    expect(vols).not.toBeNull();
    expect(vols!.A).toBeCloseTo(0.012918, 6);
    expect(vols!.B).toBeCloseTo(0.011484, 6);
    expect(vols!.C).toBeCloseTo(0.020183, 6);
  });

  it("returns null on empty input", () => {
    expect(constituentVols({}, [])).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// THE CONSISTENCY PIN (load-bearing). Rebuild ρ from THIS lib's own cov+σ and
// assert it EQUALS the FROZEN engine's `correlation_matrix` to 3dp for every
// off-diagonal pair. This proves the re-alignment + SAMPLE convention match the
// engine. MUTATION PROOF: flipping `stdDev(x, true)` → `stdDev(x, false)` in
// constituentVols shifts the rebuilt ρ by the (n−1)/n = 11/12 factor (n=12),
// turning AB's pin from 0.998 to 1.089 — RED. See the fixture note above.
// ──────────────────────────────────────────────────────────────────────────
describe("consistency pin — rebuilt ρ matches the engine correlation_matrix", () => {
  it("rebuilt ρ == computeScenario(...).correlation_matrix to 3dp (off-diagonal)", () => {
    const dateMapCache = buildDateMapCache(STRATS_3);
    const metrics = computeScenario(STRATS_3, STATE_3, dateMapCache);
    expect(metrics.correlation_matrix).not.toBeNull();
    const engine = metrics.correlation_matrix!;

    const { ids, returnsById } = alignConstituentReturns(STRATS_3, STATE_3);
    const cov = covarianceMatrix(returnsById, ids)!;
    const vols = constituentVols(returnsById, ids)!;

    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        const sa = vols[ids[i]];
        const sb = vols[ids[j]];
        const rhoLib =
          sa > 0 && sb > 0 ? Number((cov[i][j] / (sa * sb)).toFixed(3)) : 0;
        const rhoEngine = engine[ids[i]][ids[j]];
        // 3dp tolerance: both are rounded to 3 decimals.
        expect(rhoLib).toBeCloseTo(rhoEngine, 3);
      }
    }
  });
});
