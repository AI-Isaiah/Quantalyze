/**
 * Site tests for Phase 166.2 plan 04: the factsheet HEADLINE family (CONTEXT
 * D-17 rows T13, T14's computed arm, T15 and T18) must answer a compounding-NAV
 * constant yield EXACTLY as it answers an all-zero series of the same length
 * (Phase 166.1 D-07), because each site now computes its dispersion and Sharpe
 * through `src/lib/return-stats.ts` (D-17).
 *
 * Why it matters: the factsheet builds these numbers for the strategy page, the
 * allocator-portfolio and scenario payloads and the levered browser re-derive.
 * Before the fix, a constant-yield strategy passed each site's own `> 0` guard
 * on a residue sd of about 1.3e-16 and showed a Sharpe of about 1e13, a
 * fabricated skew and kurtosis, or a comparator curve "vol-matched" by a scale
 * of about 1e13. The cent-rounded 1% APY NAV is the control on the other side
 * of the floor: its dispersion is real, so its ratio must stay a finite number,
 * and widening the floor goes red.
 *
 * Expected values are never hard-coded: each test computes the site's output
 * on the all-zero input and asserts the constant-yield output identical to it
 * (`toBe` / `toEqual`, both `Object.is` on primitives, so NaN matches NaN and
 * +0 is not -0).
 */
import { describe, it, expect } from "vitest";
import { compute, cumEq } from "./compute";
import { buildComparatorBlock } from "./comparator-block";
import { buildFactsheetPayload } from "./build-payload";
import { bootstrapCI, MIN_SHARPE_RESAMPLES } from "./bootstrap";
import { computePeerPercentile } from "./peer-cohort";
import { computeOgHeadline } from "./og-metrics";
import { mean, stdDev } from "@/lib/portfolio-math-utils";
import {
  CONSTANT_YIELDS,
  apyToDaily,
  navConstantYield,
} from "@/__tests__/fixtures/dispersion-nav";

const YIELD_IDS = Object.keys(CONSTANT_YIELDS);
const N = 366;

/** Daily ISO dates from 2024-01-01, deterministic. */
function isoDates(n: number, start = "2024-01-01"): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** A deterministic noisy daily-return series (no PRNG, reload-stable). */
function noisy(n: number, phase: number, drift = 0.001): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(drift + 0.02 * Math.sin(i * 1.7 + phase) + 0.005 * Math.cos(i * 0.31 + 2 * phase));
  }
  return out;
}

const DATES = isoDates(N);
const ZEROS: number[] = new Array(N).fill(0);
const CENT_CONTROL = navConstantYield(apyToDaily(0.01), N, 10_000, true);
const NOISY_A = noisy(N, 0.3);
const NOISY_B = noisy(N, 1.1, -0.0005);

describe("T13 compute: headline Sharpe, skew, kurtosis and ann_vol through return-stats", () => {
  const HEADLINE = ["sharpe", "skew", "kurt", "ann_vol"] as const;

  for (const periodsPerYear of [252, 365]) {
    for (const rf of [0, 0.02]) {
      it(`T13 constant yield equals the all-zero series (ppy ${periodsPerYear}, rf ${rf})`, () => {
        const zero = compute(ZEROS, DATES, rf, periodsPerYear);
        // D7 (founder, 2026-09-26): an all-zero series has no Sharpe, and the
        // absence stays NaN ("—"), never 0.
        expect(Number.isNaN(zero.sharpe)).toBe(true);
        for (const id of YIELD_IDS) {
          const got = compute(navConstantYield(CONSTANT_YIELDS[id], N), DATES, rf, periodsPerYear);
          for (const field of HEADLINE) {
            expect(got[field], `${id} ${field}`).toBe(zero[field]);
          }
        }
      });
    }
  }

  it("T13 cent-rounded 1% APY control keeps a finite, non-zero Sharpe and vol", () => {
    const got = compute(CENT_CONTROL, DATES, 0, 365);
    expect(Number.isFinite(got.sharpe)).toBe(true);
    expect(got.sharpe).not.toBe(0);
    expect(got.ann_vol).toBeGreaterThan(0);
  });

  it("T13 noisy series keeps compute's own arithmetic order to the last bit", () => {
    // compute's Sharpe is ((m - rf/ppy) * ppy) / (s * sqrt(ppy)) over the
    // population sd; the shared module must reproduce it bitwise.
    const ppy = 365;
    const rf = 0.02;
    const m = mean(NOISY_A);
    const s = stdDev(NOISY_A, false);
    const got = compute(NOISY_A, DATES, rf, ppy);
    expect(got.sharpe).toBe(((m - rf / ppy) * ppy) / (s * Math.sqrt(ppy)));
    expect(got.ann_vol).toBe(s * Math.sqrt(ppy));
  });

  it("T13 non-finite input has no Sharpe: NaN, rendered '—' (D7), never 0", () => {
    // sharpe() answers null on a non-finite input. D-17 I3 had compute answer that
    // as 0, the value a NaN-sd `s > 0` guard gave; D7 (founder, 2026-09-26) keeps
    // the absence instead.
    const xs = NOISY_A.slice();
    xs[100] = NaN;
    expect(Number.isNaN(compute(xs, DATES, 0, 365).sharpe)).toBe(true);
  });
});

