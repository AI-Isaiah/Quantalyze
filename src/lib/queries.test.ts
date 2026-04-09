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

import { getStrategyDetail, getPublicStrategyDetail } from "./queries";

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
