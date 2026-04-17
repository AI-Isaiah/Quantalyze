/**
 * RBAC end-to-end matrix — Sprint 6 closeout Task 7.2.
 *
 * Two layers in one file:
 *
 *   1. Unit-level matrix exercising `withRole` under every
 *      combination of { caller role set } × { required role }. This
 *      catches a regression in the route-wrapper's OR semantics.
 *   2. Integration-level sanity check exercising the /api/admin/users/[id]/roles
 *      pilot route against a mocked Supabase stack — proves the wrapper
 *      composes with a real Route Handler (Next 16 shape + CSRF + audit
 *      emission).
 *
 * The full 4-role × ~40-route matrix is scoped to Sprint 7 alongside
 * broad `withRole` adoption. See the task plan's scope suggestions for
 * why the narrow matrix is V1.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const {
  getUserMock,
  assertSameOriginMock,
  userRolesQueryMock,
  userAppRolesInsertMock,
  userAppRolesDeleteMock,
  afterSpy,
  logAuditRpcMock,
  createAdminClientMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  assertSameOriginMock: vi.fn<(r: unknown) => Response | null>(() => null),
  userRolesQueryMock: vi.fn(),
  userAppRolesInsertMock: vi.fn(),
  userAppRolesDeleteMock: vi.fn(),
  afterSpy: vi.fn<(cb: () => void | Promise<void>) => void>((cb) => {
    queueMicrotask(() => {
      try {
        void cb();
      } catch {
        // emit() catches internally
      }
    });
  }),
  logAuditRpcMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));

// Shared supabase client factory used by both `withRole` (via createClient)
// and by the route's audit emission (which calls createClient again via
// the dynamic import inside the pilot route).
function makeUserClient() {
  return {
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table !== "user_app_roles") {
        throw new Error(`Unexpected table in user client: ${table}`);
      }
      return {
        select: () => ({
          eq: (_col: string, userId: string) => userRolesQueryMock(userId),
        }),
      };
    },
    rpc: logAuditRpcMock,
  };
}

function makeAdminClient() {
  return {
    from: (table: string) => {
      if (table !== "user_app_roles") {
        throw new Error(`Unexpected table in admin client: ${table}`);
      }
      return {
        upsert: (row: unknown, opts: unknown) =>
          userAppRolesInsertMock(row, opts),
        delete: (opts?: unknown) => ({
          eq: (_colA: string, userId: string) => ({
            eq: (_colB: string, role: string) =>
              userAppRolesDeleteMock({ userId, role, opts }),
          }),
        }),
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeUserClient()),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    createAdminClientMock();
    return makeAdminClient();
  },
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (req: unknown) => assertSameOriginMock(req),
}));

vi.mock("next/server", async (orig) => {
  const real = await orig<typeof import("next/server")>();
  return {
    ...real,
    after: (cb: () => void | Promise<void>) => afterSpy(cb),
  };
});

import { withRole, APP_ROLES } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

function makeRequest(
  body: unknown = {},
  url = "http://localhost:3000/api/admin/users/target-user-id/roles",
): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * The full parametrized matrix for `withRole`: for every combination of
 * {caller holds role X} × {required role Y}, assert the wrapper either
 * passes through (200) or returns 403. Compact N×N table — 16 cases —
 * that guards the OR semantics against a silent off-by-one refactor.
 */
describe("RBAC matrix — withRole(role) × caller.roles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    getUserMock.mockResolvedValue({
      data: { user: { id: "caller-id", email: "e@t.com" } },
    });
  });

  for (const callerRole of APP_ROLES) {
    for (const requiredRole of APP_ROLES) {
      const shouldPass = callerRole === requiredRole;
      it(
        `caller=[${callerRole}] required=${requiredRole} → ${shouldPass ? "pass" : "403"}`,
        async () => {
          // The wrapper calls getUserRoles twice: once inside requireRole,
          // once to build the handler ctx. Return the same data both times.
          userRolesQueryMock.mockResolvedValue({
            data: [{ role: callerRole }],
            error: null,
          });

          const handler = vi.fn(
            async () =>
              new NextResponse(JSON.stringify({ ok: true }), { status: 200 }),
          );
          const wrapped = withRole(requiredRole)(handler as never);
          const res = await wrapped(makeRequest() as never);

          if (shouldPass) {
            expect(res.status).toBe(200);
            expect(handler).toHaveBeenCalledTimes(1);
          } else {
            expect(res.status).toBe(403);
            expect(handler).not.toHaveBeenCalled();
          }
        },
      );
    }
  }

  it("multi-role-requirement: caller matches either → pass", async () => {
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "allocator" }],
      error: null,
    });
    const handler = vi
      .fn()
      .mockResolvedValue(
        new NextResponse(JSON.stringify({ ok: true }), { status: 200 }),
      );
    // Either admin OR allocator — caller has allocator.
    const wrapped = withRole("admin", "allocator")(handler as never);
    const res = await wrapped(makeRequest() as never);
    expect(res.status).toBe(200);
  });

  it("multi-role-requirement: caller matches none → 403", async () => {
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "analyst" }],
      error: null,
    });
    const handler = vi.fn();
    const wrapped = withRole("admin", "allocator")(handler as never);
    const res = await wrapped(makeRequest() as never);
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});

