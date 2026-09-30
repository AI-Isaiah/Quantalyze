import { describe, it, expect } from "vitest";
import { computeEventSignatures } from "./event-signatures";
import { cumEq } from "./compute";

describe("computeEventSignatures", () => {
  // Build a 50-day toy series where every other day is +1%, -1% alternating.
  // Window=14 → only indices 14..35 are eligible events. Total = 22 events.
  // Sign alternates, so wins=11, losses=11 at 1d horizon.
  const N = 50;
  const stratRet = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
  const benchRet = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 0.005 : -0.005));
  const equity = cumEq(stratRet);

  const sigs = computeEventSignatures(stratRet, benchRet, equity);

  it("counts win/loss events at 1d horizon", () => {
    expect(sigs.h1.winCount).toBe(11);
    expect(sigs.h1.lossCount).toBe(11);
  });

  it("anchors mean trajectory at 0 on the event day (t=WINDOW)", () => {
    // By construction the rebased trace at t=14 is always 0.
    expect(sigs.h1.winOfBenchmark.mean[14]).toBeCloseTo(0, 8);
    expect(sigs.h1.winOfEquity.mean[14]).toBeCloseTo(0, 8);
    expect(sigs.h1.lossOfBenchmark.mean[14]).toBeCloseTo(0, 8);
    expect(sigs.h1.lossOfEquity.mean[14]).toBeCloseTo(0, 8);
  });

  it("produces 29-point traces (±14d window)", () => {
    expect(sigs.h1.winOfBenchmark.mean).toHaveLength(29);
    expect(sigs.h1.winOfBenchmark.median).toHaveLength(29);
    expect(sigs.h1.winOfBenchmark.p25).toHaveLength(29);
    expect(sigs.h1.winOfBenchmark.p75).toHaveLength(29);
    expect(sigs.h1.winOfBenchmark.p05).toHaveLength(29);
    expect(sigs.h1.winOfBenchmark.p95).toHaveLength(29);
  });

  it("p25 ≤ median ≤ p75 at every offset", () => {
    const s = sigs.h1.winOfBenchmark;
    for (let t = 0; t < 29; t++) {
      expect(s.p25[t]).toBeLessThanOrEqual(s.median[t] + 1e-9);
      expect(s.median[t]).toBeLessThanOrEqual(s.p75[t] + 1e-9);
    }
  });

  it("p05 ≤ p25 and p75 ≤ p95 at every offset", () => {
    const s = sigs.h7.lossOfEquity;
    for (let t = 0; t < 29; t++) {
      expect(s.p05[t]).toBeLessThanOrEqual(s.p25[t] + 1e-9);
      expect(s.p75[t]).toBeLessThanOrEqual(s.p95[t] + 1e-9);
    }
  });

  it("7d horizon skips the first 6 indices (no trailing window)", () => {
    // With 50-day input, eligible 7d-event indices = [6..N-1-14] = [6..35] = 30 indices.
    // At i=6..35, trailing-7 cumulative product is positive/negative depending on
    // start parity. We just assert wins + losses sums correctly under window cutoff.
    expect(sigs.h7.winCount + sigs.h7.lossCount).toBeGreaterThan(0);
    expect(sigs.h7.winCount + sigs.h7.lossCount).toBeLessThanOrEqual(30);
  });

  it("skips events at the series boundary (no padding)", () => {
    // 30-day series with a +1% return at every index. Event-test fires on every
    // index (positive return). Boundary indices 0..13 and 16..29 must yield no
    // trace — only 14, 15 are window-eligible (need ±14d coverage). So only the
    // first eligible win event populates aggregation; many more are eligible
    // events but edge-dropped.
    const r = Array.from({ length: 30 }, () => 0.01);
    const out = computeEventSignatures(r, r, cumEq(r));
    expect(out.h1.eligibleWinCount).toBe(30);
    // Only indices 14, 15 have a full ±14d window inside [0, 29].
    expect(out.h1.winCount).toBe(2);
    expect(out.h1.eligibleWinCount).toBeGreaterThan(out.h1.winCount);
  });

  it("drops traces poisoned by a −100% return (delisting day)", () => {
    // 50-day +1% series with one catastrophic -1.0 return at index 7.
    // Without the guard, the backward walk through index 7 produces Infinity
    // and NaN-poisons every percentile column.
    const r = Array.from({ length: 50 }, (_, i) => (i === 7 ? -1 : 0.01));
    const out = computeEventSignatures(r, r, cumEq(r).map(x => Math.max(x, 1e-9)));
    // Every aggregated number must be finite — no NaN, no Infinity.
    const s = out.h1.winOfBenchmark;
    for (let t = 0; t < 29; t++) {
      expect(Number.isFinite(s.mean[t])).toBe(true);
      expect(Number.isFinite(s.p95[t])).toBe(true);
    }
  });
});

