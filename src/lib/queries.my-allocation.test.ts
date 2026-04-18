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
  apiKeys: [] as Array<{
    id: string;
    user_id: string;
    exchange: string;
    label: string;
    is_active: boolean;
    sync_status: string | null;
    last_sync_at: string | null;
    account_balance_usdt: number | null;
    created_at: string;
  }>,
  alerts: [] as Array<{
    id: string;
    portfolio_id: string;
    severity: string;
    acknowledged_at: string | null;
  }>,
  // outcome eligibility fan-out state.
  // Types include allocator_id + decision because the mock buildChain
  // applies eq() filters for those columns from the fan-out queries.
  sentAsIntroDecisions: [] as Array<{
    strategy_id: string;
    allocator_id?: string;
    decision?: string;
  }>,
  bridgeOutcomes: [] as Array<{
    id: string;
    strategy_id: string;
    allocator_id?: string;
    kind: string;
    percent_allocated: number | null;
    allocated_at: string | null;
    rejection_reason: string | null;
    note: string | null;
    delta_30d: number | null;
    delta_90d: number | null;
    delta_180d: number | null;
    estimated_delta_bps: number | null;
    estimated_days: number | null;
    needs_recompute: boolean;
    created_at: string;
  }>,
  bridgeDismissals: [] as Array<{
    strategy_id: string;
    allocator_id?: string;
    expires_at: string;
  }>,
}));

function resetState() {
  state.portfolios = [];
  state.portfolioStrategies = [];
  state.analytics = [];
  state.apiKeys = [];
  state.alerts = [];
  state.sentAsIntroDecisions = [];
  state.bridgeOutcomes = [];
  state.bridgeDismissals = [];
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
      case "api_keys":
        return applyFilters(state.apiKeys);
      case "portfolio_alerts":
        return applyFilters(state.alerts);
      // outcome eligibility fan-out tables
      case "match_decisions":
        return applyFilters(
          state.sentAsIntroDecisions as Array<Record<string, unknown>>,
        );
      case "bridge_outcomes":
        return applyFilters(
          state.bridgeOutcomes as Array<Record<string, unknown>>,
        );
      case "bridge_outcome_dismissals":
        // For dismissals, the chain uses .gt("expires_at", nowIso).
        // We simulate this by returning rows whose expires_at is in the future
        // relative to the current time at test execution.
        return applyFilters(
          state.bridgeDismissals as Array<Record<string, unknown>>,
        ).filter((r) => {
          const row = r as { expires_at: string };
          return new Date(row.expires_at) > new Date();
        });
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
    // .gt() is used by bridge_outcome_dismissals to filter active rows.
    // The rowsFor() implementation handles the actual filtering; this
    // method just returns chain to allow chaining.
    gt: (_column: string, _value: unknown) => chain,
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

describe("getMyAllocationDashboard", () => {
  beforeEach(resetState);

  it("returns null portfolio + empty arrays when the user has no real book", async () => {
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.portfolio).toBeNull();
    expect(result.strategies).toEqual([]);
    expect(result.apiKeys).toEqual([]);
    expect(result.alertCount.total).toBe(0);
  });

  it("returns portfolio + analytics + apiKeys + empty arrays when everything else is absent", async () => {
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
    expect(result.apiKeys).toEqual([]);
    expect(result.alertCount).toEqual({
      critical: 0,
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
      critical: 0,
      high: 2,
      medium: 1,
      low: 1,
      total: 4,
    });
  });
});

// outcome eligibility fan-out tests.
// Each test builds a minimal fixture and verifies eligible_for_outcome
// and existing_outcome per D-03.
const PORTFOLIO_FIXTURE = {
  id: "real-1",
  user_id: "user-1",
  name: "Active Allocation",
  description: null,
  created_at: "2024-06-01T00:00:00Z",
  is_test: false,
};

// A strategy that is part of the portfolio
const PS_S1 = {
  portfolio_id: "real-1",
  strategy_id: "s1",
  current_weight: 0.2,
  allocated_amount: 50000,
  strategy: {
    id: "s1",
    name: "Strategy Alpha",
    codename: null,
    disclosure_tier: "exploratory",
    strategy_types: [],
    markets: [],
    start_date: null,
    strategy_analytics: null,
  },
  alias: null,
};

const PS_S2 = { ...PS_S1, strategy_id: "s2", strategy: { ...PS_S1.strategy, id: "s2", name: "Strategy Beta" } };
const PS_S3 = { ...PS_S1, strategy_id: "s3", strategy: { ...PS_S1.strategy, id: "s3", name: "Strategy Gamma" } };
const PS_S5 = { ...PS_S1, strategy_id: "s5", strategy: { ...PS_S1.strategy, id: "s5", name: "Strategy Delta" } };

