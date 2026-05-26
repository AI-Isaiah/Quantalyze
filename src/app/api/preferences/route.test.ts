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

// Sentinels expose limiter identity to checkLimit so TC11 (WR-02) can assert
// the route is wired to the 30/min mandate limiter, not the 5/min user-action
// limiter that 429'd at action #6 of the WR-02 8-action burst.
const USER_ACTION_LIMITER_SENTINEL = { __id: "userActionLimiter", __limit: "5/60s" };
const MANDATE_AUTO_SAVE_LIMITER_SENTINEL = { __id: "mandateAutoSaveLimiter", __limit: "30/60s" };

const STATE = vi.hoisted(() => ({
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
    email: "alloc@test.sec",
  } as { id: string; email: string } | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcState: {} as Record<string, { data: unknown; error: { code?: string; message?: string } | null }>,
  // M-1108: carries the optional `reason` discriminant so TC4b can drive the
  // fail-CLOSED `ratelimit_misconfigured` path the route must translate to 503.
  checkLimitResult: { success: true, retryAfter: 0 } as {
    success: boolean;
    retryAfter: number;
    reason?: "ratelimit_misconfigured";
  },
  csrfResponse: null as ReturnType<typeof import("next/server").NextResponse.json> | null,
  lastCheckLimitArg: null as unknown,
  // M-0338(b): when set, the log_audit_event RPC throws a TRANSIENT-class
  // error (network blip) which `emit()` swallows — proving the fire-and-
  // forget audit path never changes the user-facing 200.
  auditRpcThrows: false,
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
      if (name === "log_audit_event" && STATE.auditRpcThrows) {
        // Transient-class failure (TypeError: fetch failed) — emit()
        // swallows it without rethrowing, so no unhandled rejection.
        throw new TypeError("fetch failed");
      }
      const outcome = STATE.rpcState[name] ?? { data: null, error: null };
      return outcome;
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: USER_ACTION_LIMITER_SENTINEL,
  mandateAutoSaveLimiter: MANDATE_AUTO_SAVE_LIMITER_SENTINEL,
  checkLimit: async (limiter: unknown) => {
    STATE.lastCheckLimitArg = limiter;
    return STATE.checkLimitResult;
  },
  // M-1108: mirror the real predicate (src/lib/ratelimit.ts) so the route's
  // misconfig→503 branch is exercised against the same discriminant the
  // production helper checks.
  isRateLimitMisconfigured: (result: {
    success: boolean;
    reason?: string;
  }) => result.success === false && result.reason === "ratelimit_misconfigured",
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
  STATE.lastCheckLimitArg = null;
  STATE.auditRpcThrows = false;
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

  it("TC4b — M-1108: limiter misconfigured (fail-CLOSED) returns 503, not 429, and runs no RPC", async () => {
    // In production a null limiter (missing UPSTASH env) fails CLOSED with
    // reason:'ratelimit_misconfigured'. The route must surface that as a 503
    // Service Unavailable so canary/health checks see the outage — NOT a 429
    // that useMandateAutoSave would honor and retry forever, masking the
    // misconfig. Without the isRateLimitMisconfigured branch this returns 429.
    STATE.checkLimitResult = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };

    const { PUT } = await import("./route");

    const res = await PUT(makeRequest({ max_weight: 0.25 }));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    const body = await res.json();
    expect(body.error).toBe("Service temporarily unavailable");

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

  it("TC6 — H-0299: 400 from RPC SQLSTATE 22023 returns a generic message and never leaks the raw Postgres error string", async () => {
    // The raw RPC error is database-author-controlled and can carry internals
    // (function name, parameter names, rejected values, schema qualifiers a
    // future Postgres reformat appends). The route MUST NOT forward it to the
    // client — it returns a stable generic message and keeps the raw text in
    // the server log only. This message deliberately embeds internals so the
    // non-leak assertion is load-bearing: a regression to `error.message`
    // passthrough would surface "p_max_weight" / "public.update_allocator_..."
    // to the caller.
    const rawDbMessage =
      "function public.update_allocator_mandates: parameter p_max_weight value 0.510000 out of bounds [0.05,0.50]";
    STATE.rpcState.update_allocator_mandates = {
      data: null,
      error: { code: "22023", message: rawDbMessage },
    };

    const { PUT } = await import("./route");

    const res = await PUT(makeRequest({ max_weight: 0.25 }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid mandate value");
    // No DB internals leaked.
    expect(body.error).not.toBe(rawDbMessage);
    expect(body.error).not.toMatch(/p_max_weight/);
    expect(body.error).not.toMatch(/update_allocator_mandates/);

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

  it("TC11 — WR-02 burst tolerance: PUT uses 30/min mandateAutoSaveLimiter, not 5/min userActionLimiter", async () => {
    // MandateForm fans a single edit out into 8+ field-level PUTs (3 strategy
    // chips + 2 exchange chips + max_weight slide + ticket-size blur +
    // archetype blur). The 5/min userActionLimiter would 429 on the 6th save
    // mid-burst and surface "Saving too fast" inline. Wiring the dedicated
    // 30/min limiter instead absorbs the burst while keeping the auth-only
    // PUT path well under abuse thresholds.
    const { PUT } = await import("./route");

    await PUT(makeRequest({ max_weight: 0.25 }));

    expect(STATE.lastCheckLimitArg).toBe(MANDATE_AUTO_SAVE_LIMITER_SENTINEL);
    expect(STATE.lastCheckLimitArg).not.toBe(USER_ACTION_LIMITER_SENTINEL);
  });

  it("TC11b — L-0075: an 8-PUT burst all succeed (200) when the 30/min limiter has budget — the route does not self-throttle", async () => {
    // WR-02 premise: MandateForm fans a single edit into 8+ field-level
    // PUTs. The 5/min userActionLimiter would 429 the 6th save mid-burst.
    // TC11 only asserts the limiter IDENTITY (a wiring check). This pins the
    // BEHAVIOR the user actually experiences: 8 sequential PUTs, each with
    // the limiter reporting budget, ALL return 200 — the route itself never
    // drops a save. (The exact 30/60s sliding-window math is enforced inside
    // Upstash and is covered by the limiter-config FLAG, not unit-testable
    // offline here.)
    const { PUT } = await import("./route");
    STATE.checkLimitResult = { success: true, retryAfter: 0 };

    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await PUT(makeRequest({ max_weight: 0.1 + i * 0.01 }));
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200]);
    await drainAuditMicrotasks();
  });

  it("TC12 — M-0338(a): admin-only fields (founder_notes) are stripped before the RPC AND absent from the audit metadata.fields a self-editor can claim", async () => {
    // pickSelfEditableFields drops founder_notes (an ADMIN_ONLY field). A
    // self-editor must not be able to smuggle it into the RPC OR have it
    // appear in the audit row's metadata.fields (which would mis-attribute
    // an admin-only mutation to a self_edit).
    const { PUT } = await import("./route");

    const res = await PUT(
      makeRequest({
        max_weight: 0.25,
        founder_notes: "smuggled admin-only note",
        min_sharpe: 0.9, // another ADMIN_ONLY field
      }),
    );
    expect(res.status).toBe(200);
    await drainAuditMicrotasks();

    const updateCall = STATE.rpcCalls.find(
      (c) => c.name === "update_allocator_mandates",
    );
    expect(updateCall).toBeDefined();
    // Only the self-editable field reached the RPC; admin-only keys dropped.
    expect(updateCall!.args).toEqual({ p_max_weight: 0.25 });
    expect(updateCall!.args).not.toHaveProperty("p_founder_notes");
    expect(updateCall!.args).not.toHaveProperty("p_min_sharpe");

    const auditCall = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(auditCall).toBeDefined();
    const metadata = auditCall!.args.p_metadata as {
      fields: string[];
      self_edit: boolean;
    };
    // metadata.fields lists ONLY the kept self-editable field — the
    // self_edit:true claim cannot be paired with an admin-only field name.
    expect(metadata.fields).toEqual(["max_weight"]);
    expect(metadata.fields).not.toContain("founder_notes");
    expect(metadata.fields).not.toContain("min_sharpe");
    expect(metadata.self_edit).toBe(true);
  });

  it("TC13 — M-0338(b): a failing (fire-and-forget) audit RPC must NOT fail the 200 OK", async () => {
    // The audit emission is fire-and-forget via after(). If the
    // log_audit_event RPC fails (transient infra blip), the user's mandate
    // save still succeeded at the DB — the response must remain 200, never
    // a 500 gated on the audit round-trip.
    STATE.auditRpcThrows = true;
    const { PUT } = await import("./route");

    const res = await PUT(makeRequest({ max_weight: 0.25 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    await drainAuditMicrotasks();

    // The mandate RPC succeeded; the audit RPC was attempted (and threw).
    expect(
      STATE.rpcCalls.some((c) => c.name === "update_allocator_mandates"),
    ).toBe(true);
    expect(STATE.rpcCalls.some((c) => c.name === "log_audit_event")).toBe(true);
  });

  it("TC14 — M-0338(c): the audit entity_id is pinned to the authenticated user.id and a body-supplied entity_id cannot override it", async () => {
    // The route never reads entity_id from the body — it always uses
    // user.id. Pin that contract so a future change that trusted a
    // client-supplied entity_id (letting one allocator's edit be audited
    // against another's id) is caught.
    const { PUT } = await import("./route");

    const res = await PUT(
      makeRequest({
        max_weight: 0.25,
        // Attacker attempts to redirect the audit anchor.
        entity_id: "99999999-9999-4999-8999-999999999999",
      }),
    );
    expect(res.status).toBe(200);
    await drainAuditMicrotasks();

    const auditCall = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(auditCall).toBeDefined();
    expect(auditCall!.args.p_entity_id).toBe(STATE.authUser!.id);
    expect(auditCall!.args.p_entity_id).not.toBe(
      "99999999-9999-4999-8999-999999999999",
    );
  });
});
