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

  it("T13 non-finite input keeps today's sharpe", () => {
    // Today: a NaN return makes the population sd NaN, `s > 0` is false and the
    // Sharpe is 0. sharpe() answers null on a non-finite input and compute must
    // keep answering that as 0 (D-17 I3), never as NaN or a number.
    const xs = NOISY_A.slice();
    xs[100] = NaN;
    const s = stdDev(xs, false);
    const todays = s > 0 ? Number.NaN : 0;
    expect(compute(xs, DATES, 0, 365).sharpe).toBe(todays);
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
    for (const id of ["daily_1e-4", "apy_5pct", "apy_100pct"]) {
      const got = payloadOf(navConstantYield(CONSTANT_YIELDS[id], N)).strategyMetrics;
      expect(got.sharpe, id).toBe(zero.sharpe);
      expect(got.skew, id).toBe(zero.skew);
      expect(got.kurt, id).toBe(zero.kurt);
      expect(got.ann_vol, id).toBe(zero.ann_vol);
    }
  });
});