describe("T18 comparator vol-match: fixed at its source (compute's ann_vol), comparator-block.ts unedited", () => {
  const stratEquity = cumEq(NOISY_A);
  const stratAnnVol = compute(NOISY_A, DATES, 0, 365).ann_vol;
  const block = (bench: number[]) =>
    buildComparatorBlock("Bench", "B", bench, NOISY_A, stratEquity, DATES, stratAnnVol, 30, 60, 365);

  it("T18 all-zero benchmark: the vol-matched curve is the unscaled curve (scale 1)", () => {
    const b = block(ZEROS);
    expect(b.volMatched).toEqual(b.cumulative);
    expect(b.volMatchedLabel).toBe("B × 1.00");
  });

  it("T18 constant-yield benchmark is vol-matched exactly as the all-zero benchmark is", () => {
    const zero = block(ZEROS);
    for (const id of YIELD_IDS) {
      const bench = navConstantYield(CONSTANT_YIELDS[id], N);
      const b = block(bench);
      expect(b.volMatched, id).toEqual(cumEq(bench));
      expect(b.volMatched, id).toEqual(b.cumulative);
      expect(b.volMatchedLabel, id).toBe(zero.volMatchedLabel);
    }
  });

  it("T18 a noisy benchmark keeps a real scale (not 1)", () => {
    // Half the strategy's amplitude, so the vol-match scale is about 2.
    const b = block(NOISY_B.map((x) => x / 2));
    expect(b.volMatched).not.toEqual(b.cumulative);
    expect(b.volMatchedLabel).not.toBe("B × 1.00");
  });
});

describe("T13 end to end: the factsheet payload's headline Sharpe", () => {
  // build-payload.test.ts exports no fixture builder, so this builds the
  // payload directly with a minimal strategy and no benchmark.
  const strategy = {
    id: "s-166-2-04",
    name: "Constant Yield Fixture",
    types: ["quant"],
    markets: ["crypto"],
    computedAt: "2025-01-01T00:00:00Z",
    trustTier: null,
    assetClass: "crypto",
    benchmark: null,
  };
  const payloadOf = (xs: number[]) =>
    buildFactsheetPayload(
      strategy,
      xs.map((value, i) => ({ date: DATES[i], value })),
    )!;

  it("T13 payload headline Sharpe, skew, kurtosis and vol on a constant yield equal the all-zero payload's", () => {
    const zero = payloadOf(ZEROS).strategyMetrics;
    expect(Number.isNaN(zero.sharpe)).toBe(true); // D7: an absence, never 0
    for (const id of ["daily_1e-4", "apy_5pct", "apy_100pct"]) {
      const got = payloadOf(navConstantYield(CONSTANT_YIELDS[id], N)).strategyMetrics;
      expect(got.sharpe, id).toBe(zero.sharpe);
      expect(got.skew, id).toBe(zero.skew);
      expect(got.kurt, id).toBe(zero.kurt);
      expect(got.ann_vol, id).toBe(zero.ann_vol);
    }
  });
});

describe("peer percentile: a strategy with no Sharpe has no Sharpe rank (D7, SFH-H1)", () => {
  it("a NaN Sharpe ranks as NaN, never the 0th percentile", () => {
    const got = computePeerPercentile(Number.NaN, 1, -0.1);
    expect(Number.isNaN(got.sharpe)).toBe(true);
    // The other two dimensions still rank.
    expect(Number.isFinite(got.sortino)).toBe(true);
  });

  it("control: a finite Sharpe keeps its rank", () => {
    expect(Number.isFinite(computePeerPercentile(1, 1, -0.1).sharpe)).toBe(true);
  });
});

