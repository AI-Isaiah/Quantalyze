import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Phase 10 / Plan 10-03 — Tests for GET /api/strategies/browse
 *
 * Coverage matrix:
 *   T1  — 401 when no authenticated user
 *   T2  — 200 + JSON body shape (id, name, codename, markets, strategy_types)
 *   T3  — only status='published' rows are returned (route filters via .eq)
 *   T4  — alphabetical order by name is honored from the upstream query
 *   T5  — empty list returns 200 with strategies: []
 *   T6  — rate limit: 6th call returns 429 + Retry-After header
 *   T7  — null/undefined markets / strategy_types collapse to [] (W2 defense)
 *   T8  — LIMIT 200 cap is honored (M10 — guards v0.16 strategy push)
 *   T9  — regression: selects name, not alias
 *   T10 — audit-2026-05-07 round-2 P1946: non-allocator caller → 403 +
 *         Cache-Control, supabase.strategies query NEVER fires
 *   T11 — audit-2026-05-07 round-2 P1947: every response shape carries
 *         `Cache-Control: private, no-store` (200 / 429 / 403)
 *
 * The supabase mock now also drives `from('profiles')` so withAllocatorAuth's
 * role lookup can be exercised end-to-end without mocking the helper itself.
 */

// audit + supabase server modules import "server-only" which throws under vitest.
vi.mock("server-only", () => ({}));

