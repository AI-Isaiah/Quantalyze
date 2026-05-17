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

const csrfState = vi.hoisted(() => ({
  // null = pass; set to a status code to force same-origin rejection.
  result: null as null | { status: number },
}));
vi.mock("@/lib/csrf", async () => {
  const { NextResponse: NR } =
    await vi.importActual<typeof import("next/server")>("next/server");
  return {
    assertSameOrigin: () => {
      if (csrfState.result) {
        return NR.json({ error: "Forbidden" }, { status: csrfState.result.status });
      }
      return null;
    },
  };
});

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
  lookupError: null as null | { message: string },
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
            error: supabaseState.lookupError,
          }),
        }),
      }),
    }),
  }),
}));

const adminUpdate = vi.hoisted(() => vi.fn());
const adminFromCalls = vi.hoisted<string[]>(() => []);
const adminState = vi.hoisted(() => ({
  // Tunable contact_requests update().eq().select() resolution. Default mirrors
  // the prior single-row success so existing happy-path tests stay green.
  updateResult: { data: [{ id: "stub" }] as Array<{ id: string }> | null, error: null as null | { message: string } },
  // Tunable profiles lookup result (after() allocator-email fetch).
  profileResult: { data: { email: "allocator@example.test" } as { email: string | null } | null, error: null as null | { message: string } },
}));
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
                select: () => Promise.resolve(adminState.updateResult),
              }),
            };
          },
        };
      }
      // profiles lookup (allocator email)
      return {
        select: () => ({
          eq: () => ({
            single: async () => adminState.profileResult,
          }),
        }),
      };
    },
  }),
}));

const rateLimitState = vi.hoisted(() => ({
  result: { success: true as boolean, retryAfter: 0 as number },
}));
vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: async () => rateLimitState.result,
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
    supabaseState.lookupError = null;
    csrfState.result = null;
    rateLimitState.result = { success: true, retryAfter: 0 };
    adminState.updateResult = { data: [{ id: "stub" }], error: null };
    adminState.profileResult = { data: { email: "allocator@example.test" }, error: null };
    adminUpdate.mockReset();
    adminFromCalls.length = 0;
    notifySpy.mockClear();
    notifySpy.mockResolvedValue(undefined);
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

  // Audit-2026-05-07 testing/csrf-negative — pins the assertSameOrigin
  // early-return so a regression that silently dropped/inverted the CSRF
  // guard would fail this test.
  it("short-circuits on the assertSameOrigin CSRF guard before auth/lookup/update", async () => {
    csrfState.result = { status: 403 };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(res.status).toBe(403);
    // None of the downstream side effects fired.
    expect(adminUpdate).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(0);
  });

  // Audit-2026-05-07 testing/rate-limit-negative — pins the 429 branch and
  // Retry-After header shape (route.ts L63-69).
  it("returns 429 with Retry-After when checkLimit reports the user is throttled", async () => {
    rateLimitState.result = { success: false, retryAfter: 5 };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("5");
    // Throttled callers must not reach lookup / update / notify / audit.
    expect(adminUpdate).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(0);
  });

  // Audit-2026-05-07 testing/lookup-error-negative — pins the 500 on
  // contact_requests lookup failure (route.ts L93-95).
  it("returns 500 and does not run the admin update when the lookup query errors", async () => {
    supabaseState.lookupError = { message: "db down" };
    supabaseState.lookupResult = null;
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(res.status).toBe(500);
    expect(adminUpdate).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
  });

  // Audit-2026-05-07 testing/not-found-negative — pins the 404 branch
  // (route.ts L96-98) distinct from the 403 ownership-mismatch path. The
  // RLS-row-hidden case must not be reclassified as 403/500.
  it("returns 404 when the row is hidden by RLS (data:null with no error)", async () => {
    supabaseState.lookupResult = null;
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(res.status).toBe(404);
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  // Audit-2026-05-07 testing/update-error-negative — pins the 500 on admin
  // update error (route.ts L122-124). A regression that silently dropped
  // updateError and returned 200 would slip a "succeeded" UI on a failed
  // DB write past tests; this case prevents that.
  it("returns 500 and skips notify+audit when the admin update returns an error", async () => {
    adminState.updateResult = { data: null, error: { message: "boom" } };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(res.status).toBe(500);
    expect(auditSpy).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(0);
  });

  // Audit-2026-05-07 testing/empty-rowset-negative — pins the defensive
  // empty-array branch (route.ts L125-132). This mirrors the original
  // audit #44 silent-success defect on the server: a successful query
  // affecting zero rows must surface as 500, never 200.
  it("returns 500 when the admin update affects zero rows (defensive empty-array guard)", async () => {
    adminState.updateResult = { data: [], error: null };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(res.status).toBe(500);
    expect(auditSpy).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(0);
  });

  // Audit-2026-05-07 testing/after-catch-negative — pins the try/catch
  // around notifyAllocatorIntroStatus inside after() (route.ts L165-170).
  // A regression that removed the try/catch would unhandled-reject; this
  // test asserts the swallow-and-log contract.
  it("swallows notify errors in the after() continuation and does not throw", async () => {
    notifySpy.mockRejectedValueOnce(new Error("smtp down"));
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    // The HTTP response was already 200 before after() ran.
    expect(res.status).toBe(200);
    expect(afterCalls).toHaveLength(1);
    // Flushing the continuation must not throw — the route catches errors
    // and logs them via console.error.
    await expect(afterCalls[0]()).resolves.toBeUndefined();
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  // Audit-2026-05-07 testing/notify-skip-negative — pins the notify-gating
  // condition `allocator?.email && strategy.name` (route.ts L158). Sending
  // notify(undefined, …) or notify(email, null, …) would ship a malformed
  // email; these cases pin the skip contract.
  it("does NOT call notifyAllocatorIntroStatus when the allocator profile lookup returns null", async () => {
    adminState.profileResult = { data: null, error: null };
    const { POST } = await import("./route");
    await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(afterCalls).toHaveLength(1);
    await afterCalls[0]();
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("does NOT call notifyAllocatorIntroStatus when the strategy name is null", async () => {
    supabaseState.lookupResult!.strategies.name = null;
    const { POST } = await import("./route");
    await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(afterCalls).toHaveLength(1);
    await afterCalls[0]();
    expect(notifySpy).not.toHaveBeenCalled();
  });

  // Audit-2026-05-07 testing/json-parse-rejection — pins the
  // `await req.json().catch(() => null)` guard at route.ts L71-78. A
  // regression that removed the catch would propagate the JSON parse
  // rejection instead of returning a clean 400.
  it("returns 400 when req.json() rejects with a parse error", async () => {
    const { POST } = await import("./route");
    const badReq = {
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as NextRequest;
    const res = await POST(badReq);
    expect(res.status).toBe(400);
    expect(adminUpdate).not.toHaveBeenCalled();
  });
});
