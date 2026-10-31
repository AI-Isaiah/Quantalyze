import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { StrategyForBuilder } from "./scenario";

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
    // Prod selects this for isPerKeyDailiesEligibleKey; optional so fixtures that
    // don't set it (→ eligible on the disconnect axis) keep compiling.
    disconnected_at?: string | null;
    // Review C4 SFH-C4-01: the account identity the per-key holdings read
    // groups on. Optional for the same reason.
    venue_account_id?: string | null;
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
  // Phase 176 (D-02): the legacy table is no longer read. Only the "176 D-02 / D-07"
  // arms seed it, to prove the payload ignores rows that are present.
  allocatorEquitySnapshots: [] as Array<{
    allocator_id: string;
    asof: string;
    value_usd: number;
    breakdown: Record<string, number> | null;
    source: "exchange_primary" | "coingecko_fallback" | "mixed";
    history_depth_months: number | null;
    // CL9 / NEW-C01-11 — optional so existing seeds (which omit it) compile;
    // the read boundary treats undefined as trustworthy.
    pre_terminus_balance_unknown?: boolean;
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
    // Phase 36 / 36-03 — api_key_id is the per-key WEIGHT source for the
    // per-key blend (D1). Optional so existing seeds (which omit it) compile.
    api_key_id?: string;
    // Phase 164.6.6.2.1 plan 17 — the stored unit of a native-unit account's
    // row (migration 20261010120000). Optional so existing seeds compile.
    quantity_unit?: string | null;
    // Phase 170.4 plan 07 — allocator_holdings.updated_at is NOT NULL; the
    // dashboard now reads it for the one-key-per-account-day rule.
    updated_at: string;
  }>,
  // Phase 36 / 36-03 — per-key csv_daily_returns rows read by
  // getMyAllocationDashboard for the Overview-stats repoint (D1/D2/D3).
  csvDailyReturns: [] as Array<{
    // 167.1.2 C3 fix F — the PK the dashboard's id-keyset drain pages on.
    // Optional: an unset id is assigned from the row's seed position (the
    // insertion order a bigint identity would give it).
    id?: number;
    api_key_id: string | null;
    allocator_id: string | null;
    date: string;
    daily_return: number;
  }>,
  // Phase 115.1 — the NEW keyed derived-curve surface (BACKBONE-03 else-branch).
  // One JSONB row per (allocator_id, kind); the display row is kind='equity_curve'.
  // Seeded ONLY by the 115.1 repoint pins; absent for every legacy fixture so the
  // SAFETY fallback (no derived row → legacy render) is exercised unchanged.
  allocatorEquityDerived: [] as Array<{
    allocator_id: string;
    kind: string;
    payload: Record<string, unknown>;
  }>,
  // Phase 151 / 151-02 (AUM-04) — the owner's own strategies, read by
  // getMyAllocationDashboard to derive the manager-role discriminator.
  // Scoped `user_id` (NOT owner_id — the columns are asymmetric across the
  // two tables, and the mock's generic eq filter makes that asymmetry
  // load-bearing rather than decorative).
  // `capital_ownership` is OPTIONAL here, and that is the point rather than a
  // convenience: the column is nullable with no DEFAULT and no backfill, so the
  // pre-150 population really does arrive with the field absent, and the AUM-04
  // fixtures above are that population. The own-capital exemption below seeds
  // it explicitly. (Typed as `string | null` and never as the imported
  // `CapitalOwnership` union — an oracle that borrows the module's own type
  // cannot notice a mark being renamed out from under it.)
  strategies: [] as Array<{
    id: string;
    user_id: string;
    api_key_id: string | null;
    status: string;
    capital_ownership?: string | null;
  }>,
  // Phase 151 / 151-02 (AUM-04) — the composite link table (migration
  // 20260710120000). Rows carry `owner_id`, so a builder that scopes
  // `.eq("user_id", …)` matches ZERO rows here and the six manager keys stay
  // un-excluded — that is the mutation falsifier for the new read's scoping.
  strategyKeys: [] as Array<{
    owner_id: string;
    strategy_id: string;
    api_key_id: string;
  }>,
  // Phase 167.1.2.1 review 09 (WR-02) — compute_jobs rows, read by the
  // dashboard (admin client, deny-all RLS) only to learn which capped keys have
  // a reconstruct job in flight.
  computeJobs: [] as Array<{
    id: string;
    kind: string;
    status: string;
    api_key_id: string | null;
  }>,
  // 151 test-analyzer gap 2 — per-table read-error injection. A PostgREST
  // failure (or a `strategy_keys` missing from the schema cache on a
  // pre-migration environment) must degrade, not blank the dashboard: the
  // role-discriminator reads are deliberately never assertOk'd. Nothing else
  // could reach that arm — every other fixture resolves `error: null`.
  tableErrors: {} as Record<string, { message: string } | null>,
  // 167.1.2 C3 fix F — PostgREST's `max_rows`: when set, every list response
  // is cut to this many rows after `.order()` and `.limit()`, whatever limit
  // the client asked for, and still answers `error: null`. Opt-in (null = no
  // cap) so the legacy fixtures are unaffected.
  maxRows: null as number | null,
  // Review C4 round 2 WR-R2-03 — the poll events the holdings read consults.
  // Rows carry a flattened `metadata->>final_status` so the `.eq()` on that
  // JSON path filters like PostgREST does.
  auditLog: [] as Array<Record<string, unknown>>,
  // Phase 167.2.1.1.1 (NAVMTM) plan 10 - the owner's raw marks. getMyAllocationDashboard
  // no longer reads them (round-1 SFH F2: the start comes from the published
  // key_inputs `marks_since`); a test seeds them to prove they name nothing.
  navMarks: [] as Array<{ allocator_id: string; api_key_id: string; mark_day: string }>,
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
  state.csvDailyReturns = [];
  state.allocatorEquityDerived = [];
  state.strategies = [];
  state.strategyKeys = [];
  state.computeJobs = [];
  state.tableErrors = {};
  state.maxRows = null;
  state.auditLog = [];
  state.navMarks = [];
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
  // Phase 167.1.2.1 review 09 (WR-02): `.in()` calls, to pin the compute_jobs read.
  ins: Array<{ column: string; value: unknown }>;
  limitN: number | null;
  headCount: boolean;
};
const chainAudit = vi.hoisted(() => ({
  entries: [] as ChainAuditEntry[],
}));

type Filter = {
  column: string;
  value: unknown;
  op: "eq" | "in" | "is" | "not-is" | "gte" | "gt";
};

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
    ins: [],
    limitN: null,
    headCount: false,
  };
  chainAudit.entries.push(audit);
  let limitN: number | null = null;
  // 167.1.2 C3 fix F — `.order()` is REAL now (multi-column, asc/desc), so a
  // fake-served page is the page PostgREST would serve.
  const orders: Array<{ column: string; ascending: boolean }> = [];
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
        if (f.op === "not-is") return (v ?? null) !== f.value;
        if (f.op === "in")
          return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
        // Phase 36 — `.gte("date", iso)` bounds the per-key csv_daily_returns
        // fetch by a date window. Lexicographic compare matches ISO-date order.
        if (f.op === "gte")
          return (
            typeof v === "string" &&
            typeof f.value === "string" &&
            v >= f.value
          );
        // 167.1.2 C3 fix F — `.gt()` is a REAL filter now (the id keyset
        // cursor). Numbers compare numerically, strings lexicographically.
        if (f.op === "gt")
          return (
            (typeof v === "number" &&
              typeof f.value === "number" &&
              v > f.value) ||
            (typeof v === "string" &&
              typeof f.value === "string" &&
              v > f.value)
          );
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
      case "csv_daily_returns":
        return applyFilters(
          state.csvDailyReturns.map((r, i) => ({
            ...r,
            id: r.id ?? i + 1,
          })) as Array<Record<string, unknown>>,
        );
      case "allocator_equity_derived":
        return applyFilters(
          state.allocatorEquityDerived as Array<Record<string, unknown>>,
        );
      // Phase 151 / AUM-04 — the two role-discriminator reads.
      case "strategies":
        return applyFilters(state.strategies as Array<Record<string, unknown>>);
      case "strategy_keys":
        return applyFilters(
          state.strategyKeys as Array<Record<string, unknown>>,
        );
      case "compute_jobs":
        return applyFilters(state.computeJobs as Array<Record<string, unknown>>);
      case "audit_log":
        return applyFilters(state.auditLog);
      case "api_key_nav_marks":
        return applyFilters(state.navMarks as Array<Record<string, unknown>>);
      default:
        return [];
    }
  }

  // The list a terminal resolves: filtered rows, sorted by every `.order()`
  // in call order, cut to `.limit()`, then cut to the server cap.
  function servedRows(): unknown[] {
    const rows = [...rowsFor()] as Array<Record<string, unknown>>;
    if (orders.length > 0) {
      rows.sort((a, b) => {
        for (const o of orders) {
          const x = a[o.column] as string | number | null | undefined;
          const y = b[o.column] as string | number | null | undefined;
          if (x === y) continue;
          if (x == null) return 1;
          if (y == null) return -1;
          const c = x < y ? -1 : 1;
          return o.ascending ? c : -c;
        }
        return 0;
      });
    }
    let out: unknown[] = limitN !== null ? rows.slice(0, limitN) : rows;
    if (state.maxRows !== null) out = out.slice(0, state.maxRows);
    return out;
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
      audit.ins.push({ column, value });
      return chain;
    },
    is: (column: string, value: unknown) => {
      filters.push({ column, value, op: "is" });
      return chain;
    },
    // Phase 09 / 09-03 — admin.from("match_decisions")...eq(...).not("original_holding_ref", "is", null)
    // Only the "<col> IS NOT NULL" form is exercised by getMyAllocationDashboard;
    // broader PostgREST .not() semantics intentionally unsupported.
    not: (column: string, op: string, value: unknown) => {
      if (op === "is") {
        filters.push({ column, value, op: "not-is" });
      }
      return chain;
    },
    // .gt() is used by bridge_outcome_dismissals to filter active rows (the
    // rowsFor() Date filter still applies there too) and by the id keyset
    // cursor of the per-key csv_daily_returns drain (167.1.2 C3 fix F).
    gt: (column: string, value: unknown) => {
      filters.push({ column, value, op: "gt" });
      return chain;
    },
    // Phase 36 — .gte("date", iso) bounds the per-key csv_daily_returns fetch
    // by a 730-day date window. Registered as a real filter so the date-window
    // bound is exercised by the test mock (not a no-op).
    gte: (column: string, value: unknown) => {
      filters.push({ column, value, op: "gte" });
      return chain;
    },
    order: (column: string, opts?: { ascending?: boolean }) => {
      orders.push({ column, ascending: opts?.ascending !== false });
      return chain;
    },
    limit: (n: number) => {
      limitN = n;
      audit.limitN = n;
      return chain;
    },
    maybeSingle: async () => {
      // Review C2 SFH-06: honour an injected read failure here too, the same
      // shape `then` resolves, so a `.maybeSingle()` read can be failed.
      const injected = state.tableErrors[table];
      if (injected) return { data: null, error: injected };
      const row = servedRows()[0];
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
          | { data: null; error: null; count: number }
          | { data: null; error: { message: string } },
      ) => void,
    ) => {
      // Injected read failure for THIS table (state.tableErrors) — the shape
      // PostgREST returns: null data alongside a non-null error.
      // The key_inputs list read (`.in("kind", ...)`) is failable on its own, so the
      // equity_curve read beside it can stay healthy.
      const injected =
        state.tableErrors[table] ??
        (table === "allocator_equity_derived" && filters.some((f) => f.op === "in" && f.column === "kind")
          ? state.tableErrors["allocator_equity_derived:key_inputs"]
          : null);
      if (injected) {
        resolve({ data: null, error: injected });
        return;
      }
      if (headCountMode) {
        resolve({ data: null, error: null, count: rowsFor().length });
      } else {
        resolve({ data: servedRows(), error: null });
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

// Review C2 round 2 SFH-R2-05: the derived-row captures are scheduled with
// next/server's `after()` so a cold finish cannot drop them. The mock records
// the callbacks; a test runs them to prove the capture is what they wait on.
// Outside these tests nothing runs them, which matches a request whose
// response has not finished yet.
const afterCallbacks = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", async (importActual) => ({
  ...(await importActual<typeof import("next/server")>()),
  after: (cb: () => unknown) => {
    afterCallbacks.push(cb);
  },
}));

// Phase 164.6.6.2 plan 09 (D-18, D-22): the dashboard reads BTC closes through
// plan 08's DB-only `readBtcCloses`. Mocked here so a test chooses the price
// window (or a read failure) and counts the reads; every other export of the
// module stays real.
const btcCloses = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/factsheet/benchmark-source", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/factsheet/benchmark-source")>()),
  readBtcCloses: btcCloses.read,
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

  // M-0480 — the scenario-test's T_H3 / T_M4 only build literal payload
  // objects to satisfy the compiler; they never invoke
  // getMyAllocationDashboard, so a regression returning undefined for
  // allocator_id (or an empty-default liveBaselineMetrics) would not fail
  // them. These assert the REAL function actually populates both fields from
  // the userId argument and the SSR lift.
  it("M-0480: populates allocator_id from the userId argument (no-book branch)", async () => {
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.allocator_id).toBe("user-1");
    expect(typeof result.allocator_id).toBe("string");
  });

  it("M-0480: returns the SSR-lifted liveBaselineMetrics shape (empty-default when no holdings)", async () => {
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    // No holdings ⇒ the emptyDefault baseline (gate=false → emptyLiveBaselineMetrics).
    // The exact field set is the SSR contract the composer consumes.
    expect(result.liveBaselineMetrics).toEqual({
      aum: 0,
      ytdTwr: null,
      sharpe: null,
      maxDd: null,
      avgRho: null,
      equity: [],
      drawdown: [],
    });
  });

  // Phase 37 / 37-01 — the !portfolio (fresh-allocator) branch carries the
  // three new per-key fields with empty/false defaults (no per-key coverage).
  // Mirrors the M-0480 model: the real function — not a literal — must populate
  // them so a branch that forgot the fields (Pitfall 2) fails loudly.
  it("Phase 37: !portfolio branch exposes the per-key channel with empty/false defaults", async () => {
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result).toHaveProperty("perKeyReturnsByApiKeyId");
    expect(result).toHaveProperty("perKeyDailiesGateSatisfied");
    expect(result).toHaveProperty("eligibleApiKeyIds");
    expect(result.perKeyReturnsByApiKeyId).toEqual({});
    expect(result.perKeyDailiesGateSatisfied).toBe(false);
    expect(result.eligibleApiKeyIds).toEqual([]);
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
  //
  // audit-2026-05-07 G8.A.2 (P35) follow-up: the bridge_outcomes embed
  // now co-fetches `codename` + `disclosure_tier` and routes through
  // `displayStrategyName`. Tests that want the canonical `name` to
  // surface verbatim must seed `disclosure_tier: 'institutional'` (the
  // tier where the resolver lets the canonical name through). Without
  // it, the resolver falls back to the synthetic Strategy #<id> — which
  // is exactly the leak-prevention behaviour for non-institutional rows.
  replacement_strategy: {
    id: "s-repl",
    name: "Crypto Momentum LP",
    codename: null,
    disclosure_tier: "institutional",
  },
  match_decision: {
    original_strategy: {
      id: "s-orig",
      name: "Legacy Equity LP",
      codename: null,
      disclosure_tier: "institutional",
    },
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
//   - holdingsSummary, snapshotCount, allKeysStale, lastSyncAt, hasSyncing,
//     equityDailyPoints, activeVenues
//     (Phase 176: equitySnapshots, minHistoryDepthMonths and
//     equityBaselineUnknown are retired with the legacy curve, D-07)
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

// Phase 176 (D-02): the warm-up count is the drawn derived curve's day count, so
// the count arms seed a version-2 derived row of N days and one identified,
// syncing key (the readiness the "ready" fixtures below use).
const P7_IDENTIFIED_KEY = {
  id: "k1",
  user_id: "user-1",
  exchange: "binance",
  label: "Binance main",
  is_active: true,
  sync_status: "ok",
  last_sync_at: new Date().toISOString(),
  disconnected_at: null,
  account_balance_usdt: 1000,
  created_at: "2026-04-01T00:00:00Z",
  venue_account_id: "acct-synthetic-1",
  account_share_kind: null,
  account_shared_with_api_key_id: null,
};

/** A trustworthy version-2 `equity_curve` row of `days` consecutive days (>= 2). */
function p7DerivedV2Row(days: number) {
  const dates = Array.from(
    { length: days },
    (_, i) => `2026-03-${String(i + 1).padStart(2, "0")}`,
  );
  return {
    allocator_id: "user-1",
    kind: "equity_curve",
    payload: {
      version: 2,
      curve: dates.map((date, i) => ({ date, equity_usd: 10_000 + i * 10 })),
      returns: dates.slice(1).map((date) => ({ date, r: 0.001 })),
      flags: [],
      degrade_reasons: [],
      is_trustworthy: true,
      scalars: { mwr: 0.12, dietz: 0.11, computable: true },
      inputs: { n_keys: 1, anchor_asof: dates[days - 1], composed_at: "2026-03-31T00:00:00Z" },
    } as Record<string, unknown>,
  };
}

describe("getMyAllocationDashboard — Phase 07 payload extensions", () => {
  beforeEach(resetState);

  it("TC p7-01: payload carries the Phase 07 field names that survive Phase 176", async () => {
    // Include a portfolio so the function takes the main branch and
    // exercises every new fetch; the `!portfolio` branch is tested in p7-02.
    state.portfolios = [P7_PORTFOLIO];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = (await getMyAllocationDashboard("user-1")) as unknown as Record<
      string,
      unknown
    >;
    expect(result).toHaveProperty("holdingsSummary");
    expect(result).toHaveProperty("snapshotCount");
    expect(result).toHaveProperty("allKeysStale");
    expect(result).toHaveProperty("lastSyncAt");
    expect(result).toHaveProperty("hasSyncing");
    expect(result).toHaveProperty("equityDailyPoints");
    expect(result).toHaveProperty("activeVenues");
  });

  it("TC p7-02: no portfolio but has api_keys + a derived row → snapshotCount is the drawn derived days (the !portfolio branch spreads the same producer)", async () => {
    // SC3: allocator with no portfolio_strategies row still sees the derived
    // book. Removes the !portfolio early-return. Phase 176 (D-02): the count is
    // the day count of the derived curve, not a legacy row count.
    state.portfolios = [];
    state.apiKeys = [P7_IDENTIFIED_KEY];
    state.allocatorEquityDerived = [p7DerivedV2Row(2)];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.portfolio).toBeNull();
    expect(result.equityHistoryState).toBe("ready");
    expect(result.equityDailyPoints).toHaveLength(2);
    expect(result.snapshotCount).toBe(2);
  });

  it("TC p7-03: snapshotCount equals the derived curve's day count when < 30", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [P7_IDENTIFIED_KEY];
    // 15 derived days (warm-up territory)
    state.allocatorEquityDerived = [p7DerivedV2Row(15)];
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

  it("TC p7-06: any active key sync_status='syncing' → hasSyncing=true; a stale+syncing key still reports allKeysStale=true (B14 — allStale and syncing are independent axes, NEW-C09-04)", async () => {
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
    // The key has never synced (last_sync_at=null) AND is mid-sync — these are
    // independent: allKeysStale must NOT be suppressed by syncing, else the
    // dashboard renders stale-sourced KPIs with full confidence during a sync
    // (NEW-C09-04). The banner gate (allKeysStale && !hasSyncing) handles the
    // double-message suppression at the consumer, not here.
    expect(result.allKeysStale).toBe(true);
  });

  it("TC p7-07 (f7): 5 derived days are counted and drawn in order while the history is ready", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [P7_IDENTIFIED_KEY];
    state.allocatorEquityDerived = [p7DerivedV2Row(5)];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    expect(result.snapshotCount).toBe(5);
    // The count is the length of the series the chart draws, in date order.
    expect(result.equityDailyPoints.map((p) => p.date)).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
    ]);
  });
});

// =============================================================================
// NEW-C09-08 (B1, audit-2026-05-07) — current_weight boundary clamp
//
// CLOSED. `getMyAllocationDashboard` now gates `current_weight` through
// `safeFraction` (see src/lib/queries.ts ~line 2910). The blocking
// aggregator sweep is complete: every downstream `current_weight ?? 0`
// consumer either normalizes (null→0 ⟺ exclusion), explicitly excludes
// zero-weight rows, or falls back to an equal-weight target — so clamping
// a garbage weight to null is a strict improvement over propagating it,
// with no silent-0 degradation.
// =============================================================================

