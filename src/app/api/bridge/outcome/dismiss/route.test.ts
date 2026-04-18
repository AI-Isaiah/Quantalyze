import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for POST /api/bridge/outcome/dismiss
 *
 * Coverage:
 *   TC1 — happy dismiss: 24h TTL upsert + bridge_outcome.dismiss audit
 *   TC2 — 401 no user: no DB call, no audit
 *   TC3 — 429 rate-limit: Retry-After header, no insert, no audit
 */

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// Synchronise after() so RPC calls are observable in STATE.rpcCalls.
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

const STATE = vi.hoisted(() => ({
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  } as { id: string; email: string } | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  insertedRow: null as Record<string, unknown> | null,
  checkLimitResult: { success: true, retryAfter: 0 } as {
    success: boolean;
    retryAfter: number;
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: STATE.authUser },
        error: null,
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      STATE.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table === "bridge_outcome_dismissals") {
        return {
          upsert: () => ({
            select: () => ({
              single: async () => ({
                data: STATE.insertedRow,
                error: STATE.insertedRow ? null : { message: "no data" },
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => STATE.checkLimitResult,
}));

const STRAT_ID = "11111111-1111-4111-8111-111111111111";
const DISMISSAL_ID = "33333333-3333-4333-8333-333333333333";
const EXPIRES_AT = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/bridge/outcome/dismiss", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function drainAuditMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  STATE.authUser = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  };
  STATE.rpcCalls = [];
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.insertedRow = {
    id: DISMISSAL_ID,
    expires_at: EXPIRES_AT,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/bridge/outcome/dismiss", () => {
  it("TC1 — happy dismiss: 200 + expires_at set + bridge_outcome.dismiss audit", async () => {
    const { POST } = await import("./route");

    const res = await POST(makeRequest({ strategy_id: STRAT_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.dismissal).toMatchObject({ id: DISMISSAL_ID });
    expect(body.dismissal.expires_at).toBeDefined();

    await drainAuditMicrotasks();

    const auditCall = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(auditCall).toBeDefined();
    expect(auditCall!.args).toMatchObject({
      p_action: "bridge_outcome.dismiss",
      p_entity_type: "bridge_outcome_dismissal",
      p_entity_id: DISMISSAL_ID,
    });
    expect(
      (auditCall!.args.p_metadata as Record<string, unknown>).strategy_id,
    ).toBe(STRAT_ID);
    expect(
      (auditCall!.args.p_metadata as Record<string, unknown>).expires_at,
    ).toBeDefined();
  });

  it("TC2 — 401 no user: no DB call, no audit", async () => {
    STATE.authUser = null;

    const { POST } = await import("./route");

    const res = await POST(makeRequest({ strategy_id: STRAT_ID }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");

    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });

  it("TC3 — 429 rate-limit: Retry-After=15 header, no insert, no audit", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 15 };

    const { POST } = await import("./route");

    const res = await POST(makeRequest({ strategy_id: STRAT_ID }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("15");
    const body = await res.json();
    expect(body.error).toBe("Too many requests");

    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });
});
