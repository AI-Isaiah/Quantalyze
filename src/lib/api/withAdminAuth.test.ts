import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Unit tests for `withAdminAuth` — the CSRF + admin gate + body guard
 * wrapper used by every /api/admin/* mutation route. The new body
 * guard (Step 3.5 of the /review pass) rejects non-object JSON
 * payloads with a clean 400 instead of letting the handler crash on
 * `const { id } = body` against a primitive.
 *
 * Mocks: server-side Supabase client (auth.getUser), isAdminUser gate,
 * admin client factory, and assertSameOrigin from csrf.ts. Each test
 * invokes the wrapped handler with a fresh Request and asserts on the
 * returned NextResponse.
 */

vi.mock("server-only", () => ({}));

const {
  getUserMock,
  isAdminUserMock,
  createAdminClientMock,
  assertSameOriginMock,
  logAuditEventAsUserMock,
  checkLimitMock,
} = vi.hoisted(() => {
  return {
    getUserMock: vi.fn<() => Promise<{ data: { user: unknown } }>>(),
    isAdminUserMock: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
    createAdminClientMock: vi.fn(() => ({ __admin: true })),
    assertSameOriginMock: vi.fn<(...args: unknown[]) => Response | null>(
      () => null,
    ),
    logAuditEventAsUserMock: vi.fn<(...args: unknown[]) => void>(),
    checkLimitMock: vi.fn<
      (...args: unknown[]) => Promise<{
        success: boolean;
        retryAfter: number;
        reason?: string;
      }>
    >(async () => ({ success: true, retryAfter: 0 })),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: (client: unknown, user: unknown) =>
    isAdminUserMock(client, user),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (req: unknown) => assertSameOriginMock(req),
}));

vi.mock("@/lib/audit", () => ({
  logAuditEventAsUser: (
    client: unknown,
    actingUserId: unknown,
    event: unknown,
  ) => logAuditEventAsUserMock(client, actingUserId, event),
}));

// B15b: the wrapper's rateLimitKey path consumes adminActionLimiter via
// checkLimit. Mock it so the ordering invariant (NOT called on invalid input)
// is observable. The existing gate/body-guard tests don't pass rateLimitKey,
// so checkLimit is never reached there and this mock is inert for them.
vi.mock("@/lib/ratelimit", () => ({
  adminActionLimiter: { __mock: "adminActionLimiter" },
  checkLimit: (...args: unknown[]) => checkLimitMock(...args),
  rateLimitDenyJson: (rl: { retryAfter: number; reason?: string }) =>
    NextResponse.json(
      {
        error:
          rl.reason === "ratelimit_misconfigured"
            ? "Rate limiter unavailable"
            : "Too many requests",
      },
      {
        status: rl.reason === "ratelimit_misconfigured" ? 503 : 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    ),
}));

import { withAdminAuth } from "./withAdminAuth";

function makeRequest(body: unknown): Request {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
  };
  if (body === "INVALID_JSON") {
    init.body = "{not json";
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request("http://localhost:3000/api/admin/test", init);
}

const adminUser = { id: "user-1", email: "admin@example.com" };

describe("withAdminAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: adminUser } });
    isAdminUserMock.mockResolvedValue(true);
    assertSameOriginMock.mockReturnValue(null);
  });

  describe("CSRF + admin gates", () => {
    it("rejects when assertSameOrigin returns a response", async () => {
      const csrfDenied = new Response("csrf", { status: 403 });
      assertSameOriginMock.mockReturnValueOnce(csrfDenied);

      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest({ id: "abc" }));

      expect(res).toBe(csrfDenied);
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects authenticated non-admin requests with 403 and emits admin.access.denied", async () => {
      // audit-2026-05-07 (admin-auth cluster) — silent admin-bypass fix.
      // An authenticated user probing /api/admin/* now leaves a forensic
      // anchor in audit_log via log_audit_event_service (fire-and-forget
      // through logAuditEventAsUser). The 403 body is the generic "Forbidden"
      // — we deliberately don't leak whether the route exists or what role
      // would have been required.
      isAdminUserMock.mockResolvedValueOnce(false);

      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest({ id: "abc" }));

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden" });
      expect(handler).not.toHaveBeenCalled();

      // The audit emission MUST happen on the denial path. If this
      // assertion is removed, the silent-probe regression returns.
      expect(logAuditEventAsUserMock).toHaveBeenCalledTimes(1);
      const [, actingUserId, event] = logAuditEventAsUserMock.mock.calls[0];
      expect(actingUserId).toBe(adminUser.id);
      expect(event).toMatchObject({
        action: "admin.access.denied",
        entity_type: "user",
        entity_id: adminUser.id,
        metadata: {
          path: "/api/admin/test",
          method: "POST",
          email: adminUser.email,
        },
      });
    });

    it("Audit-2026-05-07 C-0146: returns 401 Unauthorized when caller has no JWT", async () => {
      // Pre-fix bug: missing JWT was conflated with non-admin into a single
      // 403 "Unauthorized" envelope. Sibling withAuth.ts and requireRole()
      // already return 401 for null user; this wrapper now matches.
      getUserMock.mockResolvedValueOnce({ data: { user: null } });

      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest({ id: "abc" }));

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
      expect(handler).not.toHaveBeenCalled();
      // isAdminUser should NOT be probed once we've decided the caller
      // is unauthenticated — short-circuit before the DB read.
      expect(isAdminUserMock).not.toHaveBeenCalled();
      // No audit emission on the unauth path — no attributable user_id,
      // and flooding audit_log from this path is a DoS surface.
      expect(logAuditEventAsUserMock).not.toHaveBeenCalled();
    });
  });

  describe("body guard", () => {
    it("rejects null body with 400", async () => {
      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest(null));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Request body must be a JSON object",
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects array body with 400", async () => {
      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest([1, 2, 3]));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Request body must be a JSON object",
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects string body with 400", async () => {
      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest("just a string"));

      expect(res.status).toBe(400);
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects number body with 400", async () => {
      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest(42));

      expect(res.status).toBe(400);
      expect(handler).not.toHaveBeenCalled();
    });

    it("rejects invalid JSON with 400", async () => {
      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest("INVALID_JSON"));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid request body" });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("handler dispatch", () => {
    it("invokes the handler with the body and an admin client on happy path", async () => {
      const responseBody = { ok: true };
      const handler = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(responseBody), { status: 200 }),
        );

      const wrapped = withAdminAuth(handler as never);
      const body = { id: "00000000-0000-0000-0000-000000000001" };
      const res = await wrapped(makeRequest(body));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(responseBody);
      expect(handler).toHaveBeenCalledTimes(1);
      const [bodyArg, adminArg] = handler.mock.calls[0];
      expect(bodyArg).toEqual(body);
      expect(adminArg).toEqual({ __admin: true });
      expect(createAdminClientMock).toHaveBeenCalled();
    });
  });
});

