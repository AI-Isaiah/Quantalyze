import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for trades/upload cross-user write protection (MEDIUM-05).
 *
 * Validates:
 *   1. Rejects unauthenticated requests with 401.
 *   2. Rejects uploads to a strategy not owned by the caller (403).
 *   3. Rejects rows that try to set strategy_id to a different strategy.
 *   4. Strips disallowed columns (user_id, id, created_at) from trade rows.
 *   5. Happy path: inserts sanitized rows for owned strategies.
 */

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// audit.ts uses next/server's `after()` — pass through synchronously.
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

const ownedStrategyId = "strat-owned-001";
const otherStrategyId = "strat-other-002";

const authUser = vi.hoisted(() => ({
  id: "user-001",
  email: "trader@example.com",
}));

const supabaseState = vi.hoisted(
  (): {
    insertedBatches: Array<Record<string, unknown>[]>;
    // C-0121: capture log_audit_event RPC calls so the rollup contract
    // (one event per upload, NOT one per batch) is observable.
    rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
    // M-0356(d): error returned on the Nth (0-indexed) trades.insert call.
    // -1 = never error. Lets a test fail the SECOND batch after the first
    // succeeds, exercising the partial-`inserted`-count 500 branch.
    insertErrorOnBatch: number;
    // M-0356(e): when true, the log_audit_event RPC throws (transient infra
    // blip) — proving the fire-and-forget audit never fails the 200.
    auditRpcThrows: boolean;
  } => ({
    insertedBatches: [],
    rpcCalls: [],
    insertErrorOnBatch: -1,
    auditRpcThrows: false,
  }),
);

// M-0356(f): togglable rate-limit result. Hoisted so the module-level mock
// can read it; toggled per test (keys/sync pattern).
const rateLimitState = vi.hoisted(
  (): { result: { success: boolean; retryAfter: number } } => ({
    result: { success: true, retryAfter: 0 },
  }),
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: authUser },
        error: null,
      }),
    },
    // log_audit_event RPC capture — record every audit emission so the
    // rollup contract (C-0121: ONE event per upload, not one per batch)
    // is asserted, not just stubbed.
    rpc: async (name: string, args: Record<string, unknown>) => {
      supabaseState.rpcCalls.push({ name, args });
      if (name === "log_audit_event" && supabaseState.auditRpcThrows) {
        // Transient-class failure — emit() swallows it (no rethrow).
        throw new TypeError("fetch failed");
      }
      return { data: null, error: null };
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "strategies") {
        return {
          select: () => ({
            eq: (_field: string, value: string) => ({
              eq: (_field2: string, value2: string) => ({
                single: async () => {
                  // Only return a strategy if it matches the owned user+strategy pair
                  if (value === ownedStrategyId && value2 === authUser.id) {
                    return { data: { id: ownedStrategyId, user_id: authUser.id }, error: null };
                  }
                  return { data: null, error: { message: "Not found" } };
                },
              }),
            }),
          }),
        };
      }
      if (table === "trades") {
        return {
          insert: (batch: Record<string, unknown>[]) => {
            const idx = supabaseState.insertedBatches.length;
            supabaseState.insertedBatches.push(batch);
            if (idx === supabaseState.insertErrorOnBatch) {
              return {
                error: { message: "duplicate key value violates unique constraint" },
              };
            }
            return { error: null };
          },
        };
      }
      return {};
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => rateLimitState.result,
}));

function makeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = { origin: "http://localhost:3000" },
): NextRequest {
  return new NextRequest("http://localhost:3000/api/trades/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/trades/upload — cross-user write protection", () => {
  beforeEach(() => {
    supabaseState.insertedBatches = [];
    supabaseState.rpcCalls = [];
    supabaseState.insertErrorOnBatch = -1;
    supabaseState.auditRpcThrows = false;
    rateLimitState.result = { success: true, retryAfter: 0 };
  });

  it("rejects requests without auth (CSRF check fires first)", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ strategy_id: ownedStrategyId, trades: [] }, {}));
    // withAuth checks CSRF first on POST — missing Origin → 403
    expect(res.status).toBe(403);
    expect(supabaseState.insertedBatches).toHaveLength(0);
  });

  it("rejects upload to a strategy not owned by the caller", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        strategy_id: otherStrategyId,
        trades: [{ timestamp: "2024-01-01T00:00:00Z", symbol: "BTC", side: "buy", price: 100, quantity: 1 }],
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("not owned");
    expect(supabaseState.insertedBatches).toHaveLength(0);
  });

  it("rejects rows that try to set strategy_id to a different strategy", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        strategy_id: ownedStrategyId,
        trades: [
          {
            strategy_id: otherStrategyId,
            timestamp: "2024-01-01T00:00:00Z",
            symbol: "BTC",
            side: "buy",
            price: 100,
            quantity: 1,
          },
        ],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("strategy_id must match");
    expect(supabaseState.insertedBatches).toHaveLength(0);
  });

  it("strips disallowed columns (id, user_id, created_at) from rows", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        strategy_id: ownedStrategyId,
        trades: [
          {
            id: "attacker-id",
            user_id: "attacker-user",
            created_at: "2020-01-01",
            timestamp: "2024-01-01T00:00:00Z",
            symbol: "BTC",
            side: "buy",
            price: 100,
            quantity: 1,
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(supabaseState.insertedBatches).toHaveLength(1);
    const insertedRow = supabaseState.insertedBatches[0][0];
    // Server-set fields
    expect(insertedRow.strategy_id).toBe(ownedStrategyId);
    expect(insertedRow.user_id).toBe(authUser.id);
    // Attacker fields must be stripped
    expect(insertedRow.id).toBeUndefined();
    expect(insertedRow.created_at).toBeUndefined();
  });

  it("inserts sanitized rows for an owned strategy", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        strategy_id: ownedStrategyId,
        trades: [
          { timestamp: "2024-01-01T00:00:00Z", symbol: "BTC", side: "buy", price: 100, quantity: 1 },
          { timestamp: "2024-01-02T00:00:00Z", symbol: "ETH", side: "sell", price: 50, quantity: 2 },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(2);
    expect(body.strategy_id).toBe(ownedStrategyId);
    expect(supabaseState.insertedBatches).toHaveLength(1);
    expect(supabaseState.insertedBatches[0]).toHaveLength(2);
  });

  // ── M-0356: validation + partial-failure + rate-limit branches ────────
  it("M-0356(a) — returns 400 when trades.length > 5000", async () => {
    const trades = Array.from({ length: 5001 }, () => ({
      timestamp: "2024-01-01T00:00:00Z",
      symbol: "BTC",
      side: "buy",
      price: 100,
      quantity: 1,
    }));
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ strategy_id: ownedStrategyId, trades }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/5,?000/);
    // The cap rejects BEFORE the ownership query / inserts.
    expect(supabaseState.insertedBatches).toHaveLength(0);
  });

  it("M-0356(b) — returns 400 when a row is an array (not an object)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        strategy_id: ownedStrategyId,
        // sanitizeTradeRow rejects Array.isArray rows (route.ts:34).
        trades: [[1, 2, 3]],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid trade at index 0/);
    expect(supabaseState.insertedBatches).toHaveLength(0);
  });

  it("M-0356(c) — returns 400 when a row has no timestamp", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        strategy_id: ownedStrategyId,
        // No timestamp → sanitizeTradeRow returns null (route.ts:53).
        trades: [{ symbol: "BTC", side: "buy", price: 100, quantity: 1 }],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/at least a timestamp/);
    expect(supabaseState.insertedBatches).toHaveLength(0);
  });

  it("M-0356(d) — returns 500 with the partial `inserted` count when a later batch insert errors", async () => {
    // 600 rows → 2 batches at batchSize=500. Fail the SECOND batch (index 1)
    // after the first (500 rows) succeeded. The route must return 500 with
    // inserted=500 (the partial count), NOT swallow the error.
    supabaseState.insertErrorOnBatch = 1;
    const trades = Array.from({ length: 600 }, (_, i) => ({
      timestamp: new Date(2024, 0, 1 + (i % 28)).toISOString(),
      symbol: "BTC",
      side: "buy",
      price: 100 + i,
      quantity: 1,
    }));
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ strategy_id: ownedStrategyId, trades }));
    expect(res.status).toBe(500);
    const body = await res.json();
    // First batch (500) committed before the second errored.
    expect(body.inserted).toBe(500);
    expect(body.error).toMatch(/Insert failed at row 500/);
    // No rollup audit on a failed upload (the emit is below the loop).
    expect(
      supabaseState.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });

  it("M-0356(e) — a failing (fire-and-forget) audit RPC must NOT fail the 200 OK upload", async () => {
    supabaseState.auditRpcThrows = true;
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        strategy_id: ownedStrategyId,
        trades: [
          { timestamp: "2024-01-01T00:00:00Z", symbol: "BTC", side: "buy", price: 100, quantity: 1 },
        ],
      }),
    );
    // Insert succeeded; audit is fire-and-forget → response stays 200.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(1);
    // The audit emission WAS attempted (and threw inside emit()).
    expect(
      supabaseState.rpcCalls.some((c) => c.name === "log_audit_event"),
    ).toBe(true);
  });

  it("M-0356(f) — returns 429 with Retry-After when the rate limiter denies the request", async () => {
    rateLimitState.result = { success: false, retryAfter: 30 };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        strategy_id: ownedStrategyId,
        trades: [
          { timestamp: "2024-01-01T00:00:00Z", symbol: "BTC", side: "buy", price: 100, quantity: 1 },
        ],
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = await res.json();
    expect(body.error).toBe("Too many requests");
    // Rate-limit short-circuits before any insert.
    expect(supabaseState.insertedBatches).toHaveLength(0);
  });
});

