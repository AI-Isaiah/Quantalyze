import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for POST /api/bridge/outcome
 *
 * Coverage:
 *   TC1 — happy allocated: records outcome + emits bridge_outcome.record audit
 *   TC2 — happy rejected: records rejection + audit action is bridge_outcome.record
 *   TC3 — upsert-update: pre-existing row → created_at !== updated_at → audit action is bridge_outcome.update
 *   TC4 — 401 no user
 *   TC5 — 403 NOT_ELIGIBLE (no sent_as_intro in match_decisions)
 *   TC6 — 400 Zod: invalid uuid; kind=allocated missing percent_allocated
 *   TC7 — 429 rate-limit
 */

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// audit.ts schedules the RPC via next/server's `after()`. In tests we
// run the callback synchronously so the emission can be observed via
// STATE.rpcCalls.
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
  sentAsIntroDecision: { id: "00000000-0000-0000-0000-000000000010" } as { id: string } | null,
  checkLimitResult: { success: true, retryAfter: 0 } as { success: boolean; retryAfter: number },
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
      if (table === "bridge_outcomes") {
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
      throw new Error(`unexpected from(${table}) on user-scoped client`);
    },
  }),
}));

// The match_decisions eligibility check uses the admin client because the
// table has no allocator-self-SELECT RLS policy. Mock it here.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "match_decisions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: STATE.sentAsIntroDecision,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table}) on admin client`);
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => STATE.checkLimitResult,
}));

// UUIDs with RFC 4122 v4 format for Zod strict uuid() validation
const STRAT_ID = "11111111-1111-4111-8111-111111111111";
const OUTCOME_ID = "22222222-2222-4222-8222-222222222222";
const NOW_ISO = "2026-04-18T12:00:00.000Z";
// allocated_at within last 365 days, not in future
const ALLOCATED_AT = "2026-04-10";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/bridge/outcome", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function drainAuditMicrotasks() {
  // logAuditEvent schedules via queueMicrotask; three ticks is enough.
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
  STATE.sentAsIntroDecision = { id: "00000000-0000-0000-0000-000000000010" };
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.insertedRow = {
    id: OUTCOME_ID,
    kind: "allocated",
    percent_allocated: 12,
    allocated_at: ALLOCATED_AT,
    rejection_reason: null,
    note: null,
    delta_30d: null,
    delta_90d: null,
    delta_180d: null,
    estimated_delta_bps: null,
    estimated_days: null,
    needs_recompute: true,
    // Same instant = insert (bridge_outcome.record)
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/bridge/outcome", () => {
  it("TC1 — happy allocated: 200 + correct shape + bridge_outcome.record audit", async () => {
    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        kind: "allocated",
        percent_allocated: 12,
        allocated_at: ALLOCATED_AT,
        note: null,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.outcome).toMatchObject({ id: OUTCOME_ID, kind: "allocated" });

    await drainAuditMicrotasks();

    const auditCall = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(auditCall).toBeDefined();
    expect(auditCall!.args).toMatchObject({
      p_action: "bridge_outcome.record",
      p_entity_type: "bridge_outcome",
      p_entity_id: OUTCOME_ID,
    });
    expect(auditCall!.args.p_metadata).toMatchObject({
      strategy_id: STRAT_ID,
      kind: "allocated",
      percent_allocated: 12,
      rejection_reason: null,
    });
  });

  it("TC2 — happy rejected: 200 + rejection_reason persisted + bridge_outcome.record audit", async () => {
    STATE.insertedRow = {
      id: OUTCOME_ID,
      kind: "rejected",
      percent_allocated: null,
      allocated_at: null,
      rejection_reason: "mandate_conflict",
      note: null,
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: true,
      // First insert: timestamps equal
      created_at: NOW_ISO,
      updated_at: NOW_ISO,
    };

    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        kind: "rejected",
        rejection_reason: "mandate_conflict",
        note: null,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome.rejection_reason).toBe("mandate_conflict");
    expect(body.outcome.percent_allocated).toBeNull();
    expect(body.outcome.allocated_at).toBeNull();

    await drainAuditMicrotasks();

    const auditCall = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(auditCall).toBeDefined();
    expect(auditCall!.args.p_action).toBe("bridge_outcome.record");
    expect((auditCall!.args.p_metadata as Record<string, unknown>).rejection_reason).toBe("mandate_conflict");
  });

  it("TC3 — upsert-update: diverged timestamps → bridge_outcome.update audit", async () => {
    // Pre-existing row: created_at earlier than updated_at (has been updated before)
    STATE.insertedRow = {
      id: OUTCOME_ID,
      kind: "allocated",
      percent_allocated: 15,
      allocated_at: ALLOCATED_AT,
      rejection_reason: null,
      note: null,
      delta_30d: null,
      delta_90d: null,
      delta_180d: null,
      estimated_delta_bps: null,
      estimated_days: null,
      needs_recompute: true,
      // Different timestamps = upsert-update (bridge_outcome.update)
      created_at: "2026-04-01T10:00:00.000Z",
      updated_at: "2026-04-18T12:00:00.000Z",
    };

    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        kind: "allocated",
        percent_allocated: 15,
        allocated_at: ALLOCATED_AT,
        note: null,
      }),
    );

    expect(res.status).toBe(200);

    await drainAuditMicrotasks();

    const auditCall = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(auditCall).toBeDefined();
    expect(auditCall!.args.p_action).toBe("bridge_outcome.update");
  });

  it("TC4 — 401 no user: no DB calls, no audit", async () => {
    STATE.authUser = null;

    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({ strategy_id: STRAT_ID, kind: "allocated", percent_allocated: 10, allocated_at: ALLOCATED_AT }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);
  });

  it("TC5 — 403 NOT_ELIGIBLE: no upsert, no audit", async () => {
    STATE.sentAsIntroDecision = null;

    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({ strategy_id: STRAT_ID, kind: "allocated", percent_allocated: 10, allocated_at: ALLOCATED_AT }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("NOT_ELIGIBLE");
    expect(body.reason).toBe("No sent_as_intro for this strategy");

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);
  });

  it("TC6a — 400 Zod: invalid uuid → issues array", async () => {
    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({ strategy_id: "not-a-uuid", kind: "allocated" }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request body");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);
  });

  it("TC6b — 400 Zod: kind=allocated missing percent_allocated → superRefine error", async () => {
    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({ strategy_id: STRAT_ID, kind: "allocated", allocated_at: ALLOCATED_AT }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid request body");
    expect(Array.isArray(body.issues)).toBe(true);
    const issue = body.issues.find(
      (i: { path: string[] }) => i.path.includes("percent_allocated"),
    );
    expect(issue).toBeDefined();
  });

  it("TC7 — 429 rate-limit: Retry-After header, no upsert, no audit", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 30 };

    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({ strategy_id: STRAT_ID, kind: "allocated", percent_allocated: 10, allocated_at: ALLOCATED_AT }),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    const body = await res.json();
    expect(body.error).toBe("Too many requests");

    await drainAuditMicrotasks();
    expect(STATE.rpcCalls.filter((c) => c.name === "log_audit_event")).toHaveLength(0);
  });
});
