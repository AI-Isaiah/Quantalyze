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
import { computeAlphaBeta, computeRiskDecomposition } from "@/lib/portfolio-stats";
import { beta as sharedBeta } from "@/lib/return-stats";
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
  it.each(YIELD_IDS)("%s: beta 0 and the all-zero benchmark's alpha", (id) => {
    const bench = navConstantYield(CONSTANT_YIELDS[id], N);
    const onYield = computeAlphaBeta(NOISY_A, bench, 365);
    const onZero = computeAlphaBeta(NOISY_A, ZEROS, 365);
    expect(Object.is(onYield.beta, onZero.beta)).toBe(true);
    expect(onYield.beta).toBe(0);
    expect(Object.is(onYield.alpha, onZero.alpha)).toBe(true);
  });

  it("control: a cent-rounded 1% APY benchmark disperses, so its beta is a finite non-zero number", () => {
    const r = CENT_CONTROL.map((v, i) => v + 0.5 * NOISY_A[i]);
    const { beta } = computeAlphaBeta(r, CENT_CONTROL, 365);
    expect(Number.isFinite(beta)).toBe(true);
    expect(beta).not.toBe(0);
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
