/**
 * Site tests T16, T17, T19 and T20 for Phase 166.2 plan 05: the factsheet
 * builder's benchmark, rolling and correlation figures (`jointMetrics`' beta,
 * correlation, tracking error and information ratio; `rollingBeta`;
 * `rollingSharpe`; the benchmark correlations and correlation matrix of
 * `buildFactsheetPayload`; `buildAllocatorMetrics`' correlation) must answer a
 * compounding-NAV constant yield EXACTLY as they answer an all-zero series of
 * the same length (Phase 166.1 D-07), because those sites now compute through
 * `src/lib/return-stats.ts` (D-17).
 *
 * Why it matters: a benchmark or strategy leg that only compounds (a yield
 * sleeve, a cash-like comparator) has a residue sd of about 1.3e-16, not 0.
 * Behind the old `> 0` / `!== 0` guards that residue produced a beta, a
 * correlation or an information ratio made of float noise, and the public
 * factsheet showed it. The cent-rounded 1% APY NAV is the control on the other
 * side of the floor: its dispersion is real, so its beta and correlation must
 * stay finite and non-zero, and widening the floor goes red.
 *
 * Expected values are never hard-coded: each D-07 test computes the site's
 * output on the all-zero input and asserts the constant-yield output identical
 * (Object.is) to it. The noisy-input pins rebuild today's formulas from the
 * inputs in this file, so a change to the arithmetic of a figure that is NOT
 * residue goes red too.
 */
import { describe, it, expect } from "vitest";
import { jointMetrics } from "./joint";
import { rollingBeta, rollingSharpe, rollingSortino, rollingVol } from "./rolling";
import { buildFactsheetPayload } from "./build-payload";
import { buildAllocatorMetrics } from "./allocator";
import type { DailyReturn } from "./types";
import { CONSTANT_YIELDS, apyToDaily, navConstantYield } from "@/__tests__/fixtures/dispersion-nav";

const N = 366;
const PPY = 252;
const WINDOW = 30;

/** Deterministic noisy daily returns, about +-5%. */
function noise(n: number, seed: number): number[] {
  const out: number[] = [];
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    out.push((x / 0x7fffffff - 0.5) * 0.1);
  }
  return out;
}

const zeros = (n: number): number[] => new Array(n).fill(0);
const sig12 = (x: number): number => Number(x.toPrecision(12));

const STRAT = noise(N, 12345);
const BENCH = noise(N, 67890);
const CENT_1PCT = navConstantYield(apyToDaily(0.01), N, 10_000, true);
const YIELD_IDS = Object.keys(CONSTANT_YIELDS);

/** Today's `jointMetrics` arithmetic, rebuilt from the inputs (population sd, means by summation). */
function referenceJoint(rets: number[], bench: number[], rf: number, ppy: number) {
  const n = rets.length;
  let sr = 0;
  let sbSum = 0;
  for (let i = 0; i < n; i++) {
    sr += rets[i];
    sbSum += bench[i];
  }
  const m = sr / n;
  const mb = sbSum / n;
  let cov = 0;
  let varB = 0;
  let varS = 0;
  for (let i = 0; i < n; i++) {
    cov += (rets[i] - m) * (bench[i] - mb);
    varB += (bench[i] - mb) * (bench[i] - mb);
    varS += (rets[i] - m) * (rets[i] - m);
  }
  cov /= n;
  varB /= n;
  varS /= n;
  const beta = cov / varB;
  const corr = cov / (Math.sqrt(varS) * Math.sqrt(varB));
  let teSum = 0;
  for (let i = 0; i < n; i++) {
    const d = rets[i] - bench[i] - (m - mb);
    teSum += d * d;
  }
  const trackingError = Math.sqrt(teSum / n) * Math.sqrt(ppy);
  return {
    beta,
    corr,
    r2: corr * corr,
    alpha: (m - beta * mb) * ppy,
    treynor: ((m - rf / ppy) * ppy) / beta,
    tracking_error: trackingError,
    info_ratio: ((m - mb) * ppy) / trackingError,
  };
}

/** Today's rolling-window arithmetic, rebuilt from the inputs (population sd). */
function windowStats(w: number[]) {
  let s = 0;
  for (const x of w) s += x;
  const m = s / w.length;
  let q = 0;
  for (const x of w) q += (x - m) * (x - m);
  return { m, sd: Math.sqrt(q / w.length) };
}

