import { describe, it, expect } from "vitest";
import { buildComparatorBlock } from "./comparator-block";
import { jointMetrics } from "./joint";
import { cumEq } from "./compute";
import { CONSTANT_YIELDS, navConstantYield } from "@/__tests__/fixtures/dispersion-nav";

/**
 * Phase 164.6.6.3.3 FACTSHEETTRUTH, D-04 (B13). A strategy leg with no
 * dispersion has no beta, no alpha, no information ratio and no capture to
 * report: `beta()` answers 0 for the allocation math, and every figure built on
 * that 0 (alpha equal to the leg's own annualised mean, an IR number, captures of
 * 0) is a number the data cannot support. The FACTSHEET block therefore carries
 * NaN for exactly those five and the present-only marker `flatLeg: true`, which
 * the strip and section IV read to say why.
 *
 * The gate lives in `buildComparatorBlock`, never in `jointMetrics`: the
 * Allocations alpha/beta widget calls `jointMetrics` and
 * `return-stats.sites-joint.test.ts` T16 pins its beta at exactly +0 for a flat
 * strategy. The contrast test below fails if the gate ever moves inside it.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const N = 60;
const PPY = 365;
const dates = Array.from({ length: N }, (_, i) => addDays("2025-01-01", i));
const bench = dates.map((_, i) => ((i % 7) - 3) / 250);
const dispersing = dates.map((_, i) => ((i % 5) - 2) / 400);
const FLAT_KEYS = ["beta", "alpha", "info_ratio", "up_capture", "down_capture"] as const;

function block(strat: number[], b: number[] = bench, d: string[] = dates) {
  return buildComparatorBlock("BTC-USD", "BTC", b, strat, cumEq(strat), d, 0.2, 30, 60, PPY, PPY);
}

describe("a strategy leg with no dispersion reads no joint figure (D-04, B13)", () => {
  const flatLegs: Array<[string, number[]]> = [
    ["an all-zero leg", dates.map(() => 0)],
    ...Object.entries(CONSTANT_YIELDS)
      .filter(([id]) => ["daily_1e-4", "apy_5pct", "apy_100pct"].includes(id))
      .map(([id, y]): [string, number[]] => [`a compounding constant yield (${id})`, navConstantYield(y, N)]),
  ];

  for (const [name, strat] of flatLegs) {
    it(`${name}: beta, alpha, info_ratio and both captures are NaN and the block says flatLeg`, () => {
      const b = block(strat);
      expect(b.joint).not.toBeNull();
      for (const k of FLAT_KEYS) expect(Number.isNaN(b.joint![k]), `${k}=${b.joint![k]}`).toBe(true);
      expect(b.flatLeg).toBe(true);
      expect(b.jointWithheld).toBeNull();
    });

    it(`${name}: tracking_error is the real measurement and corr, r2 and treynor are as jointMetrics gives them`, () => {
      const b = block(strat);
      const ref = jointMetrics(strat, bench, 0, PPY);
      expect(Number.isFinite(b.joint!.tracking_error)).toBe(true);
      expect(b.joint!.tracking_error).toBe(ref.tracking_error);
      for (const k of ["corr", "r2", "treynor"] as const) {
        expect(Object.is(b.joint![k], ref[k]), k).toBe(true);
      }
    });
  }

  it("a dispersing leg's joint equals jointMetrics on the same inputs and carries no flatLeg key", () => {
    const b = block(dispersing);
    expect(b.joint).toEqual(jointMetrics(dispersing, bench, 0, PPY));
    expect("flatLeg" in b).toBe(false);
    for (const k of FLAT_KEYS) expect(Number.isFinite(b.joint![k]), k).toBe(true);
  });

  it("contrast (T16 split): jointMetrics itself still answers beta exactly +0 for the same flat leg, so the Allocations widget is untouched", () => {
    const zeros = dates.map(() => 0);
    const raw = jointMetrics(zeros, bench, 0, PPY);
    expect(Object.is(raw.beta, 0)).toBe(true);
    expect(Number.isNaN(raw.alpha)).toBe(false);
    // ...while the factsheet block for that very leg withholds it.
    expect(Number.isNaN(block(zeros).joint!.beta)).toBe(true);
  });

  it("the gate judges the PAIRED slice: a leg that moves only on unpaired days is flat on the pairs", () => {
    // The comparator has no return on days 0..29; the strategy moves only there.
    const partialBench: Array<number | null> = bench.map((r, i) => (i < 30 ? null : r));
    const strat = dates.map((_, i) => (i < 30 ? ((i % 5) - 2) / 400 : 0));
    const b = buildComparatorBlock("S&P 500", "SPX", partialBench, strat, cumEq(strat), dates, 0.2, 30, 60, PPY, PPY);
    expect(b.joint).not.toBeNull();
    expect(b.flatLeg).toBe(true);
    for (const k of FLAT_KEYS) expect(Number.isNaN(b.joint![k]), k).toBe(true);
  });

  it("a windowed slice that is flat gates on its own slice; the full record that moves does not", () => {
    const strat = dates.map((_, i) => (i < 30 ? ((i % 5) - 2) / 400 : 0));
    expect("flatLeg" in block(strat)).toBe(false);
    const tail = block(strat.slice(30), bench.slice(30), dates.slice(30));
    expect(tail.flatLeg).toBe(true);
    expect(Number.isNaN(tail.joint!.beta)).toBe(true);
  });

  it("below the paired floor there is no joint and no flatLeg marker (the floor wins)", () => {
    const few = dates.slice(0, 5);
    const zeros = few.map(() => 0);
    const b = block(zeros, bench.slice(0, 5), few);
    expect(b.joint).toBeNull();
    expect(b.jointWithheld).not.toBeNull();
    expect("flatLeg" in b).toBe(false);
  });
});
