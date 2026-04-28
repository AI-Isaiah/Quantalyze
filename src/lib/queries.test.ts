import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the manager-identity redaction in `getStrategyDetail()` and
 * `getPublicStrategyDetail()`. These functions implement T4.3a from the
 * disclosure-tier plan: a strategy with `disclosure_tier='exploratory'`
 * MUST NOT leak manager bio/years/aum/linkedin to the client.
 *
 * The redaction lives in queries.ts itself (not the React component) so the
 * fix is server-side and a curl can never bypass it.
 */

// Mock the Supabase server + admin clients BEFORE importing queries.
// `vi.hoisted` lets the mock factory reach the call recorders below.
//
// The redaction logic uses TWO clients:
//   - createClient (user-scoped) reads `strategies`
//   - createAdminClient (service_role) reads `profiles` for institutional
//     manager identity, BECAUSE migration 012 REVOKE'd column SELECT on
//     bio/years_trading/aum_range from anon + authenticated. The test
//     records BOTH client surfaces and asserts that profiles is read via
//     the admin path (and never read at all for exploratory).
const recorders = vi.hoisted(() => {
  return {
    fromCalls: [] as string[], // user-client calls
    adminFromCalls: [] as string[], // admin-client calls
    strategyData: null as unknown,
    managerRowData: null as unknown,
    // RPC recorder for fetchStrategyLazyMetrics tests (Plan 12-08 / METRICS-15).
    // Each call records (rpcName, args); each test seeds a single response.
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
    rpcResponse: { data: null as unknown, error: null as unknown },
  };
});

const buildChain = (data: unknown) => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.single = () => Promise.resolve({ data, error: null });
  // `loadManagerIdentity` (the shared helper in manager-identity.ts) uses
  // `.maybeSingle()` — less fragile than `.single()` because it returns
  // `null` instead of throwing on an empty row set. The mock chain must
  // implement both so pre-existing tests (which used `.single()`) and the
  // new shared helper (which uses `.maybeSingle()`) both work.
  chain.maybeSingle = () => Promise.resolve({ data, error: null });
  return chain;
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      recorders.fromCalls.push(table);
      return buildChain(
        table === "strategies" ? recorders.strategyData : recorders.managerRowData,
      );
    },
    // .rpc() recorder for fetchStrategyLazyMetrics (Plan 12-08 / METRICS-15).
    // Existing disclosure-tier tests don't touch this path; they keep working.
    rpc: (name: string, args: Record<string, unknown>) => {
      recorders.rpcCalls.push({ name, args });
      return Promise.resolve(recorders.rpcResponse);
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      recorders.adminFromCalls.push(table);
      return buildChain(
        table === "strategies" ? recorders.strategyData : recorders.managerRowData,
      );
    },
  }),
}));

import { getStrategyDetail, getPublicStrategyDetail, fetchStrategyLazyMetrics } from "./queries";

const baseStrategy = {
  id: "strat_123",
  user_id: "user_abc",
  status: "published",
  name: "Stellar L/S",
  codename: "Stellar",
  strategy_analytics: null,
};

const fullManagerRow = {
  display_name: "Jane Doe",
  company: "Acme Capital",
  bio: "20 years trading equities",
  years_trading: 20,
  aum_range: "$50M-$100M",
  linkedin: "https://linkedin.com/in/janedoe",
};

beforeEach(() => {
  recorders.fromCalls = [];
  recorders.adminFromCalls = [];
  recorders.strategyData = null;
  recorders.managerRowData = null;
  recorders.rpcCalls = [];
  recorders.rpcResponse = { data: null, error: null };
});

