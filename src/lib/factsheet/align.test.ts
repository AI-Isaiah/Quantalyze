import { describe, it, expect } from "vitest";
import { alignReturns } from "./align";

describe("alignReturns", () => {
  it("forward-fills benchmark prices over strategy date gaps", () => {
    const prices = [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-03", close: 110 },
    ];
    const rets = alignReturns(prices, ["2024-01-01", "2024-01-02", "2024-01-03"]);
    expect(rets[0]).toBe(0);
    expect(rets[1]).toBe(0); // forward-fill keeps prior price → 0 return
    expect(rets[2]).toBeCloseTo(0.1, 12);
  });

  it("returns 0 for first day", () => {
    expect(alignReturns([{ date: "2024-01-01", close: 50 }], ["2024-01-01"])).toEqual([0]);
  });

  it("returns 0 when prior price is unavailable", () => {
    const rets = alignReturns(
      [{ date: "2024-01-02", close: 100 }],
      ["2024-01-01", "2024-01-02"],
    );
    expect(rets[0]).toBe(0);
    expect(rets[1]).toBe(0);
  });
});
