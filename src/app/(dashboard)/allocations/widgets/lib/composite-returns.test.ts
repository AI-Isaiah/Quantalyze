import { describe, it, expect } from "vitest";
import { buildCompositeReturns } from "./composite-returns";

describe("buildCompositeReturns", () => {
  it("produces weighted average from 2 strategies", () => {
    const strategies = [
      {
        strategy: {
          strategy_analytics: {
            daily_returns: [
              { date: "2024-01-01", value: 0.02 },
              { date: "2024-01-02", value: 0.04 },
            ],
          },
        },
        weight: 0.6,
      },
      {
        strategy: {
          strategy_analytics: {
            daily_returns: [
              { date: "2024-01-01", value: 0.10 },
              { date: "2024-01-02", value: -0.02 },
            ],
          },
        },
        weight: 0.4,
      },
    ];

    const result = buildCompositeReturns(strategies);

    expect(result).toHaveLength(2);

    // Day 1: (0.02 * 0.6 + 0.10 * 0.4) / (0.6 + 0.4) = (0.012 + 0.04) / 1 = 0.052
    expect(result[0].date).toBe("2024-01-01");
    expect(result[0].value).toBeCloseTo(0.052, 6);

    // Day 2: (0.04 * 0.6 + -0.02 * 0.4) / 1 = (0.024 - 0.008) / 1 = 0.016
    expect(result[1].date).toBe("2024-01-02");
    expect(result[1].value).toBeCloseTo(0.016, 6);
  });

  it("returns empty array for empty strategies", () => {
    expect(buildCompositeReturns([])).toEqual([]);
  });

  it("excludes strategies with zero weight", () => {
    const strategies = [
      {
        strategy: {
          strategy_analytics: {
            daily_returns: [
              { date: "2024-01-01", value: 0.05 },
            ],
          },
        },
        weight: 0,
      },
      {
        strategy: {
          strategy_analytics: {
            daily_returns: [
              { date: "2024-01-01", value: 0.10 },
            ],
          },
        },
        weight: 0.5,
      },
    ];

    const result = buildCompositeReturns(strategies);

    expect(result).toHaveLength(1);
    // Only the second strategy contributes (weight 0.5)
    // 0.10 * 0.5 / 0.5 = 0.10
    expect(result[0].value).toBeCloseTo(0.10, 6);
  });

  it("returns empty when all weights are zero", () => {
    const strategies = [
      {
        strategy: {
          strategy_analytics: {
            daily_returns: [{ date: "2024-01-01", value: 0.05 }],
          },
        },
        weight: 0,
      },
    ];

    expect(buildCompositeReturns(strategies)).toEqual([]);
  });

  it("returns sorted dates", () => {
    const strategies = [
      {
        strategy: {
          strategy_analytics: {
            daily_returns: [
              { date: "2024-01-03", value: 0.01 },
              { date: "2024-01-01", value: 0.02 },
              { date: "2024-01-02", value: 0.03 },
            ],
          },
        },
        weight: 1,
      },
    ];

    const result = buildCompositeReturns(strategies);
    expect(result.map((d) => d.date)).toEqual([
      "2024-01-01",
      "2024-01-02",
      "2024-01-03",
    ]);
  });
});
