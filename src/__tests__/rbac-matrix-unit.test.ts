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
  adminUserAppRolesPreExistingMock,
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
  // audit-2026-05-07 fix M-0288: the grant path reads the pre-existing
  // row via `.select("granted_at").eq("user_id", X).eq("role", Y)
  // .maybeSingle()` to compute `was_new_grant`. Mock that chain
  // separately so the matrix tests can default it to "no pre-existing
  // row" without forcing every caller to mock the new shape.
  adminUserAppRolesPreExistingMock: vi.fn(),
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
      // audit-2026-05-07 specialist-apply (api-contract HIGH + code-reviewer
      // M + security #4): the POST handler now performs a profile-existence
      // check before mutation (mirrors the GET handler's contract). Stub
      // out the profiles lookup so the existing happy-path mutation tests
      // don't fall through to "Unexpected table" — the existence check
      // returns a non-null row by default.
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "target-user-id" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table !== "user_app_roles") {
        throw new Error(`Unexpected table in admin client: ${table}`);
      }
      return {
        // The route uses TWO different select chains on the admin client:
        //   (1) P462 — `fetchUserRoles(admin, X)` post-mutation read:
        //       `.select("role").eq("user_id", X)` (awaited directly,
        //       returns `{ data: row[], error }`).
        //   (2) M-0288 — pre-grant existence check:
        //       `.select("granted_at").eq("user_id", X).eq("role", Y)
        //        .maybeSingle()` (returns `{ data: row|null, error }`).
        // The first .eq() returns a chain node that is BOTH awaitable
        // (shape 1) and chainable (shape 2). The two mocks let tests
        // pin each shape independently.
        select: (_cols: string) => ({
          eq: (_col: string, userId: string) => {
            const postMutationPromise =
              adminUserAppRolesSelectMock(userId);
            return Object.assign(postMutationPromise, {
              eq: (_col2: string, role: string) => ({
                maybeSingle: async () =>
                  adminUserAppRolesPreExistingMock({ userId, role }),
              }),
            });
          },
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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
    // audit-2026-05-07 fix M-0288 — pre-grant existence check default.
    // The new grant path reads (user_id, role) before upsert to compute
    // `was_new_grant`. Default to "no row exists" (new grant). Tests
    // that exercise the re-grant path override this locally.
    adminUserAppRolesPreExistingMock.mockResolvedValue({
      data: null,
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

  it("blocks self-revoke of own admin role with 403 (C-0066)", async () => {
    // audit-2026-05-07 fix C-0066 (api-contract conf-7): self-action
    // rejection standardized on 403 across admin routes (matches
    // deletion-requests/[id]/_shared.ts:84-94). Pre-fix this returned
    // 400 — but the request is well-formed, the action is just
    // forbidden, so 403 is the correct semantic.
    const { POST } = await loadRoute();
    const req = makeRequest(
      { action: "revoke", role: "admin" },
      "http://localhost:3000/api/admin/users/admin-user-id/roles",
    );
    const res = await POST(req, makeParamsCtx({ id: "admin-user-id" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/another admin must act/i);
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

  // M-0016 — the single `role: "super_admin"` case above only exercises ONE
  // branch of the BODY_SCHEMA (z.object({ action: enum, role: enum })). These
  // cases pin the other failure shapes the parser must reject so a future
  // schema refactor (e.g. swapping z.enum for z.string, or dropping a field)
  // can't silently widen the accepted surface. Each asserts the route returns
  // 400 AND never touches the mutation path.
  it.each([
    {
      label: "invalid action ('demote')",
      body: { action: "demote", role: "allocator" },
    },
    {
      label: "missing role field",
      body: { action: "grant" },
    },
    {
      label: "missing action field",
      body: { role: "allocator" },
    },
    {
      label: "both fields missing (empty object)",
      body: {},
    },
    {
      label: "non-string role (number)",
      body: { action: "grant", role: 123 },
    },
    {
      label: "non-string action (boolean)",
      body: { action: true, role: "allocator" },
    },
    {
      label: "JSON-injection object as role",
      body: { action: "grant", role: { $injection: true } },
    },
    {
      label: "array as role",
      body: { action: "grant", role: ["allocator"] },
    },
    {
      label: "null role",
      body: { action: "grant", role: null },
    },
  ])(
    "M-0016: rejects $label with 400 and does not mutate",
    async ({ body }) => {
      const { POST } = await loadRoute();
      const req = makeRequest(body);
      const res = await POST(req, makeParamsCtx({ id: "target-user-id" }));
      expect(res.status).toBe(400);
      expect(userAppRolesInsertMock).not.toHaveBeenCalled();
      expect(userAppRolesDeleteMock).not.toHaveBeenCalled();
    },
  );

  // M-0016: BODY_SCHEMA is a plain z.object (NOT .strict()), so unknown keys
  // are STRIPPED, not rejected. A well-formed body carrying an extra field
  // must therefore still SUCCEED on the valid (action, role) pair — and the
  // stripped extra must not reach the mutation row. Asserting CORRECT
  // (lenient) behavior so a future tightening to .strict() is a deliberate,
  // test-visible change rather than an accidental 400 regression.
  it("M-0016: tolerates and strips an extra unknown field (non-strict object), still grants", async () => {
    adminUserAppRolesSelectMock.mockResolvedValue({
      data: [{ role: "allocator" }],
      error: null,
    });
    const { POST } = await loadRoute();
    const req = makeRequest({
      action: "grant",
      role: "allocator",
      injected_extra: "should-be-stripped",
    });
    const res = await POST(req, makeParamsCtx({ id: "target-user-id" }));
    expect(res.status).toBe(200);
    expect(userAppRolesInsertMock).toHaveBeenCalledTimes(1);
    const [row] = userAppRolesInsertMock.mock.calls[0];
    // The stripped extra must NOT be persisted on the row.
    expect(row).not.toHaveProperty("injected_extra");
    expect(row).toMatchObject({
      user_id: "target-user-id",
      role: "allocator",
    });
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

/**
 * H-0025 — registration-enforcement grep test.
 *
 * The mock-based matrix above proves `withRole`'s OR-semantics in
 * ISOLATION; the sibling integration file proves ONE pilot route end-to-
 * end. Neither asserts that EVERY admin route is actually behind a role
 * gate. A future `src/app/api/admin/<x>/route.ts` shipped WITHOUT any
 * guard (`withRole` / `withAdminAuth` / `requireAdmin` / `isAdminUser`)
 * would be invisible to both layers — an unauthenticated admin endpoint
 * that no test fails on. This source-scan test closes that gap: it
 * enumerates every admin route file and asserts each references at least
 * one canonical admin-guard token. It is a structural smoke test (it
 * does not prove the guard is reached on every code path — that's the
 * per-route handler tests' job), but it catches the dominant regression:
 * a brand-new admin route with no RBAC wrapper at all.
 */
describe("H-0025: every admin route registers an RBAC guard", () => {
  const ADMIN_API_DIR = join(process.cwd(), "src", "app", "api", "admin");
  // Canonical admin-gate tokens. A route is considered guarded if its
  // source references AT LEAST ONE. `isAdminUser` counts because several
  // routes call it directly as an inline 403 gate (e.g. the match/* and
  // allocators/[id]/holdings routes) rather than via a wrapper.
  const GUARD_TOKENS = [
    "withRole",
    "withAdminAuth",
    "requireAdmin",
    "isAdminUser",
  ];

  /** Recursively collect every `route.ts` under the admin API tree. */
  function collectRouteFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectRouteFiles(full));
      } else if (entry.name === "route.ts") {
        out.push(full);
      }
    }
    return out;
  }

  const routeFiles = collectRouteFiles(ADMIN_API_DIR);

  it("discovers admin route files (guard against an empty/mis-globbed scan)", () => {
    // If this drops to 0 the test below would vacuously pass — pin a
    // floor so a future refactor that moves the admin tree fails loud
    // instead of silently covering nothing.
    expect(routeFiles.length).toBeGreaterThanOrEqual(15);
  });

  for (const file of routeFiles) {
    const rel = file.slice(file.indexOf("src/"));
    it(`${rel} references an admin guard`, () => {
      const src = readFileSync(file, "utf8");
      const matched = GUARD_TOKENS.filter((t) => src.includes(t));
      if (matched.length === 0) {
        throw new Error(
          `${rel} references NO admin guard token (${GUARD_TOKENS.join(
            " / ",
          )}). A new admin route MUST be behind a role gate — wrap the ` +
            `handler in withRole/withAdminAuth or call requireAdmin/isAdminUser ` +
            `before any privileged work.`,
        );
      }
      expect(matched.length).toBeGreaterThan(0);
    });
  }
});

/**
 * H-0026 / H-0027 — RLS-regression observability through the REAL
 * requireRole error-discrimination logic.
 *
 * The N×N matrix above mocks `userRolesQueryMock` to ALWAYS resolve a
 * clean `{ data: [{ role }], error: null }`. That blind happy-path mock
 * makes an RLS regression invisible: if the `user_app_roles` SELECT
 * policy broke and started returning a permission error (or the table
 * vanished), the matrix would still pass because it never feeds an error
 * shape through the wrapper.
 *
 * These tests drive the error shapes the live DB would actually emit
 * through the REAL `getUserRolesResult`/`requireRole` logic in
 * src/lib/auth.ts (NOT a re-implementation), pinning the contract:
 *
 *   - A 42501 (RLS insufficient_privilege) denial is the EXPECTED
 *     "no visible roles" path → the caller is treated as role-less →
 *     403 (not a 500). This is by design: from the caller's vantage an
 *     RLS denial means "you have no roles I can see".
 *   - Any OTHER error (timeout, schema drift, a dropped `user_app_roles`
 *     table → 42P01) is a REAL fault → 500, NOT a silent 403. Pre-fix,
 *     auth.ts swallowed every error to `[]` and mis-translated outages
 *     into authorization denials (audit Finding 5). A 500 here is the
 *     "fail loud" contract that lets on-call see the real signal.
 *
 * Together these prove the wrapper does NOT blindly trust the query
 * result the way the happy-path matrix mock implies.
 */
describe("H-0026/H-0027: withRole surfaces user_app_roles RLS/DB faults (not silent trust)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    getUserMock.mockResolvedValue({
      data: { user: { id: "caller-id", email: "e@t.com" } },
    });
  });

  it("treats a 42501 RLS denial as 'no visible roles' → 403 (admin route)", async () => {
    // The user_app_roles owner-read RLS policy denied the SELECT. From
    // the wrapper's vantage this means "no visible roles" → forbidden.
    userRolesQueryMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied for table user_app_roles" },
    });
    const handler = vi.fn(
      async () => new NextResponse(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const wrapped = withRole("allocator")(handler as never);
    const res = await wrapped(makeRequest() as never);
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("surfaces an UNEXPECTED DB fault (e.g. 42P01 table-missing) as 500 — NOT a silent 403", async () => {
    // A dropped/renamed user_app_roles table (or its SELECT policy
    // breaking in a non-RLS way) emits 42P01 (undefined_table). This is
    // a real outage, NOT an authorization decision. The wrapper MUST
    // return 500 so on-call sees the fault instead of users getting a
    // misleading "you're not authorized".
    userRolesQueryMock.mockResolvedValue({
      data: null,
      error: { code: "42P01", message: 'relation "user_app_roles" does not exist' },
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const handler = vi.fn(
      async () => new NextResponse(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const wrapped = withRole("allocator")(handler as never);
    const res = await wrapped(makeRequest() as never);
    expect(res.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("a statement-timeout (57014) on the roles query is a fault → 500 (masking-outage regression guard)", async () => {
    userRolesQueryMock.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const handler = vi.fn();
    const wrapped = withRole("admin")(handler as never);
    const res = await wrapped(makeRequest() as never);
    // For an 'admin' request, requireRole would fall through to the
    // isAdminUser union ONLY when roles fetched OK and lacked admin.
    // Here the fetch FAULTED, so requireRole short-circuits to 500
    // BEFORE the admin-union fallback — a real fault must never be
    // re-interpreted as an admin grant or a 403.
    expect(res.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("an admin caller whose roles SELECT cleanly returns [] (RLS hides own row) → 403, not crash", async () => {
    // H-0027 RLS-shape probe: the policy returns an empty set (not an
    // error) — the owner_read predicate changed and stopped matching the
    // caller's own rows. requireRole('admin') then consults the
    // isAdminUser union; with profiles.is_admin=false (the makeUserClient
    // default) the caller is NOT admin → 403. This exercises the real
    // empty-result + admin-union fallback path instead of the matrix's
    // pre-seeded role array.
    userRolesQueryMock.mockResolvedValue({ data: [], error: null });
    const handler = vi.fn();
    const wrapped = withRole("admin")(handler as never);
    const res = await wrapped(makeRequest() as never);
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
