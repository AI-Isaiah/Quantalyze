import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression: UAT-01 (Phase 09) — SSR must query match_batches via the
 * service-role admin client, NOT the authed supabase client.
 *
 * What broke: queries.ts:888 used `supabase.from("match_batches")` which is
 * the authed user client. Migration 011's RLS policies on match_batches only
 * grant service-role INSERT/DELETE and admin-role SELECT/DELETE — no
 * policy allows an authenticated allocator to read their own batches.
 *
 * Symptom: `flaggedHoldings` always resolved to `[]` in production regardless
 * of whether the cron had written holding_flags. The InsightStrip flagged-count
 * line never rendered. Found by /qa browser testing on 2026-04-21 after
 * seeding a match_batches row against the demo allocator.
 *
 * This test seeds rows only for the admin mock (NOT the authed supabase mock)
 * and asserts flaggedHoldings is non-empty after the call. With the pre-fix
 * code path (supabase.from), this test fails because the authed mock sees no
 * match_batches rows.
 */

type Chain = {
  select: (...a: unknown[]) => Chain;
  eq: (c: string, v: unknown) => Chain;
  in: (c: string, v: unknown) => Chain;
  is: (c: string, v: unknown) => Chain;
  not: (c: string, op: string, v: unknown) => Chain;
  order: (c?: string, o?: { ascending?: boolean }) => Chain;
  limit: (n: number) => Chain;
  maybeSingle: () => Promise<{ data: unknown | null; error: null }>;
  single: () => Promise<{ data: unknown | null; error: null | { message: string } }>;
  then: (
    resolve: (v: { data: unknown[]; error: null; count?: number }) => void,
  ) => void;
};

function makeChain(rows: Record<string, unknown[]>): (table: string) => Chain {
  return (table: string) => {
    const filters: Array<{ column: string; value: unknown; op: "eq" | "in" | "is" | "not-is" }> = [];

    function applyFilters(all: unknown[]): unknown[] {
      return all.filter((row) =>
        filters.every((f) => {
          const v = (row as Record<string, unknown>)[f.column];
          if (f.op === "eq") return v === f.value;
          if (f.op === "is") return v === f.value;
          if (f.op === "not-is") return (v ?? null) !== f.value;
          if (f.op === "in")
            return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
          return true;
        }),
      );
    }

    const chain: Chain = {
      select: () => chain,
      eq: (c, v) => {
        filters.push({ column: c, value: v, op: "eq" });
        return chain;
      },
      in: (c, v) => {
        filters.push({ column: c, value: v, op: "in" });
        return chain;
      },
      is: (c, v) => {
        filters.push({ column: c, value: v, op: "is" });
        return chain;
      },
      not: (c, op, v) => {
        if (op === "is") filters.push({ column: c, value: v, op: "not-is" });
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        const r = applyFilters(rows[table] ?? []);
        return { data: r[0] ?? null, error: null };
      },
      single: async () => {
        const r = applyFilters(rows[table] ?? []);
        return r[0]
          ? { data: r[0], error: null }
          : { data: null, error: { message: "not found" } };
      },
      then: (resolve) => {
        const r = applyFilters(rows[table] ?? []);
        resolve({ data: r, error: null });
      },
    };
    return chain;
  };
}

// Two distinct stores: `authed` is what an authed allocator sees under RLS
// (match_batches intentionally absent — RLS blocks reads per migration 011).
// `admin` is what service-role sees (everything).
const authedRows: Record<string, unknown[]> = {
  portfolios: [],
  api_keys: [],
  portfolio_alerts: [],
  allocator_equity_snapshots: [],
  allocator_holdings: [],
  // match_batches intentionally empty for authed — simulates RLS block.
  match_batches: [],
  // strategies is readable by authed users (public status=published).
  strategies: [
    { id: "strat-top-candidate", name: "Polaris Cross-Exchange Arb" },
  ],
};

const adminRows: Record<string, unknown[]> = {
  portfolios: [],
  match_decisions: [],
  bridge_outcomes: [],
  bridge_outcome_dismissals: [],
  // Service-role sees the match_batches row.
  match_batches: [
    {
      id: "batch-uat01",
      allocator_id: "user-1",
      holding_flags: [
        {
          holding_ref: "holding:binance:BTC:spot",
          value_usd: 100000,
          weight: 0.6,
          breach_reasons: ["max_weight"],
          top_candidate_strategy_id: "strat-top-candidate",
          top_candidate_composite: 75,
          flagged: true,
        },
      ],
    },
  ],
  strategies: [
    { id: "strat-top-candidate", name: "Polaris Cross-Exchange Arb" },
  ],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: makeChain(authedRows),
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: makeChain(adminRows),
  }),
}));

import { getMyAllocationDashboard } from "./queries";

describe("queries.getMyAllocationDashboard — match_batches RLS regression", () => {
  beforeEach(() => {});

  it("UAT-01 regression: reads match_batches via admin so flaggedHoldings populates under RLS", async () => {
    const payload = await getMyAllocationDashboard("user-1");
    expect(payload.flaggedHoldings).toBeDefined();
    expect(payload.flaggedHoldings.length).toBe(1);
    expect(payload.flaggedHoldings[0]).toMatchObject({
      venue: "binance",
      symbol: "BTC",
      holding_type: "spot",
      top_candidate_strategy_id: "strat-top-candidate",
      top_candidate_name: "Polaris Cross-Exchange Arb",
    });
  });
});
