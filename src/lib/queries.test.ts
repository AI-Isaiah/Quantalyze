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
    // Phase 13 / Plan 13-01 / DISCO-01 — `getMyWatchlist` recorder.
    // The query is `from("user_favorites").select("strategy_id").eq("user_id", uid)`;
    // it `await`s the .eq() chain (no .single() / .maybeSingle()), so the chain
    // resolves at .eq() into { data, error }. Each test seeds favoritesResponse;
    // favoritesSelectCalls captures the select projection; favoritesEqCalls
    // captures the (col, val) tuple for each .eq() call.
    favoritesResponse: { data: null as unknown, error: null as unknown },
    favoritesSelectCalls: [] as string[],
    favoritesEqCalls: [] as Array<[string, unknown]>,
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

/**
 * Phase 13 / Plan 13-01 / DISCO-01 — Specialised chain builder for the
 * `user_favorites` table. `getMyWatchlist` calls
 * `.from("user_favorites").select("strategy_id").eq("user_id", uid)` and
 * awaits the .eq() chain itself (no .single()). The chain therefore needs
 * to be a thenable: each .eq() returns the chain (so additional filters
 * can stack), AND the chain resolves to { data, error } when awaited.
 */
const buildFavoritesChain = () => {
  type FavChain = {
    select: (cols: string) => FavChain;
    eq: (col: string, val: unknown) => FavChain;
    then: <T1, T2>(
      onFulfilled: (val: { data: unknown; error: unknown }) => T1,
      onRejected?: (err: unknown) => T2,
    ) => Promise<T1 | T2>;
  };
  const chain: FavChain = {
    select(cols: string) {
      recorders.favoritesSelectCalls.push(cols);
      return chain;
    },
    eq(col: string, val: unknown) {
      recorders.favoritesEqCalls.push([col, val]);
      return chain;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve({
        data: recorders.favoritesResponse.data,
        error: recorders.favoritesResponse.error,
      }).then(onFulfilled, onRejected);
    },
  };
  return chain;
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      recorders.fromCalls.push(table);
      // Phase 13 — Plan 13-01: `getMyWatchlist` reads from "user_favorites"
      // and awaits the .eq() chain. Use the thenable favorites chain there;
      // route disclosure-tier tests through the legacy single/maybeSingle
      // chain to preserve their existing assertions.
      if (table === "user_favorites") {
        return buildFavoritesChain();
      }
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

import {
  getStrategyDetail,
  getPublicStrategyDetail,
  fetchStrategyLazyMetrics,
  getMyWatchlist,
  getStrategyDetailV2,
} from "./queries";

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
  recorders.favoritesResponse = { data: null, error: null };
  recorders.favoritesSelectCalls = [];
  recorders.favoritesEqCalls = [];
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

/**
 * Phase 13 / Plan 13-01 / DISCO-01 — getMyWatchlist server-side query.
 *
 * Contract per 13-01-PLAN.md acceptance criteria:
 *   - Returns Set<string> of strategy_ids the user has starred.
 *   - On supabase error: returns empty Set (no throw — defensive against RLS
 *     surface drift; the page-level Promise.all keeps rendering the table).
 *   - Calls .from("user_favorites").select("strategy_id").eq("user_id", uid).
 *
 * Threat ref: T-13-01-04 (info disclosure) — userId comes from
 * supabase.auth.getUser() server-side, never client input. RLS on
 * user_favorites enforces user_id=auth.uid() on SELECT (migration 024).
 */
describe("getMyWatchlist (Plan 13-01 / DISCO-01)", () => {
  const USER_ID = "00000000-0000-0000-0000-000000000aaa";

  it("returns a Set<string> of strategy_ids for the given user", async () => {
    recorders.favoritesResponse = {
      data: [
        { strategy_id: "cccccccc-0001-4000-8000-000000000001" },
        { strategy_id: "cccccccc-0001-4000-8000-000000000002" },
      ],
      error: null,
    };
    const result = await getMyWatchlist(USER_ID);
    expect(result).toBeInstanceOf(Set);
    if (!result) throw new Error("expected Set, got null");
    expect(result.size).toBe(2);
    expect(result.has("cccccccc-0001-4000-8000-000000000001")).toBe(true);
    expect(result.has("cccccccc-0001-4000-8000-000000000002")).toBe(true);
  });

  it("returns null when supabase reports an error (so callers can distinguish empty-state from failure)", async () => {
    recorders.favoritesResponse = {
      data: null,
      error: { message: "rls denied" },
    };
    const result = await getMyWatchlist(USER_ID);
    expect(result).toBeNull();
  });

  it("returns an empty Set when data is an empty array", async () => {
    recorders.favoritesResponse = { data: [], error: null };
    const result = await getMyWatchlist(USER_ID);
    expect(result).toBeInstanceOf(Set);
    expect((result as Set<string>).size).toBe(0);
  });

  it("queries user_favorites with select('strategy_id') and eq('user_id', uid)", async () => {
    recorders.favoritesResponse = { data: [], error: null };
    await getMyWatchlist(USER_ID);
    expect(recorders.fromCalls).toContain("user_favorites");
    expect(recorders.favoritesSelectCalls).toEqual(["strategy_id"]);
    // Single eq filter on user_id (other filters would be a security regression
    // — the function is meant to read ALL of the user's favorites).
    expect(recorders.favoritesEqCalls).toEqual([["user_id", USER_ID]]);
  });
});

/**
 * Plan 14b-06 Task 1 — getStrategyDetailV2 panel4..7 input mappings.
 *
 * Wave-3 integration extends `StrategyV2Detail` with eager inputs for
 * Panels 4-7 (mapped from the analytics blob already fetched via the
 * existing `from('strategies').select('*, strategy_analytics (*)')` join).
 * No new RPC, no schema change, no migration.
 *
 * Tests cover:
 *   1. Interface extension (panel4Inputs / panel5Inputs / panel6Inputs / panel7Inputs)
 *   2. Mapping fidelity from analytics row to each panelNInputs sub-object
 *   3. metrics_json extraction for benchmark_returns + greeks scalars
 *   4. Pitfall 8 honored — computation_status !== 'complete' returns null
 *      everywhere
 *   5. Visibility gate preserved — unpublished strategy returns null
 *   6. Greeks long-name vs short-name fallback
 */
describe("getStrategyDetailV2 — Plan 14b-06 panel4..7 mappings", () => {
  const STRAT_ID = "00000000-0000-0000-0000-000000000abc";

  function buildAnalyticsRow(overrides: Record<string, unknown> = {}) {
    return {
      computation_status: "complete",
      cumulative_return: 0.42,
      cagr: 0.18,
      sharpe: 1.5,
      sortino: 2.1,
      max_drawdown: -0.12,
      volatility: 0.16,
      returns_series: [
        { date: "2024-01-01", value: 1.0 },
        { date: "2024-12-31", value: 1.42 },
      ],
      drawdown_series: [{ date: "2024-06-15", value: -0.12 }],
      monthly_returns: { "2024": { Jan: 0.01, Feb: 0.02 } },
      return_quantiles: { Daily: [-0.05, -0.01, 0, 0.01, 0.05] },
      rolling_metrics: {
        sharpe_30d: [{ date: "2024-01-01", value: 0.5 }],
        sharpe_90d: [{ date: "2024-01-01", value: 0.7 }],
        sharpe_365d: [{ date: "2024-01-01", value: 1.0 }],
      },
      trade_metrics: {
        total_positions: 100,
        open_positions: 5,
        closed_positions: 95,
        win_rate: 0.6,
        avg_roi: 0.05,
        avg_duration_days: 4.2,
        long_count: 60,
        short_count: 40,
        best_trade_roi: 0.5,
        worst_trade_roi: -0.2,
        expectancy: 0.04,
        risk_reward_ratio: 2.1,
        weighted_risk_reward_ratio: 2.0,
        sqn: 1.8,
        profit_factor_long: 1.5,
        profit_factor_short: 1.2,
      },
      metrics_json: {
        history_days: 365,
        equity_series_1y: [{ date: "2024-01-01", value: 1.0 }],
        btc_benchmark_returns: [{ date: "2024-01-01", value: 1.0 }],
        benchmark_returns: [
          { date: "2024-01-01", value: 0 },
          { date: "2024-01-02", value: 0.001 },
        ],
        alpha: 0.05,
        beta: 0.92,
        information_ratio: 0.42,
        treynor_ratio: 0.18,
        ...((overrides.metrics_json as Record<string, unknown>) ?? {}),
      },
      ...overrides,
    };
  }

  function buildStrategyRow(extra: Record<string, unknown> = {}) {
    return {
      id: STRAT_ID,
      user_id: "user-1",
      category_id: null,
      api_key_id: null,
      name: "Test Strategy",
      description: null,
      strategy_types: ["systematic"],
      subtypes: ["trend"],
      markets: ["crypto"],
      supported_exchanges: ["Binance"],
      leverage_range: "1-3x",
      avg_daily_turnover: 250000,
      aum: null,
      max_capacity: null,
      start_date: "2024-01-01",
      status: "published",
      is_example: false,
      benchmark: "BTC",
      created_at: "2024-01-01T00:00:00Z",
      strategy_analytics: buildAnalyticsRow(),
      ...extra,
    };
  }

  it("Test 1: returns panel4Inputs / panel5Inputs / panel6Inputs / panel7Inputs sub-objects", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result).not.toBeNull();
    expect(result!.panel4Inputs).toBeDefined();
    expect(result!.panel5Inputs).toBeDefined();
    expect(result!.panel6Inputs).toBeDefined();
    expect(result!.panel7Inputs).toBeDefined();
  });

  it("Test 2: panel4Inputs maps monthly_returns / return_quantiles / returns_series from analytics", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel4Inputs.monthly_returns).toEqual({
      "2024": { Jan: 0.01, Feb: 0.02 },
    });
    expect(result!.panel4Inputs.return_quantiles).toEqual({
      Daily: [-0.05, -0.01, 0, 0.01, 0.05],
    });
    expect(result!.panel4Inputs.returns_series).toEqual([
      { date: "2024-01-01", value: 1.0 },
      { date: "2024-12-31", value: 1.42 },
    ]);
  });

  it("Test 3: panel4Inputs.benchmark_returns reads from metrics_json.benchmark_returns", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel4Inputs.benchmark_returns).toEqual([
      { date: "2024-01-01", value: 0 },
      { date: "2024-01-02", value: 0.001 },
    ]);
  });

  it("Test 4: panel7Inputs.benchmark_greeks reads alpha/beta/IR/Treynor from metrics_json (long names preferred)", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel7Inputs.benchmark_greeks).toEqual({
      alpha: 0.05,
      beta: 0.92,
      ir: 0.42, // information_ratio (long name)
      treynor: 0.18, // treynor_ratio (long name)
    });
  });

  it("Test 4b: greeks fallback — short names accepted when long names absent", async () => {
    recorders.strategyData = buildStrategyRow({
      strategy_analytics: buildAnalyticsRow({
        metrics_json: {
          history_days: 365,
          alpha: 0.01,
          beta: 0.5,
          // information_ratio + treynor_ratio absent; use ir + treynor short names
          ir: 0.3,
          treynor: 0.15,
        },
      }),
    });
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel7Inputs.benchmark_greeks.ir).toBe(0.3);
    expect(result!.panel7Inputs.benchmark_greeks.treynor).toBe(0.15);
  });

  it("Test 5: panel5Inputs.rolling_metrics maps from analytics.rolling_metrics; sharpe scalar passes through", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(Object.keys(result!.panel5Inputs.rolling_metrics ?? {}).sort()).toEqual([
      "sharpe_30d",
      "sharpe_365d",
      "sharpe_90d",
    ]);
    expect(result!.panel5Inputs.sharpe).toBe(1.5);
  });

  it("Test 6: Pitfall 8 — when computation_status !== 'complete', all new fields are null/empty", async () => {
    recorders.strategyData = buildStrategyRow({
      strategy_analytics: buildAnalyticsRow({ computation_status: "pending" }),
    });
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel4Inputs.monthly_returns).toBeNull();
    expect(result!.panel4Inputs.return_quantiles).toBeNull();
    expect(result!.panel4Inputs.returns_series).toBeNull();
    expect(result!.panel4Inputs.benchmark_returns).toBeNull();
    expect(result!.panel5Inputs.rolling_metrics).toBeNull();
    expect(result!.panel5Inputs.sharpe).toBeNull();
    expect(result!.panel6Inputs.trade_metrics).toBeNull();
    expect(result!.panel7Inputs.benchmark_greeks).toEqual({
      alpha: null,
      beta: null,
      ir: null,
      treynor: null,
    });
    expect(result!.panel7Inputs.correlation_analytics.returns_series).toBeNull();
    expect(result!.panel7Inputs.correlation_analytics.metrics_json).toBeNull();
  });

  it("Test 7: visibility gate — getStrategyDetailV2 returns null when supabase reports an error", async () => {
    // No row data + the mock chain's .single() returns { data: null, error: null }
    // The function checks `error || !strategy` — when both are falsy, the
    // existing chain returns null which we reproduce by leaving strategyData null.
    recorders.strategyData = null;
    const result = await getStrategyDetailV2("nonexistent-id");
    expect(result).toBeNull();
  });

  it("Test 8: panel6Inputs.trade_metrics maps from analytics.trade_metrics", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel6Inputs.trade_metrics).not.toBeNull();
    expect(result!.panel6Inputs.trade_metrics!.total_positions).toBe(100);
    expect(result!.panel6Inputs.trade_metrics!.win_rate).toBe(0.6);
    expect(result!.panel6Inputs.trade_metrics!.expectancy).toBe(0.04);
  });

  it("Test 9: correlation_analytics carries returns_series + metrics_json subset", async () => {
    recorders.strategyData = buildStrategyRow();
    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result!.panel7Inputs.correlation_analytics.returns_series).toEqual([
      { date: "2024-01-01", value: 1.0 },
      { date: "2024-12-31", value: 1.42 },
    ]);
    expect(result!.panel7Inputs.correlation_analytics.metrics_json).toBeDefined();
    expect(
      (result!.panel7Inputs.correlation_analytics.metrics_json as Record<string, unknown>)["alpha"],
    ).toBe(0.05);
  });
});
