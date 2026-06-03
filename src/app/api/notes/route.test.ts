import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Phase 08 Plan 01 — /api/notes multi-scope tests.
 *
 * Covers the 4-scope {portfolio, holding, bridge_outcome, strategy} matrix
 * plus zod validation, 100KB byte-cap, audit emission metadata shape,
 * per-scope entity_id resolution (Research Finding #8), and the ON CONFLICT
 * onConflict string rebuild (Pitfall 2).
 *
 * Tests 7-13 come from Research Finding #11 (the mocked-Supabase subset of
 * the full RLS matrix; tests 1-6 + 14 live in the live-DB probe at
 * `src/__tests__/user-notes-multiscope-rls.test.ts`).
 *
 * V1 finding: Tests 10-11 assert that `supabase.from("strategies")` mock
 * received an `.eq("status", "published")` filter on the query chain. The
 * mock records every `.eq(col, val)` call via a spy and returns an
 * "unpublished" row ONLY when `.eq("status","published")` is NOT in the
 * chain. If the route forgets to apply the filter, Test 11 surfaces a 200
 * where 403 was expected.
 */

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// audit.ts schedules the RPC via next/server's `after()`. Pass through
// synchronously so emission is observable.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => {
      void cb();
    },
  };
});

const PORTFOLIO_ID = "pppppppp-pppp-4ppp-8ppp-pppppppppppp";
const OTHER_PORTFOLIO_ID = "qqqqqqqq-qqqq-4qqq-8qqq-qqqqqqqqqqqq";
const BRIDGE_OUTCOME_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_BRIDGE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STRATEGY_ID = "ssssssss-ssss-4sss-8sss-ssssssssssss";
const UNPUBLISHED_STRATEGY_ID = "uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuuu";
const HOLDING_SCOPE_REF = "binance:BTC:spot";
const OTHER_HOLDING_SCOPE_REF = "okx:ETHUSDT:derivative";

const { TEST_USER, mockFrom, mockRpc, authResult, rpcCalls } = vi.hoisted(
  () => {
    const user = { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" };
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    return {
      TEST_USER: user,
      mockFrom: vi.fn(),
      mockRpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: null, error: null };
      }),
      authResult: {
        data: { user: user as { id: string } | null },
        error: null,
      },
      rpcCalls: calls,
    };
  },
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => authResult,
    },
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

// M-1140/M-1141: the route now imports the rate limiter. Mock it so the
// existing tests keep the fail-OPEN passthrough (ok=true) and the new
// rate-limit tests can flip it to deny without touching Upstash.
const ratelimitState = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/ratelimit", () => ({
  notesUpsertLimiter: { __name: "notesUpsertLimiter" },
  checkLimit: async () =>
    ratelimitState.ok
      ? { success: true }
      : { success: false, retryAfter: 30 },
}));

function makeGetReq(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/notes");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: "GET" });
}

function makePatchReq(
  body: Record<string, unknown>,
  opts: { origin?: string | null } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  // Default to a same-origin localhost header so the CSRF guard
  // (assertSameOrigin) passes. Tests that exercise the guard explicitly
  // pass `origin: null` to omit the header.
  const origin = "origin" in opts ? opts.origin : "http://localhost:3000";
  if (origin) headers["origin"] = origin;

  return new NextRequest("http://localhost:3000/api/notes", {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Mock builders
// ---------------------------------------------------------------------------

/**
 * Build a portfolios ownership chain that returns `{data: owner ? row : null}`
 * for the .single() terminal.
 */
function portfoliosChain(owner: boolean, id: string = PORTFOLIO_ID) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: owner ? { id } : null,
            error: null,
          }),
          single: async () => ({
            data: owner ? { id } : null,
            error: owner ? null : { code: "PGRST116" },
          }),
        }),
      }),
    }),
  };
}

function holdingChain(match: boolean) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: match ? { id: "h-1" } : null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

function bridgeChain(owner: boolean, id: string = BRIDGE_OUTCOME_ID) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: owner ? { id } : null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

