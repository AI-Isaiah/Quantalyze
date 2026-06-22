import { describe, it, expect } from "vitest";
import {
  computeScenarioBenchmark,
  innerJoinByDate,
  type ScenarioBenchmark,
} from "./scenario-benchmark";

/**
 * TDD pins for the scenario↔BTC benchmark engine (Plan 24-01, BENCH-01).
 *
 * `computeScenarioBenchmark(portfolioDaily, btcDaily)` inner-joins the two
 * dated daily-return series by date (INTERSECTION — never a positional zip,
 * never a zero-filled union), then assembles tracking error / information
 * ratio / alpha / beta / correlation over the aligned window with 252-day
 * annualization, reusing the golden-tested `computeAlphaBeta` +
 * `computeTrackingError` from `@/lib/portfolio-stats`.
 *
 * The honesty invariants are encoded as assertions, not prose:
 *
 *   1. golden       — the four metrics match values hand-computed from the
 *                     CAPM / TE / IR definitions over a known overlapping pair.
 *   2. intersection — a date present in only ONE series is excluded; injecting
 *                     a wildly divergent value on a non-overlapping date does
 *                     NOT move any metric (a positional-zip / union impl FAILS).
 *   3. null-safety  — a degenerate window (n<2), a constant benchmark
 *                     (var(b)=0), or te=0 (p≡b) yields `null` for the affected
 *                     field — never a fabricated 0 (the UI renders an em-dash).
 *
 * Fixtures mirror the cov/var-beta golden style at
 * `src/lib/portfolio-stats.test.ts:299-314` — expected numbers are derived
 * from the math definitions in the test, not read back from the implementation.
 */

type DP = { date: string; value: number };

/** ISO business-ish day labels d1..dN (opaque strings; ordering is by insertion). */
function days(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `2024-01-${String(i + 1).padStart(2, "0")}`);
}

// =========================================================================
// 1. Golden TE / IR / alpha / beta over a known fully-overlapping pair
// =========================================================================

describe("computeScenarioBenchmark — golden metrics", () => {
  // Hand-computed pair (6 fully-overlapping daily returns).
  //   p = [ 0.010, -0.005, 0.020, 0.000, 0.015, -0.010 ]
  //   b = [ 0.008, -0.004, 0.012, 0.002, 0.010, -0.006 ]
  //   meanP = 0.005,  meanB = 0.0036666667
  //   cov(p,b) (population sum) = 0.00044
  //   var(b)   (population sum) = 0.00028333333
  //   beta  = cov/var               = 1.5529411764705883
  //   alpha = (meanP - beta*meanB)*252 = -0.17491764705882393
  //   te    = sampleStd(p-b)*sqrt(252) = 0.07216647421067487
  //   ir    = mean(p-b)*252/te          = 4.6559015619790225
  //   corr  = sampleCov/(stdP*stdB)      = 0.9879951689059581
  const d = days(6);
  const pVals = [0.01, -0.005, 0.02, 0.0, 0.015, -0.01];
  const bVals = [0.008, -0.004, 0.012, 0.002, 0.01, -0.006];
  const port: DP[] = d.map((date, i) => ({ date, value: pVals[i] }));
  const bench: DP[] = d.map((date, i) => ({ date, value: bVals[i] }));

  it("matches hand-computed beta (cov/var)", () => {
    const r = computeScenarioBenchmark(port, bench);
    expect(r.beta).toBeCloseTo(1.5529411764705883, 10);
  });

  it("matches hand-computed alpha ((meanP − β·meanB)·252)", () => {
    const r = computeScenarioBenchmark(port, bench);
    expect(r.alpha).toBeCloseTo(-0.17491764705882393, 10);
  });

  it("matches hand-computed tracking error (sampleStd(p−b)·√252)", () => {
    const r = computeScenarioBenchmark(port, bench);
    expect(r.trackingError).toBeCloseTo(0.07216647421067487, 10);
  });

  it("matches hand-computed information ratio (mean(p−b)·252 / te)", () => {
    const r = computeScenarioBenchmark(port, bench);
    expect(r.informationRatio).toBeCloseTo(4.6559015619790225, 8);
  });

  it("matches hand-computed sample correlation", () => {
    const r = computeScenarioBenchmark(port, bench);
    expect(r.correlation).toBeCloseTo(0.9879951689059581, 8);
  });

  it("reports the aligned count n", () => {
    const r = computeScenarioBenchmark(port, bench);
    expect(r.n).toBe(6);
  });

  it("annualizes with 252 only (a √365 / 365 impl would NOT match the goldens)", () => {
    // The golden TE above was derived with sqrt(252). Were the lib to use
    // sqrt(365), te would be sqrt(365/252)≈1.204× larger and FAIL the golden.
    const r = computeScenarioBenchmark(port, bench);
    expect(r.trackingError).not.toBeCloseTo(0.07216647421067487 * Math.sqrt(365 / 252), 4);
  });
});

