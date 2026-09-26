/**
 * Site tests T9-T12 for Phase 166.2 plan 03: `computeAlphaBeta`,
 * `computeRiskDecomposition` and the two scenario libraries must answer a
 * compounding-NAV constant yield EXACTLY as they answer an all-zero series of the
 * same length (Phase 166.1 D-07), because each now computes its beta,
 * correlation, information ratio and degeneracy test through
 * `src/lib/return-stats.ts` (D-17).
 *
 * Why it matters: a compounding NAV at a constant yield leaves a sample sd of
 * about 1.3e-16 instead of 0. A `> 0` guard, or a floor scaled only by `|mean|`,
 * passes that residue and shows an allocator a residue beta, a residue
 * correlation, a Sharpe-shaped information ratio of about 1e13, or a risk share
 * split between two strategies that do not move. The cent-rounded 1% APY NAV is
 * the control on the other side of the floor: its dispersion is real, so its
 * figures must stay finite, and widening the floor goes red.
 *
 * Expected values are never hard-coded: each test computes the site's output on
 * the all-zero input and asserts the constant-yield output identical to it.
 */
import { describe, it, expect } from "vitest";
import {
  computeAlphaBeta,
  computeRiskDecomposition,
  computeTrackingError,
} from "@/lib/portfolio-stats";
import { mean, type DailyPoint } from "@/lib/portfolio-math-utils";
import { beta as sharedBeta, pearson, sharpe } from "@/lib/return-stats";
import { computeScenarioBenchmark } from "@/app/(dashboard)/allocations/lib/scenario-benchmark";
import { computeScenarioStress } from "@/app/(dashboard)/allocations/lib/scenario-stress";
import {
  CONSTANT_YIELDS,
  apyToDaily,
  navConstantYield,
} from "@/__tests__/fixtures/dispersion-nav";

const YIELD_IDS = Object.keys(CONSTANT_YIELDS);
const N = 366;

/** A deterministic noisy daily-return series (no PRNG, reload-stable). */
function noisy(n: number, phase: number, drift = 0.001): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(drift + 0.02 * Math.sin(i * 1.7 + phase) + 0.005 * Math.cos(i * 0.31 + 2 * phase));
  }
  return out;
}