/**
 * Strategies chain that RECORDS each `.eq(col, val)` call (via eqSpy) and
 * returns a row only if `.eq("status","published")` was applied to the chain
 * (V1 finding). Use with `publishedReturnsRow=true` for the published case
 * and `publishedReturnsRow=false` for the unpublished case.
 *
 * The spy is exposed via the returned object's `.eqSpy` so tests can assert
 * the filter was applied.
 */
function strategiesChain(
  publishedReturnsRow: boolean,
): { chain: unknown; eqSpy: ReturnType<typeof vi.fn> } {
  const eqSpy = vi.fn();
  const chain = {
    select: () => {
      const ctx: Array<[string, unknown]> = [];
      const api: {
        eq: (col: string, val: unknown) => typeof api;
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      } = {
        eq(col, val) {
          eqSpy(col, val);
          ctx.push([col, val]);
          return api;
        },
        async maybeSingle() {
          const hasPublishedFilter = ctx.some(
            ([c, v]) => c === "status" && v === "published",
          );
          // If the route applied `.eq("status","published")` AND this fixture
          // returns rows for the published branch, yield a row. Otherwise
          // null — the route's `if (!data) return 403` triggers.
          if (hasPublishedFilter && publishedReturnsRow) {
            return { data: { id: STRATEGY_ID }, error: null };
          }
          return { data: null, error: null };
        },
      };
      return api;
    },
  };
  return { chain, eqSpy };
}

/**
 * user_notes upsert chain that records the `onConflict` option for
 * assertion. Returns a proxy that captures upsert args via a spy.
 */
function userNotesUpsertChain(): {
  chain: unknown;
  upsertSpy: ReturnType<typeof vi.fn>;
} {
  const upsertSpy = vi.fn();
  const chain = {
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict?: string } = {},
    ) => {
      upsertSpy(row, opts);
      return {
        select: () => ({
          single: async () => ({
            data: { updated_at: "2026-04-21T00:00:00Z" },
            error: null,
          }),
        }),
      };
    },
  };
  return { chain, upsertSpy };
}