// =========================================================================
// 2. Intersection (inner-join), NOT a positional zip or zero-filled union
// =========================================================================

describe("computeScenarioBenchmark — intersection alignment", () => {
  // Portfolio spans d1..d8; benchmark covers only d3..d6 PLUS an extra d9
  // that the portfolio never has. The overlap is exactly {d3,d4,d5,d6} → n=4.
  const d = days(9); // d1..d9
  const portfolio: DP[] = [
    { date: d[0], value: 999 }, // d1 — non-overlap (divergent poison)
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
    { date: d[8], value: -888 }, // d9 — non-overlap (divergent poison)
  ];

  it("innerJoinByDate keeps ONLY shared dates (no zero-fill, no positional zip)", () => {
    const { dates, p, b } = innerJoinByDate(portfolio, benchmark);
    expect(dates).toEqual([d[2], d[3], d[4], d[5]]);
    expect(p).toEqual([0.01, -0.005, 0.02, 0.0]);
    expect(b).toEqual([0.008, -0.004, 0.012, 0.002]);
  });

  it("reports n === 4 (the aligned overlap), not the union/positional length", () => {
    const r = computeScenarioBenchmark(portfolio, benchmark);
    expect(r.n).toBe(4);
  });

  it("a divergent value on a NON-overlapping date does not move any metric (proves inner-join, not union/zip)", () => {
    const baseline = computeScenarioBenchmark(portfolio, benchmark);

    // Mutate the poison values on the non-overlapping dates to something even
    // more extreme. A positional-zip or union/zero-fill impl would absorb these
    // and shift the metrics. Inner-join ignores them entirely.
    const portfolio2 = portfolio.map((x) =>
      x.date === d[0] ? { ...x, value: -50000 } : x,
    );
    const benchmark2 = benchmark.map((x) =>
      x.date === d[8] ? { ...x, value: 77777 } : x,
    );
    const mutated = computeScenarioBenchmark(portfolio2, benchmark2);

    expect(mutated.n).toBe(4);
    expect(mutated.beta).toBeCloseTo(baseline.beta as number, 12);
    expect(mutated.alpha).toBeCloseTo(baseline.alpha as number, 12);
    expect(mutated.trackingError).toBeCloseTo(baseline.trackingError as number, 12);
    expect(mutated.informationRatio).toBeCloseTo(baseline.informationRatio as number, 12);
    expect(mutated.correlation).toBeCloseTo(baseline.correlation as number, 12);
  });
});

// =========================================================================
// 3. Null-safety: degenerate inputs surface null, never a fabricated 0
// =========================================================================

