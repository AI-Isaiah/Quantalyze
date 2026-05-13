/**
 * RBAC matrix — UNIT layer. (Originally `rbac-matrix.test.ts`; split
 * 2026-05-13 per P696 fix.)
 *
 * This file holds the fast, mock-based unit-level matrix that exercises
 * `withRole` under every combination of { caller role set } × {
 * required role }. It catches OR-semantics regressions in the route
 * wrapper without touching a real DB.
 *
 * The integration-level matrix that drives the real Postgres + auth
 * stack (FK, RLS, CHECK constraints) lives in
 * `rbac-matrix.test.ts` and is skip-gated by SUPABASE_TEST_URL +
 * SUPABASE_TEST_SERVICE_ROLE_KEY. P696 reasoning:
 *
 *   - The pre-P696 file mocked both the Supabase client AND the auth
 *     module, so it was a unit test PRETENDING to be an integration
 *     test. RLS / FK / CHECK regressions could ship undetected.
 *   - The split keeps the cheap unit coverage (this file, always-on)
 *     and adds true integration coverage (sibling file, gated on
 *     test-DB creds — see reference_test_supabase_project.md).
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
  adminUserAppRolesSelectMock,
  afterSpy,
  logAuditRpcMock,
  createAdminClientMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  assertSameOriginMock: vi.fn<(r: unknown) => Response | null>(() => null),
  userRolesQueryMock: vi.fn(),
  userAppRolesInsertMock: vi.fn(),
  userAppRolesDeleteMock: vi.fn(),
  // P462 — the route now calls `fetchUserRoles(admin, targetUserId)` after
  // every grant + revoke to build the unified `{ user_id, roles[] }`
  // envelope. The admin client must therefore support
  // `from("user_app_roles").select("role").eq("user_id", id)`.
  adminUserAppRolesSelectMock: vi.fn(),
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
//
// audit-2026-05-07 P459 unified-gate fallback: `withRole('admin')` now
// falls through to `isAdminUser` when user_app_roles misses, which
// chains `.eq("user_id", id).eq("role", "admin").limit(1)` and also
// queries `profiles.is_admin`. We support both shapes so the gate's
// negative path (caller is NOT admin) returns cleanly instead of
// throwing on an unmocked chain.
function makeUserClient() {
  return {
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table === "user_app_roles") {
        return {
          select: () => ({
            eq: (col1: string, val1: string) => {
              const bare = userRolesQueryMock(val1);
              return Object.assign(bare, {
                eq: (_col2: string, val2: string) => ({
                  limit: async (_n: number) => {
                    const res = await userRolesQueryMock(val1);
                    if (res.error) return res;
                    const filtered = (res.data ?? []).filter(
                      (r: { role: string }) => r.role === val2,
                    );
                    return { data: filtered, error: null };
                  },
                }),
              });
              void col1;
            },
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { is_admin: false },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in user client: ${table}`);
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
        // P462 — `fetchUserRoles` in the route reads the post-mutation
        // role set via select("role").eq("user_id", id). Mirror that
        // chain here so the audit-event assertion path doesn't blow up
        // on an unmocked `.select`. The promise resolves to the canonical
        // PostgREST shape `{ data, error }`.
        select: (_cols: string) => ({
          eq: (_col: string, userId: string) => adminUserAppRolesSelectMock(userId),
        }),
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
 * Build the Next 16 `{ params }` context object a dynamic-route handler
 * receives. Next wraps the resolved param shape in a Promise per the
 * app-router file-convention contract (see node_modules/next/dist/docs/
 * 01-app/03-api-reference/03-file-conventions/route.md).
 */
