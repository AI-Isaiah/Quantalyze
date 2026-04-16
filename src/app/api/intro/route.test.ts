import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for POST /api/intro — specifically the Task 7.1a audit emission.
 *
 * Narrow scope: this file focuses on the `intro.send` audit event shape
 * and the non-blocking fire-and-forget contract. The existing intro
 * behaviours (snapshot race, allocator role gate, strategy lookup,
 * email fanout) are exercised elsewhere — we keep the mocks minimal
 * so we only have to update them when the audit emission changes.
 */

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// intro route imports `next/server` after which uses `waitUntil`/`after` —
// stub `after` to a simple sync passthrough so we don't leak waiters.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: () => undefined,
  };
});

const STATE = vi.hoisted(() => ({
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  },
  profileRole: "allocator" as "allocator" | "manager" | "both",
  insertedRow: null as { id: string } | null,
  contactInsertPayload: null as Record<string, unknown> | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/server", () => {
  return {
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
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { role: STATE.profileRole },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "contact_requests") {
          return {
            insert: (payload: Record<string, unknown>) => {
              STATE.contactInsertPayload = payload;
              return {
                select: () => ({
                  single: async () => ({
                    data: STATE.insertedRow,
                    error: null,
                  }),
                }),
              };
            },
          };
        }
        throw new Error(`unexpected from(${table})`);
      },
    }),
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: null, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: null }),
        }),
      }),
      update: () => ({
        eq: async () => ({ data: null, error: null }),
      }),
    }),
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
}));

vi.mock("@/lib/analytics/usage-events", () => ({
  trackUsageEventServer: async () => undefined,
}));

// Snapshot helper — succeed fast with a ready result so we don't hit
// the 2s timer branch in tests.
vi.mock("@/lib/intro/snapshot", () => ({
  computePortfolioSnapshot: async () => ({
    sharpe: null,
    max_drawdown: null,
    concentration: null,
    top_3_strategies: [],
    bottom_3_strategies: [],
    alerts_last_7d: 0,
  }),
}));

vi.mock("@/lib/email", () => ({
  notifyManagerIntroRequest: vi.fn(),
  notifyFounderIntroRequest: vi.fn(),
  notifyAllocatorOfIntroRequest: vi.fn(),
}));

vi.mock("@/lib/manager-identity", () => ({
  loadManagerIdentity: async () => null,
}));

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/intro", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function drainAuditMicrotasks() {
  // logAuditEvent schedules via queueMicrotask; three ticks is enough.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// UUIDs with proper RFC 4122 version (4) + variant (8|9|a|b) nibbles so
// Zod v4's strict uuid() validator accepts them.
const STRAT_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ROW_ID = "22222222-2222-4222-8222-222222222222";
const REPLACEMENT_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  STATE.profileRole = "allocator";
  STATE.insertedRow = { id: CONTACT_ROW_ID };
  STATE.contactInsertPayload = null;
  STATE.rpcCalls = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/intro — audit-log emission (Task 7.1a)", () => {
  it("emits intro.send via log_audit_event RPC on successful insert", async () => {
    const { POST } = await import("./route");

    const res = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        source: "direct",
        message: "hi",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    await drainAuditMicrotasks();

    const auditCall = STATE.rpcCalls.find(
      (c) => c.name === "log_audit_event",
    );
    expect(auditCall).toBeDefined();
    expect(auditCall!.args).toMatchObject({
      p_action: "intro.send",
      p_entity_type: "contact_request",
      p_entity_id: CONTACT_ROW_ID,
    });
    expect(auditCall!.args.p_metadata).toMatchObject({
      source: "direct",
      strategy_id: STRAT_ID,
      replacement_for: null,
    });
  });

  it("captures replacement_for in metadata when the source is 'bridge'", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        strategy_id: STRAT_ID,
        source: "bridge",
        replacement_for: REPLACEMENT_ID,
      }),
    );
    expect(res.status).toBe(200);
    await drainAuditMicrotasks();

    const auditCall = STATE.rpcCalls.find(
      (c) => c.name === "log_audit_event",
    );
    expect(auditCall).toBeDefined();
    expect(auditCall!.args.p_metadata).toMatchObject({
      source: "bridge",
      strategy_id: STRAT_ID,
      replacement_for: REPLACEMENT_ID,
    });
  });

  it("does NOT emit the audit event when the allocator role check rejects", async () => {
    STATE.profileRole = "manager"; // not allocator → 403, no audit
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ strategy_id: STRAT_ID }));
    expect(res.status).toBe(403);

    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });

  it("does NOT emit the audit event when the contact_requests insert returns null id", async () => {
    STATE.insertedRow = null;
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ strategy_id: STRAT_ID }));
    // Route still returns success (inserted is unknown; upstream mock's
    // single() returned null with no error). The pertinent assertion is
    // that we don't attempt an audit for a row we don't have an id for.
    expect(res.status).toBe(200);

    await drainAuditMicrotasks();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });
});
