import { describe, it, expect } from "vitest";
import {
  buildAllocatorPortfolioFactsheetPayload,
  equityCurveToDailyReturns,
} from "./allocator-portfolio-payload";

describe("equityCurveToDailyReturns", () => {
  it("returns an empty array when fewer than two valid points are supplied", () => {
    expect(equityCurveToDailyReturns([])).toEqual([]);
    expect(
      equityCurveToDailyReturns([{ date: "2025-01-01", value: 1 }]),
    ).toEqual([]);
  });

  it("derives daily returns from a wealth curve (curr/prev - 1)", () => {
    const got = equityCurveToDailyReturns([
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-01-02", value: 1.05 },
      { date: "2025-01-03", value: 1.0395 },
    ]);
    expect(got).toHaveLength(2);
    expect(got[0].date).toBe("2025-01-02");
    expect(got[0].value).toBeCloseTo(0.05, 6);
    expect(got[1].date).toBe("2025-01-03");
    expect(got[1].value).toBeCloseTo(-0.01, 6);
  });

  it("sorts by date and drops non-finite / non-positive values defensively", () => {
    const got = equityCurveToDailyReturns([
      { date: "2025-01-03", value: 1.05 },
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-01-02", value: 0 },
      { date: "2025-01-04", value: NaN },
      { date: "2025-01-05", value: 1.1 },
    ] as Array<{ date: string; value: number }>);
    // Valid wealth points sorted: [1.0 @ 01-01, 1.05 @ 01-03, 1.1 @ 01-05].
    // Returns derived as ratio successor pairs of the SORTED valid series.
    expect(got).toHaveLength(2);
    expect(got[0].date).toBe("2025-01-03");
    expect(got[1].date).toBe("2025-01-05");
  });
});

describe("buildAllocatorPortfolioFactsheetPayload", () => {
  it("returns null when the input series is too short", () => {
    expect(
      buildAllocatorPortfolioFactsheetPayload(
        [{ date: "2025-01-01", value: 1 }],
        { allocatorId: "alloc-1" },
      ),
    ).toBeNull();
  });

  it("synthesises a per-allocator strategyId so persistence keys don't collide on shared devices", () => {
    // Use enough points to clear the builder's length threshold (2+).
    const wealth = Array.from({ length: 10 }).map((_, i) => ({
      date: `2025-02-${String(i + 1).padStart(2, "0")}`,
      value: 1 + i * 0.01,
    }));
    const payload = buildAllocatorPortfolioFactsheetPayload(wealth, {
      allocatorId: "alloc-7",
      portfolioName: "Multi-Asset",
    });
    // The benchmark fixture covers 2023-04-26 onwards, so the 2025-02
    // window clips cleanly through and yields a payload.
    expect(payload).not.toBeNull();
    expect(payload!.strategyId).toBe("portfolio:alloc-7");
    expect(payload!.strategyName).toBe("Multi-Asset");
    // Allocator-portfolio derived series should NOT carry a trust tier
    // (it's not a published strategy) and no benchmark ticker.
    expect(payload!.trustTier).toBeNull();
    expect(payload!.benchmark).toBeNull();
  });

  it("falls back to 'My Portfolio' when no name is supplied", () => {
    const wealth = Array.from({ length: 10 }).map((_, i) => ({
      date: `2025-02-${String(i + 1).padStart(2, "0")}`,
      value: 1 + i * 0.01,
    }));
    const payload = buildAllocatorPortfolioFactsheetPayload(wealth, {
      allocatorId: "alloc-default-name",
    });
    expect(payload?.strategyName).toBe("My Portfolio");
  });
});
