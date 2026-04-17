/**
 * Sprint 6 closeout Task 7.3 code-review fix C3.
 *
 * Admins cannot approve OR reject their own GDPR Art. 17 deletion
 * request — another admin must act. This mirrors the self-revoke
 * precedent already established in /api/admin/users/[id]/roles (Task
 * 7.2).
 *
 * This test file drives the approve + reject route handlers directly
 * with a mocked Supabase stack. It asserts:
 *
 *   1. An admin who IS NOT the deletion-request target: passes the
 *      self-guard (and the route proceeds — we mock the downstream
 *      sanitize RPC + update + audit to success, verifying the guard
 *      is order-correct).
 *   2. An admin whose own user_id matches the request row's user_id:
 *      hits the guard, receives 403 with the documented message, and
 *      NEVER triggers the sanitize RPC or the request-update mutation.
 *
 * The reject route gets the same pair of tests for its analogous
 * guard.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const {
  getUserMock,
  assertSameOriginMock,
  userRolesQueryMock,
  requestLoadMock,
  requestUpdateMock,
  sanitizeUserRpcMock,
  logAuditRpcMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  assertSameOriginMock: vi.fn<(r: unknown) => Response | null>(() => null),
  userRolesQueryMock: vi.fn(),
  requestLoadMock: vi.fn(),
  requestUpdateMock: vi.fn(),
  sanitizeUserRpcMock: vi.fn(),
  logAuditRpcMock: vi.fn(),
}));

function makeUserClient() {
  return {
    auth: { getUser: getUserMock },
    // withRole queries user_app_roles internally to resolve the caller's
    // role set. The deletion routes don't touch this client beyond that
    // + the audit RPC.
    from: (table: string) => {
      if (table === "user_app_roles") {
        return {
          select: () => ({
            eq: (_col: string, userId: string) => userRolesQueryMock(userId),
          }),
        };
      }
      throw new Error(`Unexpected table in user client: ${table}`);
    },
    rpc: logAuditRpcMock,
  };
}

function makeAdminClient() {
  // The deletion routes use admin to (a) load the request row and
  // (b) update completed_at/rejected_at. The approve route also calls
  // the sanitize_user RPC on admin.
  return {
    from: (table: string) => {
      if (table !== "data_deletion_requests") {
        throw new Error(`Unexpected table in admin client: ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => requestLoadMock(),
          }),
        }),
        update: (patch: unknown) => ({
          eq: (_col: string, id: string) => requestUpdateMock(id, patch),
        }),
      };
    },
    rpc: (fn: string, args: unknown) => {
      if (fn === "sanitize_user") return sanitizeUserRpcMock(args);
      throw new Error(`Unexpected admin RPC: ${fn}`);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeUserClient()),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (req: unknown) => assertSameOriginMock(req),
}));

vi.mock("next/server", async (orig) => {
  const real = await orig<typeof import("next/server")>();
  return {
    ...real,
    after: (cb: () => void | Promise<void>) => queueMicrotask(() => void cb()),
  };
});

import { NextRequest } from "next/server";

function makeRequest(
  requestId: string,
  body: unknown = {},
  path: "approve" | "reject" = "approve",
): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/admin/deletion-requests/${requestId}/${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify(body),
    },
  );
}

function makeParamsCtx<P>(params: P): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
}

async function loadApproveRoute() {
  vi.resetModules();
  return await import(
    "@/app/api/admin/deletion-requests/[id]/approve/route"
  );
}

async function loadRejectRoute() {
  vi.resetModules();
  return await import(
    "@/app/api/admin/deletion-requests/[id]/reject/route"
  );
}

describe("POST /api/admin/deletion-requests/[id]/approve — self-action guard (C3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    // Default caller identity: the admin acting.
    getUserMock.mockResolvedValue({
      data: { user: { id: "admin-user-id", email: "a@test.com" } },
    });
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "admin" }],
      error: null,
    });
    requestUpdateMock.mockResolvedValue({ error: null });
    sanitizeUserRpcMock.mockResolvedValue({ data: true, error: null });
    logAuditRpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("returns 403 + does not sanitize when admin targets their OWN deletion request", async () => {
    // Request row whose user_id == caller id.
    requestLoadMock.mockResolvedValue({
      data: {
        id: "req-self",
        user_id: "admin-user-id",
        requested_at: new Date().toISOString(),
        completed_at: null,
        rejected_at: null,
      },
      error: null,
    });

    const { POST } = await loadApproveRoute();
    const req = makeRequest("req-self", {}, "approve");
    const res = await POST(req, makeParamsCtx({ id: "req-self" }));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/admins cannot approve their own/i);

    // Critical: the sanitize RPC must NOT be invoked, and the request
    // row must NOT be updated.
    expect(sanitizeUserRpcMock).not.toHaveBeenCalled();
    expect(requestUpdateMock).not.toHaveBeenCalled();
  });

  it("proceeds when admin targets a DIFFERENT user's deletion request (guard is order-correct)", async () => {
    requestLoadMock.mockResolvedValue({
      data: {
        id: "req-other",
        user_id: "target-user-id",
        requested_at: new Date().toISOString(),
        completed_at: null,
        rejected_at: null,
      },
      error: null,
    });

    const { POST } = await loadApproveRoute();
    const req = makeRequest("req-other", {}, "approve");
    const res = await POST(req, makeParamsCtx({ id: "req-other" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      target_user_id: string;
      was_first_run: boolean;
    };
    expect(body.success).toBe(true);
    expect(body.target_user_id).toBe("target-user-id");
    expect(body.was_first_run).toBe(true);

    // sanitize RPC was called with the TARGET user's id (not the admin's)
    expect(sanitizeUserRpcMock).toHaveBeenCalledTimes(1);
    expect(sanitizeUserRpcMock.mock.calls[0][0]).toMatchObject({
      p_user_id: "target-user-id",
    });
    expect(requestUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("self-guard fires BEFORE the terminal-state guards (security-ordering invariant)", async () => {
    // A request that's already completed AND belongs to the admin. The
    // self-guard must preempt the "already completed" 409 so a leaked
    // completed-row for the admin doesn't let them probe.
    requestLoadMock.mockResolvedValue({
      data: {
        id: "req-self-completed",
        user_id: "admin-user-id",
        requested_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        rejected_at: null,
      },
      error: null,
    });

    const { POST } = await loadApproveRoute();
    const req = makeRequest("req-self-completed", {}, "approve");
    const res = await POST(req, makeParamsCtx({ id: "req-self-completed" }));

    expect(res.status).toBe(403);
    expect(sanitizeUserRpcMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/deletion-requests/[id]/reject — self-action guard (C3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    getUserMock.mockResolvedValue({
      data: { user: { id: "admin-user-id", email: "a@test.com" } },
    });
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "admin" }],
      error: null,
    });
    requestUpdateMock.mockResolvedValue({ error: null });
    logAuditRpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("returns 403 + does not update when admin targets their OWN deletion request", async () => {
    requestLoadMock.mockResolvedValue({
      data: {
        id: "req-self",
        user_id: "admin-user-id",
        requested_at: new Date().toISOString(),
        completed_at: null,
        rejected_at: null,
      },
      error: null,
    });

    const { POST } = await loadRejectRoute();
    const req = makeRequest("req-self", { reason: "self-reject test" }, "reject");
    const res = await POST(req, makeParamsCtx({ id: "req-self" }));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/admins cannot reject their own/i);
    expect(requestUpdateMock).not.toHaveBeenCalled();
  });

  it("proceeds when admin targets a DIFFERENT user's deletion request", async () => {
    requestLoadMock.mockResolvedValue({
      data: {
        id: "req-other",
        user_id: "target-user-id",
        requested_at: new Date().toISOString(),
        completed_at: null,
        rejected_at: null,
      },
      error: null,
    });

    const { POST } = await loadRejectRoute();
    const req = makeRequest("req-other", { reason: "bogus" }, "reject");
    const res = await POST(req, makeParamsCtx({ id: "req-other" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      target_user_id: string;
    };
    expect(body.success).toBe(true);
    expect(body.target_user_id).toBe("target-user-id");
    expect(requestUpdateMock).toHaveBeenCalledTimes(1);
  });
});
