import { describe, it, expect } from "vitest";
import {
  buildDateMapCache,
  computeScenario,
  type ScenarioState,
  type StrategyForBuilder,
} from "@/lib/scenario";
import {
  alignConstituentReturns,
  clusterOrder,
  computeDiversification,
  constituentVols,
  covarianceMatrix,
  diversificationRatio,
  effectiveNumberOfBets,
  percentContributionToRisk,
  tooSimilarPairs,
  type DiversificationInput,
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

/** Local SAMPLE std (÷n−1) — mirrors stdDev(x, true); used to compute σ_p in tests. */
function stdDevSample(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const m = values.reduce((s, v) => s + v, 0) / n;
  const sumSq = values.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(sumSq / (n - 1));
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

  // WR-04 — the riskiest re-alignment path is STAGGERED inception (a constituent
  // starting mid-window, zero-filled before its include-from). The plain pin
  // above runs only on a fully-overlapping window, so it never exercises the
  // `d >= from` boundary / union-vs-intersection logic against the ENGINE. This
  // case runs `computeScenario` on a staggered fixture (B from 2024-01-05) and
  // asserts the rebuilt ρ STILL equals the engine `correlation_matrix` to 3dp —
  // closing the gap the standalone alignment test only half-covered.
  it("rebuilt ρ == engine correlation_matrix to 3dp on a STAGGERED-inception blend (WR-04)", () => {
    const staggered: ScenarioState = {
      selected: { A: true, B: true, C: true },
      weights: { A: 1, B: 1, C: 1 },
      startDates: { B: "2024-01-05" }, // B zero-filled before 2024-01-05
    };
    const dateMapCache = buildDateMapCache(STRATS_3);
    const metrics = computeScenario(STRATS_3, staggered, dateMapCache);
    expect(metrics.correlation_matrix).not.toBeNull();
    const engine = metrics.correlation_matrix!;

    const { ids, returnsById } = alignConstituentReturns(STRATS_3, staggered);
    // Confirm the re-alignment actually staggered B (else the pin is vacuous).
    expect(returnsById.B.slice(0, 4)).toEqual([0, 0, 0, 0]);
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
        expect(rhoLib).toBeCloseTo(rhoEngine, 3);
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Task 2 — DR, PCR, ENB, cluster order, too-similar, orchestrator.
// ──────────────────────────────────────────────────────────────────────────

// Shared engine-derived inputs for the equal-weight 3-constituent blend.
const dateMapCache3 = buildDateMapCache(STRATS_3);
const metrics3 = computeScenario(STRATS_3, STATE_3, dateMapCache3);
const aligned3 = alignConstituentReturns(STRATS_3, STATE_3);
const cov3 = covarianceMatrix(aligned3.returnsById, aligned3.ids)!;
const vols3 = constituentVols(aligned3.returnsById, aligned3.ids)!;
const portReturns3 = (metrics3.portfolio_daily_returns ?? []).map((p) => p.value);
// Equal normalized weights.
const W3 = { A: 1 / 3, B: 1 / 3, C: 1 / 3 };

describe("diversificationRatio (Choueifaty)", () => {
  it("= (Σwᵢσᵢ)/σ_p, hand-verified > 1 on the fixture", () => {
    const sigmaP = stdDevSample(portReturns3);
    const dr = diversificationRatio(W3, vols3, sigmaP);
    expect(dr).not.toBeNull();
    expect(dr!).toBeCloseTo(1.662551, 5);
    expect(dr!).toBeGreaterThan(1);
  });

  it("returns null when σ_p = 0", () => {
    expect(diversificationRatio(W3, vols3, 0)).toBeNull();
  });

  it("is LEVERAGE-INVARIANT under UNIFORM leverage (CR-01 fix; restores 41-01-PLAN.md:152)", () => {
    // A true Choueifaty DR is leverage-invariant: scaling every leg's leverage
    // by L scales both the levered numerator (Σ ŵᵢ·Lσᵢ = L·Σŵᵢσᵢ) and the
    // levered denominator (σ_p = L·σ_p(unlev)) by the SAME L, which cancels.
    // The prior shipped impl (un-levered numerator) WRONGLY HALVED DR under 2×
    // leverage — the review's CR-01 — and a rewritten test blessed it. This pin
    // restores the plan/research intent: DR must NOT move under uniform leverage.
    const sigmaPlain = stdDevSample(portReturns3);
    const drPlain = computeDiversification({
      ids: ["A", "B", "C"],
      returnsById: aligned3.returnsById,
      weights: W3,
      portfolioDailyReturns: portReturns3,
      correlationMatrix: metrics3.correlation_matrix,
      n: metrics3.n,
    }).diversificationRatio!;
    expect(drPlain).toBeCloseTo(1.662551, 5);

    // Apply a UNIFORM 2× leverage to every leg.
    const levState: ScenarioState = {
      ...STATE_3,
      leverage: { A: 2, B: 2, C: 2 },
    };
    const levMetrics = computeScenario(STRATS_3, levState, dateMapCache3);

    // The engine's correlation matrix is byte-identical under leverage
    // (correlation is leverage-invariant — a scale transform cancels in Pearson
    // normalization). This is what keeps the ρ consistency pin valid.
    expect(levMetrics.correlation_matrix).toEqual(metrics3.correlation_matrix);

    // σ_p doubles (the engine levers `portfolio_daily_returns`).
    const levPort = (levMetrics.portfolio_daily_returns ?? []).map(
      (p) => p.value,
    );
    expect(stdDevSample(levPort)).toBeCloseTo(2 * sigmaPlain, 9);

    // INVARIANCE: DR through the orchestrator (which now levers σᵢ too) is
    // UNCHANGED vs the no-leverage DR — the L cancels. This is the test the
    // 41-01 executor wrongly inverted; it is restored to assert EQUALITY.
    const levAligned = alignConstituentReturns(STRATS_3, levState);
    const levResult = computeDiversification({
      ids: levAligned.ids,
      returnsById: levAligned.returnsById,
      weights: W3,
      leverage: levState.leverage,
      portfolioDailyReturns: levPort,
      correlationMatrix: levMetrics.correlation_matrix,
      n: levMetrics.n,
    });
    expect(levResult.diversificationRatio!).toBeCloseTo(drPlain, 9);
    // …and the genuine Choueifaty bound holds at leverage ≠ 1.
    expect(levResult.diversificationRatio!).toBeGreaterThan(1);

    // PCR and ENB are ALSO invariant under uniform leverage (the L factors
    // cancel in the self-normalized Euler ratio).
    const plainResult = computeDiversification({
      ids: ["A", "B", "C"],
      returnsById: aligned3.returnsById,
      weights: W3,
      portfolioDailyReturns: portReturns3,
      correlationMatrix: metrics3.correlation_matrix,
      n: metrics3.n,
    });
    for (const id of ["A", "B", "C"]) {
      expect(levResult.pcr![id]).toBeCloseTo(plainResult.pcr![id], 9);
    }
    expect(levResult.effectiveNumberOfBets!).toBeCloseTo(
      plainResult.effectiveNumberOfBets!,
      9,
    );
  });

  it("shifts the risk driver under NON-UNIFORM leverage (WR-01: heavy-levered leg's PCR rises)", () => {
    // Equal-weight A,B,C. Baseline PCR (all L=1). Then lever ONLY C up to 3×.
    // The levered exposure eᵢ = ŵᵢ·Lᵢ makes C's risk share rise and the others'
    // fall — the descending list must re-sort to surface C as the dominant
    // driver. Under the BUGGY un-levered PCR this would not move at all.
    const baseline = computeDiversification({
      ids: ["A", "B", "C"],
      returnsById: aligned3.returnsById,
      weights: W3,
      portfolioDailyReturns: portReturns3,
      correlationMatrix: metrics3.correlation_matrix,
      n: metrics3.n,
    });

    const levCState: ScenarioState = {
      ...STATE_3,
      leverage: { A: 1, B: 1, C: 3 },
    };
    const levCMetrics = computeScenario(STRATS_3, levCState, dateMapCache3);
    const levCAligned = alignConstituentReturns(STRATS_3, levCState);
    const levCPort = (levCMetrics.portfolio_daily_returns ?? []).map(
      (p) => p.value,
    );
    const levered = computeDiversification({
      ids: levCAligned.ids,
      returnsById: levCAligned.returnsById,
      weights: W3,
      leverage: levCState.leverage,
      portfolioDailyReturns: levCPort,
      correlationMatrix: levCMetrics.correlation_matrix,
      n: levCMetrics.n,
    });

    // C is the near-orthogonal, highest-σ leg; levered 3× it dominates risk.
    expect(levered.pcr!.C).toBeGreaterThan(baseline.pcr!.C);
    expect(levered.pcr!.A).toBeLessThan(baseline.pcr!.A);
    expect(levered.pcr!.B).toBeLessThan(baseline.pcr!.B);
    // Re-sorted descending, C is now the top risk driver.
    const sorted = Object.entries(levered.pcr!).sort(([, a], [, b]) => b - a);
    expect(sorted[0][0]).toBe("C");
    // Still self-normalized (signed sum → 1).
    expect(
      Object.values(levered.pcr!).reduce((a, b) => a + b, 0),
    ).toBeCloseTo(1, 9);
  });

  it("keeps DR ≥ 1 for a long-only blend at non-uniform leverage (Choueifaty bound)", () => {
    const levState: ScenarioState = {
      ...STATE_3,
      leverage: { A: 1.5, B: 0.5, C: 4 },
    };
    const levMetrics = computeScenario(STRATS_3, levState, dateMapCache3);
    const levAligned = alignConstituentReturns(STRATS_3, levState);
    const levPort = (levMetrics.portfolio_daily_returns ?? []).map(
      (p) => p.value,
    );
    const result = computeDiversification({
      ids: levAligned.ids,
      returnsById: levAligned.returnsById,
      weights: W3,
      leverage: levState.leverage,
      portfolioDailyReturns: levPort,
      correlationMatrix: levMetrics.correlation_matrix,
      n: levMetrics.n,
    });
    expect(result.diversificationRatio!).toBeGreaterThanOrEqual(1);
  });
});

describe("percentContributionToRisk (Euler decomposition)", () => {
  it("sums to 1 (±1e-9) and hand-verifies an entry", () => {
    const pcr = percentContributionToRisk(["A", "B", "C"], W3, cov3)!;
    expect(pcr).not.toBeNull();
    const sum = Object.values(pcr).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(pcr.A).toBeCloseTo(0.333324, 5);
    expect(pcr.B).toBeCloseTo(0.297104, 5);
    expect(pcr.C).toBeCloseTo(0.369572, 5);
  });

  it("keeps a hedge leg's PCR signed (negative) and still sums to 1", () => {
    // D = perfectly NEGATIVELY correlated to A (ρ=−1); weight A heavy, D light.
    const D_VALUES = A_VALUES.map((x) => -1.1 * x);
    const idsAD = ["A", "D"];
    const returnsAD = { A: A_VALUES, D: D_VALUES };
    const covAD = covarianceMatrix(returnsAD, idsAD)!;
    const wAD = { A: 0.7, D: 0.3 };
    const pcr = percentContributionToRisk(idsAD, wAD, covAD)!;
    expect(pcr.D).toBeLessThan(0); // hedge → negative risk contribution
    expect(pcr.D).toBeCloseTo(-0.891892, 5);
    expect(pcr.A).toBeCloseTo(1.891892, 5);
    // STILL sums to 1 (not clamped).
    expect(pcr.A + pcr.D).toBeCloseTo(1, 9);
  });

  it("returns null when wᵀΣw ≤ 1e-15 (all-flat blend)", () => {
    // Flat constituents → zero covariance everywhere → portVar = 0.
    const flat = { X: [0, 0, 0, 0, 0], Y: [0, 0, 0, 0, 0] };
    const covFlat = covarianceMatrix(flat, ["X", "Y"])!;
    expect(
      percentContributionToRisk(["X", "Y"], { X: 0.5, Y: 0.5 }, covFlat),
    ).toBeNull();
  });
});

describe("effectiveNumberOfBets (risk-based, Meucci)", () => {
  it("= 1/Σ PCRᵢ²; equal-PCR k legs → ENB = k", () => {
    expect(effectiveNumberOfBets({ A: 1 / 3, B: 1 / 3, C: 1 / 3 })).toBeCloseTo(
      3,
      9,
    );
    expect(effectiveNumberOfBets({ A: 0.5, B: 0.5 })).toBeCloseTo(2, 9);
  });

  it("one leg owning all risk → ENB → 1", () => {
    expect(effectiveNumberOfBets({ A: 1, B: 0 })).toBeCloseTo(1, 9);
  });

  it("matches the hand-computed fixture ENB", () => {
    const pcr = percentContributionToRisk(["A", "B", "C"], W3, cov3)!;
    expect(effectiveNumberOfBets(pcr)).toBeCloseTo(2.976552, 5);
  });

  it("returns null on null pcr", () => {
    expect(effectiveNumberOfBets(null)).toBeNull();
  });
});

describe("clusterOrder (average-linkage on ½(1−ρ))", () => {
  it("places ρ≈0.998 legs A,B adjacent on the 3-leg fixture", () => {
    const order = clusterOrder(metrics3.correlation_matrix, ["A", "B", "C"]);
    expect(order).toHaveLength(3);
    const ia = order.indexOf("A");
    const ib = order.indexOf("B");
    // A and B are correlated (ρ≈0.998) so they must be adjacent; C is the outlier.
    expect(Math.abs(ia - ib)).toBe(1);
  });

  it("returns identity for ≤2 ids", () => {
    expect(clusterOrder(metrics3.correlation_matrix, [])).toEqual([]);
    expect(clusterOrder(metrics3.correlation_matrix, ["A"])).toEqual(["A"]);
    expect(clusterOrder(metrics3.correlation_matrix, ["A", "B"])).toEqual([
      "A",
      "B",
    ]);
  });

  it("treats a null/missing ρ as max distance (no NaN)", () => {
    const partial = {
      A: { A: 1, B: 0.9 },
      B: { A: 0.9, B: 1 },
      C: { C: 1 }, // C has no ρ to A/B → distance 1
    } as Record<string, Record<string, number>>;
    const order = clusterOrder(partial, ["A", "B", "C"]);
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(["A", "B", "C"]));
    // A,B (the only finite-ρ pair) cluster first.
    expect(Math.abs(order.indexOf("A") - order.indexOf("B"))).toBe(1);
  });
});

describe("tooSimilarPairs", () => {
  it("flags off-diagonal pairs with ρ ≥ 0.85", () => {
    const pairs = tooSimilarPairs(
      metrics3.correlation_matrix,
      ["A", "B", "C"],
    );
    // Only A,B (ρ≈0.998) exceed 0.85; A,C and B,C are ~−0.29.
    expect(pairs).toHaveLength(1);
    expect(pairs[0][0]).toBe("A");
    expect(pairs[0][1]).toBe("B");
    expect(pairs[0][2]).toBeGreaterThanOrEqual(0.85);
  });

  it("returns [] on a null matrix", () => {
    expect(tooSimilarPairs(null, ["A", "B"])).toEqual([]);
  });
});

describe("computeDiversification (orchestrator gate)", () => {
  function baseInput(): DiversificationInput {
    return {
      ids: ["A", "B", "C"],
      returnsById: aligned3.returnsById,
      weights: W3,
      portfolioDailyReturns: portReturns3,
      correlationMatrix: metrics3.correlation_matrix,
      n: metrics3.n,
    };
  }

  it("fully populates a result on healthy input", () => {
    const result = computeDiversification(baseInput());
    expect(result.diversificationRatio).toBeCloseTo(1.662551, 5);
    expect(result.effectiveNumberOfBets).toBeCloseTo(2.976552, 5);
    expect(result.pcr).not.toBeNull();
    expect(
      Object.values(result.pcr!).reduce((a, b) => a + b, 0),
    ).toBeCloseTo(1, 9);
    expect(result.clusterOrderIds).toHaveLength(3);
    expect(result.tooSimilarPairs).toHaveLength(1);
    expect(result.vols).not.toBeNull();
  });

  it("returns all-null with identity clusterOrderIds when ids.length < 2", () => {
    const result = computeDiversification({ ...baseInput(), ids: ["A"] });
    expect(result.diversificationRatio).toBeNull();
    expect(result.effectiveNumberOfBets).toBeNull();
    expect(result.pcr).toBeNull();
    expect(result.vols).toBeNull();
    expect(result.clusterOrderIds).toEqual(["A"]);
    expect(result.tooSimilarPairs).toEqual([]);
  });

  it("returns all-null when n < MIN_USABLE", () => {
    const result = computeDiversification({ ...baseInput(), n: 9 });
    expect(result.diversificationRatio).toBeNull();
    expect(result.clusterOrderIds).toEqual(["A", "B", "C"]);
  });

  it("returns all-null when the correlation matrix is null", () => {
    const result = computeDiversification({
      ...baseInput(),
      correlationMatrix: null,
    });
    expect(result.diversificationRatio).toBeNull();
    expect(result.pcr).toBeNull();
  });

  it("never emits NaN/Inf — all degenerate paths return null/finite", () => {
    const result = computeDiversification(baseInput());
    const finiteOrNull = (x: number | null) =>
      x === null || Number.isFinite(x);
    expect(finiteOrNull(result.diversificationRatio)).toBe(true);
    expect(finiteOrNull(result.effectiveNumberOfBets)).toBe(true);
    for (const v of Object.values(result.pcr ?? {})) {
      expect(Number.isFinite(v)).toBe(true);
    }
    for (const v of Object.values(result.vols ?? {})) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
