import { describe, it, expect, vi, beforeEach } from "vitest";

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
} = vi.hoisted(() => {
  return {
    getUserMock: vi.fn<() => Promise<{ data: { user: unknown } }>>(),
    isAdminUserMock: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
    createAdminClientMock: vi.fn(() => ({ __admin: true })),
    assertSameOriginMock: vi.fn<(...args: unknown[]) => Response | null>(
      () => null,
    ),
    logAuditEventAsUserMock: vi.fn<(...args: unknown[]) => void>(),
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

    it("rejects unauthenticated requests with 401 and emits NO audit row", async () => {
      // audit-2026-05-07 (admin-auth cluster) — 401 vs 403 split. Pre-fix
      // the no-session case returned 403, conflating "you haven't shown me
      // credentials" with "your credentials don't grant access". The
      // unauth path also does NOT emit admin.access.denied — without a
      // user_id there's nothing forensically attributable, and audit-
      // logging every unauthenticated probe is a DoS surface.
      getUserMock.mockResolvedValueOnce({ data: { user: null } });

      const handler = vi.fn();
      const wrapped = withAdminAuth(handler as never);
      const res = await wrapped(makeRequest({ id: "abc" }));

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Authentication required" });
      expect(handler).not.toHaveBeenCalled();
      expect(isAdminUserMock).not.toHaveBeenCalled();
      expect(logAuditEventAsUserMock).not.toHaveBeenCalled();
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

      // Audit-2026-05-07 C-0146: authenticated but not admin → 403 Forbidden
      // (RFC 7231). Pre-fix this returned 403 with body "Unauthorized";
      // the split now uses "Forbidden" so the body matches the status.
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