describe("NEW-C09-08 — current_weight clamped through safeFraction", () => {
  beforeEach(() => {
    resetState();
    state.portfolios = [PORTFOLIO_FIXTURE];
  });

  it("valid in-range weight passes through unchanged", async () => {
    state.portfolioStrategies = [
      { ...PS_S1, current_weight: 0.42 } as unknown as
        (typeof state.portfolioStrategies)[number],
    ];
    state.sentAsIntroDecisions = [];
    state.bridgeOutcomes = [];
    state.bridgeDismissals = [];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    const row = result.strategies.find((s) => s.strategy_id === "s1");
    expect(row?.current_weight).toBe(0.42);
  });

  it("boundary values 0 and 1 accepted", async () => {
    state.portfolioStrategies = [
      { ...PS_S1, current_weight: 0 } as unknown as
        (typeof state.portfolioStrategies)[number],
      { ...PS_S2, current_weight: 1 } as unknown as
        (typeof state.portfolioStrategies)[number],
    ];
    state.sentAsIntroDecisions = [];
    state.bridgeOutcomes = [];
    state.bridgeDismissals = [];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    const s1 = result.strategies.find((s) => s.strategy_id === "s1");
    const s2 = result.strategies.find((s) => s.strategy_id === "s2");
    expect(s1?.current_weight).toBe(0);
    expect(s2?.current_weight).toBe(1);
  });

  it("out-of-range negative weight collapses to null (producer-side bug)", async () => {
    state.portfolioStrategies = [
      { ...PS_S1, current_weight: -0.05 } as unknown as
        (typeof state.portfolioStrategies)[number],
    ];
    state.sentAsIntroDecisions = [];
    state.bridgeOutcomes = [];
    state.bridgeDismissals = [];

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");
      const row = result.strategies.find((s) => s.strategy_id === "s1");
      // Pre-fix: rendered as -5% chip. Post-fix: explicit null so UI shows "—".
      expect(row?.current_weight).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("out-of-range >1 weight collapses to null (percent vs fraction drift)", async () => {
    // A producer that ships current_weight=50 (meaning 50%) instead of 0.50
    // would otherwise display as 5000% — exactly the drift NEW-C09-08 closes.
    state.portfolioStrategies = [
      { ...PS_S1, current_weight: 50 } as unknown as
        (typeof state.portfolioStrategies)[number],
    ];
    state.sentAsIntroDecisions = [];
    state.bridgeOutcomes = [];
    state.bridgeDismissals = [];

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");
      const row = result.strategies.find((s) => s.strategy_id === "s1");
      expect(row?.current_weight).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("NaN / non-finite weight collapses to null silently", async () => {
    state.portfolioStrategies = [
      { ...PS_S1, current_weight: Number.NaN } as unknown as
        (typeof state.portfolioStrategies)[number],
    ];
    state.sentAsIntroDecisions = [];
    state.bridgeOutcomes = [];
    state.bridgeDismissals = [];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    const row = result.strategies.find((s) => s.strategy_id === "s1");
    expect(row?.current_weight).toBeNull();
  });

  it("null weight stays null (untouched-pass-through, no spurious warn)", async () => {
    state.portfolioStrategies = [
      { ...PS_S1, current_weight: null } as unknown as
        (typeof state.portfolioStrategies)[number],
    ];
    state.sentAsIntroDecisions = [];
    state.bridgeOutcomes = [];
    state.bridgeDismissals = [];

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");
      const row = result.strategies.find((s) => s.strategy_id === "s1");
      expect(row?.current_weight).toBeNull();
      // null is a legitimate "no weight" state, not a producer bug — must
      // not pollute logs with the asWeightFraction out-of-range warn.
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// Silence unused-var for DAY_MS helper (kept for future TC authors).
void DAY_MS;

describe("emptyLiveBaselineMetrics — the honest gate=false SSR baseline (ENGINE-04)", () => {
  // Phase 63 ENGINE-04 RETIRED the holdings-snapshot baseline (whose
  // alias-collapse existed only to stop a
  // fabricated ρ=1.0 for symbol-aliased BTC@binance + BTC@okx duplicates —
  // H-0487/H-0493). The gate=false SSR arm now calls this helper directly: AUM
  // preserved from holdings equity contribution, EVERY metric null → KpiStrip
  // "—". The H-0487/H-0493 class can no longer arise because no holdings series
  // ever reaches computeScenario here. This is the replacement pin for the
  // retired collapse-wiring guard (the SSR-integration half lives in the
  // "fallback branch → emptyDefault" test below).
  function mkHolding(venue: string, symbol: string, value_usd: number) {
    return {
      symbol,
      venue,
      holding_type: "spot" as const,
      value_usd,
      quantity: 1,
      mark_price_usd: null,
      api_key_id: "k",
      side: "flat" as const,
      entry_price: null,
      unrealized_pnl_usd: null,
    };
  }

  it("preserves AUM (Σ equity contribution) and nulls every metric — never a fabricated avgRho", async () => {
    const { emptyLiveBaselineMetrics } = await import("./queries");
    // The exact multi-venue aliased shape the retired collapse path had to
    // guard against: BTC split 30k/20k across two venues + ETH 50k.
    const metrics = emptyLiveBaselineMetrics([
      mkHolding("binance", "BTC", 30_000),
      mkHolding("okx", "BTC", 20_000),
      mkHolding("binance", "ETH", 50_000),
    ]);
    // AUM is preserved from holdings (Holdings tab + commit sizing still read it).
    expect(metrics.aum).toBe(100_000);
    // Every metric is null — the honest em-dash, NOT a snapshot-derived value,
    // and in particular NOT the fabricated ρ=1.0 the retired collapse path
    // produced for the aliased BTC pair. A regression that re-introduced any
    // holdings-snapshot computation here would make one of these non-null.
    expect(metrics.ytdTwr).toBeNull();
    expect(metrics.sharpe).toBeNull();
    expect(metrics.maxDd).toBeNull();
    expect(metrics.avgRho).toBeNull();
    expect(metrics.equity).toEqual([]);
    expect(metrics.drawdown).toEqual([]);
  });

  it("empty holdings → AUM 0 and null metrics (the degenerate SSR contract)", async () => {
    const { emptyLiveBaselineMetrics } = await import("./queries");
    expect(emptyLiveBaselineMetrics([])).toEqual({
      aum: 0,
      ytdTwr: null,
      sharpe: null,
      maxDd: null,
      avgRho: null,
      equity: [],
      drawdown: [],
    });
  });
});

// =============================================================================
// Phase 36 / 36-03 — Repoint Overview stats onto per-key csv_daily_returns
// (UNIFY-01/02/03). The blend unit is per api_key_id (D1); AUM stays from
// holdings (D2); the fallback is all-or-nothing per allocator (D3).
//
// These tests are FALSIFIABLE by construction:
//   - the per-key-vs-fallback divergence test FAILS if the per-key fetch is
//     ignored and the snapshot path is used unconditionally (a revert).
//   - the mixed-population test FAILS if the gate is made per-key-partial
//     (one key with dailies + one active key without must take the FALLBACK,
//     never a half-per-key/half-snapshot blended curve).
// =============================================================================
describe("getMyAllocationDashboard — Phase 36 per-key repoint (D1/D2/D3)", () => {
  beforeEach(resetState);

  // A holdings fixture whose snapshot reconstruction (from breakdown pct-change)
  // produces a DIFFERENT return series than the per-key csv_daily_returns,
  // so the per-key branch and the snapshot fallback DISAGREE — making "is the
  // per-key fetch actually used?" a falsifiable question. computeScenario
  // requires n >= 10 common dates, so we seed >= 13 snapshots (→ >= 12
  // reconstructed returns) and >= 12 per-key rows.
  const ASOF = Array.from({ length: 13 }, (_, i) =>
    `2026-05-${String(i + 1).padStart(2, "0")}`,
  );
  // Per-key csv_daily_returns for key-A: a DELIBERATELY different, larger-
  // magnitude alternating series so the blended curve / Sharpe / maxDD diverge
  // from the snapshot reconstruction. (One value per ASOF entry.)
  const PERKEY_A = [
    0.05, -0.03, 0.06, -0.02, 0.04, -0.01, 0.05, -0.02, 0.03, -0.04, 0.05,
    -0.01, 0.04,
  ];

  function seedHoldingsKeyA(value_usd = 50_000) {
    state.allocatorHoldings = [
      {
        allocator_id: "user-1",
        symbol: "BTC",
        quantity: 1,
        mark_price: 53_500,
        value_usd,
        venue: "binance",
        holding_type: "spot",
        updated_at: "2026-05-13T04:00:00+00:00",
        asof: ASOF[ASOF.length - 1],
        api_key_id: "key-A",
      },
    ];
  }

  function seedPerKeyDailiesA() {
    state.csvDailyReturns = ASOF.map((date, i) => ({
      api_key_id: "key-A",
      allocator_id: "user-1",
      date,
      daily_return: PERKEY_A[i],
    }));
  }

  function activeKeyA() {
    state.apiKeys = [
      {
        id: "key-A",
        user_id: "user-1",
        exchange: "binance",
        label: "Binance",
        is_active: true,
        sync_status: "synced",
        last_sync_at: "2026-05-08T00:00:00Z",
        account_balance_usdt: 53_500,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
  }

  it("per-key branch: every active key has dailies → stats derive from the per-key blend (NOT the snapshot reconstruction)", async () => {
    activeKeyA();
    seedHoldingsKeyA();
    seedPerKeyDailiesA();

    const { getMyAllocationDashboard, liveBaselineMetricsFromPerKeyDailies } =
      await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // The per-key blend computed directly from the per-key series + holdings.
    const expectedPerKey = liveBaselineMetricsFromPerKeyDailies(
      result.holdingsSummary,
      { "key-A": ASOF.map((date, i) => ({ date, value: PERKEY_A[i] })) },
    );
    // The dashboard's liveBaselineMetrics must equal the per-key blend.
    expect(result.liveBaselineMetrics.sharpe).toBe(expectedPerKey.sharpe);
    expect(result.liveBaselineMetrics.maxDd).toBe(expectedPerKey.maxDd);
    expect(result.liveBaselineMetrics.ytdTwr).toBe(expectedPerKey.ytdTwr);
    expect(result.liveBaselineMetrics.equity).toEqual(expectedPerKey.equity);

    // Falsifiable (Phase 63 ENGINE-04 emptyDefault contrast): the PER-KEY branch
    // must produce REAL non-null metrics — i.e. NOT the gate=false emptyDefault
    // shape (`emptyLiveBaselineMetrics`: all metrics null). A revert that dropped
    // the per-key fetch and fell through to the gate=false arm would null these
    // out and this assertion would fail. This proves the per-key branch, not the
    // fallback, produced the curve.
    expect(result.liveBaselineMetrics.sharpe).not.toBeNull();
    expect(result.liveBaselineMetrics.ytdTwr).not.toBeNull();
    expect(result.liveBaselineMetrics.equity.length).toBeGreaterThan(0);
  });

  it("fallback branch: no per-key rows → gate=false → the honest emptyDefault (AUM preserved, all metrics null) — ENGINE-04", async () => {
    activeKeyA();
    seedHoldingsKeyA();
    // No csvDailyReturns seeded → gate=false → emptyDefault branch.

    const { getMyAllocationDashboard, emptyLiveBaselineMetrics } =
      await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // Phase 63 ENGINE-04 — the gate=false SSR arm no longer reconstructs a
    // holdings-snapshot curve (0 real users, D1; the collapse machinery is
    // deleted). It returns the honest emptyDefault: AUM preserved from holdings,
    // every metric null → KpiStrip "—". This is the SSR-integration half of the
    // gate=false pin (the direct-helper half is the emptyLiveBaselineMetrics
    // describe above).
    const expected = emptyLiveBaselineMetrics(result.holdingsSummary);
    expect(result.liveBaselineMetrics).toEqual(expected);
    // Explicit field-level pin: AUM preserved (non-zero here) AND the four
    // metric fields null — the honest em-dash contract.
    expect(result.liveBaselineMetrics.aum).toBe(expected.aum);
    expect(result.liveBaselineMetrics.aum).toBeGreaterThan(0);
    expect(result.liveBaselineMetrics.ytdTwr).toBeNull();
    expect(result.liveBaselineMetrics.sharpe).toBeNull();
    expect(result.liveBaselineMetrics.maxDd).toBeNull();
    expect(result.liveBaselineMetrics.avgRho).toBeNull();
    expect(result.liveBaselineMetrics.equity).toEqual([]);
  });

  it("RT1 parity: a revoked key with STALE per-key dailies + holdings is EXCLUDED from the live-book baseline blend (composer baseline-vs-blend eligibility parity)", async () => {
    // key-A is eligible (synced). key-B is soft-disconnected: sync_status =
    // 'revoked' but is_active stays true (audit continuity), so the
    // allocator-scoped csv_daily_returns read still carries its STALE series even
    // though it is NOT in eligibleApiKeyIds. liveBaselineMetrics (the composer's
    // "your current live book" reference) must blend ONLY key-A. Pre-fix, the
    // unfiltered map blended the revoked key-B too — so the composer compared a
    // hypothetical blend (eligible-filtered, DSRC-03/RT1) against a baseline that
    // included a key the allocator disconnected.
    state.apiKeys = [
      {
        id: "key-A", user_id: "user-1", exchange: "binance", label: "Binance",
        is_active: true, sync_status: "synced", last_sync_at: "2026-05-08T00:00:00Z",
        account_balance_usdt: 30_000, created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "key-B", user_id: "user-1", exchange: "okx", label: "OKX",
        is_active: true, sync_status: "revoked", last_sync_at: "2026-05-08T00:00:00Z",
        account_balance_usdt: 20_000, created_at: "2026-01-01T00:00:00Z",
      },
    ];
    // Both keys carry holdings, so the revoked key-B would have real equity WEIGHT
    // (not just an avgRho contribution) if it leaked into the blend.
    state.allocatorHoldings = [
      {
        allocator_id: "user-1", symbol: "BTC", quantity: 1, mark_price: 53_500,
        value_usd: 30_000, venue: "binance", holding_type: "spot",
        updated_at: "2026-05-13T04:00:00+00:00",
        asof: ASOF[ASOF.length - 1], api_key_id: "key-A",
      },
      {
        allocator_id: "user-1", symbol: "ETH", quantity: 10, mark_price: 2_000,
        value_usd: 20_000, venue: "okx", holding_type: "spot",
        updated_at: "2026-05-13T04:00:00+00:00",
        asof: ASOF[ASOF.length - 1], api_key_id: "key-B",
      },
    ];
    // A distinct series for the revoked key-B so a leaked blend visibly diverges.
    const PERKEY_B = [
      -0.04, 0.05, -0.03, 0.04, -0.05, 0.03, -0.04, 0.05, -0.02, 0.04, -0.05,
      0.03, -0.04,
    ];
    state.csvDailyReturns = [
      ...ASOF.map((date, i) => ({
        api_key_id: "key-A", allocator_id: "user-1", date, daily_return: PERKEY_A[i],
      })),
      ...ASOF.map((date, i) => ({
        api_key_id: "key-B", allocator_id: "user-1", date, daily_return: PERKEY_B[i],
      })),
    ];

    const { getMyAllocationDashboard, liveBaselineMetricsFromPerKeyDailies } =
      await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // The eligible-only (key-A) blend — what the Overview MUST equal post-fix.
    const aOnly = liveBaselineMetricsFromPerKeyDailies(result.holdingsSummary, {
      "key-A": ASOF.map((date, i) => ({ date, value: PERKEY_A[i] })),
    });
    // The buggy blend that folds in the revoked key-B.
    const aPlusB = liveBaselineMetricsFromPerKeyDailies(result.holdingsSummary, {
      "key-A": ASOF.map((date, i) => ({ date, value: PERKEY_A[i] })),
      "key-B": ASOF.map((date, i) => ({ date, value: PERKEY_B[i] })),
    });

    // Post-fix: the dashboard equals the eligible-only blend.
    expect(result.liveBaselineMetrics.sharpe).toBe(aOnly.sharpe);
    expect(result.liveBaselineMetrics.equity).toEqual(aOnly.equity);
    expect(result.liveBaselineMetrics.avgRho).toBe(aOnly.avgRho);
    // Falsifiable both ways: the two blends genuinely diverge for this fixture
    // (so the test CAN fail), and the dashboard must not equal the leaked blend.
    expect(aOnly.sharpe).not.toBe(aPlusB.sharpe);
    expect(result.liveBaselineMetrics.sharpe).not.toBe(aPlusB.sharpe);
  });

  it("RT1 parity, avgRho axis: a revoked key holding NOTHING (weight 0) still leaks into the baseline correlation unless filtered", async () => {
    // The weight-0 case the fix comment singles out: key-B is revoked AND holds
    // nothing, so it contributes ZERO to the weighted return/equity/Sharpe — but
    // (pre-fix) its series is still `selected=true`, so it enters the engine's
    // avg_pairwise_correlation. Here Sharpe is identical with or without key-B; the
    // ONLY observable leak is avgRho (null with one eligible key, non-null once the
    // revoked key's series joins). This isolates the avgRho axis the weighted case
    // above can't.
    state.apiKeys = [
      {
        id: "key-A", user_id: "user-1", exchange: "binance", label: "Binance",
        is_active: true, sync_status: "synced", last_sync_at: "2026-05-08T00:00:00Z",
        account_balance_usdt: 50_000, created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "key-B", user_id: "user-1", exchange: "okx", label: "OKX",
        is_active: true, sync_status: "revoked", last_sync_at: "2026-05-08T00:00:00Z",
        account_balance_usdt: 0, created_at: "2026-01-01T00:00:00Z",
      },
    ];
    // ONLY key-A holds anything → key-B's blend weight is 0.
    seedHoldingsKeyA();
    const PERKEY_B = [
      -0.04, 0.05, -0.03, 0.04, -0.05, 0.03, -0.04, 0.05, -0.02, 0.04, -0.05,
      0.03, -0.04,
    ];
    state.csvDailyReturns = [
      ...ASOF.map((date, i) => ({
        api_key_id: "key-A", allocator_id: "user-1", date, daily_return: PERKEY_A[i],
      })),
      ...ASOF.map((date, i) => ({
        api_key_id: "key-B", allocator_id: "user-1", date, daily_return: PERKEY_B[i],
      })),
    ];

    const { getMyAllocationDashboard, liveBaselineMetricsFromPerKeyDailies } =
      await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    const aOnly = liveBaselineMetricsFromPerKeyDailies(result.holdingsSummary, {
      "key-A": ASOF.map((date, i) => ({ date, value: PERKEY_A[i] })),
    });
    const aPlusB = liveBaselineMetricsFromPerKeyDailies(result.holdingsSummary, {
      "key-A": ASOF.map((date, i) => ({ date, value: PERKEY_A[i] })),
      "key-B": ASOF.map((date, i) => ({ date, value: PERKEY_B[i] })),
    });

    // The weight-0 leak is INVISIBLE to Sharpe — so a Sharpe-only guard would miss
    // it. avgRho is the discriminating axis: null (one eligible key) vs a real
    // pairwise value once the revoked key's series joins.
    expect(aOnly.sharpe).toBe(aPlusB.sharpe); // weight-0 ⇒ Sharpe identical
    expect(aOnly.avgRho).toBeNull(); // single eligible key ⇒ no pairs
    expect(aPlusB.avgRho).not.toBeNull(); // leaked blend has a real correlation
    // Post-fix the dashboard tracks the eligible-only (null) avgRho, NOT the leak.
    expect(result.liveBaselineMetrics.avgRho).toBeNull();
    expect(result.liveBaselineMetrics.avgRho).not.toBe(aPlusB.avgRho);
  });

  it("RT1 parity, disconnected_at axis: a soft-disconnected key (disconnected_at set, is_active=true) is also excluded from the baseline", async () => {
    // Proves the baseline filter is keyed on the FULL eligible predicate, not just
    // sync_status. key-B is synced but carries disconnected_at → ineligible.
    state.apiKeys = [
      {
        id: "key-A", user_id: "user-1", exchange: "binance", label: "Binance",
        is_active: true, sync_status: "synced", last_sync_at: "2026-05-08T00:00:00Z",
        disconnected_at: null, account_balance_usdt: 30_000, created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "key-B", user_id: "user-1", exchange: "okx", label: "OKX",
        is_active: true, sync_status: "synced", last_sync_at: "2026-05-08T00:00:00Z",
        disconnected_at: "2026-05-10T00:00:00Z", account_balance_usdt: 20_000,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    state.allocatorHoldings = [
      {
        allocator_id: "user-1", symbol: "BTC", quantity: 1, mark_price: 53_500,
        value_usd: 30_000, venue: "binance", holding_type: "spot",
        updated_at: "2026-05-13T04:00:00+00:00",
        asof: ASOF[ASOF.length - 1], api_key_id: "key-A",
      },
      {
        allocator_id: "user-1", symbol: "ETH", quantity: 10, mark_price: 2_000,
        value_usd: 20_000, venue: "okx", holding_type: "spot",
        updated_at: "2026-05-13T04:00:00+00:00",
        asof: ASOF[ASOF.length - 1], api_key_id: "key-B",
      },
    ];
    const PERKEY_B = [
      -0.04, 0.05, -0.03, 0.04, -0.05, 0.03, -0.04, 0.05, -0.02, 0.04, -0.05,
      0.03, -0.04,
    ];
    state.csvDailyReturns = [
      ...ASOF.map((date, i) => ({
        api_key_id: "key-A", allocator_id: "user-1", date, daily_return: PERKEY_A[i],
      })),
      ...ASOF.map((date, i) => ({
        api_key_id: "key-B", allocator_id: "user-1", date, daily_return: PERKEY_B[i],
      })),
    ];

    const { getMyAllocationDashboard, liveBaselineMetricsFromPerKeyDailies } =
      await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    const aOnly = liveBaselineMetricsFromPerKeyDailies(result.holdingsSummary, {
      "key-A": ASOF.map((date, i) => ({ date, value: PERKEY_A[i] })),
    });
    const aPlusB = liveBaselineMetricsFromPerKeyDailies(result.holdingsSummary, {
      "key-A": ASOF.map((date, i) => ({ date, value: PERKEY_A[i] })),
      "key-B": ASOF.map((date, i) => ({ date, value: PERKEY_B[i] })),
    });
    expect(result.liveBaselineMetrics.sharpe).toBe(aOnly.sharpe);
    expect(aOnly.sharpe).not.toBe(aPlusB.sharpe);
    expect(result.liveBaselineMetrics.sharpe).not.toBe(aPlusB.sharpe);
  });

  it("mixed-population HONESTY guard (D3, amended by 151): one key with dailies + one active key WITHOUT → the CONTRIBUTING SUBSET's curve (never a half-per-key/half-snapshot one)", async () => {
    // Two active keys: key-A has per-key dailies, key-B has NONE.
    state.apiKeys = [
      {
        id: "key-A",
        user_id: "user-1",
        exchange: "binance",
        label: "Binance",
        is_active: true,
        sync_status: "synced",
        last_sync_at: "2026-05-08T00:00:00Z",
        account_balance_usdt: 30_000,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "key-B",
        user_id: "user-1",
        exchange: "okx",
        label: "OKX",
        is_active: true,
        sync_status: "synced",
        last_sync_at: "2026-05-08T00:00:00Z",
        account_balance_usdt: 20_000,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    // Holdings spread across both keys (so AUM + holdings path are realistic).
    state.allocatorHoldings = [
      {
        allocator_id: "user-1",
        symbol: "BTC",
        quantity: 1,
        mark_price: 53_500,
        value_usd: 30_000,
        venue: "binance",
        holding_type: "spot",
        updated_at: "2026-05-13T04:00:00+00:00",
        asof: ASOF[ASOF.length - 1],
        api_key_id: "key-A",
      },
      {
        allocator_id: "user-1",
        symbol: "ETH",
        quantity: 10,
        mark_price: 2_000,
        value_usd: 20_000,
        venue: "okx",
        holding_type: "spot",
        updated_at: "2026-05-13T04:00:00+00:00",
        asof: ASOF[ASOF.length - 1],
        api_key_id: "key-B",
      },
    ];
    // ONLY key-A has per-key dailies — key-B has none.
    seedPerKeyDailiesA();

    const {
      getMyAllocationDashboard,
      emptyLiveBaselineMetrics,
      liveBaselineMetricsFromPerKeyDailies,
    } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // ─────────────────────────────────────────────────────────────────────
    // WHAT D3 GUARANTEED, AND WHICH HALF OF IT SURVIVES PHASE 151.
    //
    // D3's rule was written when book entry and the live baseline shared ONE
    // all-or-nothing gate. A mixed population (key-B has no per-key series)
    // could not enter book mode at all, so "no curve" was the honest answer and
    // the emptyDefault was what this test pinned. The DANGER it was defending
    // against was never the null itself — it was a curve stitched from TWO
    // BASES: key-A's real per-key series for one half of the book and a
    // holdings-SNAPSHOT reconstruction standing in for key-B, which fabricates
    // a ρ=1.0 collapse and mixes annualization bases inside one number.
    //
    // Phase 151 (AUM-04) splits the gates and ADMITS this population to book
    // mode, and `ScenarioComparePanel` computes a real live-book column for it
    // from `contributingApiKeyIds` on the same screen. A null baseline is now
    // the DIShonest answer — it leaves two surfaces on one screen contradicting
    // each other about whether this allocator's live book exists.
    //
    // So the expected VALUE flips, and the surviving guarantee is restated in
    // the form that still bites: the curve is built from the CONTRIBUTING
    // SUBSET ONLY, and the snapshot half is GONE — a key with no series
    // contributes NOTHING to the curve rather than a reconstructed stand-in.
    // Arm (4) below is the one that would fail if anyone re-mixed a snapshot
    // reconstruction back in; it is the part of D3 still worth defending.
    // ─────────────────────────────────────────────────────────────────────

    // (1) Pre-condition — this really is the mixed population, and the OLD
    // all-or-nothing gate really is still false (otherwise every arm below is
    // testing an ordinary whole-book case).
    expect(result.perKeyDailiesGateSatisfied).toBe(false);
    expect(result.bookEntryGateSatisfied).toBe(true);
    expect(result.contributingApiKeyIds).toEqual(["key-A"]);

    // (2) The curve is the CONTRIBUTING SUBSET's per-key blend — key-A alone.
    // Review round 2 F1 — and so are the HOLDINGS behind it. Handing this
    // helper the full `holdingsSummary` (as this expectation did pre-fix)
    // produced an object whose `aum` and dollar drawdown described key-A AND
    // key-B while its `sharpe`/`equity` described key-A alone.
    const perKeyOnly = liveBaselineMetricsFromPerKeyDailies(
      result.holdingsSummary.filter((h) => h.api_key_id === "key-A"),
      { "key-A": ASOF.map((date, i) => ({ date, value: PERKEY_A[i] })) },
    );
    expect(result.liveBaselineMetrics).toEqual(perKeyOnly);

    // (2b) ONE KEY SET, stated as a number rather than as an object identity —
    // hand-computed from this fixture's own holdings: key-A's BTC position is
    // $30,000 and key-B's ETH position is $20,000, so a baseline describing
    // key-A's returns must carry key-A's $30,000, never the $50,000 custody
    // total. This is the arm that goes RED if anyone re-widens the holdings
    // argument while leaving the returns narrowed.
    expect(result.liveBaselineMetrics.aum).toBe(30_000);
    expect(
      result.holdingsSummary.reduce((s, h) => s + h.value_usd, 0),
    ).toBe(50_000);

    // (3) …and it is a REAL curve, not the honest-empty this used to be. Stated
    // as a discriminating negative so (2) cannot pass by both sides being empty.
    expect(result.liveBaselineMetrics.sharpe).not.toBeNull();
    expect(result.liveBaselineMetrics.equity.length).toBeGreaterThan(0);
    expect(result.liveBaselineMetrics).not.toEqual(
      emptyLiveBaselineMetrics(result.holdingsSummary),
    );

    // (4) ⛔ THE SURVIVING HALF OF D3 — NO SNAPSHOT RECONSTRUCTION IS MIXED IN.
    // Phase 176 (D-02): the snapshot half is not just unmixed, it is unread. The
    // payload issues no query against the legacy table at all, so there is no
    // snapshot input a stitched baseline could be built from.
    expect(
      chainAudit.entries.filter((e) => e.table === "allocator_equity_snapshots"),
    ).toHaveLength(0);

    // (5) key-B contributes NOTHING to the curve — not a fabricated ρ=1.0
    // stand-in. One contributing key means no pairs, so avgRho is null; a
    // reconstructed second leg would give it a real value (that is exactly the
    // axis the RT1 leak test above uses, because it is invisible to Sharpe).
    expect(result.liveBaselineMetrics.avgRho).toBeNull();
    // Review round 2 F1 — key-B's MONEY does NOT count here, and the previous
    // arm (`toBe(50_000)`, "AUM is custody's answer for the WHOLE book … the
    // two sets differ on purpose (Pitfall 5)") was the mixed basis stated as an
    // intention. It is already pinned at (2b) above as key-A's $30,000; what
    // survives from this arm is the contrast that gives it meaning — the curve
    // and the money now come from the SAME key, so the object makes one claim.
    expect(result.liveBaselineMetrics.aum).toBe(30_000);
  });

  it("C1 regression: a revoked-but-active key (is_active=true, sync_status='revoked') does NOT block the per-key branch — the gate predicate matches the backfill's, not bare is_active", async () => {
    // The allocator-protected path keeps a credential-revoked key is_active=true
    // and sets sync_status='revoked' (rows persist for audit). The backfill
    // NEVER derives a series for such a key, so a bare `is_active` gate would
    // pin the WHOLE allocator to the snapshot fallback FOREVER. key-A is healthy
    // with dailies; key-B is is_active=true but revoked with NO dailies.
    state.apiKeys = [
      {
        id: "key-A",
        user_id: "user-1",
        exchange: "binance",
        label: "Binance",
        is_active: true,
        sync_status: "synced",
        last_sync_at: "2026-05-08T00:00:00Z",
        account_balance_usdt: 30_000,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "key-B",
        user_id: "user-1",
        exchange: "okx",
        label: "OKX (revoked)",
        is_active: true,
        sync_status: "revoked",
        last_sync_at: "2026-05-01T00:00:00Z",
        account_balance_usdt: 20_000,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    // Both keys carry holdings (so key-B is in AUM); snapshots for the fallback.
    state.allocatorHoldings = [
      {
        allocator_id: "user-1",
        symbol: "BTC",
        quantity: 1,
        mark_price: 53_500,
        value_usd: 30_000,
        venue: "binance",
        holding_type: "spot",
        updated_at: "2026-05-13T04:00:00+00:00",
        asof: ASOF[ASOF.length - 1],
        api_key_id: "key-A",
      },
      {
        allocator_id: "user-1",
        symbol: "ETH",
        quantity: 10,
        mark_price: 2_000,
        value_usd: 20_000,
        venue: "okx",
        holding_type: "spot",
        updated_at: "2026-05-13T04:00:00+00:00",
        asof: ASOF[ASOF.length - 1],
        api_key_id: "key-B",
      },
    ];
    // Only key-A (the ELIGIBLE key) has per-key dailies. key-B is revoked.
    seedPerKeyDailiesA();

    const {
      getMyAllocationDashboard,
      liveBaselineMetricsFromPerKeyDailies,
    } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // The gate's eligible set is {key-A} (key-B is revoked → excluded, matching
    // the backfill), and key-A HAS a series → the PER-KEY branch activates.
    const expectedPerKey = liveBaselineMetricsFromPerKeyDailies(
      result.holdingsSummary,
      { "key-A": ASOF.map((date, i) => ({ date, value: PERKEY_A[i] })) },
    );
    expect(result.liveBaselineMetrics.sharpe).toBe(expectedPerKey.sharpe);
    expect(result.liveBaselineMetrics.equity).toEqual(expectedPerKey.equity);

    // Falsifiable (Phase 63 ENGINE-04 emptyDefault contrast): the OLD bare-
    // is_active gate counted key-B as active, found no series for it, and fell
    // through to the gate=false arm — which now returns the honest emptyDefault
    // (all metrics null). Assert we did NOT take that path: the per-key branch
    // produced REAL non-null metrics, NOT the emptyDefault shape.
    expect(result.liveBaselineMetrics.sharpe).not.toBeNull();
    expect(result.liveBaselineMetrics.equity.length).toBeGreaterThan(0);

    // Review round 2 F1 — this line used to read `toBe(50_000)` under the
    // comment "AUM still includes the revoked key's frozen holdings (D2
    // unchanged)". It no longer does, and that is the point: the revoked key is
    // not in `contributingApiKeyIds`, so its equity is not in the book whose
    // Sharpe the two assertions above describe. Hand-computed from the fixture:
    // key-A's BTC holding alone, $30,000. key-B's frozen $20,000 is still
    // custody's money and still reaches the Holdings surfaces via
    // `holdingsSummary` — it is only out of THIS object, which is a statement
    // about a blend it was never part of.
    expect(result.liveBaselineMetrics.aum).toBe(30_000);
    // Non-vacuity: the custody total really is the other number.
    expect(
      result.holdingsSummary.reduce((s, h) => s + h.value_usd, 0),
    ).toBe(50_000);
  });

  it("AUM is unchanged on the per-key branch (D2): summed from holdings equity contribution", async () => {
    activeKeyA();
    seedHoldingsKeyA(42_000);
    seedPerKeyDailiesA();

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    // AUM = Σ value_usd over the single spot holding, regardless of branch.
    expect(result.liveBaselineMetrics.aum).toBe(42_000);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Phase 37 / 37-01 (DSRC-01) — the per-key channel is now ON THE PAYLOAD.
  // ───────────────────────────────────────────────────────────────────────

  it("Phase 37: populated per-key fixture exposes the per-key channel on the payload (gate true, eligible ids + series present)", async () => {
    activeKeyA();
    seedHoldingsKeyA();
    seedPerKeyDailiesA();

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // The D3 gate is satisfied (the single active key has a non-empty series).
    expect(result.perKeyDailiesGateSatisfied).toBe(true);
    // The eligible-key id list carries the seeded active key.
    expect(result.eligibleApiKeyIds).toContain("key-A");
    // The per-key series is on the wire, keyed by api_key_id, byte-identical to
    // the seeded csv_daily_returns (date + daily_return → value).
    expect(Object.keys(result.perKeyReturnsByApiKeyId)).toEqual(["key-A"]);
    expect(result.perKeyReturnsByApiKeyId["key-A"]).toEqual(
      ASOF.map((date, i) => ({ date, value: PERKEY_A[i] })),
    );
  });

  it("Phase 37: byte-identity — exposing the per-key channel does NOT alter liveBaselineMetrics (Pitfall 2)", async () => {
    activeKeyA();
    seedHoldingsKeyA();
    seedPerKeyDailiesA();

    const { getMyAllocationDashboard, liveBaselineMetricsFromPerKeyDailies } =
      await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // liveBaselineMetrics is STILL the per-key blend (Phase 36 invariant held):
    // the additive fields ride the SAME perKeyReturnsByApiKeyId it derives from.
    const expectedPerKey = liveBaselineMetricsFromPerKeyDailies(
      result.holdingsSummary,
      result.perKeyReturnsByApiKeyId,
    );
    expect(result.liveBaselineMetrics).toEqual(expectedPerKey);
  });

  it("Phase 37: cross-tenant guard — perKeyReturnsByApiKeyId keys are a SUBSET of the allocator's own apiKeys[].id (T-37-01-01)", async () => {
    activeKeyA();
    seedHoldingsKeyA();
    seedPerKeyDailiesA();
    // Adversarial: a foreign-tenant key's series is present in the raw table.
    // The allocator-scoped read (.eq("allocator_id", userId)) must filter it out,
    // so it can NEVER appear in the payload's per-key field.
    state.csvDailyReturns = [
      ...state.csvDailyReturns,
      ...ASOF.map((date, i) => ({
        api_key_id: "key-FOREIGN",
        allocator_id: "user-2",
        date,
        daily_return: PERKEY_A[i],
      })),
    ];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    const ownKeyIds = new Set(result.apiKeys.map((k) => k.id));
    for (const keyId of Object.keys(result.perKeyReturnsByApiKeyId)) {
      expect(ownKeyIds.has(keyId)).toBe(true);
    }
    // Specifically: the foreign tenant's key never leaks onto the wire.
    expect(result.perKeyReturnsByApiKeyId).not.toHaveProperty("key-FOREIGN");
    // The eligible-id list is likewise own-keys-only.
    for (const id of result.eligibleApiKeyIds) {
      expect(ownKeyIds.has(id)).toBe(true);
    }
  });
});

// =============================================================================
// Phase 36 / 36-03 — helper unit tests: the D3 predicate + the grouping +
// per-key blend honesty. Direct calls (no Supabase round-trip).
// =============================================================================
describe("allActiveKeysHavePerKeyDailies — Phase 36 D3 predicate", () => {
  it("true iff every active key id has a non-empty series", async () => {
    const { allActiveKeysHavePerKeyDailies } = await import("./queries");
    const series = { "key-A": [{ date: "2026-05-01", value: 0.01 }] };
    expect(allActiveKeysHavePerKeyDailies(["key-A"], series)).toBe(true);
    // missing key-B → false (mixed population falls back)
    expect(allActiveKeysHavePerKeyDailies(["key-A", "key-B"], series)).toBe(false);
    // empty active set → false (no per-key blend without active keys)
    expect(allActiveKeysHavePerKeyDailies([], series)).toBe(false);
    // key present but with an EMPTY series → false
    expect(
      allActiveKeysHavePerKeyDailies(["key-A"], { "key-A": [] }),
    ).toBe(false);
  });
});

describe("buildPerKeyReturnsByApiKeyId — Phase 36 grouping", () => {
  it("groups by api_key_id, maps daily_return→value, drops null key + non-finite", async () => {
    const { buildPerKeyReturnsByApiKeyId } = await import("./queries");
    const out = buildPerKeyReturnsByApiKeyId([
      { api_key_id: "key-A", date: "2026-05-01", daily_return: 0.01 },
      { api_key_id: "key-A", date: "2026-05-02", daily_return: -0.02 },
      { api_key_id: "key-B", date: "2026-05-01", daily_return: 0.03 },
      // dropped: null key
      { api_key_id: null, date: "2026-05-01", daily_return: 0.99 },
      // dropped: non-finite return
      { api_key_id: "key-A", date: "2026-05-03", daily_return: Number.NaN },
    ]);
    expect(out["key-A"]).toEqual([
      { date: "2026-05-01", value: 0.01 },
      { date: "2026-05-02", value: -0.02 },
    ]);
    expect(out["key-B"]).toEqual([{ date: "2026-05-01", value: 0.03 }]);
  });
});

describe("isPerKeyDailiesEligibleKey — Phase 36 D3 backfill-parity predicate", () => {
  it("mirrors the backfill: is_active AND sync_status != 'revoked' AND disconnected_at IS NULL", async () => {
    const { isPerKeyDailiesEligibleKey } = await import("./queries");
    const base = { is_active: true, sync_status: "synced", disconnected_at: null };
    // healthy active key → eligible
    expect(isPerKeyDailiesEligibleKey(base)).toBe(true);
    // a NULL sync_status (never synced) is still eligible (IS DISTINCT FROM 'revoked')
    expect(isPerKeyDailiesEligibleKey({ ...base, sync_status: null })).toBe(true);
    // deactivated → NOT eligible
    expect(isPerKeyDailiesEligibleKey({ ...base, is_active: false })).toBe(false);
    // revoked (allocator-protected path keeps is_active=true) → NOT eligible
    expect(isPerKeyDailiesEligibleKey({ ...base, sync_status: "revoked" })).toBe(
      false,
    );
    // soft-disconnected → NOT eligible
    expect(
      isPerKeyDailiesEligibleKey({ ...base, disconnected_at: "2026-05-01T00:00:00Z" }),
    ).toBe(false);
  });
});

describe("liveBaselineMetricsFromPerKeyDailies — financial edge branches (Phase 36 D1/D2)", () => {
  // 12 dates clears computeScenario's n>=10 floor.
  const DATES = Array.from({ length: 12 }, (_, i) =>
    `2026-05-${String(i + 1).padStart(2, "0")}`,
  );
  const series = (vals: number[]) =>
    DATES.map((date, i) => ({ date, value: vals[i % vals.length] }));

  type Holding =
    Awaited<ReturnType<typeof import("./queries")["getMyAllocationDashboard"]>>["holdingsSummary"][number];
  const spot = (api_key_id: string, value_usd: number): Holding => ({
    symbol: "BTC",
    quantity: 1,
    mark_price_usd: 50_000,
    value_usd,
    venue: "binance",
    holding_type: "spot",
    api_key_id,
    side: "flat",
    entry_price: null,
    unrealized_pnl_usd: null,
  });
  const deriv = (api_key_id: string, pnl: number): Holding => ({
    symbol: "BTC-PERP",
    quantity: 1,
    mark_price_usd: 50_000,
    value_usd: 100_000, // notional — NOT the equity contribution for a derivative
    venue: "binance",
    holding_type: "derivative",
    api_key_id,
    side: "long",
    entry_price: 50_000,
    unrealized_pnl_usd: pnl, // THIS is the equity contribution
  });

  it("empty per-key map (or only empty series) → empty-default: AUM from holdings, all KPIs null, equity/drawdown []", async () => {
    const { liveBaselineMetricsFromPerKeyDailies } = await import("./queries");
    const cases: Record<string, { date: string; value: number }[]>[] = [
      {},
      { "key-A": [] },
    ];
    for (const perKey of cases) {
      const out = liveBaselineMetricsFromPerKeyDailies([spot("key-A", 50_000)], perKey);
      expect(out.aum).toBe(50_000); // D2: AUM still summed from holdings
      expect(out.ytdTwr).toBeNull();
      expect(out.sharpe).toBeNull();
      expect(out.maxDd).toBeNull();
      expect(out.avgRho).toBeNull();
      expect(out.equity).toEqual([]);
      expect(out.drawdown).toEqual([]);
    }
  });

  it("totalAum <= 0 (flat derivative book) → drawdown is [] even though a per-key series exists", async () => {
    const { liveBaselineMetricsFromPerKeyDailies } = await import("./queries");
    // A derivative with unrealized_pnl_usd=0 → equity contribution 0 → totalAum 0.
    const out = liveBaselineMetricsFromPerKeyDailies(
      [deriv("key-A", 0)],
      { "key-A": series([0.01, -0.01]) },
    );
    expect(out.aum).toBe(0);
    // The `totalAum > 0 ? deriveSnapshotDrawdowns(...) : []` branch yields [].
    expect(out.drawdown).toEqual([]);
  });

  it("negative-equity clamp: a key with negative equity (losing derivative) gets weight 0, never a sign-flipping negative weight", async () => {
    const { liveBaselineMetricsFromPerKeyDailies } = await import("./queries");
    const up = series([0.02, 0.01, 0.02, 0.01]); // key-A rising
    const down = series([-0.2, -0.3, -0.25, -0.2]); // key-B crashing
    // key-A: +100k equity; key-B: -50k equity (clamped to 0). Same dates so the
    // overlap window is identical and only the weight differs.
    const twoKey = liveBaselineMetricsFromPerKeyDailies(
      [spot("key-A", 100_000), deriv("key-B", -50_000)],
      { "key-A": up, "key-B": down },
    );
    // key-B clamped to weight 0 → the WEIGHTED curve is key-A only. A broken
    // clamp (negative weight) would invert/amplify key-B's crash and produce a
    // different (likely sub-1.0) curve.
    const keyAOnly = liveBaselineMetricsFromPerKeyDailies(
      [spot("key-A", 100_000)],
      { "key-A": up },
    );
    expect(twoKey.equity).toEqual(keyAOnly.equity);
    // Sanity: key-A's rising series produces a final cumulative wealth > 1.
    expect(twoKey.equity.at(-1)!.value).toBeGreaterThan(1);
  });

  it("avgRho is a finite number on a multi-key blend (single-key yields null) — the correlation field is populated", async () => {
    const { liveBaselineMetricsFromPerKeyDailies } = await import("./queries");
    const out = liveBaselineMetricsFromPerKeyDailies(
      [spot("key-A", 60_000), spot("key-B", 40_000)],
      { "key-A": series([0.03, -0.02, 0.04, -0.01]), "key-B": series([-0.01, 0.02, -0.03, 0.02]) },
    );
    expect(typeof out.avgRho).toBe("number");
    expect(Number.isFinite(out.avgRho)).toBe(true);
    // Contrast: a single key has no pair to correlate → avgRho null.
    const single = liveBaselineMetricsFromPerKeyDailies(
      [spot("key-A", 60_000)],
      { "key-A": series([0.03, -0.02, 0.04, -0.01]) },
    );
    expect(single.avgRho).toBeNull();
  });

  it("BLEND-02: live-baseline Sharpe rides the √365 blend basis (every per-key leg is a crypto venue); twr/maxDd/avgRho basis-invariant", async () => {
    const { liveBaselineMetricsFromPerKeyDailies } = await import("./queries");
    const { computeScenario, buildDateMapCache } = await import("./scenario");

    const aVals = [0.03, -0.02, 0.04, -0.01, 0.02, -0.015];
    const bVals = [-0.01, 0.025, -0.03, 0.02, -0.005, 0.03];
    const aSeries = series(aVals);
    const bSeries = series(bVals);

    const out = liveBaselineMetricsFromPerKeyDailies(
      [spot("key-A", 60_000), spot("key-B", 40_000)],
      { "key-A": aSeries, "key-B": bSeries },
    );

    // Reconstruct the EXACT units the helper builds (one StrategyForBuilder per
    // api_key_id; weight = clamped equity contribution; every unit selected;
    // asset_class "crypto" — every SUPPORTED_EXCHANGE is a crypto venue), so we
    // can run the frozen engine at 252 vs 365 and pin WHICH basis the helper's
    // Sharpe rides. This is the hand-computed 252-basis reference.
    const unit = (id: string, s: typeof aSeries): StrategyForBuilder => ({
      id,
      name: `key ${id}`,
      codename: null,
      disclosure_tier: "exploratory",
      strategy_types: [],
      markets: [],
      start_date: null,
      daily_returns: s,
      cagr: null,
      sharpe: null,
      volatility: null,
      max_drawdown: null,
      asset_class: "crypto",
    });
    const units = [unit("key-A", aSeries), unit("key-B", bSeries)];
    const st = {
      selected: { "key-A": true, "key-B": true },
      weights: { "key-A": 60_000, "key-B": 40_000 },
      startDates: {},
    };
    const cache = buildDateMapCache(units);
    const cm252 = computeScenario(units, st, cache, 252);
    const cm365 = computeScenario(units, st, cache, 365);

    // Sharpe MOVED to the 365 basis: helper === the 365 run, and equals the
    // 252-basis value × √(365/252).
    expect(out.sharpe).not.toBeNull();
    expect(out.sharpe).toBe(cm365.sharpe);
    // Magnitude check: the Sharpe scales ≈√(365/252) vs the 252 basis. (Not an
    // EXACT ULP identity — the engine annualizes mean-return and vol on slightly
    // different clocks, so the ratio drifts ~1e-6 from √(365/252); the exact
    // `=== cm365.sharpe` pin above is the load-bearing basis assertion. Precision
    // 3 cleanly separates ~1.2035 from the 252-basis 1.0.)
    expect((out.sharpe as number) / (cm252.sharpe as number)).toBeCloseTo(
      Math.sqrt(365 / 252),
      3,
    );
    // Falsifiable: the two bases genuinely differ for this fixture, so a helper
    // still on the 252 default would fail the `=== cm365.sharpe` pin above.
    expect(cm365.sharpe).not.toBe(cm252.sharpe);

    // Basis-INVARIANT outputs: twr / maxDd / avgRho are identical across bases
    // and byte-identical to the helper output (the blend basis touches ONLY the
    // frequency-annualized risk metric).
    expect(cm365.twr).toBe(cm252.twr);
    expect(out.ytdTwr).toBe(cm252.twr);
    expect(out.maxDd).toBe(cm252.max_drawdown);
    expect(out.avgRho).toBe(cm252.avg_pairwise_correlation);
    // Do NOT pin cagr here: liveBaseline flows through computeScenario, whose
    // CAGR clock 84-06 converts to calendar-span this same phase.
  });
});

// Phase 111 / CONSTIT-02 — provenance threading into the SSR payload.
// trust_tier lives ONLY on strategy_verifications (D-04); is_composite is a
// server-coerced boolean from strategy_analytics.data_quality_flags.composite.
// The raw flags blob must NEVER reach the client (T-111-03), and the embed
// rows must not leak either.
function psProvenance(overrides: {
  strategy_id?: string;
  verifications?: Array<{ trust_tier: string; status: string; created_at: string }>;
  data_quality_flags?: unknown;
  // Phase 147 / SCEN-01 — series-resolution inputs. Every one of these is
  // optional with a default that reproduces the pre-147 fixture byte-for-byte,
  // so the CONSTIT-02 cases above stay unmodified (plan acceptance).
  daily_returns?: unknown;
  returns_series?: unknown;
  computation_status?: string | null;
  /** false ⇒ the strategy has NO strategy_analytics row at all (embed null). */
  analyticsRow?: boolean;
  /** Drives the missing-row age bound in deriveEmptySeriesState. */
  strategy_created_at?: string | null;
}): unknown {
  const {
    strategy_id = "sc",
    verifications = [],
    data_quality_flags = null,
    daily_returns = [],
    returns_series = null,
    computation_status = "complete",
    analyticsRow = true,
    strategy_created_at = null,
  } = overrides;
  return {
    portfolio_id: "real-1",
    strategy_id,
    current_weight: 0.3,
    allocated_amount: 30000,
    alias: null,
    strategy: {
      id: strategy_id,
      name: "Composite Book",
      codename: null,
      disclosure_tier: "institutional",
      strategy_types: [],
      markets: [],
      start_date: null,
      asset_class: "crypto",
      created_at: strategy_created_at,
      organization: null,
      strategy_verifications: verifications,
      strategy_analytics: analyticsRow
        ? {
            daily_returns,
            cagr: 0.1,
            sharpe: 1,
            volatility: 0.2,
            max_drawdown: -0.1,
            data_quality_flags,
            returns_series,
            computation_status,
          }
        : null,
    },
  };
}

describe("getMyAllocationDashboard — CONSTIT-02 provenance threading", () => {
  beforeEach(() => {
    resetState();
    state.portfolios = [PORTFOLIO_FIXTURE];
  });

  it("projects the most-recent strategy_verifications.trust_tier onto strategy.trust_tier", async () => {
    state.portfolioStrategies = [
      psProvenance({
        verifications: [
          { trust_tier: "self_reported", status: "pending", created_at: "2026-01-01T00:00:00Z" },
          { trust_tier: "api_verified", status: "verified", created_at: "2026-06-01T00:00:00Z" },
        ],
      }) as (typeof state.portfolioStrategies)[number],
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    const row = result.strategies.find((s) => s.strategy_id === "sc");
    expect(row).toBeDefined();
    expect((row!.strategy as unknown as { trust_tier: unknown }).trust_tier).toBe("api_verified");
  });

  it("yields trust_tier null when no verification rows exist (not a throw)", async () => {
    state.portfolioStrategies = [
      psProvenance({ verifications: [] }) as (typeof state.portfolioStrategies)[number],
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    const row = result.strategies.find((s) => s.strategy_id === "sc");
    expect((row!.strategy as unknown as { trust_tier: unknown }).trust_tier).toBeNull();
  });

  it("derives is_composite === true only from data_quality_flags.composite === true", async () => {
    state.portfolioStrategies = [
      psProvenance({ data_quality_flags: { composite: true } }) as (typeof state.portfolioStrategies)[number],
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    const row = result.strategies.find((s) => s.strategy_id === "sc");
    expect((row!.strategy as unknown as { is_composite: unknown }).is_composite).toBe(true);
  });

  it("coerces malformed/absent data_quality_flags to is_composite=false (T-111-04 strict === true)", async () => {
    for (const flags of [null, {}, { composite: "true" }, { composite: 1 }, "garbage"]) {
      state.portfolioStrategies = [
        psProvenance({ data_quality_flags: flags }) as (typeof state.portfolioStrategies)[number],
      ];
      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");
      const row = result.strategies.find((s) => s.strategy_id === "sc");
      expect((row!.strategy as unknown as { is_composite: unknown }).is_composite).toBe(false);
    }
  });

  it("never ships the raw data_quality_flags blob or the strategy_verifications embed to the client (T-111-03)", async () => {
    state.portfolioStrategies = [
      psProvenance({
        verifications: [
          { trust_tier: "api_verified", status: "verified", created_at: "2026-06-01T00:00:00Z" },
        ],
        data_quality_flags: { composite: true, degraded_members: ["okx:BTC"] },
      }) as (typeof state.portfolioStrategies)[number],
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    const row = result.strategies.find((s) => s.strategy_id === "sc")!;
    const strat = row.strategy as unknown as Record<string, unknown>;
    // boolean projection only — no raw flags object, no verification embed
    expect("data_quality_flags" in (strat.strategy_analytics as Record<string, unknown>)).toBe(false);
    expect("strategy_verifications" in strat).toBe(false);
    // the venue-detail degraded_members must not appear anywhere in the payload
    expect(JSON.stringify(row)).not.toContain("degraded_members");
    expect(JSON.stringify(row)).not.toContain("okx:BTC");
  });
});

// ---------------------------------------------------------------------------
// Phase 147 / SCEN-01 — the BOOK path receives the real series.
//
// WHY THIS EXISTS: the scenario composer consults this payload's
// strategy_analytics.daily_returns FIRST for any strategy already in the
// allocator's own portfolio, and deliberately SKIPS the lazy /returns fetch for
// those rows — so a bare `daily_returns`-only projection has no rescue path.
// The analytics-service writes the cumprod WEALTH curve to `returns_series` and
// leaves `daily_returns` null for analytics-only strategies, which is why the
// founder's own-portfolio strategy renders 0.00. Server-side resolution here is
// the acceptance anchor (RESEARCH P2).
//
// The expected return values below are HAND-COMPUTED from the wealth curve
// (successive ratios minus one) and written as literals — they are never
// produced by calling the resolver under test:
//   1.05   / 1.0   - 1 =  0.05
//   0.945  / 1.05  - 1 = -0.10
//   1.0395 / 0.945 - 1 =  0.10
// ---------------------------------------------------------------------------
const SC1_WEALTH_CURVE = [
  { date: "2026-01-01", value: 1.0 },
  { date: "2026-01-02", value: 1.05 },
  { date: "2026-01-03", value: 0.945 },
  { date: "2026-01-04", value: 1.0395 },
];

describe("getMyAllocationDashboard — Phase 147 SCEN-01 series resolution", () => {
  beforeEach(() => {
    resetState();
    state.portfolios = [PORTFOLIO_FIXTURE];
  });

  async function bookRow(overrides: Parameters<typeof psProvenance>[0]) {
    state.portfolioStrategies = [
      psProvenance(overrides) as (typeof state.portfolioStrategies)[number],
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    return result.strategies.find((s) => s.strategy_id === "sc")!;
  }

  it("emits the DIFFERENCED series when only returns_series is populated (the founder's own-portfolio anchor)", async () => {
    const row = await bookRow({
      daily_returns: null,
      returns_series: SC1_WEALTH_CURVE,
      computation_status: "complete",
    });
    const series = (
      row.strategy.strategy_analytics as unknown as {
        daily_returns: Array<{ date: string; value: number }>;
      }
    ).daily_returns;
    expect(series).toHaveLength(3);
    expect(series[0].value).toBeCloseTo(0.05, 10);
    expect(series[1].value).toBeCloseTo(-0.1, 10);
    expect(series[2].value).toBeCloseTo(0.1, 10);
    expect(series.map((p) => p.date)).toEqual([
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
  });

  it("never ships the raw returns_series or computation_status columns to the client (T-147-10)", async () => {
    const row = await bookRow({
      daily_returns: null,
      returns_series: SC1_WEALTH_CURVE,
      computation_status: "complete",
    });
    const analytics = row.strategy.strategy_analytics as unknown as Record<
      string,
      unknown
    >;
    expect("returns_series" in analytics).toBe(false);
    expect("computation_status" in analytics).toBe(false);
    expect(JSON.stringify(row)).not.toContain("returns_series");
    expect(JSON.stringify(row)).not.toContain("computation_status");
  });

  it("prefers a populated daily_returns column over the wealth curve (direct-first)", async () => {
    const direct = [
      { date: "2026-02-01", value: 0.02 },
      { date: "2026-02-02", value: -0.03 },
    ];
    const row = await bookRow({
      daily_returns: direct,
      returns_series: SC1_WEALTH_CURVE,
      computation_status: "complete",
    });
    const series = (
      row.strategy.strategy_analytics as unknown as {
        daily_returns: Array<{ date: string; value: number }>;
      }
    ).daily_returns;
    expect(series).toEqual(direct);
  });

  it("does not forward the RAW wealth curve as if it were returns (raw-forward guard)", async () => {
    const row = await bookRow({
      daily_returns: null,
      returns_series: SC1_WEALTH_CURVE,
      computation_status: "complete",
    });
    const series = (
      row.strategy.strategy_analytics as unknown as {
        daily_returns: Array<{ date: string; value: number }>;
      }
    ).daily_returns;
    // A raw forward would be length 4 and open at the 1.0 wealth base.
    expect(series).not.toHaveLength(4);
    expect(series[0].value).not.toBeCloseTo(1.0, 10);
  });

  // -------------------------------------------------------------------------
  // series_state — the derived honesty signal for the book row's chip.
  // ONE rule, shared with the returns route via deriveEmptySeriesState
  // (UI-SPEC §3 forbids a second table). The 16h missing-row bound is what
  // stops a strategy whose compute job was never enqueued from spinning
  // forever; it is expressed here as hour offsets, never as an imported
  // constant.
  // -------------------------------------------------------------------------
  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
  const seriesState = (row: { strategy: unknown }) =>
    (row.strategy as { series_state?: unknown }).series_state;

  it("reports series_state 'available' when the resolved series is non-empty", async () => {
    const row = await bookRow({
      daily_returns: null,
      returns_series: SC1_WEALTH_CURVE,
      computation_status: "complete",
    });
    expect(seriesState(row)).toBe("available");
  });

  it("reports series_state 'computing' while a job is live and no series exists yet", async () => {
    const row = await bookRow({
      daily_returns: null,
      returns_series: null,
      computation_status: "computing",
    });
    expect(seriesState(row)).toBe("computing");
  });

  it("reports series_state 'empty' for a TERMINAL status with no series (complete and failed alike)", async () => {
    for (const status of ["complete", "failed"]) {
      const row = await bookRow({
        daily_returns: null,
        returns_series: null,
        computation_status: status,
      });
      expect(seriesState(row)).toBe("empty");
    }
  });

  it("age-bounds a MISSING analytics row: 17h old is 'empty', 1h old is still 'computing'", async () => {
    const stale = await bookRow({
      analyticsRow: false,
      strategy_created_at: hoursAgo(17),
    });
    expect(seriesState(stale)).toBe("empty");

    const fresh = await bookRow({
      analyticsRow: false,
      strategy_created_at: hoursAgo(1),
    });
    expect(seriesState(fresh)).toBe("computing");
  });
});

// ---------------------------------------------------------------------------
// Phase 115.1 — E2 equity display-repoint (BACKBONE-03 else-branch)
//
// The allocator $-equity DISPLAY moves OFF legacy `value_usd` snapshots ONTO the
// new keyed `allocator_equity_derived` surface — BUT only when a trustworthy
// derived row exists. The SAFETY pin below (never redden) proves the fallback
// contract: with NO derived row, equityDailyPoints renders byte-identically to
// the legacy snapshot path, so the prod cutover is safe even though all 517 prod
// allocator keys currently have ZERO per-key csv_daily_returns (A1 census).
//
// Pins 2/3 are RED until plan 05 wires the derived read + `equityCurveSource`.
// ---------------------------------------------------------------------------

const P1151_PORTFOLIO = {
  id: "real-1",
  user_id: "user-1",
  name: "Active Allocation",
  description: null,
  created_at: "2024-06-01T00:00:00Z",
  is_test: false,
};

// A DENSE derived curve per the phase-wide interfaces contract — dense so the
// derived path's direct `curve.map` (NO forward-fill adapter) is the exact series.
const P1151_DERIVED_CURVE = [
  { date: "2026-03-10", equity_usd: 100_500.5 },
  { date: "2026-03-11", equity_usd: 100_900.25 },
  { date: "2026-03-12", equity_usd: 101_010.1 },
  { date: "2026-03-13", equity_usd: 101_400.75 },
];

function derivedRow(isTrustworthy: boolean) {
  return {
    allocator_id: "user-1",
    kind: "equity_curve",
    payload: {
      curve: P1151_DERIVED_CURVE,
      flags: [],
      degrade_reasons: [],
      is_trustworthy: isTrustworthy,
      scalars: { mwr: 0.12, dietz: 0.11, computable: true },
      inputs: { n_keys: 2, anchor_asof: "2026-03-13", composed_at: "2026-03-13T00:00:00Z" },
    } as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Phase 167.1.2 / D-02 ("Hide it until correct") — the producer withholds the
// allocator $-equity curve for EVERY allocator.
//
// Why this matters: the legacy snapshot sum and the derived curve can both count
// one exchange account twice (two keys on one account) or read a day with no
// sync as zero. The founder's own book showed a +100% jump, a -50% "crash" and a
// Sharpe of 1.44 beside -42.8% cumulative, all computed from
// `equityDailyPoints`. Withholding that one series at its one producer removes
// every one of those numbers at once. A trustworthy-looking derived row is the
// case that MUST still be withheld (it double-counts a shared account until
// identity is resolved), so it is the fixture here, alongside legacy snapshots.
// ---------------------------------------------------------------------------
describe("167.1.2 D-02 — the allocator equity curve is withheld while it is rebuilt", () => {
  // Review C2 round 3 R3-WR-04: the derived_row_rejected capture is throttled
  // per (allocator, rejection) in module state, and every test here reads as
  // user-1, so each test starts with an empty window.
  beforeEach(async () => {
    resetState();
    (await import("./queries")).__resetDerivedRowCaptureThrottleForTests();
  });

  it("a trustworthy pre-v2 derived row → equityDailyPoints is [], equityHistoryState is 'rebuilding' and snapshotCount is null", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.allocatorEquityDerived = [derivedRow(true)];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // Positive control: the derived row was really present and read — it was
    // selected as today — so the empty series below is the D-02 gate, not an
    // absent input. Phase 176: no count over a held-back history (null, not 0).
    expect(result.equityCurveSource).toBe("derived");
    expect(result.snapshotCount).toBeNull();
    expect(result.equityHistoryState).toBe("rebuilding");
    expect(result.equityDailyPoints).toEqual([]);
  });

  it("the no-portfolio branch withholds the curve too (both branches spread the same producer)", async () => {
    state.portfolios = [];
    state.allocatorEquityDerived = [derivedRow(true)];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.snapshotCount).toBeNull();
    expect(result.equityHistoryState).toBe("rebuilding");
    expect(result.equityDailyPoints).toEqual([]);
  });

  // Phase 167.1.2 plan 11 (T-167.1.2-20a). The readiness rule is pinned on the
  // pure helper in queries.test.ts; these two pin that the producer applies it
  // to the key list getMyAllocationDashboard actually reads. The same v2 row
  // is ready with one identified key and rebuilding once a second key reads
  // the same account, so the difference is the marker and nothing else.
  function v2Row() {
    const row = derivedRow(true);
    row.payload.version = 2;
    row.payload.returns = [
      { date: "2026-03-11", r: 0.0038 },
      { date: "2026-03-12", r: 0.0011 },
      { date: "2026-03-13", r: 0.0039 },
    ];
    return row;
  }
  const identifiedKey = (over: Record<string, unknown> = {}) => ({
    id: "k-holder",
    user_id: "user-1",
    exchange: "binance",
    label: "Binance main",
    is_active: true,
    sync_status: "ok",
    last_sync_at: new Date().toISOString(),
    disconnected_at: null,
    account_balance_usdt: 1000,
    created_at: "2026-04-01T00:00:00Z",
    venue_account_id: "acct-synthetic-1",
    account_share_kind: null,
    account_shared_with_api_key_id: null,
    ...over,
  });

  it("plan 11: a version-2 row and one identified key read ready through getMyAllocationDashboard", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [identifiedKey()];
    state.allocatorEquityDerived = [v2Row()];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.equityHistoryState).toBe("ready");
    expect(result.equityHistoryRebuildReason).toBeNull();
    expect(result.equityDailyReturns).toHaveLength(3);
  });

  it("plan 11: the same row with a second key marked a duplicate of a working holder is rebuilding, reason duplicate_account", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [
      identifiedKey(),
      identifiedKey({
        id: "k-dup",
        label: "Binance copy",
        account_share_kind: "duplicate",
        account_shared_with_api_key_id: "k-holder",
      }),
    ];
    state.allocatorEquityDerived = [v2Row()];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.equityHistoryState).toBe("rebuilding");
    expect(result.equityHistoryRebuildReason).toBe("duplicate_account");
    expect(result.equityDailyPoints).toEqual([]);
    expect(result.equityDailyReturns).toEqual([]);
  });

  // Phase 176 (D-02, D-07, Discretion). The dashboard reads no legacy curve:
  // the warm-up count is the day count of the DRAWN derived curve when the
  // history is ready, and null otherwise. 40 legacy rows are seeded in every
  // arm so a producer that still read them would report their count.
  describe("176 D-02 / D-07: the payload reads no legacy curve; snapshotCount counts the drawn derived curve", () => {
    const legacyRows = () =>
      Array.from({ length: 40 }, (_, i) => ({
        allocator_id: "user-1",
        asof: `2026-02-${String((i % 28) + 1).padStart(2, "0")}`,
        value_usd: 1000 + i,
        breakdown: null,
        source: "exchange_primary" as const,
        history_depth_months: 3,
        pre_terminus_balance_unknown: i % 2 === 0,
      }));
    const twelveDayV2Row = () => {
      const row = v2Row();
      const days = Array.from(
        { length: 12 },
        (_, i) => `2026-03-${String(i + 1).padStart(2, "0")}`,
      );
      row.payload.curve = days.map((date, i) => ({
        date,
        equity_usd: 100_000 + i * 10,
      }));
      row.payload.returns = days.slice(1).map((date) => ({ date, r: 0.001 }));
      return row;
    };

    it("B-02: the read issues no .from of the legacy table", async () => {
      state.portfolios = [P1151_PORTFOLIO];
      state.apiKeys = [identifiedKey()];
      state.allocatorEquityDerived = [twelveDayV2Row()];
      state.allocatorEquitySnapshots = legacyRows();

      const { getMyAllocationDashboard } = await import("./queries");
      await getMyAllocationDashboard("user-1");

      // Positive control: the audit saw the derived read, so an empty filter
      // below is the absence of the legacy read, not an unhooked audit.
      expect(
        chainAudit.entries.some((e) => e.table === "allocator_equity_derived"),
      ).toBe(true);
      expect(
        chainAudit.entries.filter((e) => e.table === "allocator_equity_snapshots"),
      ).toHaveLength(0);
    });

    it("B-01: a ready book reports snapshotCount on the drawn derived days, not the legacy row count", async () => {
      state.portfolios = [P1151_PORTFOLIO];
      state.apiKeys = [identifiedKey()];
      state.allocatorEquityDerived = [twelveDayV2Row()];
      state.allocatorEquitySnapshots = legacyRows();

      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(result.equityHistoryState).toBe("ready");
      expect(result.equityDailyPoints).toHaveLength(12);
      expect(result.snapshotCount).toBe(12);
    });

    it("B-01b: a rebuilding book (no derived row) reports snapshotCount null, never a count over held-back history", async () => {
      state.portfolios = [P1151_PORTFOLIO];
      state.apiKeys = [identifiedKey()];
      state.allocatorEquitySnapshots = legacyRows();

      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(result.equityHistoryState).toBe("rebuilding");
      expect(result.equityHistoryRebuildReason).toBe("awaiting_derivation");
      expect(result.snapshotCount).toBeNull();
    });

    it("D-07: the payload carries no equitySnapshots, minHistoryDepthMonths or equityBaselineUnknown", async () => {
      state.portfolios = [P1151_PORTFOLIO];
      state.apiKeys = [identifiedKey()];
      state.allocatorEquityDerived = [twelveDayV2Row()];
      state.allocatorEquitySnapshots = legacyRows();

      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(result).not.toHaveProperty("equitySnapshots");
      expect(result).not.toHaveProperty("minHistoryDepthMonths");
      expect(result).not.toHaveProperty("equityBaselineUnknown");
      // activeVenues stays: the factsheet markets line reads it.
      expect(result).toHaveProperty("activeVenues");
    });
  });

  // Review C2 SFH-06. A failed read of the derived row used to become
  // "awaiting derivation" (a promise of a daily recompute) under a log line
  // that claimed a legacy fallback plan 11 removed, and PGRST205 was not
  // logged at all. The read now reports to Sentry, logs what really happens,
  // and gives the producer a distinct outcome.
  it.each([
    ["a transport error", { message: "connection reset (test)" }],
    ["PGRST205 (table missing from the schema cache)", { message: "schema cache miss (test)", code: "PGRST205" }],
  ])("SFH-06: %s on the derived-row read is history_read_failed, logged and reported", async (_label, error) => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [identifiedKey()];
    state.allocatorEquityDerived = [v2Row()];
    state.tableErrors["allocator_equity_derived"] = error as { message: string };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentry = await import("./sentry-capture");
    const captureSpy = vi
      .spyOn(sentry, "captureToSentry")
      .mockImplementation(async () => {});

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.equityHistoryState).toBe("rebuilding");
    expect(result.equityHistoryRebuildReason).toBe("history_read_failed");
    expect(captureSpy).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        tags: expect.objectContaining({ reason: "derived_row_read_failed" }),
      }),
    );
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("allocator_equity_derived read failed");
    expect(logged).not.toContain("legacy");
    errSpy.mockRestore();
    captureSpy.mockRestore();
  });

  // Review C2 round 2 R2-CR-03 (deploy day). `version: 2` is new in C2, so
  // every row written before the deploy is pre-v2. Such a row passed every
  // check its writer ran; only the reader's contract moved, and the daily
  // compose (`derive-allocator-key-dailies`, 05:30 UTC) rewrites it as v2. So
  // it reads `awaiting_derivation` ("recomputed once a day" is TRUE for it)
  // and it is NOT sent to Sentry: a warning per dashboard load for every book
  // on deploy day would report a normal transition as a fault.
  it("R2-CR-03: a pre-v2 row is awaiting_derivation, logged with its token, and not sent to Sentry", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [identifiedKey()];
    state.allocatorEquityDerived = [derivedRow(true)]; // no version: pre-v2
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentry = await import("./sentry-capture");
    const captureSpy = vi
      .spyOn(sentry, "captureToSentry")
      .mockImplementation(async () => {});

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.equityHistoryState).toBe("rebuilding");
    expect(result.equityHistoryRebuildReason).toBe("awaiting_derivation");
    expect(captureSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tags: expect.objectContaining({ reason: "derived_row_rejected" }),
      }),
    );
    // The local trace stays: the token, and never a curve value.
    const warned = JSON.stringify(warnSpy.mock.calls);
    expect(warned).toContain("not_version_2");
    expect(warned).toContain("awaiting_derivation");
    expect(warned).not.toContain("100500");
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain("allocator_equity_derived row");
    warnSpy.mockRestore();
    errSpy.mockRestore();
    captureSpy.mockRestore();
  });

  // Review C2 SFH-05 (reader half), kept for rows that ARE version 2. A v2 row
  // its writer marked untrustworthy already had its recompute, so it is
  // `derivation_rejected` and reported with its token only.
  it("SFH-05: a v2 row the writer marked untrustworthy is derivation_rejected and reported with its rejection token", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [identifiedKey()];
    const row = v2Row();
    row.payload.is_trustworthy = false;
    row.payload.degrade_reasons = ["dropped_key"];
    state.allocatorEquityDerived = [row];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentry = await import("./sentry-capture");
    const captureSpy = vi
      .spyOn(sentry, "captureToSentry")
      .mockImplementation(async () => {});

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.equityHistoryState).toBe("rebuilding");
    expect(result.equityHistoryRebuildReason).toBe("derivation_rejected");
    expect(captureSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          reason: "derived_row_rejected",
          rejection: "untrustworthy",
        }),
        level: "warning",
      }),
    );
    // Token only: the curve's dollar values never reach the log.
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain("untrustworthy");
    expect(logged).not.toContain("100500");
    errSpy.mockRestore();
    captureSpy.mockRestore();
  });

  // Review C2 round 3 R3-WR-03. The shared account with no working key is the
  // writer's untrustworthy verdict too, so it is still captured with the same
  // rejection token, but the owner sees its own reason, read from the
  // persisted `degrade_reasons`, and not "did not pass its checks".
  it("R3-WR-03: a v2 row untrustworthy for shared_account_no_working_key names that reason", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [identifiedKey()];
    const row = v2Row();
    row.payload.is_trustworthy = false;
    row.payload.degrade_reasons = ["shared_account_no_working_key"];
    state.allocatorEquityDerived = [row];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentry = await import("./sentry-capture");
    const captureSpy = vi
      .spyOn(sentry, "captureToSentry")
      .mockImplementation(async () => {});

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.equityHistoryState).toBe("rebuilding");
    expect(result.equityHistoryRebuildReason).toBe("shared_account_no_working_key");
    expect(result.equityDailyPoints).toEqual([]);
    expect(captureSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          reason: "derived_row_rejected",
          rejection: "untrustworthy",
        }),
      }),
    );
    errSpy.mockRestore();
    captureSpy.mockRestore();
  });

  // Review C2 round 2 SFH-R2-05. `captureToSentry` returns its import chain so
  // a server caller can hold the request open until the capture settles. A
  // discarded chain can be reaped on a cold finish and the alert is lost. Both
  // derived-row captures are therefore handed to `after()`, and the scheduled
  // work settles only when the capture does.
  it.each([
    [
      "a failed read",
      () => {
        state.allocatorEquityDerived = [v2Row()];
        state.tableErrors["allocator_equity_derived"] = { message: "connection reset (test)" };
      },
      "derived_row_read_failed",
    ],
    [
      "a v2 row the writer marked untrustworthy",
      () => {
        const row = v2Row();
        row.payload.is_trustworthy = false;
        state.allocatorEquityDerived = [row];
      },
      "derived_row_rejected",
    ],
  ] as const)("SFH-R2-05: the capture for %s is scheduled with after() and awaited", async (_label, arrange, reason) => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [identifiedKey()];
    arrange();
    afterCallbacks.length = 0;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    const capture = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sentry = await import("./sentry-capture");
    const captureSpy = vi
      .spyOn(sentry, "captureToSentry")
      .mockImplementation(() => capture);

    const { getMyAllocationDashboard } = await import("./queries");
    await getMyAllocationDashboard("user-1");

    expect(captureSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tags: expect.objectContaining({ reason }) }),
    );
    const scheduled = afterCallbacks.map((cb) => Promise.resolve(cb()));
    expect(scheduled.length).toBeGreaterThan(0);
    let settled = false;
    void Promise.all(scheduled).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Still pending: the scheduled work is holding the capture, not dropping it.
    expect(settled).toBe(false);
    release();
    await Promise.all(scheduled);
    expect(settled).toBe(true);
    errSpy.mockRestore();
    captureSpy.mockRestore();
  });

  // Review C2 round 3 R3-WR-04. `router.refresh()` re-runs this read every
  // 30 s while the Overview is open (AllocationsTabs'
  // PERFORMANCE_POLL_INTERVAL_MS), and an untrustworthy row can last for days
  // (no working key, a history gap). One capture per load was ~120 Sentry
  // events an hour per open tab and kept the issue permanently active, which
  // defeats the alert. A given (allocator, rejection) now reports at most once
  // per window per server instance; the console line stays on every load.
  it("R3-WR-04: the rejected-row capture reports once per (allocator, rejection) per window; the log line stays on every load", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [identifiedKey()];
    const untrusted = v2Row();
    untrusted.payload.is_trustworthy = false;
    state.allocatorEquityDerived = [untrusted];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentry = await import("./sentry-capture");
    const captureSpy = vi
      .spyOn(sentry, "captureToSentry")
      .mockImplementation(async () => {});
    const rejectedCaptures = (rejection: string) =>
      captureSpy.mock.calls.filter(
        ([, ctx]) =>
          (ctx as { tags?: Record<string, string> } | undefined)?.tags?.reason ===
            "derived_row_rejected" &&
          (ctx as { tags?: Record<string, string> }).tags?.rejection === rejection,
      ).length;
    const rejectedLogs = () =>
      errSpy.mock.calls.filter((c) =>
        String(c[0]).includes("allocator_equity_derived row rejected"),
      ).length;

    const { getMyAllocationDashboard, DERIVED_ROW_CAPTURE_WINDOW_MS } = await import(
      "./queries"
    );
    const t0 = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(t0);

    try {
      // Three polls inside the window: one capture, three log lines.
      await getMyAllocationDashboard("user-1");
      await getMyAllocationDashboard("user-1");
      nowSpy.mockReturnValue(t0 + DERIVED_ROW_CAPTURE_WINDOW_MS - 1);
      await getMyAllocationDashboard("user-1");
      expect(rejectedCaptures("untrustworthy")).toBe(1);
      expect(rejectedLogs()).toBe(3);

      // A different rejection for the same allocator has its own window.
      const malformed = v2Row();
      malformed.payload.returns = [];
      state.allocatorEquityDerived = [malformed];
      await getMyAllocationDashboard("user-1");
      expect(rejectedCaptures("malformed")).toBe(1);

      // Once the window has passed, the state that is still there reports again.
      state.allocatorEquityDerived = [untrusted];
      nowSpy.mockReturnValue(t0 + DERIVED_ROW_CAPTURE_WINDOW_MS);
      await getMyAllocationDashboard("user-1");
      expect(rejectedCaptures("untrustworthy")).toBe(2);
      expect(rejectedLogs()).toBe(5);
    } finally {
      nowSpy.mockRestore();
      errSpy.mockRestore();
      captureSpy.mockRestore();
    }
  });

  it("SFH-05 positive control: an accepted v2 row reports nothing", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [identifiedKey()];
    state.allocatorEquityDerived = [v2Row()];
    const sentry = await import("./sentry-capture");
    const captureSpy = vi
      .spyOn(sentry, "captureToSentry")
      .mockImplementation(async () => {});

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.equityHistoryState).toBe("ready");
    expect(captureSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tags: expect.objectContaining({ reason: "derived_row_rejected" }),
      }),
    );
    captureSpy.mockRestore();
  });

  // Phase 167.2.1.1.2 plan 02 (D-03, AR-3). The rebuild function stores the date
  // where the rebuilt window meets the older unchanged days as one
  // allocator_equity_derived row (kind snapshot_rebuild_boundary). The dashboard
  // payload is its one reader, so a chart or return can name the seam. Nothing
  // renders it (RESEARCH OQ-1): the curve on screen is the derived equity_curve
  // row, which does not carry the seam. Expected values are typed literals.
  describe("snapshot rebuild boundary (Phase 167.2.1.1.2 D-03)", () => {
    const boundaryRow = (
      payload: Record<string, unknown> = { boundary_date: "2026-07-24" },
      allocatorId = "user-1",
    ) => ({
      allocator_id: allocatorId,
      kind: "snapshot_rebuild_boundary",
      payload,
    });

    it("a stored boundary row reaches the payload as { boundaryDate }", async () => {
      state.portfolios = [P1151_PORTFOLIO];
      state.apiKeys = [identifiedKey()];
      state.allocatorEquityDerived = [v2Row(), boundaryRow()];

      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(result.snapshotRebuildBoundary).toEqual({ boundaryDate: "2026-07-24" });
    });

    it("the fresh-allocator branch carries it too", async () => {
      state.portfolios = [];
      state.allocatorEquityDerived = [v2Row(), boundaryRow()];

      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(result.snapshotRebuildBoundary).toEqual({ boundaryDate: "2026-07-24" });
    });

    it("no boundary row means null, and the equity curve read is unchanged", async () => {
      state.portfolios = [P1151_PORTFOLIO];
      state.apiKeys = [identifiedKey()];
      state.allocatorEquityDerived = [v2Row()];

      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(result.snapshotRebuildBoundary).toBeNull();
      // The same fixture read "ready" with three returns before this plan
      // (see "plan 11: a version-2 row and one identified key read ready").
      expect(result.equityHistoryState).toBe("ready");
      expect(result.equityDailyReturns).toHaveLength(3);
    });

    it("a failed boundary read is non-fatal, logged and reported", async () => {
      state.portfolios = [P1151_PORTFOLIO];
      state.apiKeys = [identifiedKey()];
      state.allocatorEquityDerived = [v2Row(), boundaryRow()];
      const failure = { message: "connection reset (test)" };
      state.tableErrors["allocator_equity_derived"] = failure;
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const sentry = await import("./sentry-capture");
      const captureSpy = vi
        .spyOn(sentry, "captureToSentry")
        .mockImplementation(async () => {});

      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      // The call resolved (non-fatal) and the boundary names nothing.
      expect(result.snapshotRebuildBoundary).toBeNull();
      expect(captureSpy).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({
          tags: expect.objectContaining({
            op: "getMyAllocationDashboard",
            reason: "snapshot_rebuild_boundary_read_failed",
          }),
        }),
      );
      const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("snapshot_rebuild_boundary read failed");
      expect(logged).not.toContain("legacy");
      errSpy.mockRestore();
      captureSpy.mockRestore();
    });

    it("another allocator's boundary row is never read", async () => {
      state.portfolios = [P1151_PORTFOLIO];
      state.apiKeys = [identifiedKey()];
      state.allocatorEquityDerived = [
        v2Row(),
        boundaryRow({ boundary_date: "2026-07-24" }, "user-2"),
      ];

      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(result.snapshotRebuildBoundary).toBeNull();
    });

    it("a malformed stored payload names no boundary and leaves the curve alone", async () => {
      state.portfolios = [P1151_PORTFOLIO];
      state.apiKeys = [identifiedKey()];
      state.allocatorEquityDerived = [v2Row(), boundaryRow({ boundary_date: "2026-02-30" })];
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(result.snapshotRebuildBoundary).toBeNull();
      expect(result.equityHistoryState).toBe("ready");
      expect(result.equityDailyReturns).toHaveLength(3);
      warnSpy.mockRestore();
    });
  });
});

