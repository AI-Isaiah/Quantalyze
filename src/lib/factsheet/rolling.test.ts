import { describe, it, expect } from "vitest";
import {
  rollingVol,
  rollingSharpe,
  rollingSortino,
  pickRollingWindow,
  ROLL_WINDOW_6MO,
  ROLL_WINDOW_90D,
  ROLL_WINDOW_30D,
  rollingCalendarStats,
} from "./rolling";

describe("rolling helpers", () => {
  const rets = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.005));

  it("rollingVol returns null until the window fills", () => {
    const v = rollingVol(rets);
    for (let i = 0; i < ROLL_WINDOW_6MO - 1; i++) expect(v[i]).toBeNull();
    expect(v[ROLL_WINDOW_6MO - 1]).not.toBeNull();
    expect(v[ROLL_WINDOW_6MO - 1]!).toBeGreaterThan(0);
  });

  it("rollingSharpe is finite and positive for a positive-drift series", () => {
    const s = rollingSharpe(rets);
    expect(s[ROLL_WINDOW_6MO - 1]!).toBeGreaterThan(0);
  });

  // Founder decision D7 (Phase 166.2 review round 2): a window with no losing
  // day has no Sortino. It is a gap (null), never a 0 the Rolling panel's "Now"
  // would print as "0.00".
  it("rollingSortino returns null when there are no negative returns in the window", () => {
    const allPos = Array.from({ length: 200 }, () => 0.001);
    const s = rollingSortino(allPos);
    expect(s[ROLL_WINDOW_6MO - 1]).toBeNull();
  });

  it("custom window size is respected", () => {
    const v = rollingVol(rets, 30);
    expect(v[28]).toBeNull();
    expect(v[29]).not.toBeNull();
  });

  // #597 — the annualization basis (periodsPerYear) threads through all three
  // rolling helpers. Default stays 252 (byte-identical to pre-#597); crypto
  // (365) scales every defined entry by √(365/252): vol = pstd·√N, Sharpe =
  // (m/s)·√N, Sortino = (m/rms)·√N all carry a single √N term.
  const k = Math.sqrt(365 / 252);

  it("default periodsPerYear is 252 (byte-identical to an explicit 252)", () => {
    expect(rollingVol(rets)).toEqual(rollingVol(rets, ROLL_WINDOW_6MO, 252));
    expect(rollingSharpe(rets)).toEqual(rollingSharpe(rets, ROLL_WINDOW_6MO, 252));
    expect(rollingSortino(rets)).toEqual(rollingSortino(rets, ROLL_WINDOW_6MO, 252));
  });

  it("crypto basis (365) scales vol/Sharpe/Sortino by √(365/252) on every defined entry", () => {
    const win = ROLL_WINDOW_6MO;
    const v252 = rollingVol(rets, win, 252);
    const v365 = rollingVol(rets, win, 365);
    const s252 = rollingSharpe(rets, win, 252);
    const s365 = rollingSharpe(rets, win, 365);
    const so252 = rollingSortino(rets, win, 252);
    const so365 = rollingSortino(rets, win, 365);
    let compared = 0;
    for (let i = 0; i < rets.length; i++) {
      if (v252[i] == null) {
        expect(v365[i]).toBeNull();
        continue;
      }
      expect(v365[i]!).toBeCloseTo(v252[i]! * k, 10);
      expect(s365[i]!).toBeCloseTo(s252[i]! * k, 10);
      expect(so365[i]!).toBeCloseTo(so252[i]! * k, 10);
      compared++;
    }
    // Non-vacuity: the 300-day fixture fills the 126-day window.
    expect(compared).toBeGreaterThan(0);
  });
});