describe("T16 jointMetrics on return-stats (D-07, D-17)", () => {
  const onZeroBench = jointMetrics(STRAT, zeros(N), 0, PPY);
  const onZeroActive = jointMetrics(BENCH, BENCH, 0, PPY);

  // D7 (founder, 2026-09-26): against a benchmark with no dispersion, every
  // ratio that divides by it does not exist and reads NaN ("—"), never 0, as
  // DistributionPanels shows "—" for the same pair. Tracking error is a
  // dispersion, not a ratio, and stays a number.
  it("T16 the all-zero bench has no beta, corr, r2, alpha, Treynor or capture ratio (NaN, not 0)", () => {
    for (const k of ["beta", "corr", "r2", "alpha", "treynor", "up_capture", "down_capture"] as const) {
      expect(Number.isNaN(onZeroBench[k]), k).toBe(true);
    }
    expect(Number.isFinite(onZeroBench.tracking_error)).toBe(true);
  });

  it("T16 a zero active return has no information ratio (NaN, not 0)", () => {
    expect(Number.isNaN(onZeroActive.info_ratio)).toBe(true);
  });

  it("T16 a dispersing bench with no down days has no down capture (NaN), and a real up capture", () => {
    const upOnly = BENCH.map((b) => Math.abs(b) + 0.001);
    const got = jointMetrics(STRAT, upOnly, 0, PPY);
    expect(Number.isNaN(got.down_capture)).toBe(true);
    expect(Number.isFinite(got.up_capture)).toBe(true);
  });

  for (const id of YIELD_IDS) {
    const y = CONSTANT_YIELDS[id];

    // SFH-M3: every field that divides by the BENCHMARK's dispersion, not only
    // beta and corr. up_capture broke the D-07 equality (a constant-yield bench
    // has only "up days", with a tiny real sum) and T16 did not look at it.
    // tracking_error and info_ratio are excluded on purpose: they are the
    // dispersion and Sharpe of the ACTIVE series, strategy minus bench, which a
    // constant-yield bench shifts by its yield, so they are real numbers that
    // differ from the all-zero bench's (the zero-ACTIVE case below pins them).
    it(`T16 every bench-dispersion field against a constant-yield bench equals the all-zero bench (${id})`, () => {
      const got = jointMetrics(STRAT, navConstantYield(y, N), 0, PPY);
      for (const k of ["alpha", "beta", "corr", "r2", "treynor", "up_capture", "down_capture"] as const) {
        expect(Object.is(got[k], onZeroBench[k]), k).toBe(true);
      }
    });

    it(`T16 info_ratio and tracking_error on a constant active return equal the zero-active case (${id})`, () => {
      const c = navConstantYield(y, N);
      const rets = BENCH.map((b, i) => b + c[i]);
      const got = jointMetrics(rets, BENCH, 0, PPY);
      expect(Object.is(got.info_ratio, onZeroActive.info_ratio)).toBe(true);
      expect(Object.is(got.tracking_error, onZeroActive.tracking_error)).toBe(true);
    });
  }

  // HI-01 (review round 2): the STRATEGY leg's residue. A constant-yield
  // strategy against a dispersing bench (the factsheet's default BTC panel) gave
  // a residue beta of about ±1e-15 and a Treynor of ±1e10..1e15, where an
  // all-zero strategy gives beta 0 and Treynor NaN ("—"). Only the fields that
  // rest on the strategy's dispersion are compared with the all-zero strategy:
  // alpha is the strategy's own mean return once beta is 0 (m * P, a real
  // number), and the captures, tracking error and information ratio read the
  // strategy's level, which a constant yield shifts by its yield.
  const zeroStratOnBench = jointMetrics(zeros(N), BENCH, 0, PPY);

  it("T16 the all-zero strategy on a dispersing bench has beta exactly +0, Treynor, corr and r2 NaN (control)", () => {
    expect(Object.is(zeroStratOnBench.beta, 0)).toBe(true);
    for (const k of ["treynor", "corr", "r2"] as const) {
      expect(Number.isNaN(zeroStratOnBench[k]), k).toBe(true);
    }
  });

  for (const id of YIELD_IDS) {
    const y = CONSTANT_YIELDS[id];

    it(`T16 a constant-yield STRATEGY on a dispersing bench equals the all-zero strategy on beta, Treynor, corr and r2 (${id})`, () => {
      const strat = navConstantYield(y, N);
      const got = jointMetrics(strat, BENCH, 0, PPY);
      for (const k of ["beta", "treynor", "corr", "r2"] as const) {
        expect(Object.is(got[k], zeroStratOnBench[k]), `${k}=${got[k]}`).toBe(true);
      }
      // With beta 0, alpha is the strategy's own annualised mean, not a residue.
      let sum = 0;
      for (const r of strat) sum += r;
      expect(got.alpha).toBe((sum / N) * PPY);
    });
  }

  it("T16 cent-rounded 1% APY bench keeps a finite, non-zero beta and corr (floor control)", () => {
    const got = jointMetrics(STRAT, CENT_1PCT, 0, PPY);
    expect(Number.isFinite(got.beta) && got.beta !== 0).toBe(true);
    expect(Number.isFinite(got.corr) && got.corr !== 0).toBe(true);
  });

  it("T16 treynor, alpha, beta, corr, r2 and captures on a noisy input are unchanged to 12 significant digits", () => {
    const got = jointMetrics(STRAT, BENCH, 0.03, PPY);
    const ref = referenceJoint(STRAT, BENCH, 0.03, PPY);
    expect(sig12(got.beta)).toBe(sig12(ref.beta));
    expect(sig12(got.corr)).toBe(sig12(ref.corr));
    expect(sig12(got.r2)).toBe(sig12(ref.r2));
    expect(sig12(got.alpha)).toBe(sig12(ref.alpha));
    expect(sig12(got.treynor)).toBe(sig12(ref.treynor));
    let up = 0;
    let upS = 0;
    let dn = 0;
    let dnS = 0;
    for (let i = 0; i < N; i++) {
      if (BENCH[i] > 0) {
        up += BENCH[i];
        upS += STRAT[i];
      } else if (BENCH[i] < 0) {
        dn += BENCH[i];
        dnS += STRAT[i];
      }
    }
    expect(got.up_capture).toBe(upS / up);
    expect(got.down_capture).toBe(dnS / dn);
  });

  it("T16 info_ratio and tracking_error move to the active series", () => {
    for (const ppy of [252, 365]) {
      const got = jointMetrics(STRAT, BENCH, 0, ppy);
      const ref = referenceJoint(STRAT, BENCH, 0, ppy);
      expect(sig12(got.info_ratio)).toBe(sig12(ref.info_ratio));
      expect(sig12(got.tracking_error)).toBe(sig12(ref.tracking_error));
    }
  });
});