describe("115.1 equity display-repoint", () => {
  beforeEach(resetState);
  // Guard against the CI Node-gap leaked-stub class (reference_ci_node22_vs_local_node25):
  // this block stubs no globals, but keep the discipline so a future addition can't leak.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Review round 1 (SFH-04): D-02 makes `equityDailyPoints` [] for EVERY input,
  // so asserting on it alone can no longer fail. The content these cases exist
  // for (direct mapping, never NaN, malformed and empty curves are not a
  // display series) is decided by `extractTrustworthyDerivedSeries`. A pre-v2
  // row is null. The snapshot adapter's own content is pinned in
  // allocation-helpers.equity-adapter.test.ts; plan 11 no longer renders it.
  async function candidateDerivedSeries() {
    const { extractTrustworthyDerivedSeries } = await import("./queries");
    return extractTrustworthyDerivedSeries(
      state.allocatorEquityDerived[0]?.payload ?? null,
    );
  }

  it("SAFETY (never redden): no derived row → equityDailyPoints is [], the source stamps 'legacy' and snapshotCount is null", async () => {
    // No allocator_equity_derived row seeded: the book is rebuilding
    // (awaiting_derivation). Phase 176 (D-02): there is no legacy render to fall
    // back to, so nothing is drawn, no source is claimed and no warm-up count is
    // invented.
    state.portfolios = [P1151_PORTFOLIO];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.equityDailyPoints).toEqual([]);
    // Neuter gap: the no-row case must stamp the source 'legacy' (only the
    // derived/untrusted pins asserted the source before): a producer that
    // defaulted to 'derived' on an absent row would mislabel the history.
    expect(
      (result as unknown as { equityCurveSource?: string }).equityCurveSource,
    ).toBe("legacy");
    expect(result.snapshotCount).toBeNull();
  });

  it("RED (plan 05): a trustworthy derived row repoints equityDailyPoints onto the curve (NO forward-fill adapter) and marks the source 'derived'", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.allocatorEquityDerived = [derivedRow(true)];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // Fails now (no read, no field): the provenance indicator is missing.
    expect(
      (result as unknown as { equityCurveSource?: string }).equityCurveSource,
    ).toBe("derived");
    // Phase 167.1.2 / D-02: the producer withholds the display series ([] for
    // every allocator). What it WOULD show is pinned directly on the extractor
    // it calls (review round 1 SFH-04), so this case can still fail on a
    // regression in the trust gate while the curve is hidden.
    // Plan 11: this fixture is pre-v2 (no version, no returns), so it is not
    // the display series. A v2 row is pinned below.
    expect(await candidateDerivedSeries()).toBeNull();
    expect(result.equityDailyPoints).toEqual([]);
  });

  it("RED (plan 05): an untrustworthy derived row falls back to the legacy render and marks the source 'legacy'", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.allocatorEquityDerived = [derivedRow(false)];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // Fails now: the provenance indicator is missing.
    expect(
      (result as unknown as { equityCurveSource?: string }).equityCurveSource,
    ).toBe("legacy");
    // Phase 167.1.2 / D-02: the producer withholds the display series ([] for
    // every allocator). What it WOULD show is pinned directly on the extractor
    // it calls (review round 1 SFH-04), so this case can still fail on a
    // regression in the trust gate while the curve is hidden.
    expect(await candidateDerivedSeries()).toBeNull();
    expect(result.equityDailyPoints).toEqual([]);
  });

  it("MALFORMED (T-115.1-18): is_trustworthy=true but curve is NOT an array → legacy fallback (no crash)", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    // Corrupt worker-written JSONB: trustworthy flag set, but `curve` is a
    // string. A shape-blind consumer would throw on `.map`; the shape-validate
    // gate must degrade to legacy instead.
    state.allocatorEquityDerived = [
      {
        allocator_id: "user-1",
        kind: "equity_curve",
        payload: {
          curve: "not-an-array",
          is_trustworthy: true,
        } as unknown as Record<string, unknown>,
      },
    ];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(
      (result as unknown as { equityCurveSource?: string }).equityCurveSource,
    ).toBe("legacy");
    // Phase 167.1.2 / D-02: the producer withholds the display series ([] for
    // every allocator). What it WOULD show is pinned directly on the extractor
    // it calls (review round 1 SFH-04), so this case can still fail on a
    // regression in the trust gate while the curve is hidden.
    expect(await candidateDerivedSeries()).toBeNull();
    expect(result.equityDailyPoints).toEqual([]);
  });

  it("MALFORMED (T-115.1-18): is_trustworthy=true but a curve point has non-finite equity_usd → legacy fallback (never NaN)", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    // A single NaN equity_usd must poison the whole derived curve to legacy —
    // rendering a NaN coordinate to the chart is the exact failure the shape
    // gate exists to prevent.
    state.allocatorEquityDerived = [
      {
        allocator_id: "user-1",
        kind: "equity_curve",
        payload: {
          curve: [
            { date: "2026-03-10", equity_usd: 100_500.5 },
            { date: "2026-03-11", equity_usd: Number.NaN },
          ],
          is_trustworthy: true,
        } as unknown as Record<string, unknown>,
      },
    ];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(
      (result as unknown as { equityCurveSource?: string }).equityCurveSource,
    ).toBe("legacy");
    // Phase 167.1.2 / D-02: the producer withholds the display series ([] for
    // every allocator). What it WOULD show is pinned directly on the extractor
    // it calls (review round 1 SFH-04), so this case can still fail on a
    // regression in the trust gate while the curve is hidden.
    expect(await candidateDerivedSeries()).toBeNull();
    expect(result.equityDailyPoints).toEqual([]);
  });

  it("B2 (empty curve): is_trustworthy=true but curve is [] → legacy fallback (never a blank chart labeled 'derived')", async () => {
    // A zero-anchored-keys allocator (every prod allocator today) composes
    // { curve: [], is_trustworthy: true, degrade_reasons: ['no_anchored_keys'] }
    // — the honest-empty tokens are BENIGN in the frozen core. An extractor that
    // returned [] here would stamp equityCurveSource='derived' and BLANK the chart
    // while suppressing the legacy render (which has real data). The last-line
    // defense: an empty points array degrades to null → legacy.
    state.portfolios = [P1151_PORTFOLIO];
    state.allocatorEquityDerived = [
      {
        allocator_id: "user-1",
        kind: "equity_curve",
        payload: {
          curve: [],
          flags: [],
          degrade_reasons: ["no_anchored_keys"],
          is_trustworthy: true,
          scalars: { mwr: null, dietz: null, computable: false },
        } as Record<string, unknown>,
      },
    ];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(
      (result as unknown as { equityCurveSource?: string }).equityCurveSource,
    ).toBe("legacy");
    // Phase 167.1.2 / D-02: the producer withholds the display series ([] for
    // every allocator). What it WOULD show is pinned directly on the extractor
    // it calls (review round 1 SFH-04), so this case can still fail on a
    // regression in the trust gate while the curve is hidden.
    expect(await candidateDerivedSeries()).toBeNull();
    expect(result.equityDailyPoints).toEqual([]);
  });

  it("MALFORMED (T-115.1-18): is_trustworthy present-but-non-boolean → legacy fallback", async () => {
    // The trust gate is a strict `=== true`, so a truthy-but-non-boolean flag
    // (e.g. the string "true" from a drifted writer) must NOT be honored.
    state.portfolios = [P1151_PORTFOLIO];
    state.allocatorEquityDerived = [
      {
        allocator_id: "user-1",
        kind: "equity_curve",
        payload: {
          curve: P1151_DERIVED_CURVE,
          is_trustworthy: "true",
        } as unknown as Record<string, unknown>,
      },
    ];

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(
      (result as unknown as { equityCurveSource?: string }).equityCurveSource,
    ).toBe("legacy");
    // Phase 167.1.2 / D-02: the producer withholds the display series ([] for
    // every allocator). What it WOULD show is pinned directly on the extractor
    // it calls (review round 1 SFH-04), so this case can still fail on a
    // regression in the trust gate while the curve is hidden.
    expect(await candidateDerivedSeries()).toBeNull();
    expect(result.equityDailyPoints).toEqual([]);
  });

  it("MALFORMED (T-115.1-18 / T-167.1.2-21): a bad curve or returns point is not a series", async () => {
    // Each payload is otherwise a valid version-2 series, so deleting the
    // shape check for the broken field would return a series and this fails.
    // Moved from extractTrustworthyDerivedCurve (plan 11).
    const { extractTrustworthyDerivedSeries } = await import("./queries");
    const base = {
      version: 2,
      is_trustworthy: true,
      returns: [{ date: "2026-03-11", r: 0.01 }],
    };
    expect(
      extractTrustworthyDerivedSeries({
        ...base,
        curve: [{ equity_usd: 100 }],
      }),
    ).toBeNull();
    expect(
      extractTrustworthyDerivedSeries({
        ...base,
        curve: [{ date: "2026-03-10" }],
      }),
    ).toBeNull();
    expect(
      extractTrustworthyDerivedSeries({
        ...base,
        curve: [42],
      }),
    ).toBeNull();
    expect(
      extractTrustworthyDerivedSeries({
        ...base,
        curve: [{ date: "", equity_usd: 100 }],
      }),
    ).toBeNull();
    expect(
      extractTrustworthyDerivedSeries({
        ...base,
        curve: [{ date: "not-a-date", equity_usd: 100 }],
      }),
    ).toBeNull();
    expect(
      extractTrustworthyDerivedSeries({
        ...base,
        curve: [{ date: "2026/03/10", equity_usd: 100 }],
      }),
    ).toBeNull();
    // Returns shape: non-finite, reordered, empty, and a non-numeric version.
    const curve = [
      { date: "2026-03-10", equity_usd: 100 },
      { date: "2026-03-11", equity_usd: 101 },
    ];
    expect(
      extractTrustworthyDerivedSeries({
        ...base,
        curve,
        returns: [{ date: "2026-03-11", r: Number.NaN }],
      }),
    ).toBeNull();
    expect(
      extractTrustworthyDerivedSeries({
        ...base,
        curve,
        returns: [
          { date: "2026-03-12", r: 0.01 },
          { date: "2026-03-11", r: 0.02 },
        ],
      }),
    ).toBeNull();
    expect(
      extractTrustworthyDerivedSeries({ ...base, curve, returns: [] }),
    ).toBeNull();
    expect(
      extractTrustworthyDerivedSeries({ ...base, version: "2", curve }),
    ).toBeNull();
    // A well-formed version-2 series still passes, curve mapped directly.
    expect(
      extractTrustworthyDerivedSeries({
        ...base,
        curve: [{ date: "2026-03-10", equity_usd: 100 }],
      }),
    ).toEqual({
      curve: [{ date: "2026-03-10", value: 100 }],
      returns: [{ date: "2026-03-11", value: 0.01 }],
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 151 / 151-02 Task 2 (AUM-04) — the SPLIT book-entry gate, as the
// founder rule of 2026-10-31 (D-01, Phase 176, Phase 181 absorbed) now reads it
// ---------------------------------------------------------------------------
/**
 * The rule under test (D-01): `allocatorEligibleApiKeyIds` is EVERY key the
 * canonical `isPerKeyDailiesEligibleKey` predicate admits. A key a strategy
 * uses, by `strategies.api_key_id` or by `strategy_keys`, also counts in its
 * owner's allocator book. This is what the derive already composes
 * (`eligible_key_predicate` selects keys with no strategy-link exclusion), so
 * the TS reader agrees with the curve instead of telling an owner who runs
 * strategies that they have no book. Phase 151 AUM-04 (founder census
 * 2026-08-05) subtracted the linked keys; that rule is superseded.
 *
 * The SPLIT itself stays: `perKeyDailiesGateSatisfied` still has five
 * consumers, and the one that matters here selects `liveBaselineMetrics`:
 * relaxing it in place would present a 2-of-8-key blend as "your live book" on
 * the Overview KPI strip — the exact honesty regression Phase 63 ENGINE-04
 * hardened against. So the fixtures below assert BOTH halves in the SAME
 * fixture: book gate true, old gate false, baseline still the honest
 * emptyDefault where no key carries a series.
 */
const AUM04_STRATEGIES = [
  // Every row carries `api_key_id: null` ON PURPOSE. The six strategy-linked
  // keys are reachable ONLY through `strategy_keys`, so the link-independence
  // arms below can only pass if no link read decides book membership.
  { id: "mt5-a", user_id: "user-1", api_key_id: null, status: "private" },
  { id: "mt5-b", user_id: "user-1", api_key_id: null, status: "published" },
  { id: "mt5-c", user_id: "user-1", api_key_id: null, status: "draft" },
  { id: "alpha", user_id: "user-1", api_key_id: null, status: "private" },
];

const AUM04_LINKS = [
  { owner_id: "user-1", strategy_id: "mt5-a", api_key_id: "k-mt5-1" },
  { owner_id: "user-1", strategy_id: "mt5-b", api_key_id: "k-mt5-2" },
  { owner_id: "user-1", strategy_id: "mt5-c", api_key_id: "k-mt5-3" },
  { owner_id: "user-1", strategy_id: "alpha", api_key_id: "k-deribit-1" },
  { owner_id: "user-1", strategy_id: "alpha", api_key_id: "k-deribit-2" },
  { owner_id: "user-1", strategy_id: "alpha", api_key_id: "k-deribit-3" },
];

function aum04Key(id: string, exchange: string) {
  return {
    id,
    user_id: "user-1",
    exchange,
    label: `Key ${id}`,
    is_active: true,
    sync_status: "synced",
    last_sync_at: "2026-05-08T00:00:00Z",
    account_balance_usdt: 10_000,
    created_at: "2026-01-01T00:00:00Z",
    disconnected_at: null,
  };
}

/**
 * The founder's PROD census key order, deliberately INTERLEAVED (unlinked key,
 * linked keys, unlinked key, linked keys) so a regression that returns a prefix
 * slice, or re-subtracts the linked keys, cannot pass.
 */
const AUM04_KEYS = [
  aum04Key("k-bybit", "bybit"),
  aum04Key("k-deribit-1", "deribit"),
  aum04Key("k-deribit-2", "deribit"),
  aum04Key("k-deribit-3", "deribit"),
  aum04Key("k-okx", "okx"),
  aum04Key("k-mt5-1", "mt5"),
  aum04Key("k-mt5-2", "mt5"),
  aum04Key("k-mt5-3", "mt5"),
];

/** D-01: the allocator book is every eligible key, in the census order. */
const AUM04_KEY_IDS = AUM04_KEYS.map((k) => k.id);

const AUM04_DATES = Array.from(
  { length: 12 },
  (_, i) => `2026-05-${String(i + 1).padStart(2, "0")}`,
);

function seedSeriesFor(apiKeyIds: string[]) {
  state.csvDailyReturns = apiKeyIds.flatMap((api_key_id) =>
    AUM04_DATES.map((date, i) => ({
      api_key_id,
      allocator_id: "user-1",
      date,
      daily_return: i % 2 === 0 ? 0.01 : -0.005,
    })),
  );
}

describe("getMyAllocationDashboard — every eligible key, linked or not, is in the owner's allocator book (D-01, founder 2026-10-31; was Phase 151 AUM-04)", () => {
  beforeEach(resetState);

  it("founder census END-TO-END: the 6 strategy-linked keys stay in the allocator book → book gate TRUE while the old all-or-nothing gate stays FALSE", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = AUM04_KEYS;
    state.strategies = AUM04_STRATEGIES;
    state.strategyKeys = AUM04_LINKS;
    // Only the allocator's own two keys have a per-key series.
    seedSeriesFor(["k-bybit", "k-okx"]);

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // All 8 keys are eligible for the per-key basis, and only 2 carry a
    // series, so the old all-or-nothing gate is false.
    expect(result.eligibleApiKeyIds).toHaveLength(8);
    expect(result.perKeyDailiesGateSatisfied).toBe(false);

    // D-01: the book is all 8 eligible keys, the six that a strategy links
    // through `strategy_keys` included. The two with a series contribute.
    expect(result.allocatorEligibleApiKeyIds).toEqual(AUM04_KEY_IDS);
    expect(result.allocatorEligibleApiKeyIds).toEqual(result.eligibleApiKeyIds);
    expect(result.contributingApiKeyIds).toEqual(["k-bybit", "k-okx"]);
    expect(result.bookEntryGateSatisfied).toBe(true);
  });

  it("partial allocator book: 8 eligible keys, 1 with a series → gate TRUE with exactly 1 contributing key", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = AUM04_KEYS;
    state.strategies = AUM04_STRATEGIES;
    state.strategyKeys = AUM04_LINKS;
    seedSeriesFor(["k-bybit"]);

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // The "{N} of {M}" copy downstream reads these two arrays; M is every
    // eligible key, linked or not (D-01).
    expect(result.allocatorEligibleApiKeyIds).toEqual(AUM04_KEY_IDS);
    expect(result.contributingApiKeyIds).toEqual(["k-bybit"]);
    expect(result.bookEntryGateSatisfied).toBe(true);
  });

  it("a strategy-linked key that carries the only series opens the book gate (D-01: linked is not manager-side)", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = AUM04_KEYS;
    state.strategies = AUM04_STRATEGIES;
    state.strategyKeys = AUM04_LINKS;
    // k-deribit-1 is reachable only through `strategy_keys`. Under the retired
    // AUM-04 exclusion its series could not open the gate.
    seedSeriesFor(["k-deribit-1"]);

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.allocatorEligibleApiKeyIds).toEqual(AUM04_KEY_IDS);
    expect(result.contributingApiKeyIds).toEqual(["k-deribit-1"]);
    expect(result.bookEntryGateSatisfied).toBe(true);
  });

  it("no contributing keys: eligible keys exist but none has a series → gate FALSE", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = AUM04_KEYS;
    state.strategies = AUM04_STRATEGIES;
    state.strategyKeys = AUM04_LINKS;
    // No series at all: the gate closes on the absence of a series, never on a
    // link.
    seedSeriesFor([]);

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.allocatorEligibleApiKeyIds).toEqual(AUM04_KEY_IDS);
    expect(result.contributingApiKeyIds).toEqual([]);
    expect(result.bookEntryGateSatisfied).toBe(false);
  });

  it("T-176-09: a link never widens the book — a linked key the owner has disconnected, and a linked key id outside the owner's key set, are not in it", async () => {
    // The set is `eligibleKeyIds`, derived from the owner's own key read. A
    // `strategy_keys` row naming a key outside it adds nothing, and a key the
    // eligibility predicate rejects stays out even when a strategy links it.
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [
      aum04Key("k-live", "bybit"),
      { ...aum04Key("k-gone", "okx"), disconnected_at: "2026-05-01T00:00:00Z" },
    ];
    state.strategies = [
      { id: "s-gone", user_id: "user-1", api_key_id: "k-gone", status: "private" },
      { id: "s-foreign", user_id: "user-1", api_key_id: null, status: "private" },
    ];
    state.strategyKeys = [
      { owner_id: "user-1", strategy_id: "s-foreign", api_key_id: "k-foreign" },
    ];
    seedSeriesFor(["k-live", "k-gone", "k-foreign"]);

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.eligibleApiKeyIds).toEqual(["k-live"]);
    expect(result.allocatorEligibleApiKeyIds).toEqual(["k-live"]);
    expect(result.contributingApiKeyIds).toEqual(["k-live"]);
  });

  it("!portfolio branch: a fresh allocator gets [] / [] / false — never undefined", async () => {
    // A field emitted on only ONE return branch is `undefined` here, and every
    // downstream `?? []` / `?? false` fallback would silently mask it.
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.portfolio).toBeNull();
    expect(result).toHaveProperty("allocatorEligibleApiKeyIds");
    expect(result).toHaveProperty("contributingApiKeyIds");
    expect(result).toHaveProperty("bookEntryGateSatisfied");
    expect(result.allocatorEligibleApiKeyIds).toEqual([]);
    expect(result.contributingApiKeyIds).toEqual([]);
    expect(result.bookEntryGateSatisfied).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // ONE BOOK, ONE ANSWER — the baseline rides the SPLIT gate and the CONTRIBUTING
  // key set (151 review finding [6]).
  //
  // This replaces an earlier "consumer freeze" pin, and the reason it was wrong
  // is worth keeping: that test asserted the baseline stayed frozen on the OLD
  // all-or-nothing gate ON PURPOSE, as evidence that Phase 151 had disturbed
  // nothing. The freeze WAS the defect. It left the partial-book allocator
  // admitted to book mode by `bookEntryGateSatisfied` while `liveBaselineMetrics`
  // — selected by the untouched `perKeyDailiesGateSatisfied` — stayed the
  // all-null emptyDefault. Every `pushDelta` returned early, the "vs your live
  // book" strip was permanently empty and the KpiStrip live column was
  // em-dashes, while `ScenarioComparePanel` on the SAME SCREEN built a real
  // live-book column from `contributingApiKeyIds` and showed numbers. Two
  // surfaces, one screen, contradicting each other about whether the
  // allocator's live book exists. A pin whose subject is "we changed nothing"
  // cannot see that; these two arms pin the contract instead.
  //
  // The fixture gives THREE eligible keys a series — two unlinked and one a
  // strategy links — with three DIFFERENT return patterns, and gives all three
  // holdings. It also carries a FOURTH key with a stale series and a holding: a
  // key the owner disconnected, which keeps its rows for audit continuity but
  // is not eligible. That is what makes the negative below discriminating: a
  // baseline built from the raw per-key map would fold the stale key's series
  // into "your live book", and with identical patterns it would have been
  // indistinguishable. (Before D-01 the odd one out was the linked key; a
  // linked key is now part of the book, so the stale key plays that part.)
  // ---------------------------------------------------------------------------

  /** A key the owner disconnected: ineligible, yet its rows persist. */
  const AUM04_GONE_KEY = {
    ...aum04Key("k-gone", "okx"),
    disconnected_at: "2026-05-10T00:00:00Z",
  };

  /** Distinct per-key patterns, so the contributing blend and the raw-map
   *  blend cannot coincide by construction. */
  function seedDistinctSeries(patterns: Record<string, number[]>) {
    state.csvDailyReturns = Object.entries(patterns).flatMap(
      ([api_key_id, values]) =>
        AUM04_DATES.map((date, i) => ({
          api_key_id,
          allocator_id: "user-1",
          date,
          daily_return: values[i % values.length],
        })),
    );
  }

  function aum04Holding(apiKeyId: string, symbol: string, valueUsd: number) {
    return {
      allocator_id: "user-1",
      symbol,
      quantity: 1,
      mark_price: valueUsd,
      value_usd: valueUsd,
      venue: "bybit",
      holding_type: "spot" as const,
      updated_at: "2026-05-12T04:00:00+00:00",
      asof: AUM04_DATES[AUM04_DATES.length - 1],
      api_key_id: apiKeyId,
    };
  }

  /** The founder's shape: k-bybit, k-okx and the strategy-linked k-mt5-1 all
   *  contribute (D-01); the disconnected k-gone has a series and holdings but is
   *  NOT the book. */
  function seedSplitGateFixture() {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [...AUM04_KEYS, AUM04_GONE_KEY];
    state.strategies = AUM04_STRATEGIES;
    state.strategyKeys = AUM04_LINKS;
    state.allocatorHoldings = [
      aum04Holding("k-bybit", "BTC", 50_000),
      aum04Holding("k-okx", "ETH", 30_000),
      aum04Holding("k-mt5-1", "SOL", 25_000),
      aum04Holding("k-gone", "DOGE", 20_000),
    ];
    seedDistinctSeries({
      "k-bybit": [0.012, -0.004, 0.009, -0.002, 0.014, -0.006],
      "k-okx": [-0.003, 0.011, -0.007, 0.016, -0.001, 0.008],
      "k-mt5-1": [0.021, -0.013, 0.017, -0.009, 0.024, -0.011],
      // Deliberately the ODD one out — a disconnected key whose stale series
      // would visibly distort "your live book" if it were ever folded in.
      "k-gone": [-0.05, 0.06, -0.045, 0.055, -0.04, 0.065],
    });
  }

  it("AUM-04 [6]: with the book-entry gate TRUE, liveBaselineMetrics is a REAL curve built from contributingApiKeyIds — the same key set the compare panel's live-book column uses", async () => {
    seedSplitGateFixture();

    const {
      getMyAllocationDashboard,
      emptyLiveBaselineMetrics,
      liveBaselineMetricsFromPerKeyDailies,
    } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // (1) Pre-condition: this is the fixture where the two gates DISAGREE —
    // exactly the partial-book population the split exists to admit. The
    // strategy-linked k-mt5-1 is part of the book (D-01), so it contributes.
    expect(result.bookEntryGateSatisfied).toBe(true);
    expect(result.perKeyDailiesGateSatisfied).toBe(false);
    expect(result.contributingApiKeyIds).toEqual(["k-bybit", "k-okx", "k-mt5-1"]);
    expect(result.eligibleApiKeyIds).toHaveLength(8);

    // (2) THE AGREEMENT, asserted against the payload's OWN contributing set
    // rather than a hard-coded key list: `ScenarioComparePanel` builds its
    // live-book column with `buildLiveBookDraft(bookEntryGateSatisfied,
    // contributingApiKeyIds)`, so deriving the expected baseline from those same
    // two payload fields is what pins the two surfaces to ONE book. Re-point the
    // production ternary at any other key set and this goes RED without needing
    // to know which set it was re-pointed to.
    const contributing = new Set(result.contributingApiKeyIds);
    const expected = liveBaselineMetricsFromPerKeyDailies(
      // Review round 2 F1 — the HOLDINGS are narrowed to the same set as the
      // returns. Passing the full `holdingsSummary` here (as this expectation
      // did pre-fix) is what let the production object carry an 3-key `aum` +
      // dollar drawdown beside a 2-key `sharpe` / `ytdTwr` / `equity`.
      result.holdingsSummary.filter((h) => contributing.has(h.api_key_id)),
      Object.fromEntries(
        Object.entries(result.perKeyReturnsByApiKeyId).filter(([id]) =>
          contributing.has(id),
        ),
      ),
    );
    expect(result.liveBaselineMetrics).toEqual(expected);

    // (3) It is a REAL curve — the defect was an all-null column beside a
    // populated one, so "not null" is the user-visible half of the claim.
    expect(result.liveBaselineMetrics.sharpe).not.toBeNull();
    expect(result.liveBaselineMetrics.ytdTwr).not.toBeNull();
    expect(result.liveBaselineMetrics.equity.length).toBeGreaterThan(0);
    expect(result.liveBaselineMetrics).not.toEqual(
      emptyLiveBaselineMetrics(result.holdingsSummary),
    );

    // (4) DISCRIMINATING NEGATIVE: it is NOT the blend over the raw per-key map.
    // The payload map carries the disconnected k-gone's stale series, which is
    // not in `contributingApiKeyIds`. Without this arm, (2) would still pass on
    // a baseline that quietly re-admitted a key the owner disconnected.
    expect(result.perKeyReturnsByApiKeyId).toHaveProperty("k-gone");
    expect(result.contributingApiKeyIds).not.toContain("k-gone");
    const rawMap = liveBaselineMetricsFromPerKeyDailies(
      result.holdingsSummary,
      result.perKeyReturnsByApiKeyId,
    );
    expect(rawMap.sharpe).not.toBeNull(); // non-vacuity: a real rival curve
    expect(result.liveBaselineMetrics.sharpe).not.toBe(rawMap.sharpe);
    expect(result.liveBaselineMetrics.equity).not.toEqual(rawMap.equity);

    // (5) Review round 2 F1 — one object, one key set. Hand-computed from the
    // fixture's own holdings, NOT re-derived from the helper: the contributing
    // keys are k-bybit ($50,000), k-okx ($30,000) and the strategy-linked
    // k-mt5-1 ($25,000), so the baseline's AUM is 105,000. The disconnected
    // k-gone's $20,000 is custody's business — `holdingsSummary` still reports
    // it — but it is not part of the book whose Sharpe this object states.
    expect(result.liveBaselineMetrics.aum).toBe(105_000);
    // Non-vacuity + the discriminating negative in one line: the custody total
    // is a genuinely different number, so this cannot pass under both bases.
    expect(
      result.holdingsSummary.reduce((s, h) => s + h.value_usd, 0),
    ).toBe(125_000);
    expect(result.liveBaselineMetrics.aum).not.toBe(125_000);
  });

  it("AUM-04 [6] (the unchanged half): with the book-entry gate FALSE, liveBaselineMetrics is STILL the honest emptyDefault", async () => {
    // This half of the contract is untouched by the fix and still worth pinning:
    // a null curve is the HONEST answer only when there is no book to describe.
    // Here every eligible key carries no series at all — the only series
    // belongs to a disconnected key, which must not open the gate — so there is
    // nothing to blend and the KpiStrip's em-dashes are the truth.
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [...AUM04_KEYS, AUM04_GONE_KEY];
    state.strategies = AUM04_STRATEGIES;
    state.strategyKeys = AUM04_LINKS;
    state.allocatorHoldings = [
      aum04Holding("k-bybit", "BTC", 50_000),
      aum04Holding("k-mt5-1", "SOL", 25_000),
    ];
    seedDistinctSeries({
      "k-gone": [-0.05, 0.06, -0.045, 0.055, -0.04, 0.065],
    });

    const { getMyAllocationDashboard, emptyLiveBaselineMetrics } = await import(
      "./queries"
    );
    const result = await getMyAllocationDashboard("user-1");

    // Pre-condition: the gate really is closed, and NOT because there are no
    // allocator keys — there are eight; they simply carry nothing to model.
    expect(result.allocatorEligibleApiKeyIds).toEqual(AUM04_KEY_IDS);
    expect(result.contributingApiKeyIds).toEqual([]);
    expect(result.bookEntryGateSatisfied).toBe(false);

    expect(result.liveBaselineMetrics).toEqual(
      emptyLiveBaselineMetrics(result.holdingsSummary),
    );
    // AUM survives (custody still answered), every derived metric is null.
    expect(result.liveBaselineMetrics.aum).toBe(75_000);
    expect(result.liveBaselineMetrics.sharpe).toBeNull();
    expect(result.liveBaselineMetrics.ytdTwr).toBeNull();
    expect(result.liveBaselineMetrics.equity).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 151 test-analyzer gap 2 — THE DEGRADATION PATH, as D-01 leaves it.
  //
  // Both link reads stay NON-FATAL (never assertOk'd): a transient failure must
  // not blank a working dashboard, and `strategy_keys` can be absent from the
  // PostgREST schema cache on a pre-migration environment. They no longer feed
  // book membership: `allocatorEligibleApiKeyIds` is `eligibleKeyIds` whether
  // the reads succeed or fail, so a read failure cannot change what a saved
  // scenario's persisted membership (`memberKeyIdsForSave =
  // contributingApiKeyIds`) claims to model. What the reads still feed is the
  // reconstruct note, which names nothing when the link source is unreadable.
  // These pins keep the failure visible and non-fatal: a future refactor that
  // added an `assertOk` (blanking the dashboard) or dropped the capture (making
  // the fault invisible) goes red here.
  // -------------------------------------------------------------------------
  it("degradation (strategy_keys read errors): the dashboard still returns, book membership is unchanged, and the fault is reported to Sentry", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = AUM04_KEYS;
    state.strategies = AUM04_STRATEGIES;
    state.strategyKeys = AUM04_LINKS;
    seedSeriesFor(["k-bybit", "k-okx", "k-mt5-1", "k-deribit-1"]);
    // The link table is unreadable.
    state.tableErrors["strategy_keys"] = {
      message: "PGRST002 schema cache lookup failed (test)",
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentry = await import("./sentry-capture");
    const captureSpy = vi
      .spyOn(sentry, "captureToSentry")
      .mockImplementation(async () => {});

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // (a) NEVER blank the dashboard — the read is not a gate. If someone adds
    // an assertOk here, this rejects instead of resolving.
    expect(result).toHaveProperty("bookEntryGateSatisfied");
    expect(result.eligibleApiKeyIds).toHaveLength(8);

    // (b) Membership does not depend on the link reads: the failing run holds
    // the same book as the healthy run (the control below pins the healthy
    // one). Pinning the exact set, in census order, is what stops a refactor
    // from making the book depend on a read again.
    expect(result.allocatorEligibleApiKeyIds).toEqual(AUM04_KEY_IDS);
    expect(result.contributingApiKeyIds).toEqual([
      "k-bybit",
      "k-deribit-1",
      "k-okx",
      "k-mt5-1",
    ]);
    expect(result.bookEntryGateSatisfied).toBe(true);

    // (c) The fault stays OBSERVABLE — the breadcrumb is the only signal that
    // this book projection is degraded rather than correct.
    expect(captureSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tags: expect.objectContaining({
          reason: "role_discriminator_read_failed",
        }),
      }),
    );
    // The log names what the reads still feed, not a book-gate degradation the
    // reads no longer cause.
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "strategy-link read failed (the reconstruct note names nothing)",
      ),
      expect.anything(),
    );
    expect(errSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("book gate degrades"),
      expect.anything(),
    );

    captureSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("degradation (own-`strategies` read errors): the SAME non-fatal + reported posture on the other read", async () => {
    // The two reads are OR'd into one error signal, so the sibling arm needs its
    // own pin — dropping either read's error from `phase151LinkReadError` would
    // otherwise stay green.
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = AUM04_KEYS;
    state.strategies = AUM04_STRATEGIES;
    state.strategyKeys = AUM04_LINKS;
    seedSeriesFor(["k-bybit", "k-okx"]);
    state.tableErrors["strategies"] = { message: "connection reset (test)" };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentry = await import("./sentry-capture");
    const captureSpy = vi
      .spyOn(sentry, "captureToSentry")
      .mockImplementation(async () => {});

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result).toHaveProperty("bookEntryGateSatisfied");
    expect(result.allocatorEligibleApiKeyIds).toEqual(AUM04_KEY_IDS);
    expect(captureSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tags: expect.objectContaining({
          reason: "role_discriminator_read_failed",
        }),
      }),
    );
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "strategy-link read failed (the reconstruct note names nothing)",
      ),
      expect.anything(),
    );

    captureSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("control: with BOTH reads healthy, no degradation breadcrumb fires", async () => {
    // Non-vacuity for the two tests above — proves they observe the ERROR arm
    // and not a breadcrumb that fires on every call.
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = AUM04_KEYS;
    state.strategies = AUM04_STRATEGIES;
    state.strategyKeys = AUM04_LINKS;
    seedSeriesFor(["k-bybit", "k-okx"]);
    const sentry = await import("./sentry-capture");
    const captureSpy = vi
      .spyOn(sentry, "captureToSentry")
      .mockImplementation(async () => {});

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    // The healthy census: the same book as under a read failure (D-01).
    expect(result.allocatorEligibleApiKeyIds).toEqual(AUM04_KEY_IDS);
    expect(
      captureSpy.mock.calls.some(
        ([, opts]) =>
          (opts as { tags?: Record<string, unknown> } | undefined)?.tags
            ?.reason === "role_discriminator_read_failed",
      ),
    ).toBe(false);

    captureSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Phase 151 review [4] / I5, re-stated by D-01 — THE CAPITAL MARK DOES NOT DECIDE
// BOOK MEMBERSHIP
// ---------------------------------------------------------------------------
/**
 * History: Phase 151 AUM-04 subtracted every strategy-linked key from the
 * allocator's book, and review [4] exempted `own_capital` strategies so an
 * allocator who declared their money their own was not locked out of it.
 * The founder rule of 2026-10-31 (D-01) removes the subtraction altogether:
 * every eligible key is in its owner's allocator book, so the mark no longer
 * decides anything here. The exemption's tests are re-stated as the rule that
 * replaced it. The mark still means what Phase 150 says it means elsewhere.
 *
 * The four keys below cover both link forms (direct `strategies.api_key_id` and
 * composite `strategy_keys`) and all three states of the mark: `own_capital`,
 * `team_review` and `null` (never asked). Each must be in the book, and a
 * garbled value off the untyped `text` column must change nothing.
 */
const OWN_CAPITAL_KEYS = [
  // Interleaved so a regression returning a prefix slice cannot pass.
  aum04Key("k-team", "bybit"),
  aum04Key("k-own-direct", "bybit"),
  aum04Key("k-unmarked", "okx"),
  aum04Key("k-own-composite", "deribit"),
];

const OWN_CAPITAL_STRATEGIES = [
  // EXEMPT — and via BOTH link forms, because the filter drops the whole row
  // and therefore has to defend the direct `strategies.api_key_id` link and the
  // composite `strategy_keys` link alike.
  {
    id: "own-direct",
    user_id: "user-1",
    api_key_id: "k-own-direct",
    status: "private",
    capital_ownership: "own_capital",
  },
  {
    id: "own-composite",
    user_id: "user-1",
    api_key_id: null,
    status: "private",
    capital_ownership: "own_capital",
  },
  // CONTROL 1 — an affirmative team mark stays manager-side.
  {
    id: "team",
    user_id: "user-1",
    api_key_id: "k-team",
    status: "private",
    capital_ownership: "team_review",
  },
  // CONTROL 2 — never asked. Silence is not "my own capital".
  {
    id: "unmarked",
    user_id: "user-1",
    api_key_id: "k-unmarked",
    status: "private",
    capital_ownership: null,
  },
];

const OWN_CAPITAL_LINKS = [
  { owner_id: "user-1", strategy_id: "own-composite", api_key_id: "k-own-composite" },
];

describe("getMyAllocationDashboard — the owner's allocator book holds every eligible key whatever its capital mark (D-01)", () => {
  beforeEach(resetState);

  function seedOwnCapitalCensus() {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = OWN_CAPITAL_KEYS;
    state.strategies = OWN_CAPITAL_STRATEGIES;
    state.strategyKeys = OWN_CAPITAL_LINKS;
  }

  const OWN_CAPITAL_KEY_IDS = OWN_CAPITAL_KEYS.map((k) => k.id);

  it("own_capital (direct link and strategy_keys), team_review and unmarked strategies all leave their key in the book, in key order", async () => {
    seedOwnCapitalCensus();
    seedSeriesFor(["k-own-direct", "k-own-composite", "k-team", "k-unmarked"]);

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.eligibleApiKeyIds).toHaveLength(4);
    // Interleaved fixture order is the order of the book: a re-introduced
    // subtraction, or a prefix slice, cannot pass.
    expect(result.allocatorEligibleApiKeyIds).toEqual(OWN_CAPITAL_KEY_IDS);
    // Each seeded key really does carry a series, so the membership above is
    // the rule's doing and not a missing-series artefact.
    expect(result.contributingApiKeyIds).toEqual(OWN_CAPITAL_KEY_IDS);
    expect(result.bookEntryGateSatisfied).toBe(true);
  });

  it.each([
    ["k-own-direct", "own_capital"],
    ["k-own-composite", "own_capital"],
    ["k-team", "team_review"],
    ["k-unmarked", "unmarked (null)"],
  ])(
    "the LOCKOUT: %s (%s) as the allocator's ONLY series-carrying key still opens the book gate",
    async (keyId) => {
      // The founder-facing failure in full. A subtraction of the sole
      // series-carrying key empties `contributingApiKeyIds`, closes the gate,
      // and the composer tells an allocator with live capital that they have no
      // book. Under D-01 that cannot depend on the capital mark.
      seedOwnCapitalCensus();
      seedSeriesFor([keyId]);

      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(result.contributingApiKeyIds).toEqual([keyId]);
      expect(result.bookEntryGateSatisfied).toBe(true);
    },
  );

  it("a garbled mark off the untyped text column changes nothing: the book does not read the mark", async () => {
    // `capital_ownership` is `text` in Postgres. The book no longer reads it, so
    // a near-miss value neither evicts nor re-admits a key.
    seedOwnCapitalCensus();
    state.strategies = OWN_CAPITAL_STRATEGIES.map((s) =>
      s.id === "own-direct" ? { ...s, capital_ownership: "Own_Capital" } : s,
    );
    seedSeriesFor(["k-own-direct"]);

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.allocatorEligibleApiKeyIds).toEqual(OWN_CAPITAL_KEY_IDS);
    expect(result.bookEntryGateSatisfied).toBe(true);
  });
});

