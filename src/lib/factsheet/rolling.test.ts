import { describe, it, expect } from "vitest";
import {
  rollingVol,
  rollingSharpe,
  rollingSortino,
  pickRollingWindow,
  ROLL_WINDOW_6MO,
  ROLL_WINDOW_90D,
  ROLL_WINDOW_30D,
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

  it("rollingSortino returns 0 when there are no negative returns in the window", () => {
    const allPos = Array.from({ length: 200 }, () => 0.001);
    const s = rollingSortino(allPos);
    expect(s[ROLL_WINDOW_6MO - 1]).toBe(0);
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
