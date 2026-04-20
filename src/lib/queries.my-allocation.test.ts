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
  // Phase 07 / 07-03 — allocator equity snapshots for getMyAllocationDashboard rewire
  allocatorEquitySnapshots: [] as Array<{
    allocator_id: string;
    asof: string;
    value_usd: number;
    breakdown: Record<string, number> | null;
    source: "exchange_primary" | "coingecko_fallback" | "mixed";
    history_depth_months: number | null;
  }>,
  // Phase 07 / 07-03 — allocator holdings (Phase 06 table) read for holdingsSummary
  allocatorHoldings: [] as Array<{
    allocator_id: string;
    symbol: string;
    quantity: number;
    mark_price: number | null;
    value_usd: number;
    venue: string;
    holding_type: "spot" | "derivative";
    asof: string;
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
  state.allocatorEquitySnapshots = [];
  state.allocatorHoldings = [];
  chainAudit.entries.length = 0;
}

// Phase 5 Voice-D4 + D5 — record every `.eq(column, value)` and `.limit(n)`
// call on each chain invocation so the outcomes fan-out tests can assert:
//  - (Voice-D4) the admin chain targeting bridge_outcomes has .eq("allocator_id", userId)
//  - (Voice-D5) .limit(200) was called on the same chain
type ChainAuditEntry = {
  table: string;
  select: string | null;
  eqs: Array<{ column: string; value: unknown }>;
  limitN: number | null;
  headCount: boolean;
};
const chainAudit = vi.hoisted(() => ({
  entries: [] as ChainAuditEntry[],
}));

type Filter = { column: string; value: unknown; op: "eq" | "in" | "is" };

/**
 * Minimal builder that supports the methods these helpers actually use:
 * .select, .eq, .in, .is, .order, .limit, .maybeSingle, .single.
 * Each call returns `this` for chaining except the terminal resolvers.
 */
