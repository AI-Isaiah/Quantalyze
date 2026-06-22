import { describe, it, expect } from "vitest";
import {
  runMonteCarlo,
  handleMonteCarloMessage,
  MC_PATHS_DEFAULT,
  MC_HORIZON_DEFAULT,
  type MonteCarloRequest,
  type MonteCarloResult,
} from "./scenario-montecarlo";
import { SAMPLE_FLOOR_OVERLAPPING_DAYS } from "@/lib/sample-floor";

/**
 * Falsifiable pins for the forward Monte-Carlo engine (Plan 27-01, SIM-01). The
 * whole risk class is honesty/correctness — a band that lies to an allocator
 * about forward uncertainty. Exact path values are not hand-computable for a
 * stochastic engine, so (per the scenario-stress.test.ts discipline) we DO NOT
 * snapshot impl output as "golden"; instead each invariant is a MATHEMATICAL
 * PROPERTY derived from SIM-01 that fails loud under the corresponding bug:
 *
 *   - determinism      — same (series, seed, params) ⇒ byte-identical bands.
 *                        A `Math.random` regression or non-stable sort FAILS.
 *   - seed sensitivity — a different seed ⇒ different bands (the PRNG is used).
 *   - floor gate       — n < 60 ⇒ ok:false below-floor; empty/non-finite ⇒
 *                        no-usable-n; never a fabricated band (the SoT, not a 60).
 *   - monotone bands   — p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95 at every step.
 *   - horizon widening — p95−p5 grows into the horizon (forward uncertainty
 *                        compounds). A flat band FAILS.
 *   - honest-to-N      — the parameter-uncertainty drift makes a SHORTER history
 *                        produce a WIDER terminal interval, and turning the drift
 *                        OFF removes that widening (the mechanism, both directions).
 *   - not Normal       — a fat-left-tail series ⇒ an ASYMMETRIC band (downside
 *                        further from median than upside). A Normal/symmetric
 *                        model FAILS.
 *   - leverage-aware   — doubling the (already-leveraged) input widens the band
 *                        (leverage is NOT scale-invariant for dispersion).
 */

type DP = { date: string; value: number };

/** Build a DailyPoint[] from a bare returns array (dates are irrelevant to the
 *  engine — it reads only `.value` — but must be present + distinct). */
function series(returns: number[]): DP[] {
  return returns.map((value, i) => {
    const month = String(1 + Math.floor(i / 28)).padStart(2, "0");
    const day = String(1 + (i % 28)).padStart(2, "0");
    return { date: `2024-${month}-${day}`, value };
  });
}

/** Repeat a fixed pattern to length n — same per-day distribution at any n, so
 *  two lengths differ ONLY in sample size (isolates the honest-to-N mechanism). */
function repeatPattern(pattern: number[], n: number): number[] {
  return Array.from({ length: n }, (_, i) => pattern[i % pattern.length]);
}

const PATTERN = [0.02, -0.015, 0.01, -0.02, 0.005, 0.012, -0.008];

/** Terminal interval width (p95 − p5) of an ok result. */
function terminalWidth(res: MonteCarloResult): number {
  expect(res.ok).toBe(true);
  return res.terminal!.hi - res.terminal!.lo;
}

const BASE: Omit<MonteCarloRequest, "portfolioDaily"> = {
  horizonDays: 60,
  paths: 400,
  seed: 12345,
  blockLength: 4,
};

// =========================================================================
// 1. Determinism + seed sensitivity
// =========================================================================

