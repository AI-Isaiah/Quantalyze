import { describe, expect, it } from "vitest";
import { computeWinnersLosers } from "./winners-losers";
import type { AttributionRow } from "./types";

function row(
  strategy_id: string,
  strategy_name: string,
  contribution: number,
): AttributionRow {
  return { strategy_id, strategy_name, contribution, allocation_effect: 0 };
}

describe("computeWinnersLosers", () => {
  it("returns empty arrays for null input", () => {
    expect(computeWinnersLosers(null)).toEqual({ winners: [], losers: [] });
  });

  it("returns empty arrays for empty array", () => {
    expect(computeWinnersLosers([])).toEqual({ winners: [], losers: [] });
  });

  it("splits positive and negative contributions", () => {
    const result = computeWinnersLosers([
      row("a", "Alpha", 0.05),
      row("b", "Beta", -0.03),
      row("c", "Gamma", 0.02),
      row("d", "Delta", -0.01),
    ]);
    expect(result.winners.map((w) => w.strategy_name)).toEqual([
      "Alpha",
      "Gamma",
    ]);
    expect(result.losers.map((l) => l.strategy_name)).toEqual([
      "Beta",
      "Delta",
    ]);
  });

  it("caps both arrays at the count option", () => {
    const result = computeWinnersLosers(
      [
        row("a", "A", 0.05),
        row("b", "B", 0.04),
        row("c", "C", 0.03),
        row("d", "D", 0.02),
        row("e", "E", -0.01),
        row("f", "F", -0.02),
        row("g", "G", -0.03),
        row("h", "H", -0.04),
      ],
      { count: 2 },
    );
    expect(result.winners.map((w) => w.strategy_name)).toEqual(["A", "B"]);
    expect(result.losers.map((l) => l.strategy_name)).toEqual(["H", "G"]);
  });

  it("excludes zero contributions entirely", () => {
    const result = computeWinnersLosers([
      row("a", "Alpha", 0.05),
      row("b", "Beta", 0),
      row("c", "Gamma", -0.03),
    ]);
    expect(result.winners).toHaveLength(1);
    expect(result.losers).toHaveLength(1);
    expect(result.winners[0].strategy_name).toBe("Alpha");
    expect(result.losers[0].strategy_name).toBe("Gamma");
  });

  it("breaks ties deterministically by strategy_id", () => {
    const result = computeWinnersLosers([
      row("z", "Zeta", 0.04),
      row("a", "Alpha", 0.04),
      row("m", "Mu", 0.04),
    ]);
    expect(result.winners.map((w) => w.strategy_id)).toEqual(["a", "m", "z"]);
  });

  it("returns fewer than `count` when fewer positives exist", () => {
    const result = computeWinnersLosers([
      row("a", "Alpha", 0.05),
      row("b", "Beta", -0.04),
      row("c", "Gamma", -0.03),
    ]);
    expect(result.winners).toHaveLength(1);
    expect(result.losers).toHaveLength(2);
  });

  it("returns winners only when there are no losers", () => {
    const result = computeWinnersLosers([
      row("a", "Alpha", 0.05),
      row("b", "Beta", 0.03),
    ]);
    expect(result.winners.map((w) => w.strategy_name)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(result.losers).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input: AttributionRow[] = [
      row("a", "Alpha", 0.02),
      row("b", "Beta", 0.05),
    ];
    const before = input.map((r) => r.strategy_id).join(",");
    computeWinnersLosers(input);
    const after = input.map((r) => r.strategy_id).join(",");
    expect(after).toBe(before);
  });
});
