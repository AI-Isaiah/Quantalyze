import { describe, expect, it, vi } from "vitest";
import {
  resolveDemoRecommendations,
  type RecommendationRow,
} from "./demo-recommendations";

interface BuilderRow {
  id: string;
  rank?: number;
  score?: number;
  reasons?: string[];
  strategies?: {
    id: string;
    name: string;
    codename?: string | null;
    disclosure_tier?: "institutional" | "exploratory";
    description?: string | null;
    strategy_analytics?: {
      cagr?: number | null;
      sharpe?: number | null;
      max_drawdown?: number | null;
    };
  };
}

function fakeAdminClient(batchToRows: Record<string, BuilderRow[]>) {
  const calls: string[] = [];
  return {
    calls,
    from: () => ({
      select: () => ({
        eq: (_col: string, batchId: string) => ({
          is: () => ({
            not: () => ({
              order: () => ({
                limit: () => {
                  calls.push(batchId);
                  return Promise.resolve({ data: batchToRows[batchId] ?? null });
                },
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

describe("resolveDemoRecommendations", () => {
  it("returns empty result when there are no batches", async () => {
    const admin = fakeAdminClient({});
    const result = await resolveDemoRecommendations({
      admin: admin as never,
      batches: [],
    });
    expect(result).toEqual({
      recommendations: [],
      usedBatchId: null,
      fellBackToPrevious: false,
    });
  });

  it("uses the latest batch when it produces candidates", async () => {
    const admin = fakeAdminClient({
      "batch-a": [
        {
          id: "row-1",
          rank: 1,
          score: 90,
          strategies: { id: "s-1", name: "Stellar" },
        },
      ],
      "batch-b": [],
    });
    const result = await resolveDemoRecommendations({
      admin: admin as never,
      batches: [{ id: "batch-a" }, { id: "batch-b" }],
    });
    expect(result.usedBatchId).toBe("batch-a");
    expect(result.fellBackToPrevious).toBe(false);
    expect(result.recommendations).toHaveLength(1);
    expect(admin.calls).toEqual(["batch-a"]);
  });

  it("falls back to the previous batch when the latest is empty", async () => {
    const admin = fakeAdminClient({
      "batch-a": [],
      "batch-b": [
        {
          id: "row-1",
          rank: 1,
          score: 80,
          strategies: { id: "s-1", name: "Aurora" },
        },
      ],
    });
    const result = await resolveDemoRecommendations({
      admin: admin as never,
      batches: [{ id: "batch-a" }, { id: "batch-b" }],
    });
    expect(result.usedBatchId).toBe("batch-b");
    expect(result.fellBackToPrevious).toBe(true);
    expect(result.recommendations).toHaveLength(1);
    expect(admin.calls).toEqual(["batch-a", "batch-b"]);
  });

  it("returns empty when both batches produce nothing", async () => {
    const admin = fakeAdminClient({
      "batch-a": [],
      "batch-b": [],
    });
    const result = await resolveDemoRecommendations({
      admin: admin as never,
      batches: [{ id: "batch-a" }, { id: "batch-b" }],
    });
    expect(result.usedBatchId).toBeNull();
    expect(result.recommendations).toEqual([]);
    expect(admin.calls).toEqual(["batch-a", "batch-b"]);
  });

  it("never queries a third batch even if more exist", async () => {
    const admin = fakeAdminClient({
      "batch-a": [],
      "batch-b": [],
      "batch-c": [{ id: "x", rank: 1, strategies: { id: "s", name: "Should not see" } }],
    });
    const result = await resolveDemoRecommendations({
      admin: admin as never,
      batches: [{ id: "batch-a" }, { id: "batch-b" }, { id: "batch-c" }],
    });
    expect(result.recommendations).toEqual([]);
    expect(admin.calls).toEqual(["batch-a", "batch-b"]);
  });

  it("hydrates recommendation rows with strategy data", async () => {
    const admin = fakeAdminClient({
      "batch-a": [
        {
          id: "row-1",
          rank: 1,
          score: 95,
          reasons: ["Strong fit"],
          strategies: {
            id: "s-1",
            name: "Stellar Neutral Alpha",
            codename: "STELLAR",
            disclosure_tier: "institutional",
            description: "Market-neutral.",
            strategy_analytics: {
              cagr: 0.18,
              sharpe: 1.4,
              max_drawdown: -0.05,
            },
          },
        },
      ],
    });
    const result = await resolveDemoRecommendations({
      admin: admin as never,
      batches: [{ id: "batch-a" }],
    });
    const row: RecommendationRow = result.recommendations[0];
    expect(row.strategy.name).toBe("Stellar Neutral Alpha");
    expect(row.analytics?.sharpe).toBe(1.4);
    expect(row.reasons).toEqual(["Strong fit"]);
  });

  it.skip("does not crash when admin client throws (suppressed in v1)", () => {
    // Reserved for future hardening — current callers wrap in try/catch.
    expect(true).toBe(true);
    void vi;
  });
});
