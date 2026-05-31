import { describe, it, expect, beforeEach, vi } from "vitest";

// queries.ts transitively imports `@/lib/supabase/admin`, which does
// `import "server-only"` — that throws under the jsdom test environment.
// Neutralise it (same pattern as queries.hh-1255 / queries.hh-0495 tests).
vi.mock("server-only", () => ({}));

/**
 * B19 (Internal Query Bounding) — getAllocatorAggregates RPC rewrite.
 *
 * The latest-analytics-row-per-portfolio selection moved from an unbounded
 * `.in("portfolio_id", portfolioIds).order("computed_at", desc).limit(500)` +
 * app-side Map dedup into a single SECURITY DEFINER RPC
 * (get_latest_portfolio_analytics_for_user). These pin WHY the rewrite matters:
 *   - a SINGLE rpc round-trip with the user id (no per-portfolio IN-list, so no
 *     414 / limit(500) truncation can recur);
 *   - throw-on-rpc-error (F-05 parity — the OLD path only console.error'd the
 *     analytics failure, so a real DB error looked like "analytics not computed");
 *   - the empty-portfolios short-circuit must NOT issue the rpc round-trip.
 *
 * Self-contained mock surface (separate file) so the rpc plumbing doesn't bleed
 * into the broader queries suite.
 */

const state = vi.hoisted(() => ({
  portfolios: { data: null as unknown, error: null as null | { message: string } },
  rpc: { data: null as unknown, error: null as null | { message: string } },
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
}));

function reset() {
  state.portfolios = { data: [], error: null };
  state.rpc = { data: [], error: null };
  state.rpcCalls = [];
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const result = Promise.resolve(state.portfolios);
      const chain = {
        select: () => chain,
        eq: () => result, // call site: from("portfolios").select(...).eq("user_id", userId)
      };
      return chain;
    },
    rpc: (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve(state.rpc);
    },
  }),
}));

beforeEach(reset);

describe("getAllocatorAggregates — B19 RPC rewrite", () => {
  it("fetches analytics via a single get_latest_portfolio_analytics_for_user rpc (no IN-list)", async () => {
    state.portfolios = { data: [{ id: "p1" }, { id: "p2" }], error: null };
    state.rpc = {
      data: [{ portfolio_id: "p1" }, { portfolio_id: "p2" }],
      error: null,
    };
    const { getAllocatorAggregates } = await import("./queries");

    const out = await getAllocatorAggregates("user-1");

    // Exactly one rpc round-trip, scoped by the user id (not a per-portfolio IN-list).
    expect(state.rpcCalls).toEqual([
      {
        name: "get_latest_portfolio_analytics_for_user",
        args: { p_user_id: "user-1" },
      },
    ]);
    expect(out.portfolios).toHaveLength(2);
    expect(out.analytics).toHaveLength(2);
  });

  it("throws when the analytics rpc errors (F-05 parity; pre-fix only console.error'd)", async () => {
    state.portfolios = { data: [{ id: "p1" }], error: null };
    state.rpc = { data: null, error: { message: "permission denied for function" } };
    const { getAllocatorAggregates } = await import("./queries");

    await expect(getAllocatorAggregates("user-1")).rejects.toThrow(
      /getAllocatorAggregates analytics failed: permission denied for function/,
    );
  });

  it("throws when the portfolios fetch errors (F-05, preserved)", async () => {
    state.portfolios = { data: null, error: { message: "rls denied" } };
    const { getAllocatorAggregates } = await import("./queries");

    await expect(getAllocatorAggregates("user-1")).rejects.toThrow(
      /getAllocatorAggregates portfolios failed: rls denied/,
    );
  });

  it("short-circuits to empty WITHOUT issuing the rpc when the user has no portfolios", async () => {
    state.portfolios = { data: [], error: null };
    const { getAllocatorAggregates } = await import("./queries");

    const out = await getAllocatorAggregates("user-1");

    expect(out).toEqual({ portfolios: [], analytics: [] });
    expect(state.rpcCalls).toEqual([]); // no wasted round-trip for the empty case
  });
});
