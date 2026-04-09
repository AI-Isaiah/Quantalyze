import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the My Allocation query helpers added in PR 1 of the
 * /allocations restructure: getRealPortfolio, getTestPortfolios,
 * getUserFavorites, and getMyAllocationDashboard. Separate file from
 * queries.test.ts so the mock surface stays small — these queries use
 * different chains (.maybeSingle, .insert, joined selects) than the
 * manager-identity ones covered there.
 */

// ------------------------------------------------------------------
// Supabase mock surface — emulates the PostgREST builder chain
// ------------------------------------------------------------------
const state = vi.hoisted(() => ({
  portfolios: [] as Array<{
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    created_at: string;
    is_test: boolean;
  }>,
  portfolioStrategies: [] as Array<{
    portfolio_id: string;
    strategy_id: string;
    current_weight: number;
    allocated_amount: number;
  }>,
  analytics: [] as Array<{
    id: string;
    portfolio_id: string;
    computed_at: string;
    total_aum: number;
    return_ytd: number;
  }>,
  favorites: [] as Array<{
    user_id: string;
    strategy_id: string;
    created_at: string;
    notes: string | null;
    strategy: unknown;
  }>,
  alerts: [] as Array<{
    id: string;
    portfolio_id: string;
    severity: string;
    acknowledged_at: string | null;
  }>,
}));

function resetState() {
  state.portfolios = [];
  state.portfolioStrategies = [];
  state.analytics = [];
  state.favorites = [];
  state.alerts = [];
}

type Filter = { column: string; value: unknown; op: "eq" | "in" | "is" };

/**
 * Minimal builder that supports the methods these helpers actually use:
 * .select, .eq, .in, .is, .order, .limit, .maybeSingle, .single.
 * Each call returns `this` for chaining except the terminal resolvers.
 */
function buildChain(table: string) {
  const filters: Filter[] = [];
  let limitN: number | null = null;

  function applyFilters<T extends Record<string, unknown>>(rows: T[]): T[] {
    return rows.filter((row) =>
      filters.every((f) => {
        const v = row[f.column];
        if (f.op === "eq") return v === f.value;
        if (f.op === "is") return v === f.value;
        if (f.op === "in")
          return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
        return true;
      }),
    );
  }

  function rowsFor(): unknown[] {
    switch (table) {
      case "portfolios":
        return applyFilters(state.portfolios);
      case "portfolio_strategies":
        return applyFilters(state.portfolioStrategies);
      case "portfolio_analytics":
        return applyFilters(state.analytics);
      case "user_favorites":
        return applyFilters(state.favorites);
      case "portfolio_alerts":
        return applyFilters(state.alerts);
      default:
        return [];
    }
  }

  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push({ column, value, op: "eq" });
      return chain;
    },
    in: (column: string, value: unknown) => {
      filters.push({ column, value, op: "in" });
      return chain;
    },
    is: (column: string, value: unknown) => {
      filters.push({ column, value, op: "is" });
      return chain;
    },
    order: () => chain,
    limit: (n: number) => {
      limitN = n;
      return chain;
    },
    maybeSingle: async () => {
      const rows = rowsFor();
      const row = limitN !== null ? rows.slice(0, limitN)[0] : rows[0];
      return { data: row ?? null, error: null };
    },
    single: async () => {
      const rows = rowsFor();
      const row = rows[0];
      return {
        data: row ?? null,
        error: row ? null : { message: "not found" },
      };
    },
    // Terminal await: fall through to a thenable with the full list.
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
      const rows = rowsFor();
      resolve({ data: rows, error: null });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => buildChain(table),
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => buildChain(table) }),
}));

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("getRealPortfolio", () => {
  beforeEach(resetState);

  it("returns the single is_test=false portfolio for the user", async () => {
    state.portfolios = [
      {
        id: "real-1",
        user_id: "user-1",
        name: "Active Allocation",
        description: null,
        created_at: "2024-06-01T00:00:00Z",
        is_test: false,
      },
      {
        id: "test-1",
        user_id: "user-1",
        name: "What-if: Aggressive",
        description: null,
        created_at: "2024-07-01T00:00:00Z",
        is_test: true,
      },
    ];

    const { getRealPortfolio } = await import("./queries");
    const result = await getRealPortfolio("user-1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("real-1");
    expect(result!.name).toBe("Active Allocation");
    expect(result!.is_test).toBe(false);
  });

  it("returns null when the user has no real book yet", async () => {
    state.portfolios = [
      {
        id: "test-1",
        user_id: "user-1",
        name: "Scenario",
        description: null,
        created_at: "2024-07-01T00:00:00Z",
        is_test: true,
      },
    ];

    const { getRealPortfolio } = await import("./queries");
    const result = await getRealPortfolio("user-1");
    expect(result).toBeNull();
  });

  it("ignores is_test=true portfolios", async () => {
    state.portfolios = [
      {
        id: "test-1",
        user_id: "user-1",
        name: "What-if",
        description: null,
        created_at: "2024-07-01T00:00:00Z",
        is_test: true,
      },
      {
        id: "test-2",
        user_id: "user-1",
        name: "Another what-if",
        description: null,
        created_at: "2024-08-01T00:00:00Z",
        is_test: true,
      },
    ];

    const { getRealPortfolio } = await import("./queries");
    const result = await getRealPortfolio("user-1");
    expect(result).toBeNull();
  });
});

describe("getUserPortfolios — is_test column round-trip", () => {
  beforeEach(resetState);

  it("returns portfolios with is_test populated (regression for PR 1 type change)", async () => {
    state.portfolios = [
      {
        id: "real-1",
        user_id: "user-1",
        name: "Active Allocation",
        description: null,
        created_at: "2024-06-01T00:00:00Z",
        is_test: false,
      },
      {
        id: "test-1",
        user_id: "user-1",
        name: "What-if",
        description: null,
        created_at: "2024-07-01T00:00:00Z",
        is_test: true,
      },
    ];

    // Mock auth to return user-1 for this test (getUserPortfolios reads
    // the session user via its own supabase.auth.getUser call).
    const { getUserPortfolios } = await import("./queries");
    const result = await getUserPortfolios();
    expect(result).toHaveLength(2);
    const real = result.find((p) => p.id === "real-1");
    const test = result.find((p) => p.id === "test-1");
    expect(real?.is_test).toBe(false);
    expect(test?.is_test).toBe(true);
  });
});

describe("getTestPortfolios", () => {
  beforeEach(resetState);

  it("returns only is_test=true portfolios", async () => {
    state.portfolios = [
      {
        id: "real-1",
        user_id: "user-1",
        name: "Active Allocation",
        description: null,
        created_at: "2024-06-01T00:00:00Z",
        is_test: false,
      },
      {
        id: "test-1",
        user_id: "user-1",
        name: "What-if A",
        description: null,
        created_at: "2024-07-01T00:00:00Z",
        is_test: true,
      },
      {
        id: "test-2",
        user_id: "user-1",
        name: "What-if B",
        description: null,
        created_at: "2024-08-01T00:00:00Z",
        is_test: true,
      },
    ];

    const { getTestPortfolios } = await import("./queries");
    const result = await getTestPortfolios("user-1");
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.is_test === true)).toBe(true);
    expect(result.map((p) => p.id).sort()).toEqual(["test-1", "test-2"]);
  });

  it("returns empty array when the user has no test portfolios", async () => {
    state.portfolios = [
      {
        id: "real-1",
        user_id: "user-1",
        name: "Active",
        description: null,
        created_at: "2024-06-01T00:00:00Z",
        is_test: false,
      },
    ];

    const { getTestPortfolios } = await import("./queries");
    const result = await getTestPortfolios("user-1");
    expect(result).toEqual([]);
  });
});