/** Daily ISO dates from 2024-01-01, deterministic. */
function isoDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date("2024-01-01T00:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const DATES = isoDates(366);

/** Dated points on the shared daily axis. */
function dated(values: number[]): DailyPoint[] {
  return values.map((value, i) => ({ date: DATES[i], value }));
}

/** Sample covariance matrix of the given return series (ddof 1). */
function sampleCov(series: number[][]): number[][] {
  const n = series[0].length;
  const means = series.map((s) => s.reduce((a, v) => a + v, 0) / n);
  return series.map((a, i) =>
    series.map((b, j) => {
      let c = 0;
      for (let t = 0; t < n; t++) c += (a[t] - means[i]) * (b[t] - means[j]);
      return c / (n - 1);
    }),
  );
}

const ZEROS = new Array(N).fill(0);
const CENT_CONTROL = navConstantYield(apyToDaily(0.01), N, 10_000, true);
const NOISY_A = noisy(N, 0.3);
const NOISY_B = noisy(N, 1.1, -0.0005);

// ── T9: computeAlphaBeta's beta is the shared beta ─────────────────
describe("T9 computeAlphaBeta: a constant-yield benchmark gives what an all-zero benchmark gives", () => {
  // D7 (founder, 2026-09-26): an undefined beta is an absence, so both beta and
  // alpha are null, exactly as for an all-zero benchmark (D-07's equality holds;
  // the value it holds at moved from 0 to null).
  it.each(YIELD_IDS)("%s: beta and alpha null, as for an all-zero benchmark", (id) => {
    const bench = navConstantYield(CONSTANT_YIELDS[id], N);
    const onYield = computeAlphaBeta(NOISY_A, bench, 365);
    const onZero = computeAlphaBeta(NOISY_A, ZEROS, 365);
    expect(onYield).toEqual(onZero);
    expect(onYield).toEqual({ alpha: null, beta: null });
  });

  it("a non-finite return or fewer than 2 points is an absence too, never beta 0", () => {
    const withNaN = [...NOISY_A];
    withNaN[3] = NaN;
    expect(computeAlphaBeta(withNaN, NOISY_B, 365)).toEqual({ alpha: null, beta: null });
    expect(computeAlphaBeta([0.01], [0.02], 365)).toEqual({ alpha: null, beta: null });
  });

  it("control: a cent-rounded 1% APY benchmark disperses, so its beta is a finite non-zero number", () => {
    const r = CENT_CONTROL.map((v, i) => v + 0.5 * NOISY_A[i]);
    const { alpha, beta } = computeAlphaBeta(r, CENT_CONTROL, 365);
    expect(Number.isFinite(beta)).toBe(true);
    expect(beta).not.toBe(0);
    expect(Number.isFinite(alpha)).toBe(true);
  });

  it("a noisy benchmark keeps today's beta and it is exactly the shared beta", () => {
    const { beta } = computeAlphaBeta(NOISY_A, NOISY_B, 365);
    const mA = NOISY_A.reduce((a, v) => a + v, 0) / N;
    const mB = NOISY_B.reduce((a, v) => a + v, 0) / N;
    let cov = 0;
    let varB = 0;
    for (let i = 0; i < N; i++) {
      cov += (NOISY_A[i] - mA) * (NOISY_B[i] - mB);
      varB += (NOISY_B[i] - mB) * (NOISY_B[i] - mB);
    }
    expect(beta).toBeCloseTo(cov / varB, 12);
    expect(Object.is(beta, sharedBeta(NOISY_A, NOISY_B))).toBe(true);
  });
});

// ── SFH-M7: computeTrackingError on the shared sample sd ────────────
describe("SFH-M7 computeTrackingError: a constant excess has exactly the zero excess's tracking error", () => {
  it.each(YIELD_IDS)("%s: constant outperformance over a noisy benchmark reads 0, not residue", (id) => {
    const c = navConstantYield(CONSTANT_YIELDS[id], N);
    const r = NOISY_B.map((b, i) => b + c[i]);
    // Beside a null information ratio the tracking error was about 1e-15; the
    // shared dispersion reports that residue as exactly 0, as for p = b.
    expect(computeTrackingError(r, NOISY_B, 365)).toBe(computeTrackingError(NOISY_B, NOISY_B, 365));
    expect(computeTrackingError(r, NOISY_B, 365)).toBe(0);
  });

  it("control: a noisy excess keeps its tracking error, bitwise the sample sd times sqrt(N)", () => {
    const diff = NOISY_A.map((a, i) => a - NOISY_B[i]);
    const m = diff.reduce((acc, v) => acc + v, 0) / N;
    const sd = Math.sqrt(diff.reduce((acc, v) => acc + (v - m) * (v - m), 0) / (N - 1));
    expect(computeTrackingError(NOISY_A, NOISY_B, 365)).toBe(sd * Math.sqrt(365));
  });
});

// ── T10: computeRiskDecomposition on the shared floor ───────────────
describe("T10 computeRiskDecomposition: two constant-yield strategies give what an all-zero matrix gives", () => {
  const weights = [0.6, 0.4];
  const zeroPct = computeRiskDecomposition(weights, sampleCov([ZEROS, ZEROS])).map(
    (c) => c.percentage,
  );

  it.each(YIELD_IDS)("%s: every percentage 0, identical to the all-zero matrix", (id) => {
    const a = navConstantYield(CONSTANT_YIELDS[id], N);
    const b = navConstantYield(CONSTANT_YIELDS[id], N, 12_345);
    const pct = computeRiskDecomposition(weights, sampleCov([a, b])).map((c) => c.percentage);
    expect(pct).toHaveLength(zeroPct.length);
    pct.forEach((p, i) => expect(Object.is(p, zeroPct[i])).toBe(true));
    pct.forEach((p) => expect(p).toBe(0));
  });

  it("control: a cent-rounded 1% APY book disperses, so its percentages sum to 100", () => {
    const b = navConstantYield(apyToDaily(0.01), N, 12_345, true);
    const pct = computeRiskDecomposition(weights, sampleCov([CENT_CONTROL, b])).map(
      (c) => c.percentage,
    );
    expect(pct.reduce((s, p) => s + p, 0)).toBeCloseTo(100, 9);
  });

  it("a noisy book keeps percentages summing to 100", () => {
    const pct = computeRiskDecomposition(weights, sampleCov([NOISY_A, NOISY_B])).map(
      (c) => c.percentage,
    );
    expect(pct.reduce((s, p) => s + p, 0)).toBeCloseTo(100, 9);
  });

  it("a NaN covariance still reads 0 per strategy, as it did before the shared floor", () => {
    const pct = computeRiskDecomposition(weights, [
      [NaN, 0],
      [0, 0.01],
    ]).map((c) => c.percentage);
    pct.forEach((p) => expect(p).toBe(0));
  });
});

// ── T11: computeScenarioBenchmark on the shared floor, pearson and sharpe ──
describe("T11 computeScenarioBenchmark: constant-yield legs give what all-zero legs give", () => {
  const port = dated(NOISY_A);
  const zeroBench = computeScenarioBenchmark(port, dated(ZEROS));

  it.each(YIELD_IDS)("%s benchmark: beta and alpha null, as for an all-zero benchmark", (id) => {
    const r = computeScenarioBenchmark(port, dated(navConstantYield(CONSTANT_YIELDS[id], N)));
    expect(Object.is(r.beta, zeroBench.beta)).toBe(true);
    expect(Object.is(r.alpha, zeroBench.alpha)).toBe(true);
    expect(r.beta).toBeNull();
    expect(r.alpha).toBeNull();
  });

  it.each(YIELD_IDS)("%s benchmark: correlation null, as for an all-zero benchmark", (id) => {
    const r = computeScenarioBenchmark(port, dated(navConstantYield(CONSTANT_YIELDS[id], N)));
    expect(Object.is(r.correlation, zeroBench.correlation)).toBe(true);
    expect(r.correlation).toBeNull();
  });

  it.each(YIELD_IDS)("%s portfolio: correlation null, as for an all-zero portfolio", (id) => {
    const bench = dated(NOISY_B);
    const r = computeScenarioBenchmark(dated(navConstantYield(CONSTANT_YIELDS[id], N)), bench);
    const zeroPort = computeScenarioBenchmark(dated(ZEROS), bench);
    expect(Object.is(r.correlation, zeroPort.correlation)).toBe(true);
    expect(r.correlation).toBeNull();
  });

  it.each(YIELD_IDS)(
    "%s excess (portfolio = benchmark + a constant yield): information ratio null, as for a zero excess",
    (id) => {
      const y = navConstantYield(CONSTANT_YIELDS[id], N);
      const bench = dated(NOISY_B);
      const r = computeScenarioBenchmark(dated(NOISY_B.map((v, i) => v + y[i])), bench);
      const zeroExcess = computeScenarioBenchmark(dated(NOISY_B), bench);
      expect(Object.is(r.informationRatio, zeroExcess.informationRatio)).toBe(true);
      expect(r.informationRatio).toBeNull();
    },
  );

  it("control: cent-rounded 1% APY legs disperse, so beta, correlation and IR stay finite", () => {
    const withCentBench = computeScenarioBenchmark(
      dated(CENT_CONTROL.map((v, i) => v + 0.5 * NOISY_A[i])),
      dated(CENT_CONTROL),
    );
    expect(Number.isFinite(withCentBench.beta)).toBe(true);
    expect(Number.isFinite(withCentBench.alpha)).toBe(true);
    expect(Number.isFinite(withCentBench.correlation)).toBe(true);

    const withCentPort = computeScenarioBenchmark(dated(CENT_CONTROL), dated(NOISY_B));
    expect(Number.isFinite(withCentPort.correlation)).toBe(true);

    const withCentExcess = computeScenarioBenchmark(
      dated(NOISY_B.map((v, i) => v + CENT_CONTROL[i])),
      dated(NOISY_B),
    );
    expect(Number.isFinite(withCentExcess.informationRatio)).toBe(true);
  });

  it("noisy legs: correlation is today's to display precision and exactly the shared pearson", () => {
    const r = computeScenarioBenchmark(dated(NOISY_A), dated(NOISY_B));
    // Today's sample correlation, written out: sample cov over sample sd * sample sd.
    const mA = mean(NOISY_A);
    const mB = mean(NOISY_B);
    let cov = 0;
    let vA = 0;
    let vB = 0;
    for (let i = 0; i < N; i++) {
      cov += (NOISY_A[i] - mA) * (NOISY_B[i] - mB);
      vA += (NOISY_A[i] - mA) ** 2;
      vB += (NOISY_B[i] - mB) ** 2;
    }
    const sampleCorr = cov / (N - 1) / (Math.sqrt(vA / (N - 1)) * Math.sqrt(vB / (N - 1)));
    expect(r.correlation).toBeCloseTo(sampleCorr, 3);
    expect(Object.is(r.correlation, pearson(NOISY_A, NOISY_B))).toBe(true);
  });

  it.each([252, 365])(
    "noisy legs at %i: the IR is bitwise today's value and exactly the shared sharpe of the excess",
    (periodsPerYear) => {
      const r = computeScenarioBenchmark(dated(NOISY_A), dated(NOISY_B), periodsPerYear);
      const diff = NOISY_A.map((v, i) => v - NOISY_B[i]);
      const te = computeTrackingError(NOISY_A, NOISY_B, periodsPerYear);
      expect(Object.is(r.informationRatio, (mean(diff) * periodsPerYear) / te)).toBe(true);
      expect(Object.is(r.informationRatio, sharpe(diff, { periodsPerYear, ddof: 1 }))).toBe(true);
      expect(Object.is(r.trackingError, te)).toBe(true);
    },
  );
});

// ── T12: computeScenarioStress on the shared floor ──────────────────
describe("T12 computeScenarioStress: a constant-yield series takes the all-zero series' degenerate branch", () => {
  const btc = dated(NOISY_B);
  const zeroStress = computeScenarioStress(dated(ZEROS), btc);

  it.each(YIELD_IDS)("%s series: var and cvar null, as for an all-zero series", (id) => {
    const r = computeScenarioStress(dated(navConstantYield(CONSTANT_YIELDS[id], N)), btc);
    expect(Object.is(r.var, zeroStress.var)).toBe(true);
    expect(Object.is(r.cvar, zeroStress.cvar)).toBe(true);
    expect(r.var).toBeNull();
    expect(r.cvar).toBeNull();
  });

  it("control: a cent-rounded 1% APY series disperses, so var and cvar are finite", () => {
    const r = computeScenarioStress(dated(CENT_CONTROL), btc);
    expect(Number.isFinite(r.var)).toBe(true);
    expect(Number.isFinite(r.cvar)).toBe(true);
  });
});
