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
  } => ({
    insertedBatches: [],
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
    // log_audit_event RPC stub — always succeeds.
    rpc: async () => ({ data: null, error: null }),
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
            supabaseState.insertedBatches.push(batch);
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
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
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
});
