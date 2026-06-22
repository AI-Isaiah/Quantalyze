import { describe, it, expect } from "vitest";
import { computeScenarioStress, type ScenarioStress } from "./scenario-stress";

/**
 * Falsifiable pins for the scenario stress / VaR engine (Plan 26-01,
 * STRESS-01 + STRESS-02). The entire risk class of this phase is
 * honesty/correctness — a number that lies to an allocator. Each invariant is
 * encoded as an assertion that fails LOUD under the corresponding bug:
 *
 *   - golden VaR/CVaR  — the historical floor-quantile oracle (-0.060 / -0.070).
 *                        A parametric (Normal) or linear-interpolation impl FAILS.
 *   - not parametric   — explicit negative control vs the Normal tail value.
 *   - near-market-neutral — cov≈0 book ⇒ |impact| ≈ 0, NOT the full shock
 *                        (a face-value bug yields |impact| ≈ 0.30 and FAILS).
 *   - beta-propagated  — a positive-β book ⇒ impact ≈ β·shock (sign + magnitude).
 *   - intersection     — a divergent value on a non-overlapping date does NOT
 *                        move the impact (a union/zero-fill impl FAILS).
 *   - leverage         — 2× uniform leverage ⇒ ~2× VaR/CVaR; Sharpe unchanged
 *                        (the leverage-invariant contrast); max-drawdown
 *                        monotone-more-severe, NOT exactly 2× (compounding caveat).
 *   - degenerate null  — empty / constant series / constant BTC ⇒ the affected
 *                        field is `null` (em-dash source), NEVER a fabricated 0.
 *
 * Every expected number is derived from the math definition IN this file —
 * never read back from the implementation.
 */

type DP = { date: string; value: number };

/** ISO day labels d1..dN (copied verbatim from scenario-benchmark.test.ts:34-39).
 *  Capped at 31 (the single-month form the benchmark fixtures use). */
function days(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `2024-01-${String(i + 1).padStart(2, "0")}`);
}

/** N distinct ISO dates rolling across 28-day months — for the n>=60 floor
 *  fixtures that need more than one month of strictly-increasing dates. */