describe("T15 bootstrapCI: the Sharpe point, interval and histogram through return-stats", () => {
  for (const periodsPerYear of [252, 365]) {
    it(`T15 constant yield's Sharpe fields equal the all-zero series' (ppy ${periodsPerYear})`, () => {
      // Same length and the default seed, so both runs draw the same blocks.
      const zero = bootstrapCI(ZEROS, 200, 5, 42, periodsPerYear).sharpe;
      // D7: no resample of an all-zero series has a Sharpe, so the point and the
      // interval are absent and the histogram is empty (no spike at 0).
      expect(Number.isNaN(zero.point)).toBe(true);
      expect(Number.isNaN(zero.lo)).toBe(true);
      expect(Number.isNaN(zero.hi)).toBe(true);
      expect(zero.hist.bins).toEqual([]);
      for (const id of YIELD_IDS) {
        const got = bootstrapCI(navConstantYield(CONSTANT_YIELDS[id], N), 200, 5, 42, periodsPerYear).sharpe;
        expect(got, id).toEqual(zero);
      }
    });
  }

  // D7 (founder, 2026-09-26), SFH-H1/WR-04: a resample with no dispersion has
  // no Sharpe and is left out of the distribution, never counted as 0. A sparse
  // series (one active day in 200) draws such resamples: 40 blocks of 5 miss the
  // active day about a third of the time.
  it("T15 a sparse series' null resamples are dropped from the histogram, not counted as 0", () => {
    const sparse = new Array(200).fill(0);
    sparse[57] = 0.01;
    const k = 500;
    const got = bootstrapCI(sparse, k, 5, 42, 365).sharpe;
    const counted = got.hist.bins.reduce((a, c) => a + c, 0);
    expect(counted).toBeGreaterThan(0);
    expect(counted).toBeLessThan(k);
    expect(Number.isFinite(got.lo)).toBe(true);
    expect(Number.isFinite(got.hi)).toBe(true);
    // Every resample that has a Sharpe here is positive (one positive day and
    // zeros), so a 0 in the interval could only be a fabricated null resample.
    expect(got.lo).toBeGreaterThan(0);
  });

  it(`T15 the Sharpe CI is "—" (NaN) below ${MIN_SHARPE_RESAMPLES} resamples with a Sharpe, finite at it`, () => {
    const below = bootstrapCI(NOISY_A, MIN_SHARPE_RESAMPLES - 1, 5, 42, 365).sharpe;
    expect(Number.isNaN(below.lo)).toBe(true);
    expect(Number.isNaN(below.hi)).toBe(true);
    expect(Number.isFinite(below.point)).toBe(true);
    const at = bootstrapCI(NOISY_A, MIN_SHARPE_RESAMPLES, 5, 42, 365).sharpe;
    expect(Number.isFinite(at.lo)).toBe(true);
    expect(Number.isFinite(at.hi)).toBe(true);
  });

  it("T15 cent-rounded 1% APY control keeps a finite, non-zero Sharpe point", () => {
    const got = bootstrapCI(CENT_CONTROL, 200, 5, 42, 365).sharpe;
    expect(Number.isFinite(got.point)).toBe(true);
    expect(got.point).not.toBe(0);
  });

  it("T15 noisy series keeps the bootstrap's own Sharpe arithmetic to the last bit", () => {
    // headlineStats divides by n (population) and uses (m * ppy) / (s * sqrt(ppy)).
    const ppy = 365;
    const m = mean(NOISY_A);
    const s = stdDev(NOISY_A, false);
    expect(bootstrapCI(NOISY_A, 50, 5, 42, ppy).sharpe.point).toBe((m * ppy) / (s * Math.sqrt(ppy)));
  });
});

describe("T14 computeOgHeadline (the computed arm, no persisted scalars): the OG card's Sharpe", () => {
  const rowsOf = (xs: number[]) => xs.map((value, i) => ({ date: DATES[i] as unknown, value }));

  for (const assetClass of ["crypto", "traditional"]) {
    it(`T14 constant yield's Sharpe is hidden (NaN) exactly as the all-zero series' (${assetClass})`, () => {
      const zero = computeOgHeadline(rowsOf(ZEROS), assetClass);
      expect(Number.isNaN(zero.sharpe)).toBe(true);
      for (const id of YIELD_IDS) {
        const got = computeOgHeadline(rowsOf(navConstantYield(CONSTANT_YIELDS[id], N)), assetClass);
        expect(got.sharpe, id).toBe(zero.sharpe);
      }
    });
  }

  it("T14 cent-rounded 1% APY control keeps a finite Sharpe on the card", () => {
    expect(Number.isFinite(computeOgHeadline(rowsOf(CENT_CONTROL), "crypto").sharpe)).toBe(true);
  });

  it("T14 noisy input: Sharpe in the card's own order, CAGR and max drawdown untouched", () => {
    const ppy = 365;
    const m = mean(NOISY_A);
    const s = stdDev(NOISY_A, false);
    // The drawdown and CAGR are not in the dispersion class: rebuild them here
    // the way the card does, so any change to that code goes red.
    let cum = 1;
    let peak = 1;
    let dd = 0;
    for (const r of NOISY_A) {
      cum *= 1 + r;
      if (cum > peak) peak = cum;
      const cur = cum / peak - 1;
      if (cur < dd) dd = cur;
    }
    const t0 = Date.parse(DATES[0]);
    const t1 = Date.parse(DATES[N - 1]);
    const years = (t1 - t0) / (365.25 * 86_400_000);
    const got = computeOgHeadline(rowsOf(NOISY_A), "crypto");
    expect(got.sharpe).toBe((m * ppy) / (s * Math.sqrt(ppy)));
    expect(got.maxDd).toBe(dd);
    expect(got.cagr).toBe(Math.pow(cum, 1 / years) - 1);
  });
});