describe("pickRollingWindow", () => {
  // Regression: factsheet showed empty rolling charts for short-history
  // strategies before pickRollingWindow added a 6mo → 30d fallback.
  // Found by /qa on 2026-05-20.
  it("picks 6mo at the lower boundary (length === 126 + 5)", () => {
    expect(pickRollingWindow(ROLL_WINDOW_6MO + 5)).toEqual({
      window: ROLL_WINDOW_6MO,
      label: "6mo",
      enough: true,
    });
  });

  it("falls back to 30d one observation short of the 6mo threshold", () => {
    expect(pickRollingWindow(ROLL_WINDOW_6MO + 4)).toEqual({
      window: ROLL_WINDOW_30D,
      label: "30d",
      enough: true,
    });
  });

  it("signals enough=false when even the smallest tier can't be filled", () => {
    expect(pickRollingWindow(ROLL_WINDOW_30D + 4)).toEqual({
      window: ROLL_WINDOW_30D,
      label: "30d",
      enough: false,
    });
  });

  it("returns the last tier with enough=false for a degenerate length of 0", () => {
    expect(pickRollingWindow(0)).toEqual({
      window: ROLL_WINDOW_30D,
      label: "30d",
      enough: false,
    });
  });

  it("honors custom tier ladders (rolling β uses 90d → 30d)", () => {
    const tiers = [
      { window: ROLL_WINDOW_90D, label: "90d" },
      { window: ROLL_WINDOW_30D, label: "30d" },
    ];
    expect(pickRollingWindow(ROLL_WINDOW_90D + 5, tiers)).toMatchObject({
      window: ROLL_WINDOW_90D,
      enough: true,
    });
    expect(pickRollingWindow(ROLL_WINDOW_90D + 4, tiers)).toMatchObject({
      window: ROLL_WINDOW_30D,
      enough: true,
    });
    expect(pickRollingWindow(ROLL_WINDOW_30D + 4, tiers)).toMatchObject({
      enough: false,
    });
  });
});

/**
 * Phase 236 plan 05 (FIG-01, F-5 "ddof 1 everywhere"; closes A-194-D14-02): the 126- and 30-row
 * windows are on the SAMPLE sd, the same one the 365-day calendar window has always used.
 *
 * THE ORACLE IS NOT THE IMPLEMENTATION: sums of squares are written out here and nothing is
 * imported from return-stats.ts or figure-conventions.ts.
 */
describe("rolling windows on the sample sd (F-5)", () => {
  /** Alternating +0.02 / -0.01: in any even window every deviation is exactly +-0.015. */
  const alt = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 0.02 : -0.01));

  function sampleVol(xs: number[], ppy: number): number {
    let t = 0;
    for (const x of xs) t += x;
    const m = t / xs.length;
    let ss = 0;
    for (const x of xs) ss += (x - m) * (x - m);
    return Math.sqrt(ss / (xs.length - 1)) * Math.sqrt(ppy);
  }

  it("the 126-row vol point is the sample sd x sqrt(periods): 0.015 x sqrt(126/125) x sqrt(252)", () => {
    // 126 rows: sum of squares = 126 x 0.015^2; divided by n - 1 = 125, not n = 126.
    const v = rollingVol(alt, 126, 252);
    expect(v[125]).toBeCloseTo(0.015 * Math.sqrt(126 / 125) * Math.sqrt(252), 12);
    expect(v[125]).toBeCloseTo(sampleVol(alt.slice(0, 126), 252), 12);
  });

  it("the 30-row Sharpe point is mean x N / (sample sd x sqrt(N))", () => {
    const s = rollingSharpe(alt, 30, 252);
    const w = alt.slice(0, 30);
    const sd = sampleVol(w, 1);
    expect(s[29]).toBeCloseTo((0.005 / sd) * Math.sqrt(252), 12);
    // Not the population reading: 0.005 / 0.015 x sqrt(252).
    expect(Math.abs(s[29]! - (0.005 / 0.015) * Math.sqrt(252))).toBeGreaterThan(1e-3);
  });

  it("a 126-row window and a 126-day calendar window read ONE sd on the same returns", () => {
    // 126 consecutive daily dates: the calendar window at the last date holds exactly the 126
    // returns a 126-row window holds. Before F-5 the row window divided by n and the calendar
    // one by n - 1 (A-194-D14-02), so the two disagreed by sqrt(126/125).
    const rets = alt.slice(0, 126);
    const dates = rets.map((_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
    const cal = rollingCalendarStats(rets, dates, 126, 252);
    expect(cal.vol[125]).not.toBeNull();
    expect(rollingVol(rets, 126, 252)[125]).toBeCloseTo(cal.vol[125]!, 12);
    expect(rollingSharpe(rets, 126, 252)[125]).toBeCloseTo(cal.sharpe[125]!, 12);
  });
});