function resetMocks() {
  vi.clearAllMocks();
  authResult.data = { user: TEST_USER };
  rpcCalls.length = 0;
  ratelimitState.ok = true;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe("GET /api/notes — multi-scope", () => {
  beforeEach(resetMocks);

  it("returns note content for valid portfolio scope_ref (new query shape)", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  content: "My portfolio note",
                  updated_at: "2026-04-21T00:00:00Z",
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    });

    const { GET } = await import("./route");
    const res = await GET(
      makeGetReq({ scope_kind: "portfolio", scope_ref: PORTFOLIO_ID }),
    );

    expect(res.status).toBe(200);
    // Block D / P1947: the GET success body is the caller's PRIVATE free-text
    // note. A shared cache keyed on the URL must not be able to serve it to
    // another tenant — the response must be private, no-store.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.content).toBe("My portfolio note");
    expect(body.updated_at).toBe("2026-04-21T00:00:00Z");
  });

  it("returns 404 when no note exists", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: null,
                error: { code: "PGRST116" },
              }),
            }),
          }),
        }),
      }),
    });

    const { GET } = await import("./route");
    const res = await GET(
      makeGetReq({ scope_kind: "portfolio", scope_ref: PORTFOLIO_ID }),
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 when scope_kind is missing", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeGetReq({ scope_ref: PORTFOLIO_ID }));

    expect(res.status).toBe(400);
  });

  it("returns 401 for unauthenticated user", async () => {
    authResult.data = { user: null };

    const { GET } = await import("./route");
    const res = await GET(
      makeGetReq({ scope_kind: "portfolio", scope_ref: PORTFOLIO_ID }),
    );

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH — happy paths
// ---------------------------------------------------------------------------

describe("PATCH /api/notes — 4-scope matrix + audit", () => {
  beforeEach(resetMocks);

  it("upserts portfolio-scope note and emits user_note.portfolio.update audit", async () => {
    const { chain: notesChain, upsertSpy } = userNotesUpsertChain();

    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") return portfoliosChain(true);
      if (table === "user_notes") return notesChain;
      throw new Error(`unexpected from(${table})`);
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq({
        scope_kind: "portfolio",
        scope_ref: PORTFOLIO_ID,
        content: "portfolio-note",
      }),
    );

    expect(res.status).toBe(200);
    // onConflict string is the new composite (Pitfall 2).
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [row, opts] = upsertSpy.mock.calls[0];
    expect(opts.onConflict).toBe("user_id,scope_kind,scope_ref");
    expect(row).toMatchObject({
      user_id: TEST_USER.id,
      scope_kind: "portfolio",
      scope_ref: PORTFOLIO_ID,
      content: "portfolio-note",
    });

    // Audit emission: action, entity_type, entity_id, metadata shape.
    const audit = rpcCalls.find(
      (c) => c.args.p_action === "user_note.portfolio.update",
    );
    expect(audit).toBeDefined();
    expect(audit!.args.p_entity_type).toBe("user_note");
    expect(audit!.args.p_entity_id).toBe(PORTFOLIO_ID);
    const meta = audit!.args.p_metadata as Record<string, unknown>;
    expect(meta.scope_kind).toBe("portfolio");
    expect(meta.scope_ref).toBe(PORTFOLIO_ID);
    expect(meta.content_length).toBe("portfolio-note".length);
    // D-20 privacy invariant: content is NEVER echoed.
    expect(meta.content).toBeUndefined();
  });

  it("upserts holding-scope note; entity_id = caller's user_id (Finding #8)", async () => {
    const { chain: notesChain } = userNotesUpsertChain();

    mockFrom.mockImplementation((table: string) => {
      if (table === "allocator_holdings") return holdingChain(true);
      if (table === "user_notes") return notesChain;
      throw new Error(`unexpected from(${table})`);
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq({
        scope_kind: "holding",
        scope_ref: HOLDING_SCOPE_REF,
        content: "holding-note",
      }),
    );

    expect(res.status).toBe(200);

    const audit = rpcCalls.find(
      (c) => c.args.p_action === "user_note.holding.update",
    );
    expect(audit).toBeDefined();
    expect(audit!.args.p_entity_type).toBe("user_note");
    // Finding #8: holding scope has no single entity row → entity_id = caller's id.
    expect(audit!.args.p_entity_id).toBe(TEST_USER.id);
    const meta = audit!.args.p_metadata as Record<string, unknown>;
    expect(meta.scope_kind).toBe("holding");
    expect(meta.scope_ref).toBe(HOLDING_SCOPE_REF);
    expect(meta.content).toBeUndefined();
  });

  it("upserts bridge_outcome-scope note; entity_id = scope_ref UUID", async () => {
    const { chain: notesChain } = userNotesUpsertChain();

    mockFrom.mockImplementation((table: string) => {
      if (table === "bridge_outcomes") return bridgeChain(true);
      if (table === "user_notes") return notesChain;
      throw new Error(`unexpected from(${table})`);
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq({
        scope_kind: "bridge_outcome",
        scope_ref: BRIDGE_OUTCOME_ID,
        content: "bridge-note",
      }),
    );

    expect(res.status).toBe(200);
    const audit = rpcCalls.find(
      (c) => c.args.p_action === "user_note.bridge_outcome.update",
    );
    expect(audit).toBeDefined();
    expect(audit!.args.p_entity_id).toBe(BRIDGE_OUTCOME_ID);
  });

  // --- Test 10 + V1 finding: published strategy ownership + filter spy ----
  it(
    "Test 10: PATCH strategy scope_ref of a PUBLISHED strategy → 200 " +
      "AND the mock's .eq spy records ('status','published') was applied",
    async () => {
      const { chain: notesChain } = userNotesUpsertChain();
      const { chain: stratChain, eqSpy } = strategiesChain(true);

      mockFrom.mockImplementation((table: string) => {
        if (table === "strategies") return stratChain;
        if (table === "user_notes") return notesChain;
        throw new Error(`unexpected from(${table})`);
      });

      const { PATCH } = await import("./route");
      const res = await PATCH(
        makePatchReq({
          scope_kind: "strategy",
          scope_ref: STRATEGY_ID,
          content: "strategy-note",
        }),
      );

      expect(res.status).toBe(200);

      // V1 assertion: the route MUST have applied .eq("status","published")
      // to the strategies chain.
      const statusPublishedCalled = eqSpy.mock.calls.some(
        ([col, val]) => col === "status" && val === "published",
      );
      expect(statusPublishedCalled).toBe(true);

      const audit = rpcCalls.find(
        (c) => c.args.p_action === "user_note.strategy.update",
      );
      expect(audit).toBeDefined();
      expect(audit!.args.p_entity_id).toBe(STRATEGY_ID);
    },
  );

  // --- Test 11 + V1 finding: unpublished strategy rejected; filter asserted
  it(
    "Test 11: PATCH strategy scope_ref of an UNPUBLISHED strategy → 403 " +
      "AND the mock verifies .eq('status','published') was still applied",
    async () => {
      const { chain: notesChain } = userNotesUpsertChain();
      // publishedReturnsRow=false — even if the route applies the filter,
      // the fixture yields no row, so ownership check must return 403.
      const { chain: stratChain, eqSpy } = strategiesChain(false);

      mockFrom.mockImplementation((table: string) => {
        if (table === "strategies") return stratChain;
        if (table === "user_notes") return notesChain;
        throw new Error(`unexpected from(${table})`);
      });

      const { PATCH } = await import("./route");
      const res = await PATCH(
        makePatchReq({
          scope_kind: "strategy",
          scope_ref: UNPUBLISHED_STRATEGY_ID,
          content: "strategy-note",
        }),
      );

      expect(res.status).toBe(403);

      // V1 assertion: the route MUST still apply the status=published
      // filter even on the unpublished path. This guards against a regression
      // where the route strips the filter "because it returned null either way."
      const statusPublishedCalled = eqSpy.mock.calls.some(
        ([col, val]) => col === "status" && val === "published",
      );
      expect(statusPublishedCalled).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// PATCH — ownership + validation failures (Research Finding #11 Tests 7-13)
// ---------------------------------------------------------------------------

describe("PATCH /api/notes — ownership + validation", () => {
  beforeEach(resetMocks);

  it("Test 7: PATCH portfolio scope_ref for another user's portfolio → 403", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") return portfoliosChain(false);
      throw new Error(`unexpected from(${table})`);
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq({
        scope_kind: "portfolio",
        scope_ref: OTHER_PORTFOLIO_ID,
        content: "x",
      }),
    );

    expect(res.status).toBe(403);
  });

  it("Test 8: PATCH holding scope_ref with no matching allocator_holdings → 403", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "allocator_holdings") return holdingChain(false);
      throw new Error(`unexpected from(${table})`);
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq({
        scope_kind: "holding",
        scope_ref: OTHER_HOLDING_SCOPE_REF,
        content: "x",
      }),
    );

    expect(res.status).toBe(403);
  });

  it("Test 9: PATCH bridge_outcome scope_ref for another user's outcome → 403", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "bridge_outcomes") return bridgeChain(false);
      throw new Error(`unexpected from(${table})`);
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq({
        scope_kind: "bridge_outcome",
        scope_ref: OTHER_BRIDGE_ID,
        content: "x",
      }),
    );

    expect(res.status).toBe(403);
  });

  it("Test 12: PATCH malformed holding scope_ref (2 parts) → 403", async () => {
    // Malformed holding scope_refs fail ownership (parseHoldingScopeRef
    // returns null → ownership check returns ok:false). Route responds 403
    // with a generic "Forbidden" per D-09 (no reason leak).
    mockFrom.mockImplementation((table: string) => {
      // Route short-circuits on parse failure before hitting the DB, but
      // guard any query just in case.
      if (table === "allocator_holdings") return holdingChain(false);
      throw new Error(`unexpected from(${table})`);
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq({
        scope_kind: "holding",
        scope_ref: "binance:BTC",
        content: "x",
      }),
    );

    expect(res.status).toBe(403);
  });

  it("Test 13: PATCH with scope_kind='foo' (invalid enum) → 400", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq({
        scope_kind: "foo",
        scope_ref: PORTFOLIO_ID,
        content: "x",
      }),
    );

    expect(res.status).toBe(400);
  });

  it("rejects content over 100KB with a 100 KB-limit error", async () => {
    const { PATCH } = await import("./route");
    const bigContent = "x".repeat(101 * 1024);
    const res = await PATCH(
      makePatchReq({
        scope_kind: "portfolio",
        scope_ref: PORTFOLIO_ID,
        content: bigContent,
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("100 KB");
  });

  it("returns 401 for unauthenticated user", async () => {
    authResult.data = { user: null };

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq({
        scope_kind: "portfolio",
        scope_ref: PORTFOLIO_ID,
        content: "x",
      }),
    );

    expect(res.status).toBe(401);
  });

  it("returns 403 when PATCH is sent without an Origin or Referer header (CSRF guard)", async () => {
    // The CSRF guard runs BEFORE auth, so this fails with 403 even though
    // the test user is authenticated. Mirrors the assertSameOrigin contract
    // used by every other mutating route in src/app/api/.
    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq(
        {
          scope_kind: "portfolio",
          scope_ref: PORTFOLIO_ID,
          content: "x",
        },
        { origin: null },
      ),
    );

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH — rate limit + body-size DoS guards (M-1140 / M-1141)
// ---------------------------------------------------------------------------

describe("PATCH /api/notes — rate limit + body-size guards (M-1140/M-1141)", () => {
  beforeEach(resetMocks);

  it("M-1140: returns 429 + Retry-After (no-store) when the per-user limiter denies", async () => {
    ratelimitState.ok = false;
    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq({
        scope_kind: "portfolio",
        scope_ref: PORTFOLIO_ID,
        content: "x",
      }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    // Deny path keeps the route's private/no-store contract.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    // The limiter must gate BEFORE any DB work — no ownership/upsert/audit ran.
    expect(rpcCalls).toHaveLength(0);
  });

  it("M-1140: limiter runs BEFORE the body parse — a denied request never reaches request.json()", async () => {
    // A malformed-JSON body returns 429 (limiter), not 400 (parse): proof the
    // limiter short-circuits before the route allocates the parse buffer, so an
    // abuser can't force the expensive path by spamming garbage bodies.
    ratelimitState.ok = false;
    const req = new NextRequest("http://localhost:3000/api/notes", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: "{ not valid json",
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(req);
    expect(res.status).toBe(429);
  });

  it("M-1141: an over-max content string is rejected at the Zod layer (before the byte-cap)", async () => {
    // 120_001 chars > z.string().max(120_000). Without the Zod max this body
    // would flow to the TextEncoder byte-cap and surface "100 KB"; WITH it,
    // Zod rejects first with the generic "Invalid body" — proving the
    // pre-allocation guard is in place.
    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq({
        scope_kind: "portfolio",
        scope_ref: PORTFOLIO_ID,
        content: "x".repeat(120_001),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid body");
  });

  it("M-1141: an oversized declared content-length returns 413 before parsing", async () => {
    const req = new NextRequest("http://localhost:3000/api/notes", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "content-length": String(300 * 1024), // > MAX_REQUEST_BYTES (200 KB)
      },
      body: JSON.stringify({
        scope_kind: "portfolio",
        scope_ref: PORTFOLIO_ID,
        content: "x",
      }),
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(req);

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe("Request body too large");
  });

  it("M-1141 regression: a body over the 100 KB byte-cap but under the Zod char-max still says '100 KB'", async () => {
    // Pins the chosen max(120_000): a 103,424-byte body must reach the
    // authoritative TextEncoder byte-cap (and its "100 KB" message), NOT be
    // swallowed by the coarse Zod char-limit as a generic "Invalid body".
    const { chain: notesChain } = userNotesUpsertChain();
    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") return portfoliosChain(true);
      if (table === "user_notes") return notesChain;
      throw new Error(`unexpected from(${table})`);
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      makePatchReq({
        scope_kind: "portfolio",
        scope_ref: PORTFOLIO_ID,
        content: "x".repeat(101 * 1024), // 103,424 bytes — over 100KB, under 120k chars
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("100 KB");
  });
});