describe("getUserFavorites", () => {
  beforeEach(resetState);

  it("returns the user's favorites with joined strategy data", async () => {
    const strategy = {
      id: "strat-a",
      name: "Polaris Arb",
      codename: null,
      disclosure_tier: "institutional",
      strategy_types: ["arbitrage"],
      markets: ["BTC"],
      start_date: "2022-01-03",
      strategy_analytics: {
        daily_returns: [{ date: "2024-01-02", value: 0.001 }],
        cagr: 0.15,
        sharpe: 1.4,
        volatility: 0.12,
        max_drawdown: -0.05,
      },
    };
    state.favorites = [
      {
        user_id: "user-1",
        strategy_id: "strat-a",
        created_at: "2026-04-01T00:00:00Z",
        notes: null,
        strategy,
      },
    ];

    const { getUserFavorites } = await import("./queries");
    const result = await getUserFavorites("user-1");
    expect(result).toHaveLength(1);
    expect(result[0].user_id).toBe("user-1");
    expect(result[0].strategy_id).toBe("strat-a");
    expect(result[0].strategy.name).toBe("Polaris Arb");
    expect(result[0].strategy.strategy_analytics?.sharpe).toBe(1.4);
  });

  it("returns empty array when the user has no favorites", async () => {
    const { getUserFavorites } = await import("./queries");
    const result = await getUserFavorites("user-1");
    expect(result).toEqual([]);
  });
});

describe("getMyAllocationDashboard", () => {
  beforeEach(resetState);

  it("returns null portfolio when the user has no real book", async () => {
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.portfolio).toBeNull();
    expect(result.strategies).toEqual([]);
    expect(result.favorites).toEqual([]);
    expect(result.alertCount.total).toBe(0);
  });

  it("returns portfolio + analytics + empty arrays when everything else is absent", async () => {
    state.portfolios = [
      {
        id: "real-1",
        user_id: "user-1",
        name: "Active Allocation",
        description: null,
        created_at: "2024-06-01T00:00:00Z",
        is_test: false,
      },
    ];
    state.analytics = [
      {
        id: "an-1",
        portfolio_id: "real-1",
        computed_at: "2026-04-09T00:00:00Z",
        total_aum: 1_000_000,
        return_ytd: 0.12,
      },
    ];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.portfolio?.id).toBe("real-1");
    expect(result.analytics).not.toBeNull();
    expect((result.analytics as { total_aum: number }).total_aum).toBe(
      1_000_000,
    );
    expect(result.strategies).toEqual([]);
    expect(result.favorites).toEqual([]);
    expect(result.alertCount).toEqual({
      high: 0,
      medium: 0,
      low: 0,
      total: 0,
    });
  });

  it("tallies alerts by severity", async () => {
    state.portfolios = [
      {
        id: "real-1",
        user_id: "user-1",
        name: "Active Allocation",
        description: null,
        created_at: "2024-06-01T00:00:00Z",
        is_test: false,
      },
    ];
    state.alerts = [
      { id: "a1", portfolio_id: "real-1", severity: "high", acknowledged_at: null },
      { id: "a2", portfolio_id: "real-1", severity: "high", acknowledged_at: null },
      { id: "a3", portfolio_id: "real-1", severity: "medium", acknowledged_at: null },
      { id: "a4", portfolio_id: "real-1", severity: "low", acknowledged_at: null },
    ];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.alertCount).toEqual({
      high: 2,
      medium: 1,
      low: 1,
      total: 4,
    });
  });
});