describe("getStrategyDetail — disclosure tier redaction", () => {
  it("returns null manager + does NOT query profiles for exploratory strategies", async () => {
    recorders.strategyData = {
      ...baseStrategy,
      disclosure_tier: "exploratory",
    };
    recorders.managerRowData = fullManagerRow; // would leak if hit

    const result = await getStrategyDetail("strat_123");

    expect(result).not.toBeNull();
    expect(result!.disclosureTier).toBe("exploratory");
    expect(result!.manager).toBeNull();
    // The profiles table must NEVER be queried (on either client) for an
    // exploratory strategy — that is the whole security guarantee.
    expect(recorders.fromCalls).not.toContain("profiles");
    expect(recorders.adminFromCalls).not.toContain("profiles");
    expect(recorders.fromCalls).toContain("strategies");
  });

  it("populates manager fields for institutional strategies via admin client", async () => {
    recorders.strategyData = {
      ...baseStrategy,
      disclosure_tier: "institutional",
    };
    recorders.managerRowData = fullManagerRow;

    const result = await getStrategyDetail("strat_123");

    expect(result).not.toBeNull();
    expect(result!.disclosureTier).toBe("institutional");
    expect(result!.manager).toEqual({
      display_name: "Jane Doe",
      company: "Acme Capital",
      bio: "20 years trading equities",
      years_trading: 20,
      aum_range: "$50M-$100M",
      linkedin: "https://linkedin.com/in/janedoe",
    });
    // The manager identity fetch MUST go through the admin (service_role)
    // client because migration 012 REVOKE'd column SELECT on bio/years/aum
    // from anon + authenticated. The user-scoped client must NOT be used.
    expect(recorders.adminFromCalls).toContain("profiles");
    expect(recorders.fromCalls).not.toContain("profiles");
  });

  it("defaults missing disclosure_tier to exploratory (safest fallback)", async () => {
    // No disclosure_tier on the row at all → must NOT query profiles.
    recorders.strategyData = { ...baseStrategy };
    recorders.managerRowData = fullManagerRow;

    const result = await getStrategyDetail("strat_123");

    expect(result!.disclosureTier).toBe("exploratory");
    expect(result!.manager).toBeNull();
    expect(recorders.fromCalls).not.toContain("profiles");
    expect(recorders.adminFromCalls).not.toContain("profiles");
  });
});

describe("getPublicStrategyDetail — disclosure tier redaction", () => {
  it("returns null manager + does NOT query profiles for exploratory strategies", async () => {
    recorders.strategyData = {
      ...baseStrategy,
      disclosure_tier: "exploratory",
    };
    recorders.managerRowData = fullManagerRow;

    const result = await getPublicStrategyDetail("strat_123");

    expect(result).not.toBeNull();
    expect(result!.disclosureTier).toBe("exploratory");
    expect(result!.manager).toBeNull();
    expect(recorders.fromCalls).not.toContain("profiles");
    expect(recorders.adminFromCalls).not.toContain("profiles");
  });

  it("populates manager fields for institutional strategies via admin client", async () => {
    recorders.strategyData = {
      ...baseStrategy,
      disclosure_tier: "institutional",
    };
    recorders.managerRowData = fullManagerRow;

    const result = await getPublicStrategyDetail("strat_123");

    expect(result!.disclosureTier).toBe("institutional");
    expect(result!.manager).toEqual({
      display_name: "Jane Doe",
      company: "Acme Capital",
      bio: "20 years trading equities",
      years_trading: 20,
      aum_range: "$50M-$100M",
      linkedin: "https://linkedin.com/in/janedoe",
    });
    expect(recorders.adminFromCalls).toContain("profiles");
    expect(recorders.fromCalls).not.toContain("profiles");
  });
});

/**
 * Plan 12-08 / METRICS-15 (consumer half): fetchStrategyLazyMetrics RPC consumer
 * tests. Phase 12 ships only the consumer + type union; Phase 14b actually calls
 * it from panels 4–7. Tests cover:
 *   1. Correct RPC name + arg shape (p_strategy_id / p_panel_id) — guards against
 *      drift from the SQL signature in migration 087.
 *   2. Pass-through of populated payload on success.
 *   3. Empty-object fallback on RPC error (T-12-08-01: never reveal strategy
 *      existence via the error path; UI sees the same shape as a private miss).
 *   4. Empty-object fallback on null data (defensive — supabase clients can
 *      return { data: null, error: null } for an empty visibility result).
 */
describe("fetchStrategyLazyMetrics — RPC consumer (Plan 12-08 / METRICS-15)", () => {
  it("calls the fetch_strategy_lazy_metrics RPC with the correct args", async () => {
    recorders.rpcResponse = { data: {}, error: null };
    await fetchStrategyLazyMetrics(
      "00000000-0000-0000-0000-000000000001",
      "rolling",
    );
    expect(recorders.rpcCalls).toHaveLength(1);
    expect(recorders.rpcCalls[0]).toEqual({
      name: "fetch_strategy_lazy_metrics",
      args: {
        p_strategy_id: "00000000-0000-0000-0000-000000000001",
        p_panel_id: "rolling",
      },
    });
  });

  it("returns the data field on success", async () => {
    const payload = {
      rolling_sortino_3m: [{ date: "2026-01-01", value: 1.5 }],
    };
    recorders.rpcResponse = { data: payload, error: null };
    const result = await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(result).toEqual(payload);
  });

  it("returns empty object on RPC error", async () => {
    recorders.rpcResponse = {
      data: null,
      error: { message: "boom", code: "PGRST000" },
    };
    const result = await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(result).toEqual({});
  });

  it("returns empty object on null data with no error", async () => {
    recorders.rpcResponse = { data: null, error: null };
    const result = await fetchStrategyLazyMetrics("strategy-id", "overview");
    expect(result).toEqual({});
  });
});