// Phase 167.1.2 SC-4 caller walk (read-only for `queries.ts`, which this plan
// does not edit): the SSR live-book blend feeds per-key equity as the weight.
// When every key's holdings are worth 0 the blend has no weight mass, and the
// engine now returns its honest empty shape. The helper's existing
// `liveCM.n === 0 || equity_curve.length === 0 → emptyDefault` guard must turn
// that into null KPIs and no curve, never a flat 1.0 wealth line at +0.00%.
describe("liveBaselineMetricsFromPerKeyDailies — [167.1.2 SC-4] zero weight mass", () => {
  it("every key's holdings worth 0 → null KPIs and an empty equity series (today: a flat line at +0.00%)", async () => {
    const { liveBaselineMetricsFromPerKeyDailies } = await import("./queries");
    const dates = Array.from(
      { length: 20 },
      (_, i) => `2026-05-${String(i + 1).padStart(2, "0")}`,
    );
    const holdings = [
      {
        api_key_id: "key-A",
        holding_type: "spot",
        value_usd: 0,
        unrealized_pnl_usd: null,
      },
      {
        api_key_id: "key-B",
        holding_type: "spot",
        value_usd: 0,
        unrealized_pnl_usd: null,
      },
    ] as unknown as Parameters<typeof liveBaselineMetricsFromPerKeyDailies>[0];
    const out = liveBaselineMetricsFromPerKeyDailies(holdings, {
      "key-A": dates.map((date, i) => ({ date, value: i % 2 ? 0.01 : -0.004 })),
      "key-B": dates.map((date, i) => ({ date, value: i % 2 ? -0.02 : 0.015 })),
    });
    expect(out.ytdTwr).toBeNull();
    expect(out.sharpe).toBeNull();
    expect(out.maxDd).toBeNull();
    expect(out.equity).toEqual([]);
    expect(out.drawdown).toEqual([]);
    expect(out.aum).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 167.1.2 C3 fix F (SFH-C3R2-X1) — the per-key read survives PostgREST's cap
// ---------------------------------------------------------------------------
/**
 * WHY: PostgREST cuts every response to `max_rows` (1000 on PROD) whatever
 * `.limit()` asked for, with HTTP 200 and `error: null`. The dashboard's
 * per-key read used to be ONE `.order("date", asc).limit(20000)` request, so
 * an allocator past 1000 rows got its OLDEST 1000 and lost every recent day.
 * PROD 2026-09-29: one allocator holds 2348 rows inside the 730-day window.
 * The fixture reproduces that count, with the server cap ON, stored
 * newest-first so seed order, id order and date order all disagree.
 */
describe("getMyAllocationDashboard — the per-key read drains past the 1000-row cap (167.1.2 C3 fix F)", () => {
  beforeEach(resetState);

  const KEYS = ["k-cap-a", "k-cap-b", "k-cap-c", "k-cap-d"];
  // 4 keys × 587 days = 2348 rows, all inside the 730-day window.
  const DAYS = 587;
  const dayOffset = (i: number) =>
    new Date(Date.now() - (DAYS - i) * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

  function seedPastTheCap() {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = KEYS.map((id) => aum04Key(id, "bybit"));
    state.csvDailyReturns = [];
    for (let i = DAYS - 1; i >= 0; i -= 1) {
      for (const api_key_id of KEYS) {
        state.csvDailyReturns.push({
          api_key_id,
          allocator_id: "user-1",
          date: dayOffset(i),
          daily_return: 0.001 * ((i % 7) - 3),
        });
      }
    }
    state.maxRows = 1000;
  }

  it("delivers all 2348 rows, every key through its newest day, date-ascending", async () => {
    seedPastTheCap();
    expect(state.csvDailyReturns).toHaveLength(2348);

    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");
    const byKey = result.perKeyReturnsByApiKeyId;

    expect(Object.keys(byKey).sort()).toEqual(KEYS);
    const total = KEYS.reduce((n, k) => n + byKey[k].length, 0);
    expect(total).toBe(2348);
    for (const k of KEYS) {
      const dates = byKey[k].map((p) => p.date);
      expect(dates[0]).toBe(dayOffset(0));
      expect(dates[dates.length - 1]).toBe(dayOffset(DAYS - 1));
      expect(dates).toEqual([...dates].sort());
    }
    // The drain paged on the id keyset: several csv_daily_returns requests,
    // the last of them the empty page that ends it.
    const reads = chainAudit.entries.filter((e) => e.table === "csv_daily_returns");
    expect(reads).toHaveLength(4);
    expect(reads.every((e) => e.limitN === 1000)).toBe(true);
  });

  it("fails LOUD (throws via assertOk) when the server ignores the cursor, never a partial series", async () => {
    seedPastTheCap();
    // Every row carries the same id: the second page repeats the first's ids.
    state.csvDailyReturns = state.csvDailyReturns.map((r) => ({ ...r, id: 7 }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getMyAllocationDashboard } = await import("./queries");
    await expect(getMyAllocationDashboard("user-1")).rejects.toThrow(
      /getMyAllocationDashboard\.csv_daily_returns: csv_daily_returns: page 1 returned id 7, not strictly after 7/,
    );
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Phase 167.1.2 plan 15 (item 8, D-16): the dashboard reads each key's rows at
// that key's own latest asof, through a bounded read.
// ---------------------------------------------------------------------------
describe("getMyAllocationDashboard — Open Positions reads each key's own latest asof (D-16)", () => {
  beforeEach(resetState);

  const key = (id: string, exchange: string) => ({
    id,
    user_id: "user-1",
    exchange,
    label: `Key ${id}`,
    is_active: true,
    sync_status: "ok",
    last_sync_at: "2026-09-27T00:00:00Z",
    disconnected_at: null,
    account_balance_usdt: 1000,
    created_at: "2026-04-01T00:00:00Z",
  });
  const holding = (
    api_key_id: string,
    venue: string,
    asof: string,
    symbol: string,
    value_usd: number,
  ) => ({
    allocator_id: "user-1",
    api_key_id,
    symbol,
    quantity: 1,
    mark_price: value_usd,
    value_usd,
    venue,
    holding_type: "spot" as const,
    updated_at: `${asof}T04:00:00+00:00`,
    asof,
  });

  it("mock self-test: order(desc) + limit(1) returns the newest row from an ASCENDING seed", async () => {
    // Without this the SSR arm below could pass on a mock that ignores
    // order/limit and hands back the oldest row as the "latest asof".
    state.allocatorHoldings = [
      holding("key-a", "binance", "2026-09-25", "BTC", 1),
      holding("key-a", "binance", "2026-09-27", "BTC", 3),
      holding("key-a", "binance", "2026-09-26", "BTC", 2),
    ];
    const { createClient } = await import("@/lib/supabase/server");
    const client = (await createClient()) as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          order: (
            c: string,
            o: { ascending: boolean },
          ) => { limit: (n: number) => PromiseLike<{ data: Array<{ asof: string }> }> };
        };
      };
    };
    const newest = await client
      .from("allocator_holdings")
      .select("asof")
      .order("asof", { ascending: false })
      .limit(1);
    expect(newest.data.map((r) => r.asof)).toEqual(["2026-09-27"]);
    const oldestTwo = await client
      .from("allocator_holdings")
      .select("asof")
      .order("asof", { ascending: true })
      .limit(2);
    expect(oldestTwo.data.map((r) => r.asof)).toEqual([
      "2026-09-25",
      "2026-09-26",
    ]);
  });

  it("two keys across three dates, seeded ASCENDING: holdingsSummary holds only each key's latest-asof rows", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [key("key-a", "binance"), key("key-b", "okx")];
    state.allocatorHoldings = [
      // key-a polled D-2, D-1, D. BTC was closed after D-2.
      holding("key-a", "binance", "2026-09-25", "BTC", 500),
      holding("key-a", "binance", "2026-09-25", "ETH", 100),
      holding("key-a", "binance", "2026-09-26", "ETH", 110),
      holding("key-a", "binance", "2026-09-27", "ETH", 120),
      // key-b last polled on D-1 (quiet on D): its D-1 rows are its current book.
      holding("key-b", "okx", "2026-09-25", "SOL", 30),
      holding("key-b", "okx", "2026-09-26", "SOL", 40),
      holding("key-b", "okx", "2026-09-26", "XRP", 7),
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    const got = result.holdingsSummary
      .map((h) => `${h.api_key_id}:${h.symbol}:${h.value_usd}`)
      .sort();
    expect(got).toEqual(["key-a:ETH:120", "key-b:SOL:40", "key-b:XRP:7"]);
  });

  it("every allocator_holdings read carries the explicit owner filter and a per-key filter (T-167.1.2-56)", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [key("key-a", "binance")];
    state.allocatorHoldings = [holding("key-a", "binance", "2026-09-27", "ETH", 120)];
    const { getMyAllocationDashboard } = await import("./queries");
    await getMyAllocationDashboard("user-1");

    const holdingsReads = chainAudit.entries.filter(
      (e) => e.table === "allocator_holdings",
    );
    // One latest-asof read and one rows read for the one key.
    expect(holdingsReads).toHaveLength(2);
    for (const read of holdingsReads) {
      expect(read.eqs).toContainEqual({ column: "allocator_id", value: "user-1" });
      expect(read.eqs).toContainEqual({ column: "api_key_id", value: "key-a" });
    }
    // Review C4 SFH-C4-01: the key read carries the account identity columns.
    const idRead = chainAudit.entries.find(
      (e) =>
        e.table === "api_keys" &&
        e.select ===
          "id, exchange, venue_account_id, account_share_kind, account_shared_with_api_key_id",
    );
    expect(idRead?.eqs).toContainEqual({ column: "user_id", value: "user-1" });
    // Review C4 SFH-C4-02: the poll-outcome read is owner- and key-scoped.
    // Round 2 WR-R2-03 adds the newest poll of any outcome: two reads, both
    // owner- and key-scoped.
    const pollReads = chainAudit.entries.filter((e) => e.table === "audit_log");
    expect(pollReads).toHaveLength(2);
    for (const read of pollReads) {
      expect(read.eqs).toContainEqual({ column: "user_id", value: "user-1" });
      expect(read.eqs).toContainEqual({ column: "entity_id", value: "key-a" });
    }
  });

  it("WR-R2-03: a key whose rows' poll could not read positions reaches the payload, and a later failed poll does not clear it", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [{ ...key("key-a", "binance"), sync_status: "rate_limited" }];
    state.allocatorHoldings = [holding("key-a", "binance", "2026-09-05", "USDT", 500)];
    const event = (createdAt: string, action: string, metadata: Record<string, unknown>) => ({
      user_id: "user-1",
      action,
      entity_type: "api_key",
      entity_id: "key-a",
      created_at: createdAt,
      metadata,
      "metadata->>final_status": metadata.final_status ?? null,
    });
    state.auditLog = [
      event("2026-09-05T04:00:05+00:00", "allocator.holdings.sync_completed", {
        final_status: "complete_with_warnings",
        row_count: 1,
        asof: "2026-09-05",
      }),
      event("2026-09-06T04:00:05+00:00", "allocator.holdings.sync_failed", {
        error_kind: "rate_limit",
      }),
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.partialPositionReads).toEqual([
      { api_key_id: "key-a", asof: "2026-09-05" },
    ]);
  });

  // 167.1.2.1.2 plan 01 (D-02, SC-2). A position closed and polled empty on the rows' OWN
  // day: the strict clean-poll rule cannot see it (same day), and the writer only upserts,
  // so the morning rows stay. The dashboard payload is the oracle: holdingsSummary, the live
  // AUM and the fingerprint rows all derive from the one per-key read, so one hide rule must
  // move all three. Every expected figure is typed by hand from the fixture below.
  describe("D-02: a key whose newest poll read nothing on the rows' own day is dropped from the payload", () => {
    const D = "2026-09-27";
    const event = (keyId: string, createdAt: string, metadata: Record<string, unknown>) => ({
      user_id: "user-1",
      action: "allocator.holdings.sync_completed",
      entity_type: "api_key",
      entity_id: keyId,
      created_at: createdAt,
      metadata,
      "metadata->>final_status": metadata.final_status ?? null,
    });
    const seed = () => {
      state.portfolios = [P7_PORTFOLIO];
      state.apiKeys = [key("key-a", "binance"), key("key-b", "okx")];
      state.allocatorHoldings = [
        // key-a held BTC 500 and ETH 100 this morning; both rows are the day's upserts.
        holding("key-a", "binance", D, "BTC", 500),
        holding("key-a", "binance", D, "ETH", 100),
        holding("key-b", "okx", D, "SOL", 40),
      ];
    };

    it("drops key-a from holdingsSummary, the live AUM and the fingerprint rows; key-b stays; two audit reads per key", async () => {
      // WHY: the closed position must stop showing the day it is polled empty, on every
      // surface that reads this array, and the fingerprint row set must lose the same tokens
      // the SQL twin (plan 05) drops or a book-mode commit is refused as stale.
      seed();
      state.auditLog = [
        event("key-a", `${D}T04:00:05+00:00`, { final_status: "complete", row_count: 2, asof: D }),
        event("key-a", `${D}T11:00:00+00:00`, { final_status: "complete", row_count: 0, asof: D }),
      ];
      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(
        result.holdingsSummary.map((h) => `${h.api_key_id}:${h.symbol}:${h.value_usd}`),
      ).toEqual(["key-b:SOL:40"]);
      expect(result.liveBaselineMetrics.aum).toBe(40);
      expect(result.holdingsFingerprintRows).toEqual([
        { symbol: "SOL", venue: "okx", holding_type: "spot" },
      ]);

      // No third read: exactly two audit_log reads per key, each owner- and key-scoped.
      const pollReads = chainAudit.entries.filter((e) => e.table === "audit_log");
      expect(pollReads).toHaveLength(4);
      for (const keyId of ["key-a", "key-b"]) {
        const mine = pollReads.filter((e) =>
          e.eqs.some((q) => q.column === "entity_id" && q.value === keyId),
        );
        expect(mine).toHaveLength(2);
        for (const read of mine) {
          expect(read.eqs).toContainEqual({ column: "user_id", value: "user-1" });
        }
      }
    });

    it("control: with the empty poll absent (or followed by a warnings poll) both keys stay", async () => {
      // WHY: the event is what changes the read; a later warnings poll is the second condition.
      seed();
      state.auditLog = [
        event("key-a", `${D}T04:00:05+00:00`, { final_status: "complete", row_count: 0, asof: D }),
        event("key-a", `${D}T11:00:00+00:00`, {
          final_status: "complete_with_warnings",
          row_count: 2,
          asof: D,
        }),
      ];
      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(
        result.holdingsSummary.map((h) => `${h.api_key_id}:${h.symbol}:${h.value_usd}`).sort(),
      ).toEqual(["key-a:BTC:500", "key-a:ETH:100", "key-b:SOL:40"]);
      expect(result.liveBaselineMetrics.aum).toBe(640);
      expect(result.holdingsFingerprintRows).toHaveLength(3);
    });
  });

  // 164.6.6.2.1 CR-01 (D-02, D-08, D-17). A BTC account's row is priced at the close of
  // the day BEFORE its poll. When a later poll finds that close missing it writes NO row
  // (allocator_holdings.value_usd is NOT NULL) and records the fact in a SERVICE-written
  // `allocator_equity_derived` row (`native_unpriced:<key>`). Before this, the earlier
  // priced row stayed the key's latest and the Holdings tab and the AUM kept counting it,
  // under a note that said "left out of holdings". The oracle is the dashboard payload,
  // not the fetcher's return value. The evidence is never the audit log: an owner can
  // write any event there through `log_audit_event`.
  describe("CR-01: a native key the newest poll left unpriced is not counted at an older close", () => {
    const nativeRow = (asof: string, quantity: number, value_usd: number) => ({
      ...holding("key-btc", "mt5", asof, "ACCOUNT-0123abcd", value_usd),
      quantity,
      quantity_unit: "BTC",
    });
    const unpricedRecord = (asof: string) => ({
      allocator_id: "user-1",
      kind: "native_unpriced:key-btc",
      payload: { native_unpriced: true, asof },
      computed_at: `${asof}T04:00:05+00:00`,
    });
    const seed = () => {
      state.portfolios = [P7_PORTFOLIO];
      state.apiKeys = [key("key-btc", "mt5"), key("key-usd", "binance")];
      state.allocatorHoldings = [
        // Oct 9 poll: 0.4213 BTC at the Oct 8 close of 61950 = 26099.535.
        nativeRow("2026-10-09", 0.4213, 26099.535),
        holding("key-usd", "binance", "2026-10-10", "USDT", 500),
      ];
    };

    it("the Oct 10 poll found no Oct 9 close: the Oct 9 row leaves the Holdings payload and the AUM, the other key stays", async () => {
      seed();
      state.allocatorEquityDerived = [unpricedRecord("2026-10-10")] as never;
      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(
        result.holdingsSummary.map((h) => `${h.api_key_id}:${h.symbol}:${h.value_usd}`),
      ).toEqual(["key-usd:USDT:500"]);
      expect(result.liveBaselineMetrics.aum).toBe(500);
    });

    it("control: with no record the same rows are counted (the record is what changes the read)", async () => {
      seed();
      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(result.holdingsSummary.map((h) => h.api_key_id).sort()).toEqual([
        "key-btc",
        "key-usd",
      ]);
      expect(result.liveBaselineMetrics.aum).toBe(26599.535);
    });

    it("a user-forged audit event cannot hide a key's rows (the owner can write any event through log_audit_event)", async () => {
      seed();
      // Inserted the way `public.log_audit_event` would: user_id pinned to the caller,
      // every other field the caller's choice. Every shape a reader of the old
      // marker could have honoured.
      const forged = (metadata: Record<string, unknown>) => ({
        user_id: "user-1",
        action: "allocator.holdings.sync_completed",
        entity_type: "api_key",
        entity_id: "key-btc",
        created_at: "2026-10-10T04:00:05+00:00",
        metadata,
        "metadata->>final_status": metadata.final_status ?? null,
      });
      state.auditLog = [
        forged({
          final_status: "complete_with_warnings",
          row_count: 0,
          asof: "2026-10-10",
          native_unpriced: true,
        }),
      ];
      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(
        result.holdingsSummary.find((h) => h.api_key_id === "key-btc")?.value_usd,
      ).toBe(26099.535);
      expect(result.liveBaselineMetrics.aum).toBe(26599.535);
    });

    it("a later poll that DID price the day supersedes the record: its row is the key's latest and shows", async () => {
      seed();
      state.allocatorHoldings = [
        ...state.allocatorHoldings,
        nativeRow("2026-10-11", 0.4213, 26500),
      ];
      state.allocatorEquityDerived = [unpricedRecord("2026-10-10")] as never;
      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(
        result.holdingsSummary.find((h) => h.api_key_id === "key-btc")?.value_usd,
      ).toBe(26500);
    });

    it("a record of the SAME day as the row does not hide it (that row is not older than the poll)", async () => {
      seed();
      state.allocatorEquityDerived = [unpricedRecord("2026-10-09")] as never;
      const { getMyAllocationDashboard } = await import("./queries");
      const result = await getMyAllocationDashboard("user-1");

      expect(
        result.holdingsSummary.find((h) => h.api_key_id === "key-btc")?.value_usd,
      ).toBe(26099.535);
    });
  });

  it("SFH-C4-01: after a key rotation on one account, the departed key's older rows leave holdingsSummary", async () => {
    // Old key D read the account until 2026-08-31 and held BTC-PERP. New key N
    // reads the SAME account (same venue account id) and no longer holds it.
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [
      {
        ...key("key-old", "binance"),
        disconnected_at: "2026-09-01T00:00:00Z",
        venue_account_id: "acct-1",
      },
      { ...key("key-new", "binance"), venue_account_id: "acct-1" },
    ];
    state.allocatorHoldings = [
      holding("key-old", "binance", "2026-08-31", "BTC-PERP", 900),
      holding("key-new", "binance", "2026-09-29", "ETH", 120),
    ];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(
      result.holdingsSummary.map((h) => `${h.api_key_id}:${h.symbol}`),
    ).toEqual(["key-new:ETH"]);
  });
});

// ---------------------------------------------------------------------------
// Phase 164.6.6.2 plan 09 (D-18, D-22, D-13): a BTC-native strategy in the
// allocator's book reaches the dashboard payload as a USD series.
//
// WHY: the composer's book legs, the scenario compare panel and the table's MTD
// all blend or reduce this payload's `daily_returns`. A BTC account's raw
// returns blended with USD ones silently drop the BTC price leg (a 10% BTC day
// on a BTC account is a 21% USD day when BTC itself moved 10%). The expected
// values are hand-computed literals, never produced by the function under test:
//   NAV 1.0 -> 1.1 in BTC, closes 60000 -> 66000:  (1.1 * 66000) / (1.0 * 60000) - 1 = 0.21
// ---------------------------------------------------------------------------
describe("getMyAllocationDashboard — 164.6.6.2 BTC-native book rows convert to USD", () => {
  const BTC_SERIES = [
    { date: "2026-01-01", value: 0.03 },
    { date: "2026-01-02", value: 0.1 },
  ];
  const CLOSES = {
    prices: [
      { date: "2026-01-01", close: 60000 },
      { date: "2026-01-02", close: 66000 },
    ],
    dropped: [] as string[],
    through: "2026-01-02",
  };

  beforeEach(() => {
    resetState();
    state.portfolios = [PORTFOLIO_FIXTURE];
    btcCloses.read.mockReset();
    btcCloses.read.mockResolvedValue(CLOSES);
  });

  async function dashboardFor(rows: Array<Parameters<typeof psProvenance>[0]>) {
    state.portfolioStrategies = rows.map(
      (r) => psProvenance(r) as (typeof state.portfolioStrategies)[number],
    );
    const { getMyAllocationDashboard } = await import("./queries");
    return getMyAllocationDashboard("user-1");
  }
  const seriesOf = (row: { strategy: unknown }) =>
    (
      (row.strategy as { strategy_analytics: { daily_returns: unknown } })
        .strategy_analytics
    ).daily_returns;

  it("emits the USD series and returns_unit BTC for a native row (0.21, day 0 dropped)", async () => {
    const result = await dashboardFor([
      { daily_returns: BTC_SERIES, data_quality_flags: { native_unit: "BTC" } },
    ]);
    const row = result.strategies.find((s) => s.strategy_id === "sc")!;
    expect(seriesOf(row)).toEqual([{ date: "2026-01-02", value: expect.closeTo(0.21, 12) }]);
    expect((row.strategy as unknown as { returns_unit: unknown }).returns_unit).toBe("BTC");
    expect((row.strategy as unknown as { series_state: unknown }).series_state).toBe("available");
  });

  it("parity: the payload series is exactly convertNativeReturnsToUsd on the same inputs", async () => {
    const { convertNativeReturnsToUsd } = await import("@/lib/factsheet/native-to-usd");
    const result = await dashboardFor([
      { daily_returns: BTC_SERIES, data_quality_flags: { native_unit: "BTC" } },
    ]);
    const row = result.strategies.find((s) => s.strategy_id === "sc")!;
    expect(seriesOf(row)).toEqual(convertNativeReturnsToUsd(BTC_SERIES, "BTC", CLOSES));
  });

  it("WR-02: a native curve with an absent day prices the day after it over its OWN day (+10%, not +340%)", async () => {
    // Curve 1.0, 1.1, null, 1.2, 1.32 on 03-02..03-06; BTC closes 100, 100, 200,
    // 400, 400. 03-06's native return is 1.32 / 1.2 - 1 = 0.1 and BTC was flat that
    // day, so USD is (1 + 0.1) * (400 / 400) - 1 = 0.1. Priced across the gap
    // (against 03-03, close 100) it was 1.1 * 4 - 1 = 3.4.
    btcCloses.read.mockResolvedValue({
      prices: [
        { date: "2026-03-02", close: 100 },
        { date: "2026-03-03", close: 100 },
        { date: "2026-03-04", close: 200 },
        { date: "2026-03-05", close: 400 },
        { date: "2026-03-06", close: 400 },
      ],
      dropped: [] as string[],
      through: "2026-03-06",
    });
    const result = await dashboardFor([
      {
        daily_returns: null,
        returns_series: [
          { date: "2026-03-02", value: 1.0 },
          { date: "2026-03-03", value: 1.1 },
          { date: "2026-03-04", value: null },
          { date: "2026-03-05", value: 1.2 },
          { date: "2026-03-06", value: 1.32 },
        ],
        data_quality_flags: { native_unit: "BTC" },
      },
    ]);
    const row = result.strategies.find((s) => s.strategy_id === "sc")!;
    expect(seriesOf(row)).toEqual([{ date: "2026-03-06", value: expect.closeTo(0.1, 12) }]);
    expect((row.strategy as unknown as { series_state: unknown }).series_state).toBe("available");
  });

  it("a USD row is unchanged, returns_unit is null, and no closes are read", async () => {
    const result = await dashboardFor([
      { daily_returns: BTC_SERIES, data_quality_flags: null },
    ]);
    const row = result.strategies.find((s) => s.strategy_id === "sc")!;
    expect(seriesOf(row)).toEqual(BTC_SERIES);
    expect((row.strategy as unknown as { returns_unit: unknown }).returns_unit).toBeNull();
    expect(btcCloses.read).not.toHaveBeenCalled();
  });

  it("reads the closes ONCE for a book with several native rows", async () => {
    await dashboardFor([
      { strategy_id: "n1", daily_returns: BTC_SERIES, data_quality_flags: { native_unit: "BTC" } },
      { strategy_id: "n2", daily_returns: BTC_SERIES, data_quality_flags: { native_unit: "BTC" } },
      { strategy_id: "u1", daily_returns: BTC_SERIES },
    ]);
    expect(btcCloses.read).toHaveBeenCalledTimes(1);
  });

  it("a malformed native_unit reads as USD: no conversion, no closes read", async () => {
    const result = await dashboardFor([
      { daily_returns: BTC_SERIES, data_quality_flags: { native_unit: "btc" } },
    ]);
    const row = result.strategies.find((s) => s.strategy_id === "sc")!;
    expect(seriesOf(row)).toEqual(BTC_SERIES);
    expect((row.strategy as unknown as { returns_unit: unknown }).returns_unit).toBeNull();
    expect(btcCloses.read).not.toHaveBeenCalled();
  });

  it("a failed closes read converts the BTC leg to [] and logs; series_state stays 'available'", async () => {
    btcCloses.read.mockResolvedValue(null);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await dashboardFor([
        { daily_returns: BTC_SERIES, data_quality_flags: { native_unit: "BTC" } },
      ]);
      const row = result.strategies.find((s) => s.strategy_id === "sc")!;
      expect(seriesOf(row)).toEqual([]);
      expect((row.strategy as unknown as { series_state: unknown }).series_state).toBe("available");
      expect((row.strategy as unknown as { returns_unit: unknown }).returns_unit).toBe("BTC");
      expect(
        errSpy.mock.calls.some((c) => String(c[0]).includes("BTC closes unavailable")),
      ).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });

  // SFH-1 (164.6.6.2 review): `series_state` is derived from the PRE-conversion
  // series, so an unpriced native leg reads "available" while its blend series
  // is []. The row must carry the one honest extra fact: it could not be priced.
  describe("native_unpriced: a book row whose series priced to nothing", () => {
    const flagOf = (row: { strategy: unknown }) =>
      (row.strategy as unknown as { native_unpriced: unknown }).native_unpriced;

    it("true for a native row when the closes read is null", async () => {
      btcCloses.read.mockResolvedValue(null);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await dashboardFor([
          { daily_returns: BTC_SERIES, data_quality_flags: { native_unit: "BTC" } },
        ]);
        const row = result.strategies.find((s) => s.strategy_id === "sc")!;
        expect(flagOf(row)).toBe(true);
        expect(seriesOf(row)).toEqual([]);
      } finally {
        errSpy.mockRestore();
      }
    });

    it("true when stored closes cover none of the row's days", async () => {
      btcCloses.read.mockResolvedValue({
        prices: [
          { date: "2020-01-01", close: 1 },
          { date: "2020-01-02", close: 2 },
        ],
        dropped: [],
        through: "2020-01-02",
      });
      const result = await dashboardFor([
        { daily_returns: BTC_SERIES, data_quality_flags: { native_unit: "BTC" } },
      ]);
      const row = result.strategies.find((s) => s.strategy_id === "sc")!;
      expect(flagOf(row)).toBe(true);
    });

    it("false for a priced native row", async () => {
      const result = await dashboardFor([
        { daily_returns: BTC_SERIES, data_quality_flags: { native_unit: "BTC" } },
      ]);
      const row = result.strategies.find((s) => s.strategy_id === "sc")!;
      expect(flagOf(row)).toBe(false);
    });

    it("false for a USD row, and only the unpriced row of a mixed book is flagged", async () => {
      btcCloses.read.mockResolvedValue(null);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await dashboardFor([
          { strategy_id: "n1", daily_returns: BTC_SERIES, data_quality_flags: { native_unit: "BTC" } },
          { strategy_id: "u1", daily_returns: BTC_SERIES },
        ]);
        expect(flagOf(result.strategies.find((s) => s.strategy_id === "n1")!)).toBe(true);
        expect(flagOf(result.strategies.find((s) => s.strategy_id === "u1")!)).toBe(false);
      } finally {
        errSpy.mockRestore();
      }
    });

    it("false for a native row with no series (series_state owns that absence)", async () => {
      const result = await dashboardFor([
        { daily_returns: [], data_quality_flags: { native_unit: "BTC" } },
      ]);
      const row = result.strategies.find((s) => s.strategy_id === "sc")!;
      expect(flagOf(row)).toBe(false);
    });
  });

  it("never ships the raw data_quality_flags blob", async () => {
    const result = await dashboardFor([
      { daily_returns: BTC_SERIES, data_quality_flags: { native_unit: "BTC", composite: false } },
    ]);
    const row = result.strategies.find((s) => s.strategy_id === "sc")!;
    expect(JSON.stringify(row)).not.toContain("data_quality_flags");
    expect(JSON.stringify(row)).not.toContain("native_unit");
  });
});

// ---------------------------------------------------------------------------
// Phase 164.6.6.2.1 plan 17 (D-01, D-17, D-21). A native-unit account's
// Holdings row travels from the read to the table with its STORED unit. The
// dashboard names no unit of its own: it reads `allocator_holdings.quantity_unit`
// (plan 01's column, written by plan 10's poll) and passes it through the same
// `parseReturnsUnit` every other surface uses.
// ---------------------------------------------------------------------------
describe("getMyAllocationDashboard — a native account's Holdings row carries its stored unit (164.6.6.2.1 plan 17)", () => {
  beforeEach(resetState);

  const key = (id: string) => ({
    id,
    user_id: "user-1",
    exchange: "mt5",
    label: `Key ${id}`,
    is_active: true,
    sync_status: "complete",
    last_sync_at: "2026-10-09T00:00:00Z",
    disconnected_at: null,
    account_balance_usdt: 26099.54,
    created_at: "2026-04-01T00:00:00Z",
  });
  const accountRow = (quantity_unit: string | null | undefined) => ({
    allocator_id: "user-1",
    api_key_id: "key-btc",
    symbol: "ACCOUNT-1a2b3c4d",
    quantity: 0.4213,
    mark_price: 61950,
    value_usd: 26099.54,
    venue: "mt5",
    holding_type: "spot" as const,
    updated_at: "2026-10-09T04:00:00+00:00",
    asof: "2026-10-09",
    ...(quantity_unit === undefined ? {} : { quantity_unit }),
  });

  it("projects quantity_unit on the rows read (an unprojected column is NULL for every row, whatever is stored)", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [key("key-btc")];
    state.allocatorHoldings = [accountRow("BTC")];
    const { getMyAllocationDashboard } = await import("./queries");
    await getMyAllocationDashboard("user-1");

    const rowsRead = chainAudit.entries.filter(
      (e) => e.table === "allocator_holdings" && (e.select ?? "").includes("symbol"),
    );
    expect(rowsRead).toHaveLength(1);
    expect(rowsRead[0].select).toContain("quantity_unit");
    expect(rowsRead[0].select).toContain("mark_price");
  });

  it("holdingsSummary carries the stored unit and the mark", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [key("key-btc")];
    state.allocatorHoldings = [accountRow("BTC")];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.holdingsSummary).toHaveLength(1);
    expect(result.holdingsSummary[0]).toMatchObject({
      symbol: "ACCOUNT-1a2b3c4d",
      quantity: 0.4213,
      mark_price_usd: 61950,
      quantity_unit: "BTC",
    });
  });

  it.each([
    ["a USD-family row (NULL)", null],
    ["a row the column never reached (absent)", undefined],
    ["a lower-case code", "btc"],
    ["markup", "<b>X</b>"],
  ])("holdingsSummary reads %s as no unit, never as label text", async (_label, stored) => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [key("key-btc")];
    state.allocatorHoldings = [accountRow(stored)];
    const { getMyAllocationDashboard } = await import("./queries");
    const result = await getMyAllocationDashboard("user-1");

    expect(result.holdingsSummary[0].quantity_unit).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 167.1.2.1 review 09 (WR-02, SFH F4). `historyReconstructFailed` may only
// name a key the daily fan-out still qualifies, and "linked to a strategy" is
// the fan-out's own test: ANY non-archived strategy of the owner, through
// `strategies.api_key_id` or `strategy_keys`, whatever its capital mark. These
// run the REAL reader against the owner-scoped table reads, so they pin the
// wiring that the unit cases on derivePhase07Fields cannot see: which strategies
// reach the link set (unfiltered by capital mark) and what a failed link read
// does (the note names nothing).
// ---------------------------------------------------------------------------
describe("getMyAllocationDashboard — historyReconstructFailed names only a key the fan-out still qualifies (167.1.2.1 WR-02)", () => {
  beforeEach(resetState);

  const cappedKey = () => ({
    ...aum04Key("k-capped", "bybit"),
    history_reconstructed_at: null,
    history_reconstruct_attempts: 5,
  });

  async function read() {
    const { getMyAllocationDashboard } = await import("./queries");
    return getMyAllocationDashboard("user-1");
  }

  it("a capped key with no strategy link raises it (the control)", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [cappedKey()];
    expect((await read()).historyReconstructFailed).toBe(true);
  });

  it("a capped key behind a live strategy raises nothing, whatever the capital mark (own_capital is still a link)", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [cappedKey()];
    state.strategies = [
      {
        id: "s-own",
        user_id: "user-1",
        api_key_id: "k-capped",
        status: "private",
        capital_ownership: "own_capital",
      },
    ];
    expect((await read()).historyReconstructFailed).toBe(false);
  });

  it("a capped key behind a strategy_keys composite link raises nothing, even with own_capital on the strategy", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [cappedKey()];
    state.strategies = [
      {
        id: "s-composite",
        user_id: "user-1",
        api_key_id: null,
        status: "private",
        capital_ownership: "own_capital",
      },
    ];
    state.strategyKeys = [
      { owner_id: "user-1", strategy_id: "s-composite", api_key_id: "k-capped" },
    ];
    expect((await read()).historyReconstructFailed).toBe(false);
  });

  it("a capped key behind an ARCHIVED strategy still raises it", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [cappedKey()];
    state.strategies = [
      {
        id: "s-old",
        user_id: "user-1",
        api_key_id: "k-capped",
        status: "archived",
        capital_ownership: null,
      },
    ];
    expect((await read()).historyReconstructFailed).toBe(true);
  });

  it.each(["strategy_keys", "strategies"])(
    "an unreadable %s read raises nothing, never a note about a key that may be linked",
    async (table) => {
      state.portfolios = [P7_PORTFOLIO];
      state.apiKeys = [cappedKey()];
      state.tableErrors[table] = { message: "PGRST002 schema cache lookup failed (test)" };
      vi.spyOn(console, "error").mockImplementation(() => {});
      const sentry = await import("./sentry-capture");
      vi.spyOn(sentry, "captureToSentry").mockImplementation(async () => {});
      expect((await read()).historyReconstructFailed).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// Phase 167.1.2.1 review 09 round 2 (WR-02, the in-flight half of SFH F4). The
// fan-out counts an attempt at ENQUEUE, so the fifth attempt reads as capped
// while its job is still pending, running or backing off, and the job may yet
// succeed. The note waits on a job in flight, using the statuses the fan-out and
// the Python hold wait on. These run the REAL reader against a seeded
// compute_jobs table.
// ---------------------------------------------------------------------------
describe("getMyAllocationDashboard — historyReconstructFailed waits on a reconstruct in flight (167.1.2.1 WR-02 round 2)", () => {
  beforeEach(resetState);

  const cappedKey = () => ({
    ...aum04Key("k-capped", "bybit"),
    history_reconstructed_at: null,
    history_reconstruct_attempts: 5,
  });

  const job = (status: string, over: Record<string, unknown> = {}) => ({
    id: "j-1",
    kind: "reconstruct_allocator_history",
    status,
    api_key_id: "k-capped",
    ...over,
  });

  const computeJobReads = () =>
    chainAudit.entries.filter((e) => e.table === "compute_jobs");

  async function read() {
    const { getMyAllocationDashboard } = await import("./queries");
    return getMyAllocationDashboard("user-1");
  }

  it("a capped key with no job at all raises it (the control)", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [cappedKey()];
    expect((await read()).historyReconstructFailed).toBe(true);
    expect(computeJobReads()).toHaveLength(1);
  });

  // Hand-typed on purpose: these four are the statuses migration 20261021120000
  // counts as in flight. The twin test pins the constant to the migration; this
  // pins the behaviour to the words.
  it.each(["pending", "running", "done_pending_children", "failed_retry"])(
    "a capped key whose reconstruct is %s raises nothing",
    async (status) => {
      state.portfolios = [P7_PORTFOLIO];
      state.apiKeys = [cappedKey()];
      state.computeJobs = [job(status)];
      expect((await read()).historyReconstructFailed).toBe(false);
    },
  );

  it.each(["done", "failed_final"])(
    "a capped key whose last reconstruct is %s (finished) still raises it",
    async (status) => {
      state.portfolios = [P7_PORTFOLIO];
      state.apiKeys = [cappedKey()];
      state.computeJobs = [job(status)];
      expect((await read()).historyReconstructFailed).toBe(true);
    },
  );

  it("an in-flight job of ANOTHER kind does not hold the note", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [cappedKey()];
    state.computeJobs = [job("running", { kind: "poll_allocator_positions" })];
    expect((await read()).historyReconstructFailed).toBe(true);
  });

  it("an in-flight reconstruct of a key the owner does not hold does not hold the note", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [cappedKey()];
    state.computeJobs = [job("running", { api_key_id: "k-someone-else" })];
    expect((await read()).historyReconstructFailed).toBe(true);
  });

  it("two capped keys, one in flight: the other is still named", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [
      cappedKey(),
      { ...cappedKey(), id: "k-other", venue_account_id: "acct-other" },
    ];
    state.computeJobs = [job("pending")];
    expect((await read()).historyReconstructFailed).toBe(true);
  });

  it("no capped key means no compute_jobs read at all (the common dashboard pays nothing)", async () => {
    state.portfolios = [P7_PORTFOLIO];
    const healthy = cappedKey();
    healthy.history_reconstruct_attempts = 1;
    state.apiKeys = [healthy];
    expect((await read()).historyReconstructFailed).toBe(false);
    expect(computeJobReads()).toHaveLength(0);
  });

  it("the read asks only for the reconstruct kind, the four in-flight statuses and the capped key ids", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [cappedKey()];
    await read();
    const [entry] = computeJobReads();
    expect(entry.select).toBe("api_key_id");
    expect(entry.eqs).toContainEqual({
      column: "kind",
      value: "reconstruct_allocator_history",
    });
    expect(entry.ins).toContainEqual({
      column: "status",
      value: ["pending", "running", "done_pending_children", "failed_retry"],
    });
    expect(entry.ins).toContainEqual({
      column: "api_key_id",
      value: ["k-capped"],
    });
  });

  it("an unreadable compute_jobs read raises nothing and is captured, never a note that may be false", async () => {
    state.portfolios = [P7_PORTFOLIO];
    state.apiKeys = [cappedKey()];
    state.tableErrors.compute_jobs = { message: "42501 permission denied (test)" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sentry = await import("./sentry-capture");
    const capture = vi
      .spyOn(sentry, "captureToSentry")
      .mockImplementation(async () => {});
    expect((await read()).historyReconstructFailed).toBe(false);
    expect(capture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tags: expect.objectContaining({
          reason: "reconstruct_in_flight_read_failed",
        }),
        level: "warning",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 167.2.1.1.1 (NAVMTM) plan 10, D-08 + the UI-SPEC planner check. The
// dashboard names the day recorded equity begins for the Equity curve note: the
// earliest PUBLISHED `marks_since` (the `key_inputs:<id>` row the derive writes
// only after apply_marks succeeded) among the keys the DRAWN curve includes (the
// allocator-eligible live keys, plus the departed keys the D-09 rule includes).
// One read on the USER client under the owner's RLS, with an explicit allocator
// filter. A note must never name a step the drawn curve does not contain, so a
// departed key the curve leaves out, or a key whose apply was refused, can never
// supply the date. Dates are synthetic.
// ---------------------------------------------------------------------------
describe("getMyAllocationDashboard - marksStart names the first recorded-equity day of the drawn keys (NAVMTM D-08)", () => {
  beforeEach(async () => {
    resetState();
    (await import("./queries")).__resetDerivedRowCaptureThrottleForTests();
  });

  const liveKey = (id: string) => ({
    ...aum04Key(id, "binance"),
    venue_account_id: `acct-${id}`,
    account_share_kind: null,
    account_shared_with_api_key_id: null,
    history_inclusion: null,
  });
  const departedKey = (id: string, over: Record<string, unknown> = {}) => ({
    ...aum04Key(id, "okx"),
    is_active: false,
    disconnected_at: "2026-04-20T00:00:00Z",
    venue_account_id: `acct-${id}`,
    account_share_kind: null,
    account_shared_with_api_key_id: null,
    history_inclusion: null,
    ...over,
  });
  const returnsFor = (apiKeyId: string, days: string[]) =>
    days.map((date) => ({ api_key_id: apiKeyId, allocator_id: "user-1", date, daily_return: 0.004 }));
  /** A key's stored derive inputs, carrying the published start when its apply succeeded. */
  const mark = (apiKeyId: string, marks_since: string, allocator_id = "user-1") => ({
    allocator_id,
    kind: `key_inputs:${apiKeyId}`,
    payload: { marks_since } as Record<string, unknown>,
  });
  const GONE_DAYS = ["2026-03-01", "2026-03-02", "2026-04-10"];

  /** A ready v2 derived row carrying the given writer flags. */
  function readyRow(flags: string[] = []) {
    const row = derivedRow(true);
    row.payload.version = 2;
    row.payload.flags = flags;
    row.payload.returns = [
      { date: "2026-03-11", r: 0.0038 },
      { date: "2026-03-12", r: 0.0011 },
      { date: "2026-03-13", r: 0.0039 },
    ];
    return row;
  }

  async function read() {
    const { getMyAllocationDashboard } = await import("./queries");
    return getMyAllocationDashboard("user-1");
  }
  const marksReads = () =>
    chainAudit.entries.filter(
      (e) => e.table === "allocator_equity_derived" && e.ins.some((i) => i.column === "kind"),
    );
  const idsOf = (entry: { ins: Array<{ column: string; value: unknown }> }) =>
    [...((entry.ins.find((i) => i.column === "kind")?.value as string[]) ?? [])]
      .map((k) => k.replace("key_inputs:", ""))
      .sort();

  it("reads the earliest published start across the included keys, on the owner's filter", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live"), liveKey("k-live-2")];
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(mark("k-live", "2026-03-08"), mark("k-live-2", "2026-03-06"));

    const result = await read();

    expect(result.marksStart).toBe("2026-03-06");
    const reads = marksReads();
    expect(reads).toHaveLength(1);
    expect(reads[0].eqs).toContainEqual({ column: "allocator_id", value: "user-1" });
    expect(idsOf(reads[0])).toEqual(["k-live", "k-live-2"]);
  });

  it("a key whose apply was refused publishes no start, so its raw marks never name the step (SFH F2)", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live"), liveKey("k-refused")];
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(mark("k-live", "2026-03-08"), {
      allocator_id: "user-1",
      kind: "key_inputs:k-refused",
      payload: { nav_mark_refusal: "mark_unit_mismatch" },
    });
    // The marks table holds an earlier day for the refused key; the curve never applied it.
    state.navMarks = [
      { allocator_id: "user-1", api_key_id: "k-refused", mark_day: "2026-02-01" },
      { allocator_id: "user-1", api_key_id: "k-live", mark_day: "2026-03-08" },
    ];

    const result = await read();

    expect(result.marksStart).toBe("2026-03-08");
    expect(chainAudit.entries.filter((e) => e.table === "api_key_nav_marks")).toHaveLength(0);
  });

  it("every included key refused: no start, whatever the marks table holds (SFH F2)", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-refused")];
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push({
      allocator_id: "user-1",
      kind: "key_inputs:k-refused",
      payload: { nav_mark_refusal: "mark_base_nonpositive" },
    });
    state.navMarks = [{ allocator_id: "user-1", api_key_id: "k-refused", mark_day: "2026-02-01" }];

    expect((await read()).marksStart).toBeNull();
  });

  it("another owner's earlier marks are never the answer (the explicit allocator filter)", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live")];
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(...[mark("k-live", "2026-03-08"), mark("k-live", "2026-01-02", "user-2")]);

    expect((await read()).marksStart).toBe("2026-03-08");
  });

  it("a departed key the owner excluded is outside the filter, so its earlier marks never name the step", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live"), departedKey("k-gone", { history_inclusion: "exclude" })];
    state.csvDailyReturns = returnsFor("k-gone", GONE_DAYS);
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(...[mark("k-live", "2026-03-08"), mark("k-gone", "2026-02-01")]);

    const result = await read();

    expect(idsOf(marksReads()[0])).toEqual(["k-live"]);
    expect(result.marksStart).toBe("2026-03-08");
  });

  it("a departed key the D-09 rule includes is in the filter, and its earlier mark names the step", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    // A distinct account of its own, history ends at its disconnect: the rule includes it.
    state.apiKeys = [liveKey("k-live"), departedKey("k-gone")];
    state.csvDailyReturns = returnsFor("k-gone", GONE_DAYS);
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(...[mark("k-live", "2026-03-08"), mark("k-gone", "2026-02-10")]);

    const result = await read();

    expect(idsOf(marksReads()[0])).toEqual(["k-gone", "k-live"]);
    expect(result.marksStart).toBe("2026-02-10");
  });

  it("a departed key with no returns days has nothing in the curve, so it is outside the filter", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live"), departedKey("k-gone")];
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(...[mark("k-live", "2026-03-08"), mark("k-gone", "2026-02-10")]);

    const result = await read();

    expect(idsOf(marksReads()[0])).toEqual(["k-live"]);
    expect(result.marksStart).toBe("2026-03-08");
  });

  it("departed_history_unavailable set and the earliest row on a departed key: null, the note fails closed", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live"), departedKey("k-gone")];
    state.csvDailyReturns = returnsFor("k-gone", GONE_DAYS);
    state.allocatorEquityDerived = [readyRow(["departed_history_unavailable"])];
    state.allocatorEquityDerived.push(...[mark("k-live", "2026-03-08"), mark("k-gone", "2026-02-10")]);

    const result = await read();

    // Positive control: the flag really reached the payload.
    expect(result.departedHistoryUnavailable).toBe(true);
    expect(result.marksStart).toBeNull();
  });

  it("the same flag with the earliest row on a live key names that key's day", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live"), departedKey("k-gone")];
    state.csvDailyReturns = returnsFor("k-gone", GONE_DAYS);
    state.allocatorEquityDerived = [readyRow(["departed_history_unavailable"])];
    state.allocatorEquityDerived.push(...[mark("k-live", "2026-02-10"), mark("k-gone", "2026-03-08")]);

    const result = await read();

    expect(result.departedHistoryUnavailable).toBe(true);
    expect(result.marksStart).toBe("2026-02-10");
  });

  // SFH-2 N1: the same rows publish `marks_trailing_since` when a key's marks stop
  // updating; the earliest across the drawn keys is named, under the same rules.
  const paused = (apiKeyId: string, marks_trailing_since: unknown) => ({
    allocator_id: "user-1",
    kind: `key_inputs:${apiKeyId}`,
    payload: { marks_since: "2026-03-01", marks_trailing_since } as Record<string, unknown>,
  });

  it("reads the earliest published paused-marks day across the included keys", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live"), liveKey("k-live-2"), liveKey("k-current")];
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(
      paused("k-live", "2026-03-12"),
      paused("k-live-2", "2026-03-09"),
      mark("k-current", "2026-03-02"),
    );

    const result = await read();

    expect(result.marksTrailingSince).toBe("2026-03-09");
    expect(result.marksStart).toBe("2026-03-01");
  });

  it("no key paused, or a malformed day: null", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live")];
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(mark("k-live", "2026-03-08"));
    expect((await read()).marksTrailingSince).toBeNull();

    resetState();
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live")];
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(paused("k-live", "2026-03-32"));
    expect((await read()).marksTrailingSince).toBeNull();
  });

  it("another owner's paused key and a departed key the owner excluded never name the day", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live"), departedKey("k-gone", { history_inclusion: "exclude" })];
    state.csvDailyReturns = returnsFor("k-gone", GONE_DAYS);
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(
      paused("k-live", "2026-03-12"),
      paused("k-gone", "2026-03-05"),
      { ...paused("k-live", "2026-03-02"), allocator_id: "user-2" },
    );

    expect((await read()).marksTrailingSince).toBe("2026-03-12");
  });

  it("departed_history_unavailable set and the earliest paused day on a departed key: null, fail closed", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live"), departedKey("k-gone")];
    state.csvDailyReturns = returnsFor("k-gone", GONE_DAYS);
    state.allocatorEquityDerived = [readyRow(["departed_history_unavailable"])];
    state.allocatorEquityDerived.push(paused("k-live", "2026-03-12"), paused("k-gone", "2026-03-05"));

    const result = await read();

    expect(result.departedHistoryUnavailable).toBe(true);
    expect(result.marksTrailingSince).toBeNull();
    // The start is judged on its own rows: both keys start the same day, the live one is first.
    expect(result.marksStart).toBe("2026-03-01");
  });

  it("a failed read is non-fatal: null, a reason-only warning, a Sentry capture, and the dashboard still returns", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live")];
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(...[mark("k-live", "2026-03-08")]);
    const failure = { message: "connection reset (test)" };
    state.tableErrors["allocator_equity_derived:key_inputs"] = failure;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sentry = await import("./sentry-capture");
    const captureSpy = vi.spyOn(sentry, "captureToSentry").mockImplementation(async () => {});

    const result = await read();

    expect(result.marksStart).toBeNull();
    expect(result.equityHistoryState).toBe("ready");
    expect(captureSpy).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        tags: expect.objectContaining({
          op: "getMyAllocationDashboard",
          reason: "nav_marks_start_read_failed",
        }),
      }),
    );
    expect(warnSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("key_inputs marks_since read failed");
    warnSpy.mockRestore();
    captureSpy.mockRestore();
  });

  it("no rows reads null; an empty included set makes no read at all", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live")];
    state.allocatorEquityDerived = [readyRow()];
    expect((await read()).marksStart).toBeNull();
    expect(marksReads()).toHaveLength(1);

    resetState();
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [];
    state.allocatorEquityDerived.push(...[mark("k-live", "2026-03-08")]);
    expect((await read()).marksStart).toBeNull();
    expect(marksReads()).toHaveLength(0);
  });

  it("the fresh-allocator branch (no portfolio) carries it too", async () => {
    state.portfolios = [];
    state.apiKeys = [liveKey("k-live")];
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(...[mark("k-live", "2026-03-06")]);

    expect((await read()).marksStart).toBe("2026-03-06");
  });

  it("a malformed stored day names no start (the one reader validates it)", async () => {
    state.portfolios = [P1151_PORTFOLIO];
    state.apiKeys = [liveKey("k-live")];
    state.allocatorEquityDerived = [readyRow()];
    state.allocatorEquityDerived.push(...[mark("k-live", "2026-02-30")]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await read()).marksStart).toBeNull();
  });
});
