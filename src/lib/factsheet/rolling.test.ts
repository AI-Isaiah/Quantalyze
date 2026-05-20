import { describe, it, expect } from "vitest";
import { rollingVol, rollingSharpe, rollingSortino, ROLL_WINDOW_6MO } from "./rolling";

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
