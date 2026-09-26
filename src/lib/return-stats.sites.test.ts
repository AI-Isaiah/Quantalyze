/**
 * Site tests T1-T5 for Phase 166.2 plan 01: each Tier-2 site that computes a
 * Sharpe, correlation or diversification ratio from daily returns must answer
 * a compounding-NAV constant yield EXACTLY as it answers an all-zero series of
 * the same length (Phase 166.1 D-07), because that site now computes through
 * `src/lib/return-stats.ts` (D-17).
 *
 * Why it matters: before the fix each site passed its own `> 0` guard on a
 * residue sd of about 1.3e-16 and showed a Sharpe of 1e12 to 1e14, or a residue
 * correlation, to an allocator. The cent-rounded 1% APY NAV is the control on
 * the other side of the floor: its dispersion is real, so its ratio must stay a
 * finite number, and widening the floor goes red.
 *
 * Expected values are never hard-coded: each test computes the site's output on
 * the all-zero input and asserts the constant-yield output identical to it.
 */
import { describe, it, expect } from "vitest";
import { reconstructAndAnalyze } from "@/app/(dashboard)/compare/lib/holding-compare-adapter";
import {
  CONSTANT_YIELDS,
  apyToDaily,
  navLevelsConstantYield,
} from "@/__tests__/fixtures/dispersion-nav";

const YIELD_IDS = Object.keys(CONSTANT_YIELDS);

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

/** Equity snapshots whose `symbol` breakdown walks through `levels`. */
function snapshotsFromLevels(levels: number[], symbol = "USDC") {
  const dates = isoDates(levels.length);
  return levels.map((v, i) => ({ asof: dates[i], breakdown: { [symbol]: v } }));
}

describe("T1 reconstructAndAnalyze (holding Sharpe on /compare)", () => {
  const FLAT = snapshotsFromLevels(new Array(367).fill(10_000));

  it.each(YIELD_IDS)("%s: sharpe is identical to the flat-NAV holding's", (id) => {
    const got = reconstructAndAnalyze(
      snapshotsFromLevels(navLevelsConstantYield(CONSTANT_YIELDS[id])),
      "USDC",
    );
    const flat = reconstructAndAnalyze(FLAT, "USDC");
    expect(Object.is(got.sharpe, flat.sharpe), `sharpe=${got.sharpe}`).toBe(true);
  });

  it("the cent-rounded 1% APY NAV keeps a finite sharpe", () => {
    const a = reconstructAndAnalyze(
      snapshotsFromLevels(navLevelsConstantYield(apyToDaily(0.01), 366, 10_000, true)),
      "USDC",
    );
    expect(a.sharpe).not.toBeNull();
    expect(Number.isFinite(a.sharpe!)).toBe(true);
  });

  it("cumulative_return, max_drawdown and vol keep today's formula on a noisy NAV, bitwise", () => {
    const levels: number[] = [10_000];
    for (let i = 1; i < 200; i++) {
      levels.push(levels[i - 1] * (1 + 0.001 + 0.02 * Math.sin(i * 1.7 + 0.3)));
    }
    const a = reconstructAndAnalyze(snapshotsFromLevels(levels), "USDC");
    const returns = levels.slice(1).map((v, i) => v / levels[i] - 1);
    const n = returns.length;
    const m = returns.reduce((x, y) => x + y, 0) / n;
    const std = Math.sqrt(returns.reduce((x, y) => x + (y - m) ** 2, 0) / n);
    let peak = levels[0];
    let maxDD = 0;
    for (const v of levels) {
      if (v > peak) peak = v;
      const dd = (v - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }
    expect(Object.is(a.vol, std * Math.sqrt(365))).toBe(true);
    expect(Object.is(a.cumulative_return, returns.reduce((acc, r) => acc * (1 + r), 1) - 1)).toBe(true);
    expect(Object.is(a.max_drawdown, maxDD)).toBe(true);
    // The Sharpe moves from (mean / std) * sqrt(365) to the factsheet order,
    // the same number to rounding.
    expect(a.sharpe!).toBeCloseTo((m / std) * Math.sqrt(365), 10);
  });
});