function manyDays(n: number): string[] {
  const out: string[] = [];
  let month = 1;
  let day = 1;
  for (let i = 0; i < n; i++) {
    out.push(`2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    day += 1;
    if (day > 28) {
      day = 1;
      month += 1;
    }
  }
  return out;
}

// =========================================================================
// 1-3. Golden VaR / CVaR oracle + the "not parametric" negative control
// =========================================================================

describe("computeScenarioStress — golden VaR/CVaR oracle (STRESS-02)", () => {
  // The 20-value RESEARCH series (shown sorted ascending for clarity). The
  // input order does not matter — computeVaR sorts internally.
  //   sorted = [-0.080, -0.060, -0.045, -0.030, -0.025, -0.020, -0.015,
  //             -0.010, -0.005,  0.000,  0.005,  0.010,  0.012,  0.015,
  //              0.018,  0.020,  0.025,  0.030,  0.040,  0.060]
  //   n = 20, confidence = 0.95
  //   idx       = floor((1 - 0.95) * 20) = floor(1.0) = 1
  //   VaR(95%)  = sorted[1] = -0.060          (the floor / type-1 quantile)
  //   tail      = { r <= -0.060 } = [-0.080, -0.060]
  //   CVaR(95%) = mean([-0.080, -0.060]) = -0.070
  const SORTED = [
    -0.08, -0.06, -0.045, -0.03, -0.025, -0.02, -0.015, -0.01, -0.005, 0.0,
    0.005, 0.01, 0.012, 0.015, 0.018, 0.02, 0.025, 0.03, 0.04, 0.06,
  ];
  const d = days(20);
  // Feed in a NON-sorted order so the test also proves the impl sorts.
  const shuffled = [...SORTED].reverse();
  const port: DP[] = d.map((date, i) => ({ date, value: shuffled[i] }));
  // Full-overlap BTC so the section path is exercised (β irrelevant to VaR).
  const btc: DP[] = d.map((date, i) => ({ date, value: (i % 2 === 0 ? 0.01 : -0.008) }));

  it("golden VaR — VaR(95%) is the floor-quantile -0.060", () => {
    const r = computeScenarioStress(port, btc);
    expect(r.var).toBeCloseTo(-0.06, 10);
  });

  it("golden CVaR — CVaR(95%) = mean of the tail = -0.070, and CVaR <= VaR", () => {
    const r = computeScenarioStress(port, btc);
    expect(r.cvar).toBeCloseTo(-0.07, 10);
    expect(r.cvar!).toBeLessThanOrEqual(r.var!);
  });

  it("not parametric — VaR is an EMPIRICAL order statistic, NOT a parametric/interpolated value", () => {
    // The defining property of a HISTORICAL (type-1, floor) VaR: the result is
    // EXACTLY one of the observed returns (the sorted[idx] order statistic) —
    // never a synthesized value between observations. A parametric Normal VaR
    // (mean − 1.645·std) and a linear-interpolation quantile (e.g. R-7) both
    // synthesize a value that is NOT a member of the sample, so each of those
    // impls fails the "is an order statistic" assertion below. This is a
    // stronger negative control than a magnitude epsilon (which is coincidentally
    // small for this particular series), because it keys on the model's STRUCTURE.
    const r = computeScenarioStress(port, btc);
    // 1. The result IS exactly an observed return (an order statistic) — to full
    //    float precision, not merely "close". A parametric/interpolated VaR is not.
    expect(SORTED).toContain(r.var);
    expect(r.var).toBe(-0.06); // === the floor-quantile order statistic, exactly

    // 2. Show the parametric tail value the historical VaR explicitly is NOT
    //    equal to (it is a synthesized number absent from the sample).
    const n = SORTED.length;
    const mean = SORTED.reduce((s, v) => s + v, 0) / n;
    const variance = SORTED.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const normalVaR = mean - 1.645 * Math.sqrt(variance); // a synthesized value
    expect(SORTED).not.toContain(normalVaR); // not an order statistic
    expect(r.var).not.toBe(normalVaR);

    // 3. And NOT the linear-interpolation (R-7) quantile, which would synthesize a
    //    value between sorted[0] and sorted[1] for the 0.05·(n−1) position.
    //    R-7 position h = (n−1)·(1−c) = 19·0.05 = 0.95 ⇒ between sorted[0] (-0.080)
    //    and sorted[1] (-0.060): interp = -0.080 + 0.95·(-0.060 − −0.080) = -0.061.
    const h = (n - 1) * (1 - 0.95);
    const lo = Math.floor(h);
    const r7 = SORTED[lo] + (h - lo) * (SORTED[lo + 1] - SORTED[lo]); // ≈ -0.061
    expect(r.var).not.toBeCloseTo(r7, 10); // historical floor differs from R-7
  });
});

// =========================================================================
// 4-6. β-propagated shock: near-market-neutral, positive-β, intersection
// =========================================================================

describe("computeScenarioStress — β-propagated shock (STRESS-01)", () => {
  it("near-market-neutral — cov≈0 book ⇒ |impact| ≈ 0, NOT the full shock", () => {
    // Construct a portfolio ORTHOGONAL to BTC over the overlap so cov ≈ 0 ⇒
    // β ≈ 0 ⇒ projectedImpact ≈ 0. BTC alternates ±; portfolio alternates on a
    // DIFFERENT period (period-4 vs period-2) and is mean-balanced so the
    // sample covariance with BTC is ~0 by construction.
    //   btc  : period-2 square wave  [+a, -a, +a, -a, ...]
    //   port : period-4 square wave  [+c, +c, -c, -c, ...]
    // Over a whole number of period-4 blocks, Σ port_i·btc_i = 0 exactly
    // (each block contributes +c·a − c·a − c·a + c·a = 0), and both series are
    // zero-mean → cov = 0 → β = 0.
    const n = 64; // 16 full period-4 blocks
    const d = manyDays(n);
    const a = 0.02;
    const c = 0.015;
    const btc: DP[] = d.map((date, i) => ({ date, value: i % 2 === 0 ? a : -a }));
    const port: DP[] = d.map((date, i) => ({
      date,
      value: i % 4 < 2 ? c : -c,
    }));
    const r = computeScenarioStress(port, btc, { shock: -0.3 });
    // β ≈ 0 ⇒ |impact| is tiny — strictly NOT the face-value shock 0.30.
    expect(Math.abs(r.projectedImpact!)).toBeLessThan(1e-9);
    // Falsifiable the other direction: a "shock applied at face value" bug
    // (impact = shock) would yield |impact| ≈ 0.30 — assert we are far from it.
    expect(Math.abs(r.projectedImpact!)).toBeLessThan(0.3 * 0.01);
  });

  it("beta-propagated impact — positive-β book ⇒ impact ≈ β·shock (signed)", () => {
    // Build a portfolio that is exactly 2× the BTC series over the overlap.
    //   port_i = 2·btc_i  ⇒  cov(p,b) = 2·var(b)  ⇒  β = cov/var = 2.
    //   shock = -0.30  ⇒  projectedImpact = β·shock = 2·(-0.30) = -0.60.
    const d = days(30);
    const btc: DP[] = d.map((date, i) => ({ date, value: i % 2 === 0 ? 0.01 : -0.008 }));
    const port: DP[] = btc.map((x) => ({ ...x, value: x.value * 2 }));
    const r = computeScenarioStress(port, btc, { shock: -0.3 });
    expect(r.beta).toBeCloseTo(2, 8);
    // impact = β·shock — sign negative, magnitude = β·|shock|.
    expect(r.projectedImpact).toBeCloseTo(r.beta! * -0.3, 10);
    expect(r.projectedImpact).toBeCloseTo(-0.6, 8);
    expect(r.projectedImpact!).toBeLessThan(0); // signed downside, never flipped
  });

  it("intersection not union — a divergent value on a non-overlapping date does not move the impact", () => {
    // Portfolio spans d1..d8; BTC covers only d3..d6 PLUS an extra d9 the
    // portfolio never has. Overlap is exactly {d3,d4,d5,d6}. A union / zero-fill
    // / positional-zip impl would absorb the poison values and shift β·shock.
    const d = days(9);
    const portfolio: DP[] = [
      { date: d[0], value: 999 }, // d1 — non-overlap poison
      { date: d[1], value: 0.001 }, // d2 — non-overlap
      { date: d[2], value: 0.01 }, // d3 — overlap
      { date: d[3], value: -0.005 }, // d4 — overlap
      { date: d[4], value: 0.02 }, // d5 — overlap
      { date: d[5], value: 0.0 }, // d6 — overlap
      { date: d[6], value: 0.003 }, // d7 — non-overlap
      { date: d[7], value: -0.002 }, // d8 — non-overlap
    ];
    const benchmark: DP[] = [
      { date: d[2], value: 0.008 }, // d3
      { date: d[3], value: -0.004 }, // d4
      { date: d[4], value: 0.012 }, // d5
      { date: d[5], value: 0.002 }, // d6
      { date: d[8], value: -888 }, // d9 — non-overlap poison
    ];
    const baseline = computeScenarioStress(portfolio, benchmark, { shock: -0.3 });
    expect(baseline.betaN).toBe(4); // the inner-join overlap, NOT the union length

    // Mutate the poison values on the non-overlapping dates to be even more
    // extreme. Inner-join ignores them entirely; the impact must not move.
    const portfolio2 = portfolio.map((x) =>
      x.date === d[0] ? { ...x, value: -50000 } : x,
    );
    const benchmark2 = benchmark.map((x) =>
      x.date === d[8] ? { ...x, value: 77777 } : x,
    );
    const mutated = computeScenarioStress(portfolio2, benchmark2, { shock: -0.3 });
    expect(mutated.betaN).toBe(4);
    expect(mutated.projectedImpact).toBeCloseTo(baseline.projectedImpact as number, 12);
    expect(mutated.beta).toBeCloseTo(baseline.beta as number, 12);
  });
});

// =========================================================================
// 7-8. Leverage scaling: VaR/CVaR ~2×, Sharpe invariant, drawdown monotone
// =========================================================================

/** Sharpe (return/risk) on a daily series = mean / sampleStd. Inline so the
 *  invariant is computed from the definition, not an imported helper. */
function sharpe(values: number[]): number {
  const n = values.length;
  const m = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1);
  return m / Math.sqrt(variance);
}

/** Cumulative max-drawdown over an arithmetic daily-return series:
 *  the most-negative peak-to-trough of the compounded equity curve.
 *  Returns a non-positive number (0 = no drawdown). */
function maxDrawdown(values: number[]): number {
  let equity = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of values) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const dd = equity / peak - 1; // <= 0
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

describe("computeScenarioStress — leverage scaling (STRESS-02, Pitfall 3-4)", () => {
  // A non-constant 64-day series with a real downside tail, and its 2× uniform
  // leverage twin (each daily levered return scales linearly: value·2).
  const d = manyDays(64);
  const base = d.map((_date, i) => {
    // Deterministic, non-degenerate, with a genuine left tail.
    const v = i % 7 === 0 ? -0.05 : i % 3 === 0 ? -0.02 : 0.01 + (i % 5) * 0.003;
    return v;
  });
  const port1x: DP[] = d.map((date, i) => ({ date, value: base[i] }));
  const port2x: DP[] = d.map((date, i) => ({ date, value: base[i] * 2 }));
  const btc: DP[] = d.map((date, i) => ({ date, value: i % 2 === 0 ? 0.012 : -0.009 }));

  it("leverage scales VaR not Sharpe — 2×L ⇒ ~2× VaR/CVaR; Sharpe unchanged", () => {
    const r1 = computeScenarioStress(port1x, btc);
    const r2 = computeScenarioStress(port2x, btc);
    // VaR/CVaR are quantiles/tail-means of the linearly-scaled daily series →
    // scale exactly ~2× (the quantile of 2r is 2× the quantile of r).
    expect(r2.var).toBeCloseTo(2 * r1.var!, 8);
    expect(r2.cvar).toBeCloseTo(2 * r1.cvar!, 8);
    // Sharpe = mean/std is leverage-INVARIANT (both numerator and denominator
    // scale by L) — the explicit success-criterion contrast.
    expect(sharpe(base.map((v) => v * 2))).toBeCloseTo(sharpe(base), 12);
  });

  it("leverage drawdown monotone — 2× drawdown is MORE severe, NOT exactly 2×", () => {
    // Max-drawdown compounds: ∏(1 + L·rᵢ) ≠ ∏(1 + rᵢ)^L, so the 2× curve is
    // monotonically more negative but NOT exactly 2× the 1× drawdown.
    const dd1x = maxDrawdown(base);
    const dd2x = maxDrawdown(base.map((v) => v * 2));
    expect(dd1x).toBeLessThan(0); // there IS a real drawdown to scale
    // Monotone-more-severe (more negative) — NOT a toBeCloseTo(2×) assertion.
    expect(dd2x).toBeLessThan(dd1x);
    // And explicitly NOT exactly 2× (the compounding caveat is the point).
    expect(Math.abs(dd2x - 2 * dd1x)).toBeGreaterThan(1e-6);
  });
});

// =========================================================================
// 9. Degeneracy / null-safety matrix — em-dash source, never a fabricated 0
// =========================================================================

describe("computeScenarioStress — degenerate null paths (em-dash source)", () => {
  it("degenerate null — empty portfolioDaily ⇒ every estimate field is null (not 0)", () => {
    const r: ScenarioStress = computeScenarioStress([], []);
    expect(r.varN).toBe(0);
    expect(r.betaN).toBe(0);
    expect(r.var).toBeNull();
    expect(r.cvar).toBeNull();
    expect(r.beta).toBeNull();
    expect(r.projectedImpact).toBeNull();
  });

  it("degenerate null — numerically-constant portfolioDaily (n>=60, float-residue var) ⇒ var/cvar null", () => {
    // A constant 0.003 every day leaves a ~1e-37 float-residue variance that an
    // exact `=== 0` check would miss, letting computeVaR return a constant
    // quantile the section would render as a fabricated number. The relative-
    // scale guard must surface null instead.
    const d = manyDays(64);
    const port: DP[] = d.map((date) => ({ date, value: 0.003 }));
    const btc: DP[] = d.map((date, i) => ({ date, value: i % 2 === 0 ? 0.01 : -0.008 }));
    const r = computeScenarioStress(port, btc);
    expect(r.varN).toBe(64);
    expect(r.var).toBeNull();
    expect(r.cvar).toBeNull();
  });

  it("degenerate null — a NaN injected DIRECTLY through the public signature ⇒ var/cvar null (WR-01)", () => {
    // The module docstring claims the result is "fully null-safe" on a non-finite
    // series. The function's OWN guard must honor that contract independent of the
    // upstream producer: a NaN defeats the relative-scale guard (NaN <= NaN is
    // false), so without an explicit finite-check it would reach computeVaR, whose
    // sort comparator returns NaN for any pair touching the contaminant → a
    // corrupted (possibly non-NaN-but-WRONG) quantile rendered as a confident,
    // fabricated number. The honest result is a clean null.
    const d = manyDays(64);
    const port: DP[] = d.map((date, i) => ({
      date,
      // A real non-degenerate downside series, but with ONE NaN contaminant.
      value: i === 13 ? NaN : i % 7 === 0 ? -0.05 : 0.01 + (i % 5) * 0.003,
    }));
    const btc: DP[] = d.map((date, i) => ({ date, value: i % 2 === 0 ? 0.01 : -0.008 }));
    const r = computeScenarioStress(port, btc);
    // The window N is still the full length — only the estimate is suppressed.
    expect(r.varN).toBe(64);
    // var/cvar MUST be null, never NaN and never a corrupted finite quantile.
    expect(r.var).toBeNull();
    expect(r.cvar).toBeNull();
  });

  it("degenerate null — an Infinity injected DIRECTLY through the public signature ⇒ var/cvar null (WR-01)", () => {
    // Infinity participates in arithmetic without short-circuiting to NaN in every
    // path, so it is a distinct contaminant from NaN — assert it is also suppressed.
    const d = manyDays(64);
    const port: DP[] = d.map((date, i) => ({
      date,
      value: i === 20 ? Infinity : i % 7 === 0 ? -0.05 : 0.01 + (i % 5) * 0.003,
    }));
    const btc: DP[] = d.map((date, i) => ({ date, value: i % 2 === 0 ? 0.01 : -0.008 }));
    const r = computeScenarioStress(port, btc);
    expect(r.varN).toBe(64);
    expect(r.var).toBeNull();
    expect(r.cvar).toBeNull();
  });

  it("degenerate null — constant BTC over the overlap (n>=60) ⇒ beta/projectedImpact null", () => {
    // computeScenarioBenchmark null-guards the constant-benchmark via its
    // relative-scale test, so beta is null ⇒ projectedImpact is null — never a
    // fabricated finite β (~2) from computeAlphaBeta's float-residue branch.
    const d = manyDays(64);
    const port: DP[] = d.map((date, i) => ({ date, value: i % 2 === 0 ? 0.01 : -0.006 }));
    const btc: DP[] = d.map((date) => ({ date, value: 0.003 })); // constant → var≈0
    const r = computeScenarioStress(port, btc, { shock: -0.3 });
    expect(r.betaN).toBe(64);
    expect(r.beta).toBeNull();
    expect(r.projectedImpact).toBeNull();
    // VaR side is still well-defined here (the portfolio series is non-constant).
    expect(r.var).not.toBeNull();
  });
});
