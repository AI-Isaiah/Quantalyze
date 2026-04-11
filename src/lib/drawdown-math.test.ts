import { describe, it, expect } from "vitest";
import { segmentDrawdowns } from "./drawdown-math";
import type { TimeSeriesPoint } from "./types";

// Helper: build a drawdown series from (date, value) tuples so tests stay
// readable. Values follow the quantstats `to_drawdown_series` convention
// (≤ 0, with 0 meaning "at a new high").
function series(...points: [string, number][]): TimeSeriesPoint[] {
  return points.map(([date, value]) => ({ date, value }));
}

describe("segmentDrawdowns", () => {
  it("returns [] for empty input", () => {
    expect(segmentDrawdowns([])).toEqual([]);
  });

  it("returns [] for a single point", () => {
    expect(segmentDrawdowns(series(["2024-01-01", 0]))).toEqual([]);
  });

  it("returns [] for an all-zero series", () => {
    expect(
      segmentDrawdowns(
        series(
          ["2024-01-01", 0],
          ["2024-01-02", 0],
          ["2024-01-03", 0],
        ),
      ),
    ).toEqual([]);
  });

  it("segments three distinct recovered episodes and sorts deepest first", () => {
    const episodes = segmentDrawdowns(
      series(
        ["2024-01-01", 0],
        ["2024-01-02", -0.05],
        ["2024-01-03", -0.10], // episode 1 trough
        ["2024-01-04", -0.06],
        ["2024-01-05", 0], // episode 1 recovery
        ["2024-01-06", 0],
        ["2024-01-07", -0.02], // episode 2 trough (smallest)
        ["2024-01-08", -0.01],
        ["2024-01-09", 0], // episode 2 recovery
        ["2024-01-10", 0],
        ["2024-01-11", -0.07],
        ["2024-01-12", -0.08], // episode 3 trough
        ["2024-01-13", -0.04],
        ["2024-01-14", 0], // episode 3 recovery
      ),
    );
    expect(episodes).toHaveLength(3);
    // Sorted deepest first by |depth|: -0.10, -0.08, -0.02.
    expect(episodes[0].depthPct).toBeCloseTo(-0.10, 10);
    expect(episodes[1].depthPct).toBeCloseTo(-0.08, 10);
    expect(episodes[2].depthPct).toBeCloseTo(-0.02, 10);
    // No spurious merging: episode 1's trough is Jan 3, episode 3's trough is Jan 12.
    expect(episodes[0].troughDate).toBe("2024-01-03");
    expect(episodes[0].peakDate).toBe("2024-01-01");
    expect(episodes[0].recoveryDate).toBe("2024-01-05");
    expect(episodes[0].isCurrent).toBe(false);
    expect(episodes[1].troughDate).toBe("2024-01-12");
    expect(episodes[1].peakDate).toBe("2024-01-10");
    expect(episodes[1].recoveryDate).toBe("2024-01-14");
    expect(episodes[2].troughDate).toBe("2024-01-07");
  });

  it("marks the final episode as ongoing when the series ends in drawdown", () => {
    const episodes = segmentDrawdowns(
      series(
        ["2024-01-01", 0],
        ["2024-01-02", -0.05],
        ["2024-01-03", -0.10],
        ["2024-01-04", 0], // episode 1 recovery
        ["2024-01-05", -0.03],
        ["2024-01-06", -0.08], // ongoing trough, no recovery after
      ),
    );
    expect(episodes).toHaveLength(2);
    // Sorted deepest first: -0.10, -0.08.
    expect(episodes[0].isCurrent).toBe(false);
    expect(episodes[0].recoveryDate).toBe("2024-01-04");
    const ongoing = episodes[1];
    expect(ongoing.isCurrent).toBe(true);
    expect(ongoing.recoveryDate).toBeNull();
    expect(ongoing.peakDate).toBe("2024-01-04");
    expect(ongoing.troughDate).toBe("2024-01-06");
    expect(ongoing.depthPct).toBeCloseTo(-0.08, 10);
  });

  it("filters tiny drawdowns below the 0.5% default threshold", () => {
    const episodes = segmentDrawdowns(
      series(
        ["2024-01-01", 0],
        ["2024-01-02", -0.003], // tiny, <0.5%, filtered
        ["2024-01-03", 0],
        ["2024-01-04", -0.02], // kept
        ["2024-01-05", 0],
      ),
    );
    expect(episodes).toHaveLength(1);
    expect(episodes[0].depthPct).toBeCloseTo(-0.02, 10);
    expect(episodes[0].troughDate).toBe("2024-01-04");
  });

  it("respects a custom minDepth threshold", () => {
    // Default threshold would keep both; minDepth=0.015 filters the -0.01 one.
    const raw = series(
      ["2024-01-01", 0],
      ["2024-01-02", -0.01], // depth 0.01
      ["2024-01-03", 0],
      ["2024-01-04", -0.02], // depth 0.02
      ["2024-01-05", 0],
    );
    const defaultEpisodes = segmentDrawdowns(raw);
    expect(defaultEpisodes).toHaveLength(2);

    const strictEpisodes = segmentDrawdowns(raw, 0.015);
    expect(strictEpisodes).toHaveLength(1);
    expect(strictEpisodes[0].depthPct).toBeCloseTo(-0.02, 10);
  });

  it("computes durationDays from peak to recovery", () => {
    // Peak 2024-01-01, recovery 2024-01-15 → 14 days.
    const episodes = segmentDrawdowns(
      series(
        ["2024-01-01", 0],
        ["2024-01-05", -0.05],
        ["2024-01-08", -0.10],
        ["2024-01-12", -0.04],
        ["2024-01-15", 0],
      ),
    );
    expect(episodes).toHaveLength(1);
    expect(episodes[0].peakDate).toBe("2024-01-01");
    expect(episodes[0].recoveryDate).toBe("2024-01-15");
    expect(episodes[0].durationDays).toBe(14);
    expect(episodes[0].depthPct).toBeCloseTo(-0.10, 10);
  });

  it("depthPct is negative and matches the lowest point", () => {
    const episodes = segmentDrawdowns(
      series(
        ["2024-01-01", 0],
        ["2024-01-02", -0.03],
        ["2024-01-03", -0.07],
        ["2024-01-04", -0.12], // deepest
        ["2024-01-05", -0.05],
        ["2024-01-06", 0],
      ),
    );
    expect(episodes).toHaveLength(1);
    expect(episodes[0].depthPct).toBeLessThan(0);
    expect(episodes[0].depthPct).toBeCloseTo(-0.12, 10);
    expect(episodes[0].troughDate).toBe("2024-01-04");
  });

  it("treats index 0 as the peak when the series starts below 0", () => {
    const episodes = segmentDrawdowns(
      series(
        ["2024-01-01", -0.05], // already in drawdown at start
        ["2024-01-03", -0.10], // trough
        ["2024-01-07", -0.04],
        ["2024-01-10", 0], // recovery
      ),
    );
    expect(episodes).toHaveLength(1);
    expect(episodes[0].peakDate).toBe("2024-01-01");
    expect(episodes[0].troughDate).toBe("2024-01-03");
    expect(episodes[0].recoveryDate).toBe("2024-01-10");
    expect(episodes[0].depthPct).toBeCloseTo(-0.10, 10);
    expect(episodes[0].durationDays).toBe(9);
  });

  it("handles exact-zero transitions as two separate episodes", () => {
    // -0.01, 0, -0.02 → two episodes, not one merged episode.
    const episodes = segmentDrawdowns(
      series(
        ["2024-01-01", 0],
        ["2024-01-02", -0.01],
        ["2024-01-03", 0], // episode 1 recovers
        ["2024-01-04", -0.02],
        ["2024-01-05", 0], // episode 2 recovers
      ),
    );
    expect(episodes).toHaveLength(2);
    // Sorted deepest first.
    expect(episodes[0].depthPct).toBeCloseTo(-0.02, 10);
    expect(episodes[0].peakDate).toBe("2024-01-03");
    expect(episodes[0].troughDate).toBe("2024-01-04");
    expect(episodes[0].recoveryDate).toBe("2024-01-05");
    expect(episodes[1].depthPct).toBeCloseTo(-0.01, 10);
    expect(episodes[1].peakDate).toBe("2024-01-01");
    expect(episodes[1].troughDate).toBe("2024-01-02");
    expect(episodes[1].recoveryDate).toBe("2024-01-03");
  });

  it("closes the episode when the series ends exactly at 0", () => {
    const episodes = segmentDrawdowns(
      series(
        ["2024-01-01", 0],
        ["2024-01-02", -0.05],
        ["2024-01-03", -0.10],
        ["2024-01-04", 0], // full recovery on the last day
      ),
    );
    expect(episodes).toHaveLength(1);
    expect(episodes[0].isCurrent).toBe(false);
    expect(episodes[0].recoveryDate).toBe("2024-01-04");
  });

  it("treats positive values as not-in-drawdown (defensive)", () => {
    // Drawdown series should never contain positive values (quantstats
    // convention is value <= 0). But if one slips in — e.g. a floating
    // point blip or a mislabeled series — positive values must NOT be
    // treated as being in a drawdown episode. The only genuine dip below
    // the 0.5% threshold here is -0.02 → one episode, not two.
    const episodes = segmentDrawdowns(
      series(
        ["2024-01-01", 0],
        ["2024-01-02", 0.03], // spurious positive — ignored (not in dd)
        ["2024-01-03", 0],
        ["2024-01-04", -0.02], // real dip
        ["2024-01-05", 0],
      ),
    );
    expect(episodes).toHaveLength(1);
    expect(episodes[0].depthPct).toBeCloseTo(-0.02, 10);
    expect(episodes[0].troughDate).toBe("2024-01-04");
  });
});