/**
 * Integration-level sanity check for the pilot route.
 *
 * Loads the real route module after the mocks are in place and drives
 * each branch: grant, revoke, self-admin-revoke block, Zod validation
 * failure. Audit emission is verified via the RPC mock.
 */
describe("POST /api/admin/users/[id]/roles — pilot route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    logAuditRpcMock.mockResolvedValue({ data: null, error: null });
    userAppRolesInsertMock.mockResolvedValue({ data: null, error: null });
    userAppRolesDeleteMock.mockResolvedValue({
      data: null,
      error: null,
      count: 1,
    });
    // Default: caller is admin.
    getUserMock.mockResolvedValue({
      data: { user: { id: "admin-user-id", email: "a@test.com" } },
    });
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "admin" }],
      error: null,
    });
  });

  async function loadRoute() {
    // Reset the module registry so the mocks above are observed on each
    // fresh import. vi.resetModules() is the canonical idiom.
    vi.resetModules();
    return await import(
      "@/app/api/admin/users/[id]/roles/route"
    );
  }

  it("grants a role, calls upsert, emits an audit event", async () => {
    const { POST } = await loadRoute();
    const req = makeRequest({ action: "grant", role: "allocator" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      action: "grant",
      role: "allocator",
    });
    expect(userAppRolesInsertMock).toHaveBeenCalledTimes(1);
    const [row, opts] = userAppRolesInsertMock.mock.calls[0];
    expect(row).toMatchObject({
      user_id: "target-user-id",
      role: "allocator",
      granted_by: "admin-user-id",
    });
    expect(opts).toMatchObject({ onConflict: "user_id,role" });

    // Audit emission — give the microtask queue a turn.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(logAuditRpcMock).toHaveBeenCalledWith(
      "log_audit_event",
      expect.objectContaining({
        p_action: "role.grant",
        p_entity_type: "user_app_role",
        p_entity_id: "target-user-id",
        p_metadata: expect.objectContaining({
          role: "allocator",
          granted_by: "admin-user-id",
        }),
      }),
    );
  });

  it("revokes a role, calls delete, emits an audit event", async () => {
    const { POST } = await loadRoute();
    const req = makeRequest({ action: "revoke", role: "analyst" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      action: "revoke",
      role: "analyst",
    });
    expect(userAppRolesDeleteMock).toHaveBeenCalledTimes(1);
    expect(userAppRolesDeleteMock.mock.calls[0][0]).toMatchObject({
      userId: "target-user-id",
      role: "analyst",
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(logAuditRpcMock).toHaveBeenCalledWith(
      "log_audit_event",
      expect.objectContaining({
        p_action: "role.revoke",
        p_entity_type: "user_app_role",
        p_entity_id: "target-user-id",
        p_metadata: expect.objectContaining({
          role: "analyst",
          revoked_by: "admin-user-id",
        }),
      }),
    );
  });

  it("blocks self-revoke of own admin role with 400", async () => {
    // Admin user targeting themself.
    const { POST } = await loadRoute();
    const req = makeRequest(
      { action: "revoke", role: "admin" },
      "http://localhost:3000/api/admin/users/admin-user-id/roles",
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cannot revoke (your|their) own admin/i);
    expect(userAppRolesDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin callers with 403 (withRole gate)", async () => {
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "allocator" }],
      error: null,
    });
    const { POST } = await loadRoute();
    const req = makeRequest({ action: "grant", role: "analyst" });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(userAppRolesInsertMock).not.toHaveBeenCalled();
  });

  it("rejects invalid body with 400 (Zod)", async () => {
    const { POST } = await loadRoute();
    const req = makeRequest({ action: "grant", role: "super_admin" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(userAppRolesInsertMock).not.toHaveBeenCalled();
  });

  it("rejects missing target user id with 400", async () => {
    const { POST } = await loadRoute();
    const req = makeRequest(
      { action: "grant", role: "allocator" },
      // Path without /users/<id>/ — wrapper passes through, route handler
      // short-circuits on the path parse.
      "http://localhost:3000/api/admin/xxx/roles",
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(userAppRolesInsertMock).not.toHaveBeenCalled();
  });
});