describe("computeScenarioBenchmark — null degenerate paths (em-dash source)", () => {
  it("n<2 aligned → every metric field is null (not 0)", () => {
    const d = days(3);
    // Only one shared date → aligned n=1.
    const port: DP[] = [
      { date: d[0], value: 0.01 },
      { date: d[1], value: 0.02 },
    ];
    const bench: DP[] = [
      { date: d[1], value: 0.008 },
      { date: d[2], value: 0.009 },
    ];
    const r: ScenarioBenchmark = computeScenarioBenchmark(port, bench);
    expect(r.n).toBe(1);
    expect(r.beta).toBeNull();
    expect(r.alpha).toBeNull();
    expect(r.trackingError).toBeNull();
    expect(r.informationRatio).toBeNull();
    expect(r.correlation).toBeNull();
  });

  it("constant benchmark (var(b)=0) → beta & alpha are null, NOT a fabricated 0", () => {
    // computeAlphaBeta returns {alpha:0, beta:0} for BOTH n<2 AND var(b)=0 —
    // indistinguishable from its return value. The lib must detect var(b)=0
    // itself and surface null so the UI renders "—", not "0.00".
    const d = days(6);
    const port: DP[] = d.map((date, i) => ({
      date,
      value: i % 2 === 0 ? 0.01 : -0.004,
    }));
    const bench: DP[] = d.map((date) => ({ date, value: 0.003 })); // constant → var=0
    const r = computeScenarioBenchmark(port, bench);
    expect(r.n).toBe(6);
    expect(r.beta).toBeNull();
    expect(r.alpha).toBeNull();
    // Correlation is also undefined when std(b)=0 → null (no fabricated 0).
    expect(r.correlation).toBeNull();
  });

  it("numerically-constant NONZERO excess (steady outperformance) → information ratio is null, never a fabricated ~1e15", () => {
    // A steady +0.003/day outperformance: the excess series (p−b) is a
    // numerically CONSTANT but NONZERO 0.003 every day. te = std(excess)·√252
    // is ~1e-16 float residue (from mean-subtraction), which passes an exact
    // `te > 0` guard → IR = excessMean·252/1e-16 ≈ 2.5e15: a FABRICATED finite
    // number formatNumber would render. The SAME relative-scale degeneracy test
    // beta/alpha/correlation already apply must gate IR too → null.
    const d = days(30);
    // Non-degenerate benchmark (real variance) so only the EXCESS is degenerate.
    const bench: DP[] = d.map((date, i) => ({
      date,
      value: i % 2 === 0 ? 0.01 : -0.006,
    }));
    // port = bench + 0.003 every day → excess ≡ 0.003 (constant, nonzero).
    const port: DP[] = bench.map((x) => ({ ...x, value: x.value + 0.003 }));
    const r = computeScenarioBenchmark(port, bench);
    expect(r.n).toBe(30);
    expect(r.informationRatio).toBeNull();
    // Sanity: this is NOT the te=0 (p≡b) case — there IS real excess, just
    // numerically constant. te is a tiny float residue, not exactly 0.
    expect(r.trackingError).not.toBeNull();
  });

  it("te=0 (p ≡ b) → information ratio is null (guard te>0 before dividing)", () => {
    const d = days(6);
    const series = d.map((date, i) => ({
      date,
      value: i % 2 === 0 ? 0.012 : -0.007,
    }));
    const port: DP[] = series;
    const bench: DP[] = series.map((x) => ({ ...x })); // identical → p-b ≡ 0 → te=0
    const r = computeScenarioBenchmark(port, bench);
    expect(r.trackingError).toBeCloseTo(0, 12);
    expect(r.informationRatio).toBeNull();
    // Beta against itself is 1, alpha ~0 (these are well-defined here).
    expect(r.beta).toBeCloseTo(1, 8);
  });

  it("no overlap at all → n=0 and all metrics null", () => {
    const port: DP[] = [{ date: "2024-01-01", value: 0.01 }];
    const bench: DP[] = [{ date: "2024-02-01", value: 0.02 }];
    const r = computeScenarioBenchmark(port, bench);
    expect(r.n).toBe(0);
    expect(r.beta).toBeNull();
    expect(r.alpha).toBeNull();
    expect(r.trackingError).toBeNull();
    expect(r.informationRatio).toBeNull();
    expect(r.correlation).toBeNull();
  });
});