/**
 * Phase 169.4 ALLOCTRUTH plan 05 (169.5 D-65, 169.4 D-70(1)): a comparator null is a
 * day with no data, never a 0% day. An event whose verdict reads a null is skipped;
 * a trace whose window reads a null is dropped, like an edge event. The
 * trace reads the 28 daily returns at indices eventIdx-13 .. eventIdx+14 (the
 * point at -14 is the close ending day eventIdx-14, so that day's own return is
 * not part of any trace).
 */
describe("computeEventSignatures: a comparator null is skipped, never read as 0 (D-65, D-70(1))", () => {
  const N = 80;
  const J = 40; // the one null
  const nullAsZero = (a: ReadonlyArray<number | null>) => a.map((r) => r ?? 0);

  it("strategy-driven: a null in the benchmark drops exactly the benchmark traces that read it; equity traces are unchanged", () => {
    const strat = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const benchDense = Array.from({ length: N }, (_, i) => (i % 3 === 0 ? 0.004 : -0.002));
    const bench: Array<number | null> = benchDense.map((r, i) => (i === J ? null : r));
    const eq = cumEq(strat);
    const honest = computeEventSignatures(strat, bench, eq);
    const dense = computeEventSignatures(strat, benchDense, eq);
    // Window-eligible events are 14..65 (52). Those reading index 40 are 26..53 (28).
    expect(dense.h1.winCount + dense.h1.lossCount).toBe(52);
    expect(honest.h1.winCount + honest.h1.lossCount).toBe(52 - 28);
    // The verdict reads only the strategy, so the eligible population is unchanged ...
    expect(honest.h1.eligibleWinCount).toBe(dense.h1.eligibleWinCount);
    // ... and so are the equity traces (the strategy carries no null).
    expect(honest.h1.winOfEquity).toEqual(dense.h1.winOfEquity);
    expect(honest.h7.lossOfEquity).toEqual(dense.h7.lossOfEquity);
    // The same series 0-filled keeps all 52: the null would have been a flat day.
    const zeroFilled = computeEventSignatures(strat, nullAsZero(bench), eq);
    expect(zeroFilled.h1.winCount + zeroFilled.h1.lossCount).toBe(52);
  });

  it("benchmark-driven: an event at a null, an h7 event whose trailing 7 hold a null, and an equity trace reading a null are all skipped", () => {
    // Every day +1% except one null: every surviving equity trace is exactly
    // 1.01^(t-14) - 1, so any trace built across a 0-filled day shows up as a
    // spread between p05 and p95.
    const ret: Array<number | null> = Array.from({ length: N }, (_, i) => (i === J ? null : 0.01));
    const out = computeEventSignatures(ret, ret, cumEq(nullAsZero(ret)));

    // h1: the event AT the null is skipped (79 eligible), and the traces reading it
    // are dropped (52 - 28 = 24 benchmark traces).
    expect(out.h1.eligibleWinCount).toBe(N - 1);
    expect(out.h1.eligibleLossCount).toBe(0);
    expect(out.h1.winCount).toBe(24);
    // h7: indices 6..79 have a trailing window (74); those whose trailing 7 hold
    // index 40 are 40..46 (7), skipped rather than read as a 0% day.
    expect(out.h7.eligibleWinCount).toBe(74 - 7);
    // Equity traces: none reads the null, so every one is the exact +1% path.
    for (const s of [out.h1.winOfEquity, out.h7.winOfEquity]) {
      for (let t = 0; t < 29; t++) {
        expect(s.p05[t], `t=${t}`).toBeCloseTo(s.p95[t], 12);
        expect(s.mean[t], `t=${t}`).toBeCloseTo(Math.pow(1.01, t - 14) - 1, 12);
      }
    }
  });
});