describe("T17 rollingBeta and rollingSharpe on return-stats (D-07, D-17)", () => {
  const betaOnZeroBench = rollingBeta(STRAT, zeros(N), WINDOW);
  const sharpeOnZeros = rollingSharpe(zeros(N), WINDOW, PPY);

  // D7 (founder, 2026-09-26), SFH-M1: a window with no ratio is a GAP (null),
  // the value the warm-up region already carries, never a drawn 0.
  it("T17 every window of an all-zero series (bench) is null, a gap, not 0", () => {
    expect(betaOnZeroBench.every((v) => v === null)).toBe(true);
    expect(sharpeOnZeros.every((v) => v === null)).toBe(true);
  });

  it("T17 a flat stretch inside a noisy series is a gap only where the window is flat", () => {
    const mixed = STRAT.slice();
    for (let i = 100; i < 100 + 2 * WINDOW; i++) mixed[i] = 0;
    const s = rollingSharpe(mixed, WINDOW, PPY);
    // The first window wholly inside the flat stretch ends at 100 + WINDOW - 1.
    expect(s[100 + WINDOW - 1]).toBeNull();
    expect(Number.isFinite(s[99] as number)).toBe(true);
    expect(Number.isFinite(s[N - 1] as number)).toBe(true);
    const b = rollingBeta(STRAT, mixed, WINDOW);
    expect(b[100 + WINDOW - 1]).toBeNull();
    expect(Number.isFinite(b[N - 1] as number)).toBe(true);
  });

  it("T17 rollingVol of a constant yield is exactly the all-zero series' 0 (SFH-M7, shared sd)", () => {
    for (const id of YIELD_IDS) {
      expect(rollingVol(navConstantYield(CONSTANT_YIELDS[id], N), WINDOW, PPY), id).toEqual(
        rollingVol(zeros(N), WINDOW, PPY),
      );
    }
  });

  for (const id of YIELD_IDS) {
    const y = CONSTANT_YIELDS[id];

    it(`T17 rollingBeta against a constant-yield bench equals the all-zero bench (${id})`, () => {
      expect(rollingBeta(STRAT, navConstantYield(y, N), WINDOW)).toEqual(betaOnZeroBench);
    });

    it(`T17 rollingSharpe of a constant yield equals the all-zero series (${id})`, () => {
      expect(rollingSharpe(navConstantYield(y, N), WINDOW, PPY)).toEqual(sharpeOnZeros);
    });
  }

  // HI-01 (review round 2): a constant-yield STRATEGY window has beta exactly
  // 0, the all-zero strategy's value, never a residue of about ±1e-15.
  it("T17 rollingBeta of a constant-yield strategy equals the all-zero strategy, element by element", () => {
    const control = rollingBeta(zeros(N), BENCH, WINDOW);
    expect(control[N - 1]).toBe(0);
    for (const id of YIELD_IDS) {
      const got = rollingBeta(navConstantYield(CONSTANT_YIELDS[id], N), BENCH, WINDOW);
      const bad = got.findIndex((v, i) => !Object.is(v, control[i]));
      expect(bad, `${id}: index ${bad} = ${got[bad]}`).toBe(-1);
    }
  });

  it("T17 cent-rounded 1% APY keeps a finite, non-zero rolling beta and Sharpe (floor control)", () => {
    const b = rollingBeta(STRAT, CENT_1PCT, WINDOW);
    const s = rollingSharpe(CENT_1PCT, WINDOW, PPY);
    const lastB = b[N - 1] as number;
    const lastS = s[N - 1] as number;
    expect(Number.isFinite(lastB) && lastB !== 0).toBe(true);
    expect(Number.isFinite(lastS) && lastS !== 0).toBe(true);
  });

  it("T17 rollingBeta and rollingSharpe on a noisy series are bitwise today's arithmetic", () => {
    const beta = rollingBeta(STRAT, BENCH, WINDOW);
    const sharpe = rollingSharpe(STRAT, WINDOW, PPY);
    for (let i = WINDOW - 1; i < N; i++) {
      const ws = STRAT.slice(i - WINDOW + 1, i + 1);
      const wb = BENCH.slice(i - WINDOW + 1, i + 1);
      const s = windowStats(ws);
      const b = windowStats(wb);
      let cov = 0;
      let varB = 0;
      for (let k = 0; k < WINDOW; k++) {
        cov += (ws[k] - s.m) * (wb[k] - b.m);
        varB += (wb[k] - b.m) * (wb[k] - b.m);
      }
      expect(beta[i]).toBe(cov / WINDOW / (varB / WINDOW));
      expect(sharpe[i]).toBe((s.m * PPY) / (s.sd * Math.sqrt(PPY)));
    }
  });

  it("T17 rollingVol and rollingSortino on a noisy series are bitwise unchanged", () => {
    const vol = rollingVol(STRAT, WINDOW, PPY);
    const sortino = rollingSortino(STRAT, WINDOW, PPY);
    const sqrtN = Math.sqrt(PPY);
    for (let i = WINDOW - 1; i < N; i++) {
      const w = STRAT.slice(i - WINDOW + 1, i + 1);
      const { m, sd } = windowStats(w);
      expect(vol[i]).toBe(sd * sqrtN);
      let downSq = 0;
      for (const x of w) if (x < 0) downSq += x * x;
      const dd = Math.sqrt(downSq / WINDOW) * sqrtN;
      expect(sortino[i]).toBe((m * PPY) / dd);
    }
  });
});