describe("withAdminAuth — B15b validate-before-limit", () => {
  const SCHEMA = z.object({ id: z.string().uuid() });
  const VALID_ID = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: adminUser } });
    isAdminUserMock.mockResolvedValue(true);
    assertSameOriginMock.mockReturnValue(null);
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
  });

  it("schema-invalid body → 400 and checkLimit is NEVER called (no token burned)", async () => {
    // The load-bearing B15b invariant for the admin wrapper, mirroring
    // withAuthLimited: a well-formed-object-but-schema-invalid body (here a
    // non-UUID id) is rejected before the rateLimitKey limiter runs. If a
    // refactor reverts the order (limit before validate), this fails.
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAdminAuth(handler, {
      schema: SCHEMA,
      rateLimitKey: (u) => `t:${u.id}`,
    });
    const res = await wrapped(makeRequest({ id: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(checkLimitMock).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("malformed JSON → 400 before the limiter (no token consumed)", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAdminAuth(handler, {
      schema: SCHEMA,
      rateLimitKey: (u) => `t:${u.id}`,
    });
    const res = await wrapped(makeRequest("INVALID_JSON"));
    expect(res.status).toBe(400);
    expect(checkLimitMock).not.toHaveBeenCalled();
  });

  it("valid body → checkLimit called once, then handler with the typed body", async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAdminAuth(handler, {
      schema: SCHEMA,
      rateLimitKey: (u) => `t:${u.id}`,
    });
    const res = await wrapped(makeRequest({ id: VALID_ID }));
    expect(res.status).toBe(200);
    expect(checkLimitMock).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0] as unknown[])[0]).toEqual({ id: VALID_ID });
  });

  it("valid body but over limit → 429, handler not called", async () => {
    checkLimitMock.mockResolvedValueOnce({ success: false, retryAfter: 30 });
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAdminAuth(handler, {
      schema: SCHEMA,
      rateLimitKey: (u) => `t:${u.id}`,
    });
    const res = await wrapped(makeRequest({ id: VALID_ID }));
    expect(res.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
  });

  it("schema-less rateLimitKey route still object-guards the body before limiting", async () => {
    // Even without a schema, the object-guard parse runs before the limiter
    // (B15b reorder), so a non-object body is 400 with no token consumed.
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAdminAuth(handler, {
      rateLimitKey: (u) => `t:${u.id}`,
    });
    const res = await wrapped(makeRequest([1, 2, 3]));
    expect(res.status).toBe(400);
    expect(checkLimitMock).not.toHaveBeenCalled();
  });
});
