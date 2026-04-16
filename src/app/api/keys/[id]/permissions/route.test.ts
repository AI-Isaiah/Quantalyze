import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for GET /api/keys/[id]/permissions — specifically the Task 7.1a
 * `api_key.decrypt` audit emission.
 *
 * The live behaviour of the route (Python proxy, unstable_cache, ownership
 * check) is covered indirectly by the staging E2E. This file's job is
 * narrow: prove the audit event fires on success AND does NOT fire on
 * ownership rejection / 404 / rate-limit paths.
 */

vi.mock("server-only", () => ({}));

const USER = { id: "00000000-0000-0000-0000-000000000001" };
const KEY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const STATE = vi.hoisted(() => ({
  keyRow: null as { id: string; user_id: string } | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rateLimitOk: true as boolean,
  fetcherImpl: null as (() => Promise<unknown>) | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: USER }, error: null }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      STATE.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table !== "api_keys") throw new Error(`unexpected from(${table})`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: STATE.keyRow, error: null }),
          }),
        }),
      };
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => ({
    success: STATE.rateLimitOk,
    retryAfter: STATE.rateLimitOk ? 0 : 60,
  }),
}));

// Mock next/cache's unstable_cache so we can control the fetcher output
// without touching the real Python service. Returns a function that when
// called invokes STATE.fetcherImpl.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>) => {
    return async () => {
      if (STATE.fetcherImpl) return STATE.fetcherImpl();
      return fn();
    };
  },
}));

function makeRequest(keyId: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/keys/${keyId}/permissions`,
    { method: "GET" },
  );
}

async function drainAuditMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  STATE.keyRow = { id: KEY_ID, user_id: USER.id };
  STATE.rpcCalls = [];
  STATE.rateLimitOk = true;
  STATE.fetcherImpl = async () => ({
    read: true,
    trade: false,
    withdraw: false,
    detected_at: "2026-04-16T00:00:00Z",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/keys/[id]/permissions — audit-log emission (Task 7.1a)", () => {
  it("emits api_key.decrypt via log_audit_event on a successful probe", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.read).toBe(true);

    await drainAuditMicrotasks();

    const auditCall = STATE.rpcCalls.find(
      (c) => c.name === "log_audit_event",
    );
    expect(auditCall).toBeDefined();
    expect(auditCall!.args).toMatchObject({
      p_action: "api_key.decrypt",
      p_entity_type: "api_key",
      p_entity_id: KEY_ID,
    });
    expect(auditCall!.args.p_metadata).toMatchObject({
      route: "/api/keys/[id]/permissions",
    });
  });

  it("does NOT emit when the ownership check rejects (403 path)", async () => {
    STATE.keyRow = { id: KEY_ID, user_id: "99999999-9999-4999-8999-999999999999" };
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(403);

    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });

  it("does NOT emit when the key is not found (404 path)", async () => {
    STATE.keyRow = null;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(404);

    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });

  it("does NOT emit when the Python fetcher throws (502 path)", async () => {
    STATE.fetcherImpl = async () => {
      throw new Error("upstream 500");
    };
    const { GET } = await import("./route");

    // Silence console.error for the expected proxy-failure log.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(makeRequest(KEY_ID));
    consoleErr.mockRestore();
    expect(res.status).toBe(502);

    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });

  it("does NOT emit when rate-limited (429 path)", async () => {
    STATE.rateLimitOk = false;
    const { GET } = await import("./route");
    const res = await GET(makeRequest(KEY_ID));
    expect(res.status).toBe(429);

    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });
});