// ─── C-0121: trades.upload rollup audit emission ───────────────────────
// The route batches inserts at batchSize=500 (route.ts:105). The audit
// emission contract is one ROLLUP event per upload call (not one per
// batch) — this is the explicit @audit-skip rationale in route.ts:110-112
// (per-batch insert) + the single logAuditEvent call after the loop.
// A regression that moved the emission INSIDE the batch loop would
// O(N) the audit table for large uploads — a 5,000-row upload at the
// max cap would write 10 audit rows. These tests pin the rollup
// contract: exactly ONE event, metadata.inserted = sanitized row
// count, metadata.batches = ceil(inserted / 500).
describe("POST /api/trades/upload — C-0121 rollup audit emission", () => {
  beforeEach(() => {
    supabaseState.insertedBatches = [];
    supabaseState.rpcCalls = [];
    supabaseState.insertErrorOnBatch = -1;
    supabaseState.auditRpcThrows = false;
    rateLimitState.result = { success: true, retryAfter: 0 };
  });

  it("emits exactly ONE trades.upload audit row regardless of batch count", async () => {
    // 1,500 rows → 3 batches at batchSize=500. If the audit emission
    // moved inside the loop, we'd see 3 log_audit_event RPC calls; the
    // rollup contract requires exactly 1.
    const trades = Array.from({ length: 1500 }, (_, i) => ({
      timestamp: new Date(2024, 0, 1 + (i % 28)).toISOString(),
      symbol: "BTC",
      side: i % 2 === 0 ? "buy" : "sell",
      price: 100 + i,
      quantity: 1,
    }));

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ strategy_id: ownedStrategyId, trades }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(1500);

    // 3 insert batches recorded — proves the loop ran.
    expect(supabaseState.insertedBatches).toHaveLength(3);

    // Exactly ONE audit emission for the entire upload.
    const auditCalls = supabaseState.rpcCalls.filter(
      (c) => c.name === "log_audit_event",
    );
    expect(auditCalls).toHaveLength(1);

    // Shape pinned: action, entity_type, entity_id, metadata.{inserted,batches}.
    const event = auditCalls[0].args;
    expect(event.p_action).toBe("trades.upload");
    expect(event.p_entity_type).toBe("strategy");
    expect(event.p_entity_id).toBe(ownedStrategyId);
    expect(event.p_metadata).toMatchObject({
      inserted: 1500,
      batches: 3,
    });
  });

  it("does NOT emit any trades.upload audit on the cross-tenant 403 path", async () => {
    // Ownership check rejects → 403 before the insert loop. The audit
    // emission lives below the loop, so it shouldn't fire — but pin it
    // explicitly so a regression that moved the emit above the loop is
    // caught.
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        strategy_id: otherStrategyId,
        trades: [
          { timestamp: "2024-01-01T00:00:00Z", symbol: "BTC", side: "buy", price: 100, quantity: 1 },
        ],
      }),
    );
    expect(res.status).toBe(403);

    const auditCalls = supabaseState.rpcCalls.filter(
      (c) => c.name === "log_audit_event",
    );
    expect(auditCalls).toHaveLength(0);
  });
});
