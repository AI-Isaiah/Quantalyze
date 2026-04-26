import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Phase 10 / Plan 10-03 — Tests for GET /api/strategies/browse
 *
 * Coverage matrix:
 *   T1 — 401 when no authenticated user
 *   T2 — 200 + JSON body shape (id, alias, codename, markets, strategy_types)
 *   T3 — only status='published' rows are returned (route filters via .eq)
 *   T4 — alphabetical order by alias is honored from the upstream query
 *   T5 — empty list returns 200 with strategies: []
 *   T6 — rate limit: 6th call returns 429 + Retry-After header
 *   T7 — null/undefined markets / strategy_types collapse to [] (W2 defense)
 *   T8 — LIMIT 200 cap is honored (M10 — guards v0.16 strategy push)
 */

// audit + supabase server modules import "server-only" which throws under vitest.
vi.mock("server-only", () => ({}));

const STATE = vi.hoisted(() => ({
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  } as { id: string; email: string } | null,
  // Holds the rows returned by the supabase chain. The mock asserts the
  // .eq("status", "published") filter and the .order("alias", asc) call.
  strategyRows: [] as Array<Record<string, unknown>>,
  observedFilters: {
    status: null as string | null,
    orderColumn: null as string | null,
    orderAsc: null as boolean | null,
    limit: null as number | null,
  },
  checkLimitResult: { success: true, retryAfter: 0 } as {
    success: boolean;
    retryAfter: number;
  },
  rateLimitKey: null as string | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: STATE.authUser },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table !== "strategies") {
        throw new Error(`unexpected from(${table}) on user-scoped client`);
      }
      // Mirror the chained PostgREST builder. Each call captures the
      // observable side effect for assertion, then returns `this` so the
      // next chain link works.
      const builder = {
        select: (_cols: string) => builder,
        eq: (col: string, val: string) => {
          if (col === "status") STATE.observedFilters.status = val;
          return builder;
        },
        order: (
          col: string,
          opts: { ascending: boolean } = { ascending: true },
        ) => {
          STATE.observedFilters.orderColumn = col;
          STATE.observedFilters.orderAsc = opts.ascending;
          return builder;
        },
        limit: (n: number) => {
          STATE.observedFilters.limit = n;
          return Promise.resolve({
            data: STATE.strategyRows.slice(0, n),
            error: null,
          });
        },
        // Fallback if .limit is omitted (it shouldn't be — M10 cap is required).
        then: (
          resolve: (v: { data: unknown[]; error: null }) => unknown,
        ) => resolve({ data: STATE.strategyRows, error: null }),
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: { __mock: "userActionLimiter" },
  checkLimit: async (_limiter: unknown, key: string) => {
    STATE.rateLimitKey = key;
    return STATE.checkLimitResult;
  },
}));

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/strategies/browse", {
    method: "GET",
    headers: {
      origin: "http://localhost:3000",
    },
  });
}

beforeEach(() => {
  STATE.authUser = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  };
  STATE.strategyRows = [];
  STATE.observedFilters = {
    status: null,
    orderColumn: null,
    orderAsc: null,
    limit: null,
  };
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.rateLimitKey = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/strategies/browse", () => {
  it("T1 — 401 when no authenticated user", async () => {
    STATE.authUser = null;
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("T2 — 200 + body has strategies array with required fields", async () => {
    STATE.strategyRows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        alias: "Alpha Quant",
        codename: "AQ",
        markets: ["crypto"],
        strategy_types: ["mean-reversion"],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.strategies)).toBe(true);
    expect(body.strategies).toHaveLength(1);
    expect(body.strategies[0]).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      alias: "Alpha Quant",
      codename: "AQ",
      markets: ["crypto"],
      strategy_types: ["mean-reversion"],
    });
  });

  it("T3 — passes .eq('status','published') to the supabase chain", async () => {
    STATE.strategyRows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        alias: "A",
        codename: null,
        markets: [],
        strategy_types: [],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(STATE.observedFilters.status).toBe("published");
  });

  it("T4 — orders by alias ascending (alphabetical) — UI doesn't re-sort", async () => {
    STATE.strategyRows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        alias: "Alpha",
        codename: null,
        markets: [],
        strategy_types: [],
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        alias: "Bravo",
        codename: null,
        markets: [],
        strategy_types: [],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(STATE.observedFilters.orderColumn).toBe("alias");
    expect(STATE.observedFilters.orderAsc).toBe(true);
    const body = await res.json();
    expect(body.strategies.map((s: { alias: string }) => s.alias)).toEqual([
      "Alpha",
      "Bravo",
    ]);
  });

  it("T5 — empty list returns 200 + { strategies: [] } (NOT 404)", async () => {
    STATE.strategyRows = [];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies).toEqual([]);
  });

  it("T6 — rate-limited: 429 with Retry-After header + correct key", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 30 };
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = await res.json();
    expect(body.error).toBe("Too many requests");
    // Per-user key — Plan 10-03 specifies "strategies_browse:${user.id}"
    expect(STATE.rateLimitKey).toBe(
      "strategies_browse:00000000-0000-0000-0000-000000000001",
    );
  });

  it("T7 (W2) — null/undefined markets and strategy_types collapse to [] in response", async () => {
    STATE.strategyRows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        alias: "Edge",
        codename: null,
        markets: null,
        strategy_types: undefined,
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies[0].markets).toEqual([]);
    expect(body.strategies[0].strategy_types).toEqual([]);
  });

  it("T8 (M10) — LIMIT 200 cap: 250 published strategies → response has 200", async () => {
    STATE.strategyRows = Array.from({ length: 250 }, (_, i) => ({
      id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      alias: `Strategy ${String(i).padStart(3, "0")}`,
      codename: null,
      markets: ["crypto"],
      strategy_types: ["systematic"],
    }));
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(STATE.observedFilters.limit).toBe(200);
    const body = await res.json();
    expect(body.strategies).toHaveLength(200);
  });
});
