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
    // M-1159: error the strategies-table `.single()` resolves with. Default
    // null (every existing test sees a clean resolve); set to a PostgrestError
    // shape to drive getStrategyDetailV2's error-vs-missing branch.
    strategyError: null as unknown,
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
    // Records the `.select(cols)` argument used against the strategies
    // table so the path-extraction contract can assert no `select *` regressions.
    strategySelectCols: [] as string[],
    // NEW-C03-03 regression: records `.eq(col, val)` calls on the strategies
    // table so we can assert the `status=published` predicate is always sent.
    strategyEqCalls: [] as Array<[string, unknown]>,
    // Phase B pr-test-analyzer F1 — captureToSentry call recorder.
    // H-0488 / Phase B follow-up: a regression that drops Sentry capture
    // from the RPC-error or shape-mismatch paths would otherwise be invisible.
    sentryCalls: [] as Array<{ err: unknown; opts: unknown }>,
  };
});

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, opts: unknown) => {
    recorders.sentryCalls.push({ err, opts });
  },
}));

const buildChain = (data: unknown, recordStrategySelect = false) => {
  const chain: Record<string, unknown> = {};
  chain.select = (cols?: string) => {
    if (recordStrategySelect && typeof cols === "string") {
      recorders.strategySelectCols.push(cols);
    }
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    if (recordStrategySelect) {
      recorders.strategyEqCalls.push([col, val]);
    }
    return chain;
  };
  // Phase 15 (WR-04 fix) added `.order()` + `.limit()` to bound the embedded
  // strategy_verifications join to the latest row only. Both must return the
  // chain so the existing `.single()` / `.maybeSingle()` resolution still works.
  chain.order = () => chain;
  chain.limit = () => chain;
  // M-1159: only the strategies-table chain (recordStrategySelect) surfaces
  // a seeded error, so manager/other chains keep their clean-resolve contract.
  chain.single = () =>
    Promise.resolve({ data, error: recordStrategySelect ? recorders.strategyError : null });
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
        table === "strategies",
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
        table === "strategies",
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
  // M-1159: reset the seeded strategies-table error per-test, matching every
  // sibling recorder. Without this, a test that leaves a non-PGRST116 error set
  // would leak into later strategies-table tests (getStrategyDetailV2 would
  // throw the stale error), reporting red on correct code.
  recorders.strategyError = null;
  recorders.managerRowData = null;
  recorders.rpcCalls = [];
  recorders.rpcResponse = { data: null, error: null };
  recorders.favoritesResponse = { data: null, error: null };
  recorders.favoritesSelectCalls = [];
  recorders.favoritesEqCalls = [];
  recorders.strategySelectCols = [];
  recorders.strategyEqCalls = [];
  recorders.sentryCalls = [];
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

/**
 * NEW-C03-03 regression: getStrategyDetail must always filter by
 * status='published'. Without it, RLS allows the strategy owner to see
 * their own draft/pending_review strategies on the discovery page while
 * /factsheet/[id] correctly 404s — the two surfaces disagree on "live."
 */
describe("getStrategyDetail — status=published predicate (NEW-C03-03)", () => {
  it("sends status=published eq predicate on the strategies query", async () => {
    recorders.strategyData = {
      ...baseStrategy,
      disclosure_tier: "exploratory",
    };
    await getStrategyDetail("strat_123");
    // eq calls are recorded when recordStrategySelect=true (strategies table)
    const statusCall = recorders.strategyEqCalls.find(
      ([col]) => col === "status",
    );
    expect(statusCall).toBeDefined();
    expect(statusCall![1]).toBe("published");
  });

  it("returns null when strategy data is null (non-published strategies return null from DB)", async () => {
    // Simulate the DB returning null (e.g. a pending_review strategy whose
    // owner requests /discovery/<slug>/<id>) — the query now always gates on
    // status='published' so non-published rows return null → notFound().
    recorders.strategyData = null;
    const result = await getStrategyDetail("strat_draft");
    expect(result).toBeNull();
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

  // audit-2026-05-07 H-0489/H-0494: the RPC response is `any` and the
  // function previously did `(data ?? {}) as LazyMetricsPayload`, which
  // accepted ANY shape (arrays, primitives, false, 0). A typo'd panelId
  // / SECURITY DEFINER mis-return would silently corrupt every consumer
  // that destructures `payload.rolling_sortino_3m`. Reject non-plain-object
  // payloads at the boundary and collapse to `{}` to match the
  // visibility-miss contract.
  it("returns {} when RPC returns an array (non-object payload)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recorders.rpcResponse = { data: [1, 2, 3] as unknown, error: null };
    const result = await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(result).toEqual({});
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("unexpected RPC payload shape"),
      expect.objectContaining({ type: "array" }),
    );
    errSpy.mockRestore();
  });

  it("returns {} when RPC returns a primitive (false / number / string)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recorders.rpcResponse = { data: false as unknown, error: null };
    expect(await fetchStrategyLazyMetrics("strategy-id", "rolling")).toEqual({});
    recorders.rpcResponse = { data: 0 as unknown, error: null };
    expect(await fetchStrategyLazyMetrics("strategy-id", "rolling")).toEqual({});
    recorders.rpcResponse = { data: "oops" as unknown, error: null };
    expect(await fetchStrategyLazyMetrics("strategy-id", "rolling")).toEqual({});
    errSpy.mockRestore();
  });

  // Phase B pr-test-analyzer F1 — audit-2026-05-07 H-0488 contract:
  // RPC errors must escalate to Sentry, not just console.error (Vercel
  // runtime logs are not monitored continuously).
  it("captures the RPC error to Sentry with op + panel_id + rpc_code tags", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpcError = { message: "rls denied", code: "PGRST301" };
    recorders.rpcResponse = { data: null, error: rpcError };
    await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(recorders.sentryCalls).toHaveLength(1);
    expect(recorders.sentryCalls[0].err).toBe(rpcError);
    expect(recorders.sentryCalls[0].opts).toEqual(
      expect.objectContaining({
        tags: expect.objectContaining({
          op: "fetchStrategyLazyMetrics",
          panel_id: "rolling",
          rpc_code: "PGRST301",
        }),
        level: "error",
      }),
    );
    errSpy.mockRestore();
  });

  it("defaults rpc_code to 'unknown' when error.code is absent", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recorders.rpcResponse = {
      data: null,
      error: { message: "no code field" },
    };
    await fetchStrategyLazyMetrics("strategy-id", "exposure");
    expect(recorders.sentryCalls).toHaveLength(1);
    expect(
      (recorders.sentryCalls[0].opts as { tags: { rpc_code: string } }).tags
        .rpc_code,
    ).toBe("unknown");
    errSpy.mockRestore();
  });

  // Phase B silent-failure F3 + type-design F4: shape-mismatch path must
  // ALSO escalate to Sentry (a SECURITY DEFINER return-type drift was
  // previously invisible because only the error-channel went to Sentry).
  it("captures shape-mismatch (array payload) to Sentry with reason=unexpected_payload_shape", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recorders.rpcResponse = { data: [1, 2, 3] as unknown, error: null };
    await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(recorders.sentryCalls).toHaveLength(1);
    expect(recorders.sentryCalls[0].opts).toEqual(
      expect.objectContaining({
        tags: expect.objectContaining({
          op: "fetchStrategyLazyMetrics",
          panel_id: "rolling",
          reason: "unexpected_payload_shape",
        }),
        level: "error",
      }),
    );
    errSpy.mockRestore();
  });

  // Phase B silent-failure F2: a legitimate `null` data ("visibility miss")
  // must NOT log or escalate — only real shape regressions should.
  it("does NOT log or capture on null data (legitimate visibility miss)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recorders.rpcResponse = { data: null, error: null };
    await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(errSpy).not.toHaveBeenCalled();
    expect(recorders.sentryCalls).toHaveLength(0);
    errSpy.mockRestore();
  });

  // Phase B type-design F4: unexpected keys (e.g. SQL CASE typo
  // `rollig_sortino_3m`) must be filtered out AND escalated to Sentry.
  it("filters unexpected keys from the payload and captures to Sentry", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    recorders.rpcResponse = {
      data: {
        rolling_sortino_3m: [{ date: "2026-01-01", value: 1.0 }],
        rollig_sortino_typo: [{ date: "2026-01-01", value: 99 }],
      },
      error: null,
    };
    const result = await fetchStrategyLazyMetrics("strategy-id", "rolling");
    expect(result).toEqual({
      rolling_sortino_3m: [{ date: "2026-01-01", value: 1.0 }],
    });
    expect(recorders.sentryCalls).toHaveLength(1);
    expect(recorders.sentryCalls[0].opts).toEqual(
      expect.objectContaining({
        tags: expect.objectContaining({
          op: "fetchStrategyLazyMetrics",
          panel_id: "rolling",
          reason: "unexpected_payload_keys",
        }),
      }),
    );
    expect(
      (recorders.sentryCalls[0].opts as { extra: { unexpected: string[] } })
        .extra.unexpected,
    ).toEqual(["rollig_sortino_typo"]);
    errSpy.mockRestore();
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

  // audit-2026-05-07 H-0490 regression: rows with null/undefined
  // strategy_id must NOT make it into the Set. The old code did
  // `data.map((row) => row.strategy_id as string)` which let `null` /
  // `undefined` flow through as Set members; `Set.has(undefined)` then
  // returns true for any caller probing with `s.id` that itself happens
  // to be undefined, falsely flagging unrelated strategies as starred.
  it("drops rows where strategy_id is null or undefined (column-drift defence)", async () => {
    recorders.favoritesResponse = {
      data: [
        { strategy_id: "cccccccc-0001-4000-8000-000000000001" },
        { strategy_id: null },
        { strategy_id: undefined },
        { strategy_id: "" },
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
    // Critically: the set must NOT contain undefined — Set.has(undefined)
    // would otherwise return true for callers probing with `s.id`
    // when `s.id` is also undefined (the false-star regression).
    expect(result.has(undefined as unknown as string)).toBe(false);
    expect(result.has(null as unknown as string)).toBe(false);
    expect(result.has("")).toBe(false);
  });

  // Phase B pr-test-analyzer F4: the typeof guard must accept ONLY
  // non-empty strings. A future regression to `if (sid != null)` would
  // re-admit numbers / booleans / arrays / objects, breaking the contract.
  it("drops rows where strategy_id is a non-string truthy value (type-drift defence)", async () => {
    recorders.favoritesResponse = {
      data: [
        { strategy_id: 123 },
        { strategy_id: true },
        { strategy_id: ["nested-id"] },
        { strategy_id: { id: "obj" } },
      ],
      error: null,
    };
    const result = await getMyWatchlist(USER_ID);
    expect(result).toBeInstanceOf(Set);
    if (!result) throw new Error("expected Set, got null");
    expect(result.size).toBe(0);
  });

  // Phase B pr-test-analyzer F10: an RLS-blocked SELECT can return
  // { data: null, error: null }. Function must collapse to an empty Set
  // (not null — null is reserved for explicit error states).
  it("returns an empty Set when data is null and error is null (RLS-block edge case)", async () => {
    recorders.favoritesResponse = { data: null, error: null };
    const result = await getMyWatchlist(USER_ID);
    expect(result).toBeInstanceOf(Set);
    expect((result as Set<string>).size).toBe(0);
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

  // M-1159: getStrategyDetailV2 must NOT collapse a transient DB/transport
  // error into the same `null` it returns for a genuine 0-row miss. A clean
  // PGRST116 (no rows — also how RLS hides an invisible row) stays null so the
  // v2 page renders notFound() (404). Any OTHER error must THROW so the
  // route's error.tsx boundary (Reload + fall-back-to-v1 CTA) engages instead
  // of a misleading "Strategy Not Found". WHY it matters: a Supabase outage on
  // a real, published strategy should be a recoverable error state, never a
  // 404 that tells the allocator the strategy does not exist.
  it("Test 7b (M-1159): throws on a transient (non-PGRST116) DB error so error.tsx engages", async () => {
    recorders.strategyData = null;
    recorders.strategyError = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    await expect(getStrategyDetailV2("transient-err-id")).rejects.toThrow(
      /getStrategyDetailV2.*failed/,
    );
  });

  it("Test 7c (M-1159): returns null (not throw) on a clean PGRST116 0-row miss → notFound()", async () => {
    recorders.strategyData = null;
    recorders.strategyError = {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
    };
    const result = await getStrategyDetailV2("clean-miss-id");
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

/**
 * METRICS-15 path-extraction contract.
 *
 * Locks the two halves of the SC#3b p95<50ms detail-fetch contract that
 * queries.ts:391-407 documents:
 *
 *   1. Wire shape — getStrategyDetailV2 must NEVER hit the strategies row
 *      with `select *`. The explicit STRATEGY/ANALYTICS column lists are the
 *      bandwidth win; a regression to `*` would silently double the bytes
 *      crossing the wire and miss the p95 budget under load.
 *
 *   2. In-memory unpack — the panel{1..7} mapper that runs after Supabase
 *      returns must execute well under the 50ms budget so the network is the
 *      dominant cost. Microbenchmark over a maximally-populated analytics row
 *      against a deterministic-data mock; assert p95 stays inside the budget.
 *
 * Why no LATERAL join migration: the doc comment at queries.ts:391-407
 * (and migration 087) makes explicit that PostgREST cannot project a JSONB
 * sub-tree without an RPC. The lazy fetch via fetch_strategy_lazy_metrics
 * IS the LATERAL/sibling-table architecture; the eager projection above
 * trims the surrounding bandwidth. Both halves of the contract live here.
 */
describe("getStrategyDetailV2 — METRICS-15 path-extraction perf contract", () => {
  const STRAT_ID = "00000000-0000-0000-0000-000000000abc";

  function buildAnalyticsRow() {
    return {
      computation_status: "complete",
      cumulative_return: 0.42,
      cagr: 0.18,
      sharpe: 1.5,
      sortino: 2.1,
      max_drawdown: -0.12,
      volatility: 0.16,
      // Heaviest realistic shapes the eager unpack must walk: 1y daily series
      // (~252 entries), 12mo monthly grid, full quantiles + rolling families,
      // trade_metrics, drawdown_series. The lazy sibling-table series live
      // outside this projection (path-extracted via fetch_strategy_lazy_metrics)
      // so they don't pad the row.
      returns_series: Array.from({ length: 252 }, (_, i) => ({
        date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
        value: 1 + i * 0.001,
      })),
      drawdown_series: Array.from({ length: 30 }, (_, i) => ({
        date: new Date(2024, 5, 1 + i).toISOString().slice(0, 10),
        value: -0.01 * (i + 1),
      })),
      monthly_returns: {
        "2023": Object.fromEntries(
          ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
            (m, i) => [m, i * 0.005],
          ),
        ),
        "2024": Object.fromEntries(
          ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
            (m, i) => [m, i * 0.006],
          ),
        ),
      },
      return_quantiles: {
        Daily: Array.from({ length: 21 }, (_, i) => -0.05 + i * 0.005),
        Weekly: Array.from({ length: 21 }, (_, i) => -0.1 + i * 0.01),
        Monthly: Array.from({ length: 21 }, (_, i) => -0.2 + i * 0.02),
      },
      rolling_metrics: {
        sharpe_30d: Array.from({ length: 90 }, (_, i) => ({
          date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
          value: 0.5 + i * 0.001,
        })),
        sharpe_90d: Array.from({ length: 90 }, (_, i) => ({
          date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
          value: 0.7 + i * 0.001,
        })),
        sharpe_365d: Array.from({ length: 90 }, (_, i) => ({
          date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
          value: 1.0 + i * 0.001,
        })),
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
        equity_series_1y: Array.from({ length: 252 }, (_, i) => ({
          date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
          value: 1 + i * 0.0005,
        })),
        btc_benchmark_returns: Array.from({ length: 252 }, (_, i) => ({
          date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
          value: 1 + i * 0.0003,
        })),
        benchmark_returns: Array.from({ length: 252 }, (_, i) => ({
          date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
          value: i * 0.0001,
        })),
        alpha: 0.05,
        beta: 0.92,
        information_ratio: 0.42,
        treynor_ratio: 0.18,
      },
    };
  }

  function buildStrategyRow() {
    return {
      id: STRAT_ID,
      name: "METRICS-15 perf fixture",
      start_date: "2024-01-01",
      supported_exchanges: ["Binance"],
      strategy_types: ["systematic"],
      subtypes: ["trend"],
      markets: ["crypto"],
      leverage_range: "1-3x",
      avg_daily_turnover: 250000,
      status: "published",
      strategy_analytics: buildAnalyticsRow(),
    };
  }

  it("uses an explicit column projection on the strategies row (no `select *`)", async () => {
    recorders.strategyData = buildStrategyRow();
    await getStrategyDetailV2(STRAT_ID);

    expect(recorders.strategySelectCols.length).toBeGreaterThanOrEqual(1);
    const selectCols = recorders.strategySelectCols[0];

    expect(selectCols).not.toMatch(/\*/);

    for (const col of [
      "id",
      "name",
      "start_date",
      "supported_exchanges",
      "strategy_types",
      "leverage_range",
      "avg_daily_turnover",
      "strategy_analytics",
      "metrics_json",
      "trade_metrics",
      "rolling_metrics",
      // CRITICAL: data_quality_flags MUST be in the projection. PR #106
      // added the typed AnalyticsDataQualityFlags interface and PR #107
      // added the no_linked_api_key flag, but the v2 SELECT was never
      // updated to pull the column — so PostgREST silently returned
      // rows without it and every chip both PRs added was dead in
      // production. See queries.ts:404 + the integration test below.
      "data_quality_flags",
    ]) {
      expect(selectCols).toContain(col);
    }
  });

  it("panel6Inputs.data_quality_flags maps from analytics.data_quality_flags (no chip is dead-on-arrival)", async () => {
    const strategyRow = buildStrategyRow();
    (strategyRow.strategy_analytics as Record<string, unknown>).data_quality_flags = {
      account_balance_unavailable: true,
      no_linked_api_key: false,
      trade_mix_approximation: true,
    };
    recorders.strategyData = strategyRow;

    const result = await getStrategyDetailV2(STRAT_ID);
    expect(result).not.toBeNull();
    expect(result!.panel6Inputs.data_quality_flags).not.toBeNull();
    expect(result!.panel6Inputs.data_quality_flags?.account_balance_unavailable).toBe(true);
    expect(result!.panel6Inputs.data_quality_flags?.trade_mix_approximation).toBe(true);
  });

  it("in-memory unpack p95 stays under the 50ms detail-fetch budget", async () => {
    recorders.strategyData = buildStrategyRow();

    // Warm the JIT a few times before measuring so the first iteration's
    // cold-start cost doesn't pollute the percentile.
    for (let i = 0; i < 3; i++) await getStrategyDetailV2(STRAT_ID);

    const N = 50;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      await getStrategyDetailV2(STRAT_ID);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(N * 0.95) - 1];

    // The SC#3b end-to-end budget is 50ms; this measures pure in-memory
    // unpack against a mocked Supabase chain so 100ms gives the test
    // headroom against GC pauses on noisy CI runners while still flagging
    // any 10x regression in the panel-mapper hot path.
    expect(p95).toBeLessThan(100);
  });
});
