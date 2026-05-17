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
const adminEqCalls = vi.hoisted<Array<[string, unknown]>>(() => []);
const adminFromCalls = vi.hoisted<string[]>(() => []);
const adminState = vi.hoisted(() => ({
  // Tunable contact_requests update().eq().eq().select() resolution.
  // The route now chains .eq('id', id).eq('status', 'pending') for the
  // TOCTOU guard (red-team:toctou-status-overwrite). Default mirrors
  // the prior single-row success so existing happy-path tests stay
  // green.
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
            const chain = {
              eq: (col: string, val: unknown) => {
                adminEqCalls.push([col, val]);
                return chain;
              },
              select: () => Promise.resolve(adminState.updateResult),
            };
            return chain;
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

// Red-team 2026-05-17 (red-team:audit-after-jwt-expiry, HIGH conf 8): the
// route now uses logAuditEventAsUser(adminClient, user.id, event) so the
// after()-deferred RPC runs through service_role and is immune to user
// JWT expiry. The spy receives the adminClient, the user.id, and the
// event payload (vs. the prior (supabaseClient, event) shape).
const auditSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({
  logAuditEventAsUser: auditSpy,
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
    adminEqCalls.length = 0;
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

  it("emits a contact_request.status_change audit event via logAuditEventAsUser on the happy path", async () => {
    const { POST } = await import("./route");
    await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(auditSpy).toHaveBeenCalledTimes(1);
    // Red-team 2026-05-17 (audit-after-jwt-expiry): pin the new
    // (adminClient, user.id, event) signature. The acting user id MUST
    // be the authenticated user's id (captured at request time, NOT
    // resolved at after() emit time from a stale JWT).
    const [, actingUserId, event] = auditSpy.mock.calls[0];
    expect(actingUserId).toBe(TEST_USER.id);
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

  // Red-team 2026-05-17 (red-team:toctou-status-overwrite, CRITICAL conf
  // 9): with the .eq('status', 'pending') guard on the UPDATE, a row
  // that already transitioned to a terminal state (because a concurrent
  // admin call or another browser tab just resolved it) returns 0
  // affected rows. The route MUST surface this as 409 ("request already
  // resolved") — NOT 200, NOT 500 — so the UI can route the manager to
  // refresh instead of retry, and so we don't double-audit / double-
  // notify the same transition.
  it("returns 409 when the admin update affects zero rows (TOCTOU: row resolved elsewhere)", async () => {
    adminState.updateResult = { data: [], error: null };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(res.status).toBe(409);
    expect(auditSpy).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(0);
  });

  // Red-team 2026-05-17 (red-team:toctou-status-overwrite, CRITICAL conf
  // 9): the admin UPDATE chain MUST include both .eq('id', id) AND
  // .eq('status', 'pending'). The status guard is what closes the
  // TOCTOU between the L87 lookup and this write. Asserting against
  // the recorded eq() calls pins the SQL shape so a regression that
  // dropped the status guard (and re-opened the race) gets caught at
  // unit time.
  it("guards the admin UPDATE with .eq('status', 'pending') for TOCTOU close", async () => {
    const { POST } = await import("./route");
    await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    // The chain is .update(...).eq('id', id).eq('status', 'pending').select()
    // Both eq calls land in adminEqCalls in that order.
    expect(adminEqCalls).toEqual([
      ["id", "33333333-3333-4333-8333-333333333333"],
      ["status", "pending"],
    ]);
  });

  // Red-team 2026-05-17 (red-team:notify-replay-amplification, HIGH conf
  // 9): if the lookup returns status != 'pending' (because a concurrent
  // writer already resolved the row), the route short-circuits with
  // 409 BEFORE issuing the admin update. This is the cheap idempotency
  // belt — the .eq('status','pending') on the UPDATE is the
  // cross-process suspenders.
  it("returns 409 (and skips update/audit/notify) when the request was already resolved", async () => {
    supabaseState.lookupResult = {
      ...supabaseState.lookupResult!,
      status: "intro_made",
    };
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        id: "33333333-3333-4333-8333-333333333333",
        action: "accept",
      }),
    );
    expect(res.status).toBe(409);
    expect(adminUpdate).not.toHaveBeenCalled();
    expect(auditSpy).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(0);
  });

  // Red-team 2026-05-17 (red-team:null-allocator-id-silent-skip, MED
  // conf 8): if allocator_id is null on the row (legacy data), the
  // after() callback MUST log a [api/intro-response] warning and skip
  // notify — supabase-js translates .eq('id', null) into 'id IS NULL'
  // which silently no-ops, leaving the operator without any audit
  // signal that the notification was dropped. The explicit guard +
  // console.warn makes the skip observable.
  it("logs a stable-prefix warning and skips notify when allocator_id is null", async () => {
    supabaseState.lookupResult = {
      ...supabaseState.lookupResult!,
      allocator_id: null as unknown as string,
    };
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({
          id: "33333333-3333-4333-8333-333333333333",
          action: "accept",
        }),
      );
      expect(res.status).toBe(200);
      expect(afterCalls).toHaveLength(1);
      await afterCalls[0]();
      expect(notifySpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [msg] = warnSpy.mock.calls[0];
      expect(String(msg)).toMatch(/\[api\/intro-response\]/);
      expect(String(msg)).toMatch(/allocator_id/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // Red-team 2026-05-17 (red-team:join-shape-cast-fragile, MED conf 8):
  // if supabase-js inference flips the join shape from object to array
  // (after a supabase-js bump or FK constraint rename), the cast
  // would silently 403 every legitimate manager. The runtime shape
  // guard surfaces the regression as a 500 with a logged
  // [api/intro-response] 'unexpected join shape' diagnostic — making
  // it impossible to silently invert ownership enforcement.
  it("returns 500 (not 403) when the strategies join returns an array shape", async () => {
    // Force the join to come back as an array — what supabase-js would
    // return if the FK relationship were re-inferred as to-many.
    supabaseState.lookupResult = {
      ...supabaseState.lookupResult!,
      strategies: [
        { user_id: TEST_USER.id, name: "Stellar Neutral Alpha" },
      ] as unknown as { user_id: string | null; name: string | null },
    };
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({
          id: "33333333-3333-4333-8333-333333333333",
          action: "accept",
        }),
      );
      expect(res.status).toBe(500);
      expect(adminUpdate).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
      const [msg] = errSpy.mock.calls[0];
      expect(String(msg)).toMatch(/\[api\/intro-response\]/);
      expect(String(msg)).toMatch(/unexpected join shape/);
    } finally {
      errSpy.mockRestore();
    }
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
