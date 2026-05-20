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