function makeParamsCtx<P>(params: P): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
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
          // The wrapper issues exactly ONE getUserRoles call per request
          // now — requireRole returns the resolved role set alongside the
          // pass/fail discriminant, and withRole reuses it for the
          // handler context.
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
    // P462 — fetchUserRoles default for the unified `{ user_id, roles[] }`
    // envelope. Tests that care about a specific post-mutation role set
    // (e.g. grant returns ["allocator"], revoke returns []) override this
    // locally before invoking the route.
    adminUserAppRolesSelectMock.mockResolvedValue({
      data: [],
      error: null,
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
    // P462 — post-grant role set the route should echo back to the caller.
    adminUserAppRolesSelectMock.mockResolvedValue({
      data: [{ role: "allocator" }],
      error: null,
    });
    const { POST } = await loadRoute();
    const req = makeRequest({ action: "grant", role: "allocator" });
    const res = await POST(req, makeParamsCtx({ id: "target-user-id" }));
    expect(res.status).toBe(200);
    // P462 (audit-2026-05-07) — unified envelope across GET / grant / revoke:
    // `{ user_id, roles: AppRole[] }`. The pre-P462 `{ success, action, role }`
    // shape is gone — same single parser drives the UI now.
    expect(await res.json()).toEqual({
      user_id: "target-user-id",
      roles: ["allocator"],
    });
    expect(userAppRolesInsertMock).toHaveBeenCalledTimes(1);
    const [row, opts] = userAppRolesInsertMock.mock.calls[0];
    expect(row).toMatchObject({
      user_id: "target-user-id",
      role: "allocator",
      granted_by: "admin-user-id",
    });
    expect(opts).toMatchObject({ onConflict: "user_id,role" });

    // Audit emission — wait for the microtask deferred by `after()` to
    // settle. vi.waitFor polls a predicate with a bounded timeout and
    // fails loudly if the call never lands (unlike a triple
    // Promise.resolve chain that would silently green on an async
    // emission regression).
    await vi.waitFor(() => expect(logAuditRpcMock).toHaveBeenCalled());
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
    // P462 — post-revoke role set is empty for this target.
    adminUserAppRolesSelectMock.mockResolvedValue({
      data: [],
      error: null,
    });
    const { POST } = await loadRoute();
    const req = makeRequest({ action: "revoke", role: "analyst" });
    const res = await POST(req, makeParamsCtx({ id: "target-user-id" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // P462 — unified `{ user_id, roles[] }` envelope; pre-fix shape
    // `{ success, action, role, removed_rows }` is gone.
    expect(body).toEqual({
      user_id: "target-user-id",
      roles: [],
    });
    expect(userAppRolesDeleteMock).toHaveBeenCalledTimes(1);
    expect(userAppRolesDeleteMock.mock.calls[0][0]).toMatchObject({
      userId: "target-user-id",
      role: "analyst",
    });

    await vi.waitFor(() => expect(logAuditRpcMock).toHaveBeenCalled());
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
    const res = await POST(req, makeParamsCtx({ id: "admin-user-id" }));
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
    const res = await POST(req, makeParamsCtx({ id: "target-user-id" }));
    expect(res.status).toBe(403);
    expect(userAppRolesInsertMock).not.toHaveBeenCalled();
  });

  it("rejects invalid body with 400 (Zod)", async () => {
    const { POST } = await loadRoute();
    const req = makeRequest({ action: "grant", role: "super_admin" });
    const res = await POST(req, makeParamsCtx({ id: "target-user-id" }));
    expect(res.status).toBe(400);
    expect(userAppRolesInsertMock).not.toHaveBeenCalled();
  });

  it("rejects missing target user id with 400", async () => {
    const { POST } = await loadRoute();
    const req = makeRequest(
      { action: "grant", role: "allocator" },
      // The wrapper now reads `id` from the resolved params context, not
      // from the URL. Simulate a router that failed to wire the segment
      // through by passing an empty params object.
      "http://localhost:3000/api/admin/users//roles",
    );
    const res = await POST(req, makeParamsCtx({ id: "" }));
    expect(res.status).toBe(400);
    expect(userAppRolesInsertMock).not.toHaveBeenCalled();
  });
});