const EXISTING_OUTCOME_S2 = {
  id: "outcome-s2",
  strategy_id: "s2",
  kind: "allocated",
  percent_allocated: 10,
  allocated_at: "2026-04-01",
  rejection_reason: null,
  note: null,
  delta_30d: null,
  delta_90d: null,
  delta_180d: null,
  estimated_delta_bps: null,
  estimated_days: null,
  needs_recompute: true,
  created_at: "2026-04-01T00:00:00Z",
};

describe("getMyAllocationDashboard — outcome eligibility fan-out", () => {
  beforeEach(() => {
    resetState();
    // Common portfolio fixture
    state.portfolios = [PORTFOLIO_FIXTURE];
  });

  it("TC1 — eligible row: sent_as_intro, no outcome, no active dismissal → eligible_for_outcome=true, existing_outcome=null", async () => {
    state.portfolioStrategies = [PS_S1 as unknown as typeof state.portfolioStrategies[number]];
    state.sentAsIntroDecisions = [{ strategy_id: "s1", allocator_id: "user-1", decision: "sent_as_intro" }];
    state.bridgeOutcomes = [];
    state.bridgeDismissals = [];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    const row = result.strategies.find((s) => s.strategy_id === "s1");
    expect(row).toBeDefined();
    expect(row!.eligible_for_outcome).toBe(true);
    expect(row!.existing_outcome).toBeNull();
  });

  it("TC2 — already-outcomed row: sent_as_intro + existing outcome → eligible_for_outcome=false, existing_outcome populated", async () => {
    state.portfolioStrategies = [PS_S2 as unknown as typeof state.portfolioStrategies[number]];
    state.sentAsIntroDecisions = [{ strategy_id: "s2", allocator_id: "user-1", decision: "sent_as_intro" }];
    state.bridgeOutcomes = [{ ...EXISTING_OUTCOME_S2, allocator_id: "user-1" }];
    state.bridgeDismissals = [];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    const row = result.strategies.find((s) => s.strategy_id === "s2");
    expect(row).toBeDefined();
    expect(row!.eligible_for_outcome).toBe(false);
    expect(row!.existing_outcome).not.toBeNull();
    expect(row!.existing_outcome!.id).toBe("outcome-s2");
    expect(row!.existing_outcome!.kind).toBe("allocated");
    expect(row!.existing_outcome!.percent_allocated).toBe(10);
  });

  it("TC3 — snoozed row: sent_as_intro + active dismissal → eligible_for_outcome=false, existing_outcome=null", async () => {
    state.portfolioStrategies = [PS_S3 as unknown as typeof state.portfolioStrategies[number]];
    state.sentAsIntroDecisions = [{ strategy_id: "s3", allocator_id: "user-1", decision: "sent_as_intro" }];
    state.bridgeOutcomes = [];
    // Active dismissal: expires_at in the future
    state.bridgeDismissals = [
      {
        strategy_id: "s3",
        allocator_id: "user-1",
        expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      },
    ];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    const row = result.strategies.find((s) => s.strategy_id === "s3");
    expect(row).toBeDefined();
    expect(row!.eligible_for_outcome).toBe(false);
    expect(row!.existing_outcome).toBeNull();
  });

  it("TC4 — expired dismissal: sent_as_intro + expired dismissal → eligible_for_outcome=true", async () => {
    state.portfolioStrategies = [PS_S3 as unknown as typeof state.portfolioStrategies[number]];
    state.sentAsIntroDecisions = [{ strategy_id: "s3", allocator_id: "user-1", decision: "sent_as_intro" }];
    state.bridgeOutcomes = [];
    // Expired dismissal: expires_at in the past — should NOT hide the row
    state.bridgeDismissals = [
      {
        strategy_id: "s3",
        allocator_id: "user-1",
        expires_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    ];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    const row = result.strategies.find((s) => s.strategy_id === "s3");
    expect(row).toBeDefined();
    expect(row!.eligible_for_outcome).toBe(true);
    expect(row!.existing_outcome).toBeNull();
  });

  it("TC5 — no sent_as_intro: no match_decisions row → eligible_for_outcome=false regardless", async () => {
    state.portfolioStrategies = [PS_S5 as unknown as typeof state.portfolioStrategies[number]];
    state.sentAsIntroDecisions = []; // no sent_as_intro for s5
    state.bridgeOutcomes = [];
    state.bridgeDismissals = [];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    const row = result.strategies.find((s) => s.strategy_id === "s5");
    expect(row).toBeDefined();
    expect(row!.eligible_for_outcome).toBe(false);
    expect(row!.existing_outcome).toBeNull();
  });
});