/** A daily-return series on consecutive calendar days inside the benchmark fixtures' range. */
function dated(values: number[]): DailyReturn[] {
  const t0 = Date.parse("2024-01-01T00:00:00Z");
  return values.map((value, i) => ({
    date: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
    value,
  }));
}

const PAYLOAD_STRATEGY = {
  id: "s-166-2-05",
  name: "Constant Yield Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2025-01-02T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
};

/** The benchmark correlations and the strategy's row of the matrix, as the payload reports them. */
function payloadCorrelations(values: number[]): number[] {
  const p = buildFactsheetPayload(PAYLOAD_STRATEGY, dated(values));
  if (!p) throw new Error("buildFactsheetPayload returned null");
  const matrix = p.correlationMatrix.matrix;
  return [
    ...p.correlations.map((r) => r.rho),
    ...matrix[0].slice(1),
    ...matrix.slice(1).map((row) => row[0]),
  ];
}

describe("T19 buildFactsheetPayload correlations on return-stats (D-07, D-17)", () => {
  const onZeros = payloadCorrelations(zeros(N));

  it("T19 an all-zero strategy reports NaN for every benchmark correlation (the degenerate value)", () => {
    expect(onZeros.length).toBe(15);
    expect(onZeros.every((x) => Object.is(x, NaN))).toBe(true);
  });

  for (const id of YIELD_IDS) {
    it(`T19 benchmark correlations and matrix cells of a constant-yield strategy equal the all-zero strategy (${id})`, () => {
      const got = payloadCorrelations(navConstantYield(CONSTANT_YIELDS[id], N));
      expect(got.length).toBe(onZeros.length);
      got.forEach((x, i) => expect(Object.is(x, onZeros[i])).toBe(true));
    });
  }

  it("T19 cent-rounded 1% APY strategy keeps finite correlations (floor control)", () => {
    const got = payloadCorrelations(CENT_1PCT);
    expect(got.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe("T20 buildAllocatorMetrics correlation on return-stats (D-07, D-17)", () => {
  const onZeroLeg = buildAllocatorMetrics(BENCH, zeros(N));
  const zeroPortfolio = buildAllocatorMetrics(zeros(N), STRAT);

  // D7 (founder, 2026-09-26), WR-04: a leg with no dispersion has no
  // correlation, NaN ("—"), never "+0.00". The sleeve scan stays exact: the
  // cross term it drops is 0 by construction (one vol is 0).
  it("T20 an all-zero leg has no correlation (NaN), and the sleeve scan still runs", () => {
    expect(Number.isNaN(onZeroLeg.corr)).toBe(true);
    expect(Number.isNaN(zeroPortfolio.corr)).toBe(true);
    expect(Number.isFinite(onZeroLeg.blend_vol)).toBe(true);
    expect(Number.isFinite(onZeroLeg.sleeve_pct)).toBe(true);
    // With the MultiMarket leg flat, blend vol at sleeve w is (1-w) * annVol.
    const annVol = buildAllocatorMetrics(BENCH, zeros(N)).ann_vol;
    expect(onZeroLeg.blend_vol).toBeCloseTo((1 - onZeroLeg.sleeve_pct) * annVol, 12);
  });

  // SFH-M4 / IN-04: every figure is over one window, so unequal legs are refused
  // loudly, as jointMetrics refuses them, instead of computing vol over n and the
  // correlation over min(n, m).
  it("T20 refuses legs of unequal length", () => {
    expect(() => buildAllocatorMetrics(BENCH, STRAT.slice(0, N - 1))).toThrow(/same length/);
    expect(() => buildAllocatorMetrics(BENCH.slice(0, N - 1), STRAT)).toThrow(/same length/);
  });

  for (const id of YIELD_IDS) {
    const y = CONSTANT_YIELDS[id];

    it(`T20 a constant-yield strategy leg gives the all-zero leg's correlation, sleeve and blend vol (${id})`, () => {
      const got = buildAllocatorMetrics(BENCH, navConstantYield(y, N));
      expect(Object.is(got.corr, onZeroLeg.corr)).toBe(true);
      expect(Object.is(got.sleeve_pct, onZeroLeg.sleeve_pct)).toBe(true);
      expect(Object.is(got.blend_vol, onZeroLeg.blend_vol)).toBe(true);
    });

    it(`T20 a constant-yield portfolio gives the all-zero portfolio's ann_vol and correlation (${id})`, () => {
      const got = buildAllocatorMetrics(navConstantYield(y, N), STRAT);
      expect(Object.is(got.ann_vol, zeroPortfolio.ann_vol)).toBe(true);
      expect(Object.is(got.corr, zeroPortfolio.corr)).toBe(true);
    });
  }

  it("T20 cent-rounded 1% APY leg keeps a finite, non-zero correlation (floor control)", () => {
    const got = buildAllocatorMetrics(BENCH, CENT_1PCT);
    expect(Number.isFinite(got.corr) && got.corr !== 0).toBe(true);
  });

  it("T20 a noisy pair keeps its correlation and vols to 12 significant digits", () => {
    for (const ppy of [252, 365]) {
      const got = buildAllocatorMetrics(BENCH, STRAT, ppy);
      const a = windowStats(BENCH);
      const b = windowStats(STRAT);
      let cov = 0;
      for (let i = 0; i < N; i++) cov += (BENCH[i] - a.m) * (STRAT[i] - b.m);
      cov /= N;
      expect(sig12(got.corr)).toBe(sig12(cov / (a.sd * b.sd)));
      expect(got.ann_vol).toBe(a.sd * Math.sqrt(ppy));
    }
  });
});