function buildChain(table: string) {
  const filters: Filter[] = [];
  const audit: ChainAuditEntry = {
    table,
    select: null,
    eqs: [],
    limitN: null,
    headCount: false,
  };
  chainAudit.entries.push(audit);
  let limitN: number | null = null;
  // Phase 07 / 07-03 — supabase.select("*", { count: "exact", head: true })
  // returns only the row count without rows. When this mode is set, the
  // terminal resolver returns { data: null, error: null, count: N }.
  let headCountMode = false;

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
      case "allocator_equity_snapshots":
        return applyFilters(
          state.allocatorEquitySnapshots as Array<Record<string, unknown>>,
        );
      case "allocator_holdings":
        return applyFilters(
          state.allocatorHoldings as Array<Record<string, unknown>>,
        );
      default:
        return [];
    }
  }

  const chain = {
    select: (
      cols?: string,
      options?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
    ) => {
      audit.select = cols ?? null;
      if (options?.head === true) {
        headCountMode = true;
        audit.headCount = true;
      }
      return chain;
    },
    eq: (column: string, value: unknown) => {
      filters.push({ column, value, op: "eq" });
      audit.eqs.push({ column, value });
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
    order: (_column?: string, _opts?: { ascending?: boolean }) => chain,
    limit: (n: number) => {
      limitN = n;
      audit.limitN = n;
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
    // When headCountMode is set (via select("*", { count: "exact", head: true })),
    // resolve to { data: null, error: null, count: N } instead of rows.
    then: (
      resolve: (
        v:
          | { data: unknown[]; error: null; count?: number }
          | { data: null; error: null; count: number },
      ) => void,
    ) => {
      const rows = rowsFor();
      if (headCountMode) {
        resolve({ data: null, error: null, count: rows.length });
      } else {
        resolve({ data: rows, error: null });
      }
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

// ---------------------------------------------------------------------------
// Phase 5 D-15 — getMyAllocationDashboard outcomes top-level fan-out
// ---------------------------------------------------------------------------

const P5_OUTCOME_O1 = {
  id: "outcome-1",
  strategy_id: "s-repl",
  match_decision_id: "md-1",
  allocator_id: "user-1",
  kind: "allocated",
  percent_allocated: 12,
  allocated_at: "2026-03-01",
  rejection_reason: null,
  note: null,
  delta_30d: 0.04,
  delta_90d: null,
  delta_180d: null,
  estimated_delta_bps: null,
  estimated_days: null,
  needs_recompute: false,
  created_at: "2026-04-01T00:00:00Z",
  // Synthesized embed fields — the mock chain returns these as-is for
  // bridge_outcomes rows; the queries.ts normalizer should carry them
  // through to payload.outcomes[i].match_decision / .replacement_strategy.
  replacement_strategy: { id: "s-repl", name: "Crypto Momentum LP" },
  match_decision: {
    original_strategy: { id: "s-orig", name: "Legacy Equity LP" },
  },
};

const P5_OUTCOME_O2 = {
  ...P5_OUTCOME_O1,
  id: "outcome-2",
  match_decision_id: null,
  created_at: "2026-03-01T00:00:00Z",
  match_decision: null,
};

describe("getMyAllocationDashboard — outcomes top-level fan-out (Phase 5 D-15)", () => {
  beforeEach(() => {
    resetState();
    state.portfolios = [PORTFOLIO_FIXTURE];
  });

  it("TC outcomes-01: payload has top-level outcomes: Array<OutcomeRow> sorted created_at DESC", async () => {
    state.bridgeOutcomes = [
      P5_OUTCOME_O2 as unknown as typeof state.bridgeOutcomes[number],
      P5_OUTCOME_O1 as unknown as typeof state.bridgeOutcomes[number],
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(Array.isArray(result.outcomes)).toBe(true);
    expect(result.outcomes.length).toBe(2);
    // Caller (queries.ts) applies .order('created_at', ascending:false) via the
    // admin chain; the mock doesn't sort — rely on caller passing rows sorted.
  });

  it("TC outcomes-02: each outcome carries replacement_strategy: {id,name} AND match_decision.original_strategy: {id,name} via nested FK embed", async () => {
    state.bridgeOutcomes = [
      P5_OUTCOME_O1 as unknown as typeof state.bridgeOutcomes[number],
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    const o = result.outcomes[0];
    expect(o.replacement_strategy?.name).toBe("Crypto Momentum LP");
    expect(o.match_decision?.original_strategy.name).toBe("Legacy Equity LP");
    expect(o.match_decision?.original_strategy.id).toBe("s-orig");
  });

  it("TC outcomes-03: when match_decision_id is NULL, outcomes[0].match_decision === null (em-dash case for UI D-03)", async () => {
    state.bridgeOutcomes = [
      P5_OUTCOME_O2 as unknown as typeof state.bridgeOutcomes[number],
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    const o = result.outcomes[0];
    expect(o.match_decision).toBeNull();
  });

  it("TC outcomes-04: empty outcomes set -> payload.outcomes === [] (not null/undefined)", async () => {
    state.bridgeOutcomes = [];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.outcomes).toEqual([]);
  });

  it("TC outcomes-05: outcomes fan-out includes .eq('allocator_id', userId) on the admin chain + .limit(200) (Voice-D4 + D5 regression gate)", async () => {
    state.bridgeOutcomes = [
      P5_OUTCOME_O1 as unknown as typeof state.bridgeOutcomes[number],
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    await getMyAllocationDashboard("user-1");

    // Find bridge_outcomes chain invocation(s) that included the nested embed
    // (distinguishable from the existing fan-out chain by presence of the
    // match_decision embed OR the .limit(200) call).
    const outcomesChains = chainAudit.entries.filter(
      (c) => c.table === "bridge_outcomes",
    );
    expect(outcomesChains.length).toBeGreaterThanOrEqual(1);

    // Voice-D5: at least ONE bridge_outcomes chain must have limit(200)
    const limitedChains = outcomesChains.filter((c) => c.limitN === 200);
    expect(limitedChains.length).toBeGreaterThanOrEqual(1);

    // Voice-D4: that same chain must have .eq("allocator_id", "user-1")
    const limited = limitedChains[0];
    expect(
      limited.eqs.some(
        (e) => e.column === "allocator_id" && e.value === "user-1",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 07 / 07-03 — getMyAllocationDashboard Phase 07 payload extensions
//
// New fields per VOICES-ACCEPTED f7 + f9:
//   - equitySnapshots, holdingsSummary, snapshotCount, allKeysStale,
//     lastSyncAt, hasSyncing, equityDailyPoints, minHistoryDepthMonths,
//     activeVenues
//
// The rewire MUST still populate these fields when the allocator has
// NO portfolios row — per Phase 07 SC3 (fresh allocator with api_keys +
// snapshots but no portfolio_strategies row). The !portfolio early-return
// short-circuit is removed.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

const P7_PORTFOLIO = {
  id: "real-1",
  user_id: "user-1",
  name: "Active Allocation",
  description: null,
  created_at: "2024-06-01T00:00:00Z",
  is_test: false,
};

describe("getMyAllocationDashboard — Phase 07 payload extensions", () => {
  beforeEach(resetState);

  it("TC p7-01: payload carries all 9 Phase 07 field names", async () => {
    // Include a portfolio so the function takes the main branch and
    // exercises every new fetch; the `!portfolio` branch is tested in p7-02.
    state.portfolios = [P7_PORTFOLIO];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = (await getMyAllocationDashboard("user-1")) as unknown as Record<
      string,
      unknown
    >;
    expect(result).toHaveProperty("equitySnapshots");
    expect(result).toHaveProperty("holdingsSummary");
    expect(result).toHaveProperty("snapshotCount");
    expect(result).toHaveProperty("allKeysStale");
    expect(result).toHaveProperty("lastSyncAt");
    expect(result).toHaveProperty("hasSyncing");
    expect(result).toHaveProperty("equityDailyPoints");
    expect(result).toHaveProperty("minHistoryDepthMonths");
    expect(result).toHaveProperty("activeVenues");
  });

  it("TC p7-02: no portfolio but has api_keys + snapshots → snapshotCount>0, equitySnapshots populated, equityDailyPoints derived", async () => {
    // SC3: allocator with no portfolio_strategies row still sees real
    // equity via the snapshot pipeline. Removes the !portfolio early-return.
    state.portfolios = [];
    state.apiKeys = [
      {
        id: "k1",
        user_id: "user-1",
        exchange: "binance",
        label: "Binance main",
        is_active: true,
        sync_status: "ok",
        last_sync_at: new Date().toISOString(),
        account_balance_usdt: 1000,
        created_at: "2026-04-01T00:00:00Z",
      },
    ];
    state.allocatorEquitySnapshots = [
      {
        allocator_id: "user-1",
        asof: "2026-04-10",
        value_usd: 10_000,
        breakdown: null,
        source: "exchange_primary",
        history_depth_months: 24,
      },
      {
        allocator_id: "user-1",
        asof: "2026-04-11",
        value_usd: 10_100,
        breakdown: null,
        source: "exchange_primary",
        history_depth_months: 24,
      },
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.portfolio).toBeNull();
    expect(result.snapshotCount).toBeGreaterThan(0);
    expect(result.equitySnapshots.length).toBeGreaterThan(0);
    expect(result.equityDailyPoints.length).toBeGreaterThan(0);
  });

  it("TC p7-03: snapshotCount equals mocked row count when < 30", async () => {
    state.portfolios = [P7_PORTFOLIO];
    // 15 snapshots (warm-up territory)
    state.allocatorEquitySnapshots = Array.from({ length: 15 }, (_, i) => ({
      allocator_id: "user-1",
      asof: `2026-03-${String(i + 1).padStart(2, "0")}`,
      value_usd: 1000 + i,
      breakdown: null,
      source: "exchange_primary" as const,
      history_depth_months: 24,
    }));
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.snapshotCount).toBe(15);
  });

  it("TC p7-04: all active api_keys last_sync_at older than 24h → allKeysStale=true, lastSyncAt=max(mocked)", async () => {
    state.portfolios = [P7_PORTFOLIO];
    const nowMs = Date.now();
    const staleA = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
    const staleB = new Date(nowMs - 36 * 60 * 60 * 1000).toISOString(); // 36h ago (max of the two)
    state.apiKeys = [
      {
        id: "k1",
        user_id: "user-1",
        exchange: "binance",
        label: "Binance",
        is_active: true,
        sync_status: "ok",
        last_sync_at: staleA,
        account_balance_usdt: null,
        created_at: "2026-04-01T00:00:00Z",
      },
      {
        id: "k2",
        user_id: "user-1",
        exchange: "okx",
        label: "OKX",
        is_active: true,
        sync_status: "ok",
        last_sync_at: staleB,
        account_balance_usdt: null,
        created_at: "2026-04-01T00:00:00Z",
      },
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.allKeysStale).toBe(true);
    expect(result.lastSyncAt).toBe(staleB);
  });

  it("TC p7-05: one fresh active key → allKeysStale=false", async () => {
    state.portfolios = [P7_PORTFOLIO];
    const nowMs = Date.now();
    state.apiKeys = [
      {
        id: "k1",
        user_id: "user-1",
        exchange: "binance",
        label: "Binance",
        is_active: true,
        sync_status: "ok",
        last_sync_at: new Date(nowMs - 48 * 60 * 60 * 1000).toISOString(),
        account_balance_usdt: null,
        created_at: "2026-04-01T00:00:00Z",
      },
      {
        id: "k2",
        user_id: "user-1",
        exchange: "okx",
        label: "OKX",
        is_active: true,
        sync_status: "ok",
        last_sync_at: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(), // 2h — fresh
        account_balance_usdt: null,
        created_at: "2026-04-01T00:00:00Z",
      },
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.allKeysStale).toBe(false);
  });

  it("TC p7-06: any active key sync_status='syncing' → hasSyncing=true", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [
      {
        id: "k1",
        user_id: "user-1",
        exchange: "binance",
        label: "Binance",
        is_active: true,
        sync_status: "syncing",
        last_sync_at: null,
        account_balance_usdt: null,
        created_at: "2026-04-01T00:00:00Z",
      },
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.hasSyncing).toBe(true);
  });

  it("TC p7-07 (f7): equitySnapshots of 5 daily rows → equityDailyPoints length 5, values preserved in order", async () => {
    state.portfolios = [P7_PORTFOLIO];
    const values = [100, 110, 105, 120, 115];
    state.allocatorEquitySnapshots = values.map((v, i) => ({
      allocator_id: "user-1",
      asof: new Date(Date.UTC(2026, 2, i + 1)).toISOString().slice(0, 10),
      value_usd: v,
      breakdown: null,
      source: "exchange_primary" as const,
      history_depth_months: 24,
    }));
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.equityDailyPoints).toHaveLength(5);
    expect(result.equityDailyPoints.map((p) => p.value)).toEqual(values);
  });

  it("TC p7-08 (f9): history_depth_months = [24,24,3] → minHistoryDepthMonths=3", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.allocatorEquitySnapshots = [
      {
        allocator_id: "user-1",
        asof: "2026-03-01",
        value_usd: 100,
        breakdown: null,
        source: "exchange_primary",
        history_depth_months: 24,
      },
      {
        allocator_id: "user-1",
        asof: "2026-03-02",
        value_usd: 110,
        breakdown: null,
        source: "exchange_primary",
        history_depth_months: 24,
      },
      {
        allocator_id: "user-1",
        asof: "2026-03-03",
        value_usd: 105,
        breakdown: null,
        source: "exchange_primary",
        history_depth_months: 3,
      },
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.minHistoryDepthMonths).toBe(3);
  });

  it("TC p7-09 (f9): all history_depth_months NULL → minHistoryDepthMonths=null", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.allocatorEquitySnapshots = [
      {
        allocator_id: "user-1",
        asof: "2026-03-01",
        value_usd: 100,
        breakdown: null,
        source: "coingecko_fallback",
        history_depth_months: null,
      },
      {
        allocator_id: "user-1",
        asof: "2026-03-02",
        value_usd: 110,
        breakdown: null,
        source: "coingecko_fallback",
        history_depth_months: null,
      },
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.minHistoryDepthMonths).toBeNull();
  });

  it("TC p7-10 (f9): active api_keys venues [binance, okx] → activeVenues=[Binance, OKX] display-cased + sorted", async () => {
    state.portfolios = [P7_PORTFOLIO];
    const nowIso = new Date().toISOString();
    state.apiKeys = [
      {
        id: "k1",
        user_id: "user-1",
        exchange: "okx",
        label: "OKX",
        is_active: true,
        sync_status: "ok",
        last_sync_at: nowIso,
        account_balance_usdt: null,
        created_at: "2026-04-01T00:00:00Z",
      },
      {
        id: "k2",
        user_id: "user-1",
        exchange: "binance",
        label: "Binance",
        is_active: true,
        sync_status: "ok",
        last_sync_at: nowIso,
        account_balance_usdt: null,
        created_at: "2026-04-01T00:00:00Z",
      },
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.activeVenues).toEqual(["Binance", "OKX"]);
  });
});

// Silence unused-var for DAY_MS helper (kept for future TC authors).
void DAY_MS;
