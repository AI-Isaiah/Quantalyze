/**
 * Audit-2026-05-07 C-0135 + C-0136 — manager-side intro response route.
 *
 * The route exists to (a) trigger notifyAllocatorIntroStatus on every
 * manager-driven transition (closes C-0135 — direct browser-client
 * UPDATE skipped the notify path) and (b) whitelist the writeable
 * columns to { status, responded_at } so a manager UI cannot mutate
 * admin_note / founder_notes / allocation_amount via the path that
 * RLS was permitting (closes C-0136 application-layer surface).
 *
 * Branches verified:
 *   1. Unauthenticated caller → 401.
 *   2. Caller is not the strategy manager → 403 (ownership check).
 *   3. Invalid body (missing action) → 400.
 *   4. Happy path (manager owns the strategy) → 200 + service-role UPDATE
 *      writes only { status, responded_at }.
 *   5. Happy path → notifyAllocatorIntroStatus is invoked from `after()`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

// Trap the `after(cb)` continuation so we can await it from the test.
const afterCalls: Array<() => Promise<void> | void> = [];
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (cb: () => Promise<void> | void) => {
      afterCalls.push(cb);
    },
  };
});

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

const TEST_USER = vi.hoisted(() => ({
  id: "00000000-0000-4000-8000-000000000001",
}));

const supabaseState = vi.hoisted(() => ({
  currentUser: TEST_USER as { id: string } | null,
  lookupResult: null as
    | null
    | {
        id: string;
        strategy_id: string;
        status: string;
        allocator_id: string;
        strategies: { user_id: string | null; name: string | null };
      },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: supabaseState.currentUser },
        error: null,
      }),
    },
    // logAuditEvent calls .rpc on this client.
    rpc: async () => ({ data: null, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: supabaseState.lookupResult,
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

const adminUpdate = vi.hoisted(() => vi.fn());
const adminFromCalls = vi.hoisted<string[]>(() => []);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      adminFromCalls.push(table);
      if (table === "contact_requests") {
        return {
          update: (payload: Record<string, unknown>) => {
            adminUpdate(payload);
            return {
              eq: () => ({
                select: () => Promise.resolve({
                  data: [{ id: "stub" }],
                  error: null,
                }),
              }),
            };
          },
        };
      }
      // profiles lookup (allocator email)
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { email: "allocator@example.test" },
              error: null,
            }),
          }),
        }),
      };
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
}));

const notifySpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/email", () => ({
  notifyAllocatorIntroStatus: notifySpy,
}));

const auditSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({
  logAuditEvent: auditSpy,
}));

function makeRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe("POST /api/intro-response — audit C-0135 + C-0136", () => {
  beforeEach(() => {
    supabaseState.currentUser = TEST_USER;
    supabaseState.lookupResult = {
      id: "33333333-3333-4333-8333-333333333333",
      strategy_id: "22222222-2222-4222-8222-222222222222",
      status: "pending",
      allocator_id: "44444444-4444-4444-8444-444444444444",
      strategies: {
        user_id: TEST_USER.id, // caller is the manager
        name: "Stellar Neutral Alpha",
      },
    };
    adminUpdate.mockReset();
    adminFromCalls.length = 0;
    notifySpy.mockClear();
    auditSpy.mockClear();
    afterCalls.length = 0;
  });

  it("returns 401 when no user is authenticated", async () => {
    supabaseState.currentUser = null;
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on an invalid body", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ id: "not-a-uuid", action: "weird" }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when the caller is not the strategy manager (closes C-0136 ownership surface)", async () => {
    // Different manager owns the strategy — the ownership check must reject.
    supabaseState.lookupResult!.strategies.user_id = "99999999-9999-4999-8999-999999999999";
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(res.status).toBe(403);
    // Critically, NO UPDATE was issued — the manager UI surface that
    // C-0136 worried about is dead.
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("writes only { status, responded_at } on the happy path (column whitelist)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(res.status).toBe(200);
    expect(adminUpdate).toHaveBeenCalledTimes(1);
    const payload = adminUpdate.mock.calls[0][0] as Record<string, unknown>;
    // Whitelist: only status + responded_at, no admin_note / founder_notes /
    // allocation_amount / message / mandate_context (C-0136 fix).
    expect(Object.keys(payload).sort()).toEqual(["responded_at", "status"]);
    expect(payload.status).toBe("intro_made");
    expect(typeof payload.responded_at).toBe("string");
  });

  it("decline action writes status='declined'", async () => {
    const { POST } = await import("./route");
    await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "decline",
      }),
    );
    const payload = adminUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("declined");
  });

  it("triggers notifyAllocatorIntroStatus on every transition (closes C-0135 silent-notify drop)", async () => {
    const { POST } = await import("./route");
    await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "decline",
      }),
    );
    // `after` is mocked to capture the continuation; flush it manually.
    expect(afterCalls).toHaveLength(1);
    await afterCalls[0]();
    expect(notifySpy).toHaveBeenCalledTimes(1);
    const [allocatorEmail, strategyName, status] = notifySpy.mock.calls[0];
    expect(allocatorEmail).toBe("allocator@example.test");
    expect(strategyName).toBe("Stellar Neutral Alpha");
    expect(status).toBe("declined");
  });

  it("emits a contact_request.status_change audit event on the happy path", async () => {
    const { POST } = await import("./route");
    await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const [, event] = auditSpy.mock.calls[0];
    expect(event.action).toBe("contact_request.status_change");
    expect(event.entity_type).toBe("contact_request");
    expect(event.metadata.new_status).toBe("intro_made");
    expect(event.metadata.actor_role).toBe("manager");
  });
});
