import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * C-PR5-01 (audit-2026-05-07) — route-level coverage for
 * POST /api/admin/match/recompute focused on the actor-binding
 * contract:
 *
 *   1. Forwards the authenticated admin's user.id as the third arg to
 *      ``recomputeMatch`` (this is the load-bearing field that the
 *      analytics-service ``recompute()`` endpoint asserts equals the
 *      allocator_id OR is an admin profile). A regression that drops
 *      this arg restores the cross-tenant write vector PR-5 closed.
 *
 *   2. Non-admin → 403 BEFORE recomputeMatch is invoked. The existing
 *      admin gate remains the production authorization; this test pins
 *      that the actor-binding fix didn't accidentally widen the gate.
 *
 *   3. Unauthenticated → 401 (RFC 7235) before any call to
 *      recomputeMatch.
 *
 * Mirrors the pattern in kill-switch/route.test.ts.
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const userState = vi.hoisted<{ current: { id: string } | null }>(() => ({
  current: null,
}));

const adminFlag = vi.hoisted(() => ({ isAdmin: false }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: userState.current },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => adminFlag.isAdmin,
}));

vi.mock("@/lib/ratelimit", () => ({
  adminActionLimiter: {},
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
}));

// Capture every call to recomputeMatch so we can assert the third arg.
const recomputeCalls: Array<{
  allocatorId: string;
  force: boolean;
  actorId?: string;
}> = [];

vi.mock("@/lib/analytics-client", () => ({
  recomputeMatch: async (allocatorId: string, force: boolean, actorId?: string) => {
    recomputeCalls.push({ allocatorId, force, actorId });
    return { ok: true, batch_id: "b-test" };
  },
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

beforeEach(() => {
  userState.current = null;
  adminFlag.isAdmin = false;
  recomputeCalls.length = 0;
});

function buildPostRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/admin/match/recompute", {
    method: "POST",
    headers: { "content-type": "application/json", ...VALID_ORIGIN },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/match/recompute — actor binding (C-PR5-01)", () => {
  it("forwards user.id as actorId on the third arg of recomputeMatch", async () => {
    userState.current = { id: "admin-user-uuid-001" };
    adminFlag.isAdmin = true;

    const { POST } = await import("./route");
    const res = await POST(
      buildPostRequest({ allocator_id: "alloc-uuid-target", force: false }),
    );
    expect(res.status).toBe(200);

    expect(recomputeCalls).toHaveLength(1);
    expect(recomputeCalls[0].allocatorId).toBe("alloc-uuid-target");
    expect(recomputeCalls[0].force).toBe(false);
    // The load-bearing assertion: the authenticated admin's id flows
    // through as actor_id so analytics-service can defense-in-depth
    // gate the cross-tenant write.
    expect(recomputeCalls[0].actorId).toBe("admin-user-uuid-001");
  });

  it("preserves force=true forwarding alongside actorId", async () => {
    userState.current = { id: "admin-user-uuid-002" };
    adminFlag.isAdmin = true;

    const { POST } = await import("./route");
    await POST(
      buildPostRequest({ allocator_id: "alloc-target-002", force: true }),
    );

    expect(recomputeCalls).toHaveLength(1);
    expect(recomputeCalls[0].force).toBe(true);
    expect(recomputeCalls[0].actorId).toBe("admin-user-uuid-002");
  });

  it("non-admin → 403 BEFORE recomputeMatch is called", async () => {
    userState.current = { id: "non-admin-uuid" };
    adminFlag.isAdmin = false;

    const { POST } = await import("./route");
    const res = await POST(
      buildPostRequest({ allocator_id: "alloc-x", force: false }),
    );
    expect(res.status).toBe(403);
    // Crucial: actor binding does NOT widen the gate; if the admin gate
    // fails, the analytics-service never sees the request and thus the
    // actor-id forwarding contract isn't even exercised.
    expect(recomputeCalls).toHaveLength(0);
  });

  it("unauthenticated → 401 BEFORE recomputeMatch is called", async () => {
    userState.current = null;

    const { POST } = await import("./route");
    const res = await POST(
      buildPostRequest({ allocator_id: "alloc-x", force: false }),
    );
    expect(res.status).toBe(401);
    expect(recomputeCalls).toHaveLength(0);
  });

  it("missing allocator_id → 400 BEFORE recomputeMatch is called", async () => {
    userState.current = { id: "admin-id" };
    adminFlag.isAdmin = true;

    const { POST } = await import("./route");
    const res = await POST(buildPostRequest({ force: false }));
    expect(res.status).toBe(400);
    expect(recomputeCalls).toHaveLength(0);
  });
});