describe("runMonteCarlo — determinism (SIM-01: reproducible bands)", () => {
  const s = series(repeatPattern(PATTERN, 252));

  it("same series + seed + params ⇒ byte-identical bands", () => {
    const a = runMonteCarlo({ portfolioDaily: s, ...BASE });
    const b = runMonteCarlo({ portfolioDaily: s, ...BASE });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("a different seed ⇒ different bands (the PRNG is actually used)", () => {
    const a = runMonteCarlo({ portfolioDaily: s, ...BASE, seed: 1 });
    const b = runMonteCarlo({ portfolioDaily: s, ...BASE, seed: 2 });
    expect(JSON.stringify(a.bands)).not.toBe(JSON.stringify(b.bands));
  });

  it("handleMonteCarloMessage is the same entry point as runMonteCarlo", () => {
    expect(handleMonteCarloMessage).toBe(runMonteCarlo);
  });
});

// =========================================================================
// 2. Floor gate — never a fabricated band (the Phase-22 SoT)
// =========================================================================

describe("runMonteCarlo — floor gate (SIM-01.3, the shared SoT)", () => {
  it("n exactly at the floor ⇒ ok", () => {
    const res = runMonteCarlo({
      portfolioDaily: series(repeatPattern(PATTERN, SAMPLE_FLOOR_OVERLAPPING_DAYS)),
      ...BASE,
    });
    expect(res.ok).toBe(true);
    expect(res.n).toBe(SAMPLE_FLOOR_OVERLAPPING_DAYS);
    expect(res.bands).not.toBeNull();
  });

  it("n one below the floor ⇒ below-floor, no bands (never fabricated)", () => {
    const res = runMonteCarlo({
      portfolioDaily: series(repeatPattern(PATTERN, SAMPLE_FLOOR_OVERLAPPING_DAYS - 1)),
      ...BASE,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("below-floor");
    expect(res.bands).toBeNull();
    expect(res.terminal).toBeNull();
  });

  it("empty series ⇒ no-usable-n (the engine's degenerate [] output)", () => {
    const res = runMonteCarlo({ portfolioDaily: [], ...BASE });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no-usable-n");
    expect(res.n).toBeNull();
    expect(res.bands).toBeNull();
  });

  it("a non-finite value anywhere ⇒ no-usable-n (never a corrupted band)", () => {
    const bad = repeatPattern(PATTERN, 120);
    bad[50] = NaN;
    const res = runMonteCarlo({ portfolioDaily: series(bad), ...BASE });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no-usable-n");
    expect(res.bands).toBeNull();
  });
});

// =========================================================================
// 3. Band shape — monotone quantiles + horizon widening + structure
// =========================================================================

describe("runMonteCarlo — band shape (SIM-01.1/.2)", () => {
  const res = runMonteCarlo({
    portfolioDaily: series(repeatPattern(PATTERN, 252)),
    ...BASE,
    horizonDays: 120,
    parameterUncertainty: false, // isolate the resampled dispersion
  });

  it("emits one band point per forward step with the requested quantile keys", () => {
    expect(res.ok).toBe(true);
    expect(res.bands!.length).toBe(120);
    expect(res.bands![0].step).toBe(1);
    expect(res.bands![119].step).toBe(120);
    expect(Object.keys(res.bands![0].q).sort()).toEqual(["p25", "p5", "p50", "p75", "p95"]);
    expect(res.medianKey).toBe("p50");
  });

  it("quantiles are monotone non-decreasing at every step (p5≤p25≤p50≤p75≤p95)", () => {
    for (const b of res.bands!) {
      expect(b.q.p5).toBeLessThanOrEqual(b.q.p25);
      expect(b.q.p25).toBeLessThanOrEqual(b.q.p50);
      expect(b.q.p50).toBeLessThanOrEqual(b.q.p75);
      expect(b.q.p75).toBeLessThanOrEqual(b.q.p95);
    }
  });

  it("the band widens into the horizon (forward uncertainty compounds)", () => {
    const first = res.bands![0];
    const last = res.bands![res.bands!.length - 1];
    expect(last.q.p95 - last.q.p5).toBeGreaterThan(first.q.p95 - first.q.p5);
  });

  it("terminal summary mirrors the last band's outer quantiles + median", () => {
    const last = res.bands![res.bands!.length - 1].q;
    expect(res.terminal!.median).toBe(last.p50);
    expect(res.terminal!.lo).toBe(last.p5);
    expect(res.terminal!.hi).toBe(last.p95);
  });
});

// =========================================================================
// 4. Honest to sample size — the parameter-uncertainty drift mechanism
// =========================================================================

describe("runMonteCarlo — honest to N (SIM-01.2)", () => {
  const short = series(repeatPattern(PATTERN, SAMPLE_FLOOR_OVERLAPPING_DAYS)); // n=60
  const long = series(repeatPattern(PATTERN, 600)); // same per-day distribution, larger n

  it("a SHORTER history ⇒ a WIDER terminal interval (drift on)", () => {
    const wShort = terminalWidth(runMonteCarlo({ portfolioDaily: short, ...BASE }));
    const wLong = terminalWidth(runMonteCarlo({ portfolioDaily: long, ...BASE }));
    expect(wShort).toBeGreaterThan(wLong);
  });

  it("turning the drift OFF removes the short-history widening (the mechanism)", () => {
    const wShortDrift = terminalWidth(runMonteCarlo({ portfolioDaily: short, ...BASE }));
    const wShortNoDrift = terminalWidth(
      runMonteCarlo({ portfolioDaily: short, ...BASE, parameterUncertainty: false }),
    );
    // The drift term ADDS estimation uncertainty ⇒ the band is strictly wider
    // with it on than off, for the same short history.
    expect(wShortDrift).toBeGreaterThan(wShortNoDrift);
  });

  it("the drift magnitude is the honest LINEAR H·σ/√n — NOT the exp(H·δ) explosion", () => {
    // CALIBRATION pin (the C1 red-team finding): a per-day drift added to every
    // return and compounded inflates the band SUPER-linearly (exp(H·δ)) — a
    // dishonestly wide band. The correct shift is LINEAR in the horizon: the
    // standard error of the H-day cumulative mean, H·σ/√n, spanning ~3.29 SD
    // across p5..p95. We isolate the drift contribution via the quadrature of the
    // drift-on vs drift-off terminal widths (independent variances add) and assert
    // it matches the theoretical magnitude — a 3×+ inflation (the old bug) or a
    // gross under-widening BOTH fail this.
    const n = 60;
    const H = 504;
    const paths = 2000;
    const s = series(repeatPattern(PATTERN, n));
    const vals = s.map((d) => d.value);
    const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sigma = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / (vals.length - 1));

    const common = { horizonDays: H, paths, seed: 999, blockLength: 4 } as const;
    const wOn = terminalWidth(runMonteCarlo({ portfolioDaily: s, ...common, parameterUncertainty: true }));
    const wOff = terminalWidth(runMonteCarlo({ portfolioDaily: s, ...common, parameterUncertainty: false }));
    const driftWidth = Math.sqrt(Math.max(0, wOn * wOn - wOff * wOff));
    const expected = 3.29 * ((H * sigma) / Math.sqrt(n)); // honest p5..p95 drift span

    expect(driftWidth).toBeGreaterThan(0.4 * expected);
    expect(driftWidth).toBeLessThan(2.5 * expected);
  });

  it("no absurd terminal at the realistic 252-day horizon (bounded, not exploding)", () => {
    // The default horizon's p95 must stay sane (a 1-year projection, not a
    // lottery ticket). The old exp(H·δ) construction trended toward absurd
    // multi-hundred-percent p95s for short histories; the linear shift cannot.
    const res = runMonteCarlo({
      portfolioDaily: series(repeatPattern(PATTERN, 60)),
      horizonDays: 252,
      paths: 1000,
      seed: 7,
    });
    expect(res.ok).toBe(true);
    expect(res.terminal!.hi).toBeLessThan(5); // < +500% over a year — a sane ceiling
    expect(res.terminal!.lo).toBeGreaterThanOrEqual(-1); // never worse than −100%
  });
});

// =========================================================================
// 5. Not parametric — empirical, so a skewed series ⇒ an asymmetric band
// =========================================================================

describe("runMonteCarlo — empirical, no Normal-tail assumption (SIM-01.1)", () => {
  it("a fat-tailed series ⇒ a clearly ASYMMETRIC band (a symmetric Normal shortcut fails)", () => {
    // Mostly small positives with rare large crashes (excess kurtosis / fat
    // tails). The band is built by EMPIRICAL resampling + multiplicative
    // compounding, never a `mean ± z·std` symmetric Normal-in-return-space fit.
    // Compounding a bounded-below return series produces RIGHT-skewed cumulative
    // wealth (the upside tail is longer than the downside), so the band is
    // markedly asymmetric — an assertion a symmetric Normal-return model FAILS
    // and a fabricated-symmetric band could never satisfy.
    const skewed: number[] = [];
    for (let i = 0; i < 252; i++) skewed.push(i % 21 === 0 ? -0.18 : 0.01);
    const res = runMonteCarlo({
      portfolioDaily: series(skewed),
      ...BASE,
      horizonDays: 120,
      parameterUncertainty: false, // isolate the distribution shape
    });
    const t = res.terminal!;
    const downside = t.median - t.lo;
    const upside = t.hi - t.median;
    const width = t.hi - t.lo;
    // Asymmetric by a clear margin (not a symmetric band), in the right-skew
    // direction multiplicative compounding produces.
    expect(upside).toBeGreaterThan(downside);
    expect(Math.abs(upside - downside)).toBeGreaterThan(0.1 * width);
  });
});

// =========================================================================
// 6. Leverage-aware — doubling the already-leveraged input widens the band
// =========================================================================

describe("runMonteCarlo — leverage widens the band (SIM-01, not scale-invariant)", () => {
  it("a 2× series ⇒ a wider terminal interval than the 1× series", () => {
    const base = repeatPattern(PATTERN, 252);
    const w1 = terminalWidth(
      runMonteCarlo({ portfolioDaily: series(base), ...BASE, parameterUncertainty: false }),
    );
    const w2 = terminalWidth(
      runMonteCarlo({
        portfolioDaily: series(base.map((x) => x * 2)),
        ...BASE,
        parameterUncertainty: false,
      }),
    );
    expect(w2).toBeGreaterThan(w1);
  });
});

// =========================================================================
// 7. Defaults are exported + sane
// =========================================================================

describe("runMonteCarlo — defaults", () => {
  it("applies the documented default horizon + path count", () => {
    const res = runMonteCarlo({ portfolioDaily: series(repeatPattern(PATTERN, 300)) });
    expect(res.horizonDays).toBe(MC_HORIZON_DEFAULT);
    expect(res.paths).toBe(MC_PATHS_DEFAULT);
    expect(res.bands!.length).toBe(MC_HORIZON_DEFAULT);
  });
});
