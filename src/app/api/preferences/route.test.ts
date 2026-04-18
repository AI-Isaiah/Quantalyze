import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for PUT /api/preferences (Phase 2 — Mandate Profile Builder).
 *
 * Coverage:
 *   TC1 — happy self-edit: RPC invoked + mandate_preference.update audit fired.
 *         (MANDATE-04 mandate_edited_at column population asserted in
 *         Task 6's live-DB update-allocator-mandates-rpc.test.ts.)
 *   TC2 — Reset (p_clear_fields): body {max_weight:null} → rpcArgs has
 *         p_clear_fields:["max_weight"] and no p_max_weight key.
 *   TC3 — 401 no auth
 *   TC4 — 429 rate limit
 *   TC5 — 400 validation — TS layer (max_weight 0.99)
 *   TC6 — 400 validation — RPC SQLSTATE 22023
 *   TC7 — 401 from RPC — SQLSTATE 28000
 *   TC8 — 500 unknown RPC error
 *   TC9 — CSRF short-circuit
 *   TC10 — invalid JSON body → 400
 */

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// audit.ts schedules the RPC via next/server's `after()`. In tests we run
// the callback synchronously so the emission is observable via STATE.rpcCalls.
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
  rpcState: {} as Record<string, { data: unknown; error: { code?: string; message?: string } | null }>,
  checkLimitResult: { success: true, retryAfter: 0 } as { success: boolean; retryAfter: number },
  csrfResponse: null as ReturnType<typeof import("next/server").NextResponse.json> | null,
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
      const outcome = STATE.rpcState[name] ?? { data: null, error: null };
      return outcome;
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => STATE.checkLimitResult,
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => STATE.csrfResponse,
}));

function makeRequest(body: Record<string, unknown> | string): NextRequest {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return new NextRequest("http://localhost:3000/api/preferences", {
    method: "PUT",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: bodyStr,
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
  STATE.rpcState = {};
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.csrfResponse = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PUT /api/preferences", () => {
  it("TC1 — happy self-edit: RPC invoked with named params + audit fires", async () => {
    const { PUT } = await import("./route");

    const res = await PUT(
      makeRequest({ max_weight: 0.25, correlation_ceiling: 0.5 }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    await drainAuditMicrotasks();

    // MANDATE-04: this unit test verifies the RPC was invoked. The live-DB
    // enforcement of `mandate_edited_at` being populated within 5 seconds
    // after a successful RPC call lives in
    // src/__tests__/update-allocator-mandates-rpc.test.ts (Task 6).
    const updateCall = STATE.rpcCalls.find(
      (c) => c.name === "update_allocator_mandates",
    );
    expect(updateCall).toBeDefined();
    expect(updateCall!.args).toEqual({
      p_max_weight: 0.25,
      p_correlation_ceiling: 0.5,
    });

    const auditCall = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(auditCall).toBeDefined();
    expect(auditCall!.args).toMatchObject({
      p_action: "mandate_preference.update",
      p_entity_type: "allocator_preference_mandate",
      p_entity_id: STATE.authUser!.id,
    });
    expect(auditCall!.args.p_metadata).toMatchObject({
      fields: ["max_weight", "correlation_ceiling"],
      self_edit: true,
    });
  });

  it("TC2 — Reset (p_clear_fields): body {max_weight:null} transforms to p_clear_fields", async () => {
    const { PUT } = await import("./route");

    const res = await PUT(makeRequest({ max_weight: null }));

    expect(res.status).toBe(200);

    await drainAuditMicrotasks();

    const updateCall = STATE.rpcCalls.find(
      (c) => c.name === "update_allocator_mandates",
    );
    expect(updateCall).toBeDefined();
    expect(updateCall!.args).toEqual({
      p_clear_fields: ["max_weight"],
    });
    // No p_max_weight key
    expect(updateCall!.args).not.toHaveProperty("p_max_weight");

    const auditCall = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(auditCall).toBeDefined();
    expect(auditCall!.args.p_metadata).toMatchObject({
      fields: ["max_weight"],
    });
  });

  it("TC3 — 401 no auth: no rpcCalls", async () => {
    STATE.authUser = null;

    const { PUT } = await import("./route");

    const res = await PUT(makeRequest({ max_weight: 0.25 }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC4 — 429 rate limit: Retry-After header, no rpcCalls", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 30 };

    const { PUT } = await import("./route");

    const res = await PUT(makeRequest({ max_weight: 0.25 }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = await res.json();
    expect(body.error).toBe("Too many requests");

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC5 — 400 validation (TS layer): out-of-range max_weight rejected before RPC", async () => {
    const { PUT } = await import("./route");

    const res = await PUT(makeRequest({ max_weight: 0.99 }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/between 0\.05 and 0\.50/);

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC6 — 400 from RPC SQLSTATE 22023: error.message surfaced, no audit", async () => {
    STATE.rpcState.update_allocator_mandates = {
      data: null,
      error: {
        code: "22023",
        message: "max_weight must be between 0.05 and 0.50",
      },
    };

    const { PUT } = await import("./route");

    const res = await PUT(makeRequest({ max_weight: 0.25 }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("max_weight must be between 0.05 and 0.50");

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);
  });

  it("TC7 — 401 from RPC SQLSTATE 28000: Unauthorized, no audit", async () => {
    STATE.rpcState.update_allocator_mandates = {
      data: null,
      error: {
        code: "28000",
        message: "update_allocator_mandates: no auth session",
      },
    };

    const { PUT } = await import("./route");

    const res = await PUT(makeRequest({ max_weight: 0.25 }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);
  });

  it("TC8 — 500 unknown RPC error: generic message, no audit", async () => {
    STATE.rpcState.update_allocator_mandates = {
      data: null,
      error: { code: "XX000", message: "some db err" },
    };

    const { PUT } = await import("./route");

    const res = await PUT(makeRequest({ max_weight: 0.25 }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to save mandate");

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);
  });

  it("TC9 — CSRF short-circuits before auth/rpc/audit", async () => {
    const { NextResponse } = await import("next/server");
    STATE.csrfResponse = NextResponse.json(
      { error: "Forbidden" },
      { status: 403 },
    );

    const { PUT } = await import("./route");

    const res = await PUT(makeRequest({ max_weight: 0.25 }));

    expect(res.status).toBe(403);

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("TC10 — invalid JSON body: 400, no rpc, no audit", async () => {
    const { PUT } = await import("./route");

    const res = await PUT(makeRequest("{not valid json"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request body");

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls).toHaveLength(0);
  });
});