const STATE = vi.hoisted(() => ({
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  } as { id: string; email: string } | null,
  // withAllocatorAuth profile lookup: defaults to an allocator row so all
  // pre-existing happy-path tests pass without rewiring. T10 flips this to
  // 'manager' to exercise the 403 gate.
  profileRole: "allocator" as "allocator" | "both" | "manager" | null,
  // Holds the rows returned by the supabase chain. The mock asserts the
  // .eq("status", "published") filter and the .order("name", asc) call.
  strategyRows: [] as Array<Record<string, unknown>>,
  observedFilters: {
    status: null as string | null,
    orderColumn: null as string | null,
    orderAsc: null as boolean | null,
    limit: null as number | null,
    selectCols: null as string | null,
  },
  // Set to true whenever the supabase mock observes a call against the
  // strategies table. T10 asserts this stays FALSE after a 403 — the
  // allocator gate must short-circuit before the catalog query runs.
  strategiesQueried: false,
  checkLimitResult: { success: true, retryAfter: 0 } as {
    success: boolean;
    retryAfter: number;
  },
  rateLimitKey: null as string | null,
  // Round-2-D pr-test-analyzer M6: when set, the strategies query
  // resolves with this error so the route's 500 branch + Cache-Control
  // header can be pinned.
  strategyQueryError: null as { code: string; message: string } | null,
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
      if (table === "profiles") {
        // withAllocatorAuth role lookup chain:
        //   supabase.from('profiles').select('role').eq('id', uid).maybeSingle()
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  STATE.profileRole === null
                    ? null
                    : { role: STATE.profileRole },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table !== "strategies") {
        throw new Error(`unexpected from(${table}) on user-scoped client`);
      }
      STATE.strategiesQueried = true;
      // Mirror the chained PostgREST builder. Each call captures the
      // observable side effect for assertion, then returns `this` so the
      // next chain link works.
      const builder = {
        select: (cols: string) => {
          STATE.observedFilters.selectCols = cols;
          return builder;
        },
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
          if (STATE.strategyQueryError) {
            return Promise.resolve({
              data: null,
              error: STATE.strategyQueryError,
            });
          }
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
  STATE.profileRole = "allocator";
  STATE.strategyRows = [];
  STATE.observedFilters = {
    status: null,
    orderColumn: null,
    orderAsc: null,
    limit: null,
    selectCols: null,
  };
  STATE.strategiesQueried = false;
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.rateLimitKey = null;
  STATE.strategyQueryError = null;
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

  it("T2 — 200 + body has strategies array with required fields (institutional tier preserves real name)", async () => {
    // Audit C-0112 — institutional rows are the only tier permitted to
    // surface the real `strategies.name`. Pin that path here.
    STATE.strategyRows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Alpha Quant",
        codename: "AQ",
        disclosure_tier: "institutional",
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
      name: "AQ",
      codename: "AQ",
      markets: ["crypto"],
      strategy_types: ["mean-reversion"],
    });
  });

  it("T3 — passes .eq('status','published') to the supabase chain", async () => {
    STATE.strategyRows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "A",
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

  it("T4 — orders by name ascending (alphabetical) — UI doesn't re-sort", async () => {
    // Audit C-0112 — institutional + no-codename rows are the only path
    // that round-trips the real strategies.name to the response. Pin the
    // alphabetical-order contract on that path so the assertion is
    // meaningful (exploratory-tier rows would collapse to synthetic
    // `Strategy #<id>` labels and stop testing the order contract).
    STATE.strategyRows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Alpha",
        codename: null,
        disclosure_tier: "institutional",
        markets: [],
        strategy_types: [],
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Bravo",
        codename: null,
        disclosure_tier: "institutional",
        markets: [],
        strategy_types: [],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(STATE.observedFilters.orderColumn).toBe("name");
    expect(STATE.observedFilters.orderAsc).toBe(true);
    const body = await res.json();
    expect(body.strategies.map((s: { name: string }) => s.name)).toEqual([
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
        name: "Edge",
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

  it("T9 (regression) — selects strategies.name, not strategies.alias (alias lives on portfolio_strategies)", async () => {
    // Regression for: GET /api/strategies/browse 500
    //   "column strategies.alias does not exist"
    // Found by /qa on 2026-04-26 against live dev DB. Drawer showed
    // "Couldn't load strategies — close and reopen the drawer."
    // Root cause: route selected `alias` from `strategies`, but `alias`
    // lives on `portfolio_strategies` (per-allocator override, migration
    // 025). The strategies catalog uses `name` (initial schema) +
    // `codename` (migration 014).
    STATE.strategyRows = [];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const cols = STATE.observedFilters.selectCols ?? "";
    expect(cols).toContain("name");
    expect(cols).not.toContain("alias");
    expect(STATE.observedFilters.orderColumn).toBe("name");
  });

  it("T8 (M10 + M-0343) — 250 published strategies → 200 rows, has_more:true, probe LIMIT+1", async () => {
    STATE.strategyRows = Array.from({ length: 250 }, (_, i) => ({
      id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      name: `Strategy ${String(i).padStart(3, "0")}`,
      codename: null,
      markets: ["crypto"],
      strategy_types: ["systematic"],
    }));
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    // M-0343: fetch one past the cap (the probe row) to detect truncation.
    expect(STATE.observedFilters.limit).toBe(201);
    const body = await res.json();
    // Page is sliced back to the cap; the probe row is never returned.
    expect(body.strategies).toHaveLength(200);
    // The truncation signal + self-describing cap the client can act on.
    expect(body.has_more).toBe(true);
    expect(body.limit).toBe(200);
  });

  it("T8b (M-0343) — under the cap: 50 strategies → has_more:false, full page", async () => {
    STATE.strategyRows = Array.from({ length: 50 }, (_, i) => ({
      id: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`,
      name: `Strategy ${String(i).padStart(3, "0")}`,
      codename: null,
      markets: ["crypto"],
      strategy_types: ["systematic"],
    }));
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies).toHaveLength(50);
    expect(body.has_more).toBe(false);
    expect(body.limit).toBe(200);
  });

  // ============================================================
  // T10 — audit-2026-05-07 round-2 P1946: allocator gate
  // ============================================================
  it("T10 — non-allocator caller (role='manager') → 403 + Cache-Control, strategies query NEVER fires", async () => {
    STATE.profileRole = "manager";
    const { GET } = await import("./route");
    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toMatch(/allocator/i);

    // Critical: the catalog query must NOT have run. The gate is upstream
    // of the handler — strategies metadata must not leak by accident.
    expect(STATE.strategiesQueried).toBe(false);
  });

  it("T10b — missing profile → 403 + Cache-Control", async () => {
    STATE.profileRole = null;
    const { GET } = await import("./route");
    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(STATE.strategiesQueried).toBe(false);
  });

  it("T10c — role='both' (manager+allocator) → 200 (the gate admits both)", async () => {
    STATE.profileRole = "both";
    STATE.strategyRows = [];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(STATE.strategiesQueried).toBe(true);
  });

  // ============================================================
  // T11 — audit-2026-05-07 round-2 P1947: Cache-Control headers
  // ============================================================
  it("T11a — 200 happy-path response carries Cache-Control: private, no-store", async () => {
    STATE.strategyRows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Alpha",
        codename: null,
        markets: ["crypto"],
        strategy_types: ["systematic"],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T11b — 429 rate-limit response carries Cache-Control AND Retry-After", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 9 };
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("9");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("T11c — 500 supabase-error response carries Cache-Control (round-2-D pr-test-analyzer M6)", async () => {
    STATE.strategyQueryError = { code: "PGRST500", message: "boom" };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    consoleSpy.mockRestore();
  });

  // ============================================================
  // T12 — audit-2026-05-07 C-0112: codename+name pair leak
  //
  // Before this fix the route projected the raw strategies.name column
  // for EVERY row, regardless of disclosure_tier. Because the drawer
  // searches case-insensitively over both `name` and `codename`, a
  // caller who knows a real strategy name (e.g. from a SEC filing, a
  // Twitter mention, the manager's own bio) could query the drawer and
  // see which codename it maps to — defeating pseudonymity for the
  // entire verified catalog. The fix replaces the response `name` with
  // `displayStrategyName(...)`, which surfaces the real name ONLY when
  // `disclosure_tier === 'institutional'`.
  // ============================================================
  it("T12a — exploratory tier + codename present → response name === codename (real name suppressed)", async () => {
    STATE.strategyRows = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Renaissance Medallion",
        codename: "Sigma-7",
        disclosure_tier: "exploratory",
        markets: ["crypto"],
        strategy_types: ["systematic"],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies).toHaveLength(1);
    // The pseudonymity contract: the response label is the codename, NOT
    // the real strategy name. A drawer search for "Renaissance" must NOT
    // find this row, because the row never carries the string
    // "Renaissance" anywhere on the wire.
    expect(body.strategies[0].name).toBe("Sigma-7");
    expect(body.strategies[0].codename).toBe("Sigma-7");
    expect(JSON.stringify(body)).not.toContain("Renaissance");
    expect(JSON.stringify(body)).not.toContain("Medallion");
  });

  it("T12b — exploratory tier + no codename → response name === 'Strategy #<id-prefix>' (real name suppressed)", async () => {
    STATE.strategyRows = [
      {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Bridgewater Pure Alpha",
        codename: null,
        disclosure_tier: "exploratory",
        markets: ["fx"],
        strategy_types: ["macro"],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    // No codename on an exploratory row → fall back to the synthetic
    // `Strategy #<id-prefix>` label rather than leaking the real name.
    expect(body.strategies[0].name).toBe("Strategy #44444444");
    expect(JSON.stringify(body)).not.toContain("Bridgewater");
    expect(JSON.stringify(body)).not.toContain("Pure Alpha");
  });

  it("T12c — institutional tier → real strategies.name surfaces ONLY when codename is absent", async () => {
    // Institutional managers have opted into open identity, so the real
    // name is the legitimate label. But `displayStrategyName` still
    // prefers codename when one is set — pin both cases.
    STATE.strategyRows = [
      {
        id: "55555555-5555-4555-8555-555555555555",
        name: "Two Sigma Equity Long-Short",
        codename: null,
        disclosure_tier: "institutional",
        markets: ["equity"],
        strategy_types: ["long-short"],
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        name: "Citadel Wellington",
        codename: "Wellington-1",
        disclosure_tier: "institutional",
        markets: ["multi"],
        strategy_types: ["multi-strategy"],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies[0].name).toBe("Two Sigma Equity Long-Short");
    // Codename still wins on institutional rows so the UI renders a
    // single canonical label.
    expect(body.strategies[1].name).toBe("Wellington-1");
    expect(body.strategies[1].codename).toBe("Wellington-1");
  });

  it("T12d — missing/null disclosure_tier defaults to exploratory (fail-closed)", async () => {
    // Legacy rows or partial-import rows may have a NULL
    // disclosure_tier. The route MUST treat those as exploratory, not
    // accidentally elevate them to institutional and leak the name.
    STATE.strategyRows = [
      {
        id: "77777777-7777-4777-8777-777777777777",
        name: "Legacy Hedge Fund 2007",
        codename: null,
        // disclosure_tier intentionally omitted
        markets: ["equity"],
        strategy_types: ["long-short"],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies[0].name).toBe("Strategy #77777777");
    expect(JSON.stringify(body)).not.toContain("Legacy Hedge Fund");
  });

  it("T12e — SELECT list co-fetches disclosure_tier (so the mapping has the data it needs)", async () => {
    // Belt-and-braces: if a future refactor drops disclosure_tier from
    // the SELECT list, the route would silently default every row to
    // 'exploratory' and synthesize labels for institutional rows too —
    // not a security regression, but a UX one. Pin the SELECT shape.
    STATE.strategyRows = [];
    const { GET } = await import("./route");
    await GET(makeRequest());
    const cols = STATE.observedFilters.selectCols ?? "";
    expect(cols).toContain("disclosure_tier");
    expect(cols).toContain("codename");
    expect(cols).toContain("name");
  });

  // ============================================================
  // H-0300 — response-payload allow-list / forbidden-key fence
  //
  // The route co-fetches `disclosure_tier` (and could, after a future
  // copy-paste, co-fetch backtest stats) purely to drive the name-
  // redaction projection. The PROJECTION must strip everything except
  // the five BrowseStrategyRow keys. The existing T12 tests pin the
  // NAME redaction, but none asserts the response object's key SET — so
  // a regression that spread `...row` (or added `disclosure_tier` /
  // `backtest_returns` to the emitted object) would leak silently. These
  // tests pin the exhaustive allow-list and the forbidden-key absence.
  // ============================================================
  it("H-0300a — emitted strategy objects expose ONLY the BrowseStrategyRow allow-list", async () => {
    STATE.strategyRows = [
      {
        id: "88888888-8888-4888-8888-888888888888",
        name: "Two Sigma Equity",
        codename: "TS-Eq",
        disclosure_tier: "institutional",
        markets: ["equity"],
        strategy_types: ["long-short"],
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strategies).toHaveLength(1);

    const ALLOWED = ["id", "name", "codename", "markets", "strategy_types"].sort();
    expect(Object.keys(body.strategies[0]).sort()).toEqual(ALLOWED);
    // Explicit forbidden-key fence — disclosure_tier is fetched but must
    // never reach the wire.
    expect(body.strategies[0]).not.toHaveProperty("disclosure_tier");
  });

  it("H-0300b — an extra sensitive column on the source row does NOT leak into the response", async () => {
    // Model a future copy-paste that adds `backtest_returns` (and a stray
    // `user_id`) to the SELECT. Because the route projects an explicit
    // allow-list rather than spreading the row, these MUST be dropped. If
    // a regression switched to `{ ...row, name: safeLabel }`, this fails.
    STATE.strategyRows = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        name: "Citadel Wellington",
        codename: "W-1",
        disclosure_tier: "institutional",
        markets: ["multi"],
        strategy_types: ["multi-strategy"],
        backtest_returns: [0.12, 0.34, 0.56],
        user_id: "secret-owner-uuid",
      },
    ];
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.strategies[0]).not.toHaveProperty("backtest_returns");
    expect(body.strategies[0]).not.toHaveProperty("user_id");
    expect(body.strategies[0]).not.toHaveProperty("disclosure_tier");
    // Whole-payload sweep — none of the sensitive values appear anywhere.
    expect(JSON.stringify(body)).not.toContain("secret-owner-uuid");
    expect(JSON.stringify(body)).not.toContain("0.34");
  });
});
