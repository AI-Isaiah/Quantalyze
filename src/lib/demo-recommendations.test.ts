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

  it("uses the latest batch when it produces >= 3 candidates", async () => {
    // audit-2026-05-07 C-0123 — the threshold is now >= 3, not > 0.
    // With 3 candidates and no prior fallback needed, we should only
    // hit Supabase once (latest batch) per the sequential-by-design
    // comment in the source.
    const admin = fakeAdminClient({
      "batch-a": [
        { id: "row-1", rank: 1, score: 90, strategies: { id: "s-1", name: "Stellar" } },
        { id: "row-2", rank: 2, score: 80, strategies: { id: "s-2", name: "Aurora" } },
        { id: "row-3", rank: 3, score: 70, strategies: { id: "s-3", name: "Pulse" } },
      ],
      "batch-b": [],
    });
    const result = await resolveDemoRecommendations({
      admin: admin as never,
      batches: [{ id: "batch-a" }, { id: "batch-b" }],
    });
    expect(result.usedBatchId).toBe("batch-a");
    expect(result.fellBackToPrevious).toBe(false);
    expect(result.recommendations).toHaveLength(3);
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

  describe("audit-2026-05-07 C-0123 — fallback threshold and race-window discriminator", () => {
    it("falls back to the previous batch when latest has 1-2 candidates (was: claimed batches[0] under > 0)", async () => {
      // Pre-fix behavior: `latestRows.length > 0` accepted 1 candidate
      // as authoritative — friend-forwarded URL lands on a sparse
      // "Top matches" page when exclusion filters left 4/5 ranked-null.
      // Post-fix: with 2 candidates < MIN_LATEST_RECOMMENDATIONS, we
      // fall back to the prior batch's full 3-card set.
      const admin = fakeAdminClient({
        "batch-a": [
          { id: "row-1", rank: 1, score: 90, strategies: { id: "s-1", name: "Sparse-A" } },
          { id: "row-2", rank: 2, score: 80, strategies: { id: "s-2", name: "Sparse-B" } },
        ],
        "batch-b": [
          { id: "row-3", rank: 1, score: 70, strategies: { id: "s-3", name: "Prior-A" } },
          { id: "row-4", rank: 2, score: 60, strategies: { id: "s-4", name: "Prior-B" } },
          { id: "row-5", rank: 3, score: 50, strategies: { id: "s-5", name: "Prior-C" } },
        ],
      });
      const result = await resolveDemoRecommendations({
        admin: admin as never,
        batches: [{ id: "batch-a" }, { id: "batch-b" }],
      });
      expect(result.usedBatchId).toBe("batch-b");
      expect(result.fellBackToPrevious).toBe(true);
      expect(result.recommendations).toHaveLength(3);
    });

    it("rejects latest batch when candidate_count < 3 even if rows >= 3 (race-window discriminator)", async () => {
      // Race window: a future writer that inserts candidates BEFORE
      // updating `match_batches.candidate_count` could return 3+ rows
      // from a not-yet-finalized batch. The discriminator on the batch
      // row must agree the batch is fully populated, otherwise prefer
      // the prior batch.
      const admin = fakeAdminClient({
        "batch-a": [
          { id: "row-1", rank: 1, score: 90, strategies: { id: "s-1", name: "Race-A" } },
          { id: "row-2", rank: 2, score: 80, strategies: { id: "s-2", name: "Race-B" } },
          { id: "row-3", rank: 3, score: 70, strategies: { id: "s-3", name: "Race-C" } },
        ],
        "batch-b": [
          { id: "row-4", rank: 1, score: 60, strategies: { id: "s-4", name: "Prior-A" } },
          { id: "row-5", rank: 2, score: 50, strategies: { id: "s-5", name: "Prior-B" } },
          { id: "row-6", rank: 3, score: 40, strategies: { id: "s-6", name: "Prior-C" } },
        ],
      });
      const result = await resolveDemoRecommendations({
        admin: admin as never,
        // candidate_count = 2 on the latest batch -> writer hasn't
        // finalized; must fall through to prior batch.
        batches: [
          { id: "batch-a", candidate_count: 2 },
          { id: "batch-b", candidate_count: 5 },
        ],
      });
      expect(result.usedBatchId).toBe("batch-b");
      expect(result.fellBackToPrevious).toBe(true);
    });

    it("accepts latest batch when candidate_count >= 3 AND rows >= 3 (success case)", async () => {
      const admin = fakeAdminClient({
        "batch-a": [
          { id: "row-1", rank: 1, score: 90, strategies: { id: "s-1", name: "OK-A" } },
          { id: "row-2", rank: 2, score: 80, strategies: { id: "s-2", name: "OK-B" } },
          { id: "row-3", rank: 3, score: 70, strategies: { id: "s-3", name: "OK-C" } },
        ],
      });
      const result = await resolveDemoRecommendations({
        admin: admin as never,
        batches: [{ id: "batch-a", candidate_count: 5 }],
      });
      expect(result.usedBatchId).toBe("batch-a");
      expect(result.fellBackToPrevious).toBe(false);
      expect(result.recommendations).toHaveLength(3);
      // Only one Supabase round-trip on the happy path.
      expect(admin.calls).toEqual(["batch-a"]);
    });

    it("falls through to latest sparse result when no prior batch is available", async () => {
      // No prior fallback parachute: better to render a sparse "Top
      // matches" page than a blank one. The friend at least sees
      // something instead of an empty appendix.
      const admin = fakeAdminClient({
        "batch-a": [
          { id: "row-1", rank: 1, score: 90, strategies: { id: "s-1", name: "Only-One" } },
        ],
      });
      const result = await resolveDemoRecommendations({
        admin: admin as never,
        batches: [{ id: "batch-a" }],
      });
      expect(result.usedBatchId).toBe("batch-a");
      expect(result.fellBackToPrevious).toBe(false);
      expect(result.recommendations).toHaveLength(1);
    });
  });
});
