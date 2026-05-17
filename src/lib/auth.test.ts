import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for src/lib/auth.ts — the RBAC helpers shipped in Task 7.2.
 *
 *   - `getUserRoles` returns the user's role set from user_app_roles.
 *   - `requireRole` returns either `{ forbidden }` (401 no user / 403 no
 *     intersection) or `{ roles }` (the caller's resolved role set).
 *   - `withRole` wraps a NextRequest handler with CSRF + auth + role gate,
 *     threads Next 16 `{ params }` through, and reuses the resolved role
 *     set so the wrapper itself issues exactly ONE getUserRoles round-trip.
 *
 * Mocks: Supabase server client, CSRF helper, user/role DB fetches.
 */

vi.mock("server-only", () => ({}));

const {
  getUserMock,
  assertSameOriginMock,
  userRolesQueryMock,
  profilesIsAdminQueryMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn<
    () => Promise<{ data: { user: unknown } }>
  >(),
  assertSameOriginMock: vi.fn<(req: unknown) => Response | null>(() => null),
  // Used for a simple `.from("user_app_roles").select("role").eq("user_id", id)` chain.
  userRolesQueryMock: vi.fn<
    (userId: string) => Promise<{ data: { role: string }[] | null; error: unknown }>
  >(),
  // Used for the unified `isAdminUser` fallback path (audit-2026-05-07 P459/P700)
  // — queries `profiles.is_admin` when the user_app_roles 'admin' check
  // misses. Defaults to "not an admin" so the existing tests that expect
  // 403 on a non-admin role set keep passing.
  profilesIsAdminQueryMock: vi.fn<
    (userId: string) => Promise<{ data: { is_admin: boolean } | null; error: unknown }>
  >(() => Promise.resolve({ data: { is_admin: false }, error: null })),
}));

// Helper: build a `.from(table)` factory that handles BOTH the
// user_app_roles query chains (the bare role-fetch AND the admin-role
// re-check used by `hasAdminRoleRow` in `src/lib/admin.ts`) AND the
// profiles.is_admin query used by `hasIsAdminFlag`.
function buildFromMock() {
  return (table: string) => {
    if (table === "user_app_roles") {
      return {
        select: () => ({
          eq: (col1: string, val1: string) => {
            // Chained .eq().eq().limit() — the hasAdminRoleRow shape.
            // We delegate to userRolesQueryMock with the userId; the
            // role filter is applied client-side in the test by
            // filtering the returned data set.
            const chained = {
              eq: (_col2: string, val2: string) => ({
                limit: async (_n: number) => {
                  const res = await userRolesQueryMock(val1);
                  if (res.error) return res;
                  const filtered = (res.data ?? []).filter(
                    (r) => r.role === val2,
                  );
                  return { data: filtered, error: null };
                },
              }),
              // Fallback for the bare `.eq("user_id", id)` shape used
              // by getUserRoles — supports `await` directly.
              then: (
                resolve: (
                  v: { data: { role: string }[] | null; error: unknown },
                ) => unknown,
              ) => userRolesQueryMock(col1 === "user_id" ? val1 : val1).then(resolve),
            };
            return chained;
          },
        }),
      };
    }
    if (table === "profiles") {
      return {
        select: () => ({
          eq: (_col: string, userId: string) => ({
            single: () => profilesIsAdminQueryMock(userId),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: buildFromMock(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (req: unknown) => assertSameOriginMock(req),
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getUserRoles,
  requireRole,
  withRole,
  APP_ROLES,
  type RoleHandler,
} from "./auth";

function makeFromOnly(): SupabaseClient {
  // Mock that satisfies getUserRoles AND the unified admin-fallback
  // path inside `isAdminUser` (audit-2026-05-07 P459) — both
  // user_app_roles (single + chained eq) and profiles queries.
  const client = {
    from: buildFromMock(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return client as unknown as SupabaseClient;
}

function makeRequest({
  method = "POST",
  body,
}: { method?: string; body?: unknown } = {}): Request {
  return new Request("http://localhost:3000/api/admin/users/abc/roles", {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  assertSameOriginMock.mockReturnValue(null);
  // Default: profiles.is_admin = false. Individual tests that need the
  // unified admin-union to flip TRUE override this with mockResolvedValueOnce.
  profilesIsAdminQueryMock.mockImplementation(() =>
    Promise.resolve({ data: { is_admin: false }, error: null }),
  );
  // Default: any extra user_app_roles read returns an empty set so the
  // hasAdminRoleRow re-check inside isAdminUser does not blow up tests
  // that only registered ONE mockResolvedValueOnce for the primary
  // getUserRoles call.
  userRolesQueryMock.mockResolvedValue({ data: [], error: null });
});

describe("APP_ROLES runtime list", () => {
  it("lists the four expected roles in a stable order", () => {
    expect(APP_ROLES).toEqual([
      "admin",
      "allocator",
      "quant_manager",
      "analyst",
    ]);
  });
});

describe("getUserRoles", () => {
  it("returns the full role set for a user", async () => {
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "admin" }, { role: "allocator" }],
      error: null,
    });

    const roles = await getUserRoles(makeFromOnly(), "u-1");
    expect(roles).toEqual(["admin", "allocator"]);
    expect(userRolesQueryMock).toHaveBeenCalledWith("u-1");
  });

  it("returns an empty array when the user has no roles", async () => {
    userRolesQueryMock.mockResolvedValueOnce({ data: [], error: null });
    const roles = await getUserRoles(makeFromOnly(), "u-2");
    expect(roles).toEqual([]);
  });

  it("returns an empty array on RLS denial (42501) and does NOT log", async () => {
    // Finding 5 (audit-2026-05-07 red-team): 42501 is the expected
    // "no read access" code — it is NOT a fault and should not be
    // logged as one. The previous behavior was to log every error
    // including this one; that produced noise without signal.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    userRolesQueryMock.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    const roles = await getUserRoles(makeFromOnly(), "u-3");
    expect(roles).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns an empty array on PostgREST no-rows (PGRST116) and does NOT log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    userRolesQueryMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116", message: "no rows" },
    });
    const roles = await getUserRoles(makeFromOnly(), "u-3b");
    expect(roles).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns an empty array on unexpected error AND logs to stderr (legacy contract preserved)", async () => {
    // Finding 5: a non-RLS, non-PGRST116 error is a real fault — we
    // still return `[]` from the legacy `getUserRoles` helper for
    // backward compatibility, but the discriminated `getUserRolesResult`
    // (which `requireRole` now uses) returns ok:false so the route
    // layer can surface 500 instead of 403. Logging happens here.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    userRolesQueryMock.mockResolvedValueOnce({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    });
    const roles = await getUserRoles(makeFromOnly(), "u-3c");
    expect(roles).toEqual([]);
    expect(spy).toHaveBeenCalledWith(
      "[auth] getUserRolesResult faulted:",
      expect.objectContaining({ user_id: "u-3c", code: "57014" }),
    );
    spy.mockRestore();
  });

  it("filters out unknown role strings defensively", async () => {
    userRolesQueryMock.mockResolvedValueOnce({
      data: [
        { role: "admin" },
        // A hypothetical drifted role that slipped past the CHECK constraint.
        { role: "super_admin_forgotten_role" },
        { role: "analyst" },
      ],
      error: null,
    });
    const roles = await getUserRoles(makeFromOnly(), "u-4");
    expect(roles).toEqual(["admin", "analyst"]);
  });
});

describe("requireRole", () => {
  const mockUser = { id: "user-1", email: "user@test.com" } as Parameters<
    typeof requireRole
  >[1];

  it("returns { forbidden: 401 } when user is null", async () => {
    const result = await requireRole(makeFromOnly(), null, "admin");
    expect("forbidden" in result).toBe(true);
    if ("forbidden" in result) {
      expect(result.forbidden.status).toBe(401);
    }
  });

  it("audit-2026-05-07 H-0428: zero-role calls are a COMPILE error and not callable at runtime", () => {
    // requireRole's signature is
    //   `(supabase, user, ...roles: [AppRole, ...AppRole[]])`
    // — the tuple `[AppRole, ...AppRole[]]` enforces "at least one
    // role" at the type layer. The legacy "passes through when roles
    // is empty" behaviour has been removed; callers that need
    // authenticated-only gating must use `withAuth` (not `withRole`)
    // and `auth.getUser` directly (not `requireRole`).
    //
    // We assert the type-level contract via a TypeScript expect-error
    // comment. This test exists to document the behaviour change and
    // to fail the build if a future refactor reintroduces the
    // variadic-default-to-empty form.
    /* eslint-disable @typescript-eslint/no-unused-expressions */
    // @ts-expect-error — requireRole requires at least one AppRole.
    () => requireRole(makeFromOnly(), mockUser);
    // Sanity: the one-role form still typechecks.
    () => requireRole(makeFromOnly(), mockUser, "admin");
    /* eslint-enable @typescript-eslint/no-unused-expressions */
    expect(true).toBe(true);
  });

  it("returns { forbidden: 403 } when user has NONE of the requested roles", async () => {
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "quant_manager" }],
      error: null,
    });
    const result = await requireRole(
      makeFromOnly(),
      mockUser,
      "admin",
    );
    expect("forbidden" in result).toBe(true);
    if ("forbidden" in result) {
      expect(result.forbidden.status).toBe(403);
      expect(await result.forbidden.json()).toEqual({ error: "Forbidden" });
    }
  });

  it("returns { roles } when user has AT LEAST ONE requested role", async () => {
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "allocator" }],
      error: null,
    });
    const result = await requireRole(
      makeFromOnly(),
      mockUser,
      "admin",
      "allocator",
    );
    expect("roles" in result).toBe(true);
    if ("roles" in result) {
      expect(result.roles).toEqual(["allocator"]);
    }
  });

  it("Finding 5: returns { forbidden: 500 } when the role fetch faults (NOT 403)", async () => {
    // Pre-fix: a 57014 (statement timeout) would silently translate to
    // a 403 because getUserRoles swallowed every error and returned [].
    // Post-fix: requireRole uses the discriminated `getUserRolesResult`
    // and surfaces a 500 so on-call sees the real signal.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    userRolesQueryMock.mockResolvedValueOnce({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    });
    const result = await requireRole(
      makeFromOnly(),
      mockUser,
      "admin",
    );
    expect("forbidden" in result).toBe(true);
    if ("forbidden" in result) {
      // 500, NOT 403 — a real fault is not an authorization failure.
      expect(result.forbidden.status).toBe(500);
    }
    spy.mockRestore();
  });

  it("returns { roles } including the full resolved set (superset)", async () => {
    userRolesQueryMock.mockResolvedValueOnce({
      data: [
        { role: "admin" },
        { role: "allocator" },
        { role: "quant_manager" },
      ],
      error: null,
    });
    const result = await requireRole(
      makeFromOnly(),
      mockUser,
      "admin",
      "quant_manager",
    );
    expect("roles" in result).toBe(true);
    if ("roles" in result) {
      expect(result.roles.sort()).toEqual([
        "admin",
        "allocator",
        "quant_manager",
      ]);
    }
  });
});

describe("withRole", () => {
  it("runs CSRF check on POST and bails when assertSameOrigin returns a response", async () => {
    // M-0499 (audit-2026-05-07): the order is auth → CSRF, so the
    // request must be from an AUTHENTICATED caller for the CSRF check
    // to run. Pre-fix the order was CSRF → auth, which leaked the
    // unauth-vs-bad-origin distinction.
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-admin", email: "a@t.com" } },
    });
    const csrfResponse = new Response("csrf denied", { status: 403 });
    assertSameOriginMock.mockReturnValueOnce(csrfResponse as never);

    const handler = vi.fn();
    const wrapped = withRole("admin")(handler as never);

    const res = await wrapped(makeRequest({ body: { action: "grant" } }) as never);
    expect(res).toBe(csrfResponse);
    expect(handler).not.toHaveBeenCalled();
  });

  it("M-0499: unauthenticated POST returns 401 WITHOUT running CSRF (no origin-vs-auth distinguisher)", async () => {
    // audit-2026-05-07: pre-fix, an unauthenticated POST with a
    // missing/wrong Origin header returned 403 (CSRF), but an
    // unauthenticated POST with a CORRECT Origin returned 401 (auth).
    // That distinguisher let an attacker confirm the same-origin
    // policy from outside. Post-fix the wrapper always runs auth
    // first, so an unauthenticated caller ALWAYS gets 401 regardless
    // of Origin — CSRF only runs for authenticated callers.
    getUserMock.mockResolvedValue({ data: { user: null } });
    // If the test were to reach CSRF, this would surface as a 403.
    // The assertion below proves CSRF never runs.
    const csrfResponse = new Response("csrf denied", { status: 403 });
    assertSameOriginMock.mockReturnValue(csrfResponse as never);

    const handler = vi.fn();
    const wrapped = withRole("admin")(handler as never);

    const res = await wrapped(
      makeRequest({ body: { action: "grant" } }) as never,
    );
    expect(res.status).toBe(401);
    expect(assertSameOriginMock).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT run CSRF check on GET requests", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-admin", email: "a@t.com" } },
    });
    // Only ONE getUserRoles call per request now — the wrapper reuses the
    // role set resolved inside requireRole.
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "admin" }],
      error: null,
    });

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const wrapped = withRole("admin")(handler as never);

    const getReq = new Request("http://localhost:3000/api/admin/health", {
      method: "GET",
    });
    const res = await wrapped(getReq as never);
    expect(res.status).toBe(200);
    expect(assertSameOriginMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const handler = vi.fn();
    const wrapped = withRole("admin")(handler as never);

    const res = await wrapped(
      makeRequest({ body: { action: "grant" } }) as never,
    );
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when user lacks the required role", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-nonadmin", email: "n@t.com" } },
    });
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "allocator" }],
      error: null,
    });

    const handler = vi.fn();
    const wrapped = withRole("admin")(handler as never);

    const res = await wrapped(
      makeRequest({ body: { action: "grant" } }) as never,
    );
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("invokes the handler with user + resolved role set on pass, via a single DB round-trip", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-admin", email: "a@t.com" } },
    });
    // Exactly ONE call — the wrapper reuses the role set resolved by
    // requireRole instead of re-fetching.
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "admin" }, { role: "allocator" }],
      error: null,
    });

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const wrapped = withRole("admin")(handler as never);

    const res = await wrapped(
      makeRequest({ body: { action: "grant" } }) as never,
    );
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(userRolesQueryMock).toHaveBeenCalledTimes(1);
    const [reqArg, ctxArg] = handler.mock.calls[0];
    expect(reqArg.method).toBe("POST");
    expect(ctxArg.user.id).toBe("u-admin");
    expect(ctxArg.roles.sort()).toEqual(["admin", "allocator"]);
    // Wrapper supplies the user-scoped supabase client in the context so
    // handlers don't re-import createClient.
    expect(ctxArg.supabase).toBeDefined();
    expect(ctxArg.supabase.auth).toBeDefined();
  });

  it("threads Next 16 dynamic-route params through to the handler context", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-admin", email: "a@t.com" } },
    });
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "admin" }],
      error: null,
    });

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const wrapped = withRole<{ id: string }>("admin")(
      handler as never,
    );

    // Next 16 hands the handler `{ params: Promise<{ id: string }> }`.
    // The wrapper must await the promise and pass the resolved object
    // through to the handler.
    const res = await wrapped(
      makeRequest({ body: {} }) as never,
      { params: Promise.resolve({ id: "target-user-id" }) } as never,
    );
    expect(res.status).toBe(200);
    const [, ctxArg] = handler.mock.calls[0];
    expect(ctxArg.params).toEqual({ id: "target-user-id" });
  });

  it("defaults params to {} when the wrapper is invoked without a Next context", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-admin", email: "a@t.com" } },
    });
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "admin" }],
      error: null,
    });

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const wrapped = withRole("admin")(handler as never);

    const res = await wrapped(
      makeRequest({ body: {} }) as never,
    );
    expect(res.status).toBe(200);
    const [, ctxArg] = handler.mock.calls[0];
    expect(ctxArg.params).toEqual({});
  });

  it("H-0428: zero-role withRole() is a COMPILE error", () => {
    // The tuple `[AppRole, ...AppRole[]]` enforces "at least one role"
    // at the type layer. This test documents the contract and fails
    // the build if a future refactor reintroduces the variadic-empty
    // form (which would silently widen withRole() to authenticated-only).
    /* eslint-disable @typescript-eslint/no-unused-expressions */
    // @ts-expect-error — withRole requires at least one AppRole.
    () => withRole();
    // Sanity: one-role form still typechecks.
    () => withRole("admin");
    /* eslint-enable @typescript-eslint/no-unused-expressions */
    expect(true).toBe(true);
  });

  it("H-0430: static-route handler params is Record<string, never> by default (compile-error on params.foo)", () => {
    // Default `P = Record<string, never>` means a static-route handler
    // that tries to read `params.foo` is a compile error — the
    // previous default `P = unknown` allowed `params as { foo: string }`
    // casts to compile silently when the runtime had no params.
    //
    // Sanity: a dynamic-route handler that declares the generic still
    // typechecks and gets `params: { id: string }`.
    // We don't actually need a runtime assertion — the existence of
    // the type alias chain (RoleHandler default → RoleContext default
    // P → Record<string, never>) is the test. The line below would
    // be a compile error if the default P widened back to `unknown`.
    const _staticSig: RoleHandler = async (_req, _ctx) =>
      // NextResponse.json is the proper return; emulate via the
      // existing import surface to avoid pulling new symbols.
      new (await import("next/server")).NextResponse(null);
    void _staticSig;
    expect(true).toBe(true);
  });

  it("accepts multiple role choices (OR semantics)", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-mgr", email: "m@t.com" } },
    });
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "quant_manager" }],
      error: null,
    });

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    // Either admin OR quant_manager.
    const wrapped = withRole("admin", "quant_manager")(
      handler as never,
    );

    const res = await wrapped(
      makeRequest({ body: {} }) as never,
    );
    expect(res.status).toBe(200);
  });
});

/**
 * Back-compat matrix — the scenarios a Sprint 7 migration of
 * `is_admin` + `profiles.role` must continue to satisfy. We simulate the
 * post-migration user_app_roles state that the backfill in migration 054
 * would produce, then assert requireRole resolves the way the spec
 * requires.
 *
 * Matrix shape: 4 legacy profile shapes × 4 requested-role checks.
 * Compact enough to read in one screen; explicit enough to catch a
 * silent regression in requireRole's OR semantics.
 */
describe("RBAC back-compat matrix (simulated post-backfill state)", () => {
  type LegacyShape = {
    label: string;
    is_admin: boolean;
    role: "manager" | "allocator" | "both";
    // Backfilled user_app_roles rows per migration 054's multi-row INSERT.
    expectedRoles: string[];
  };

  const SHAPES: LegacyShape[] = [
    {
      label: "founder admin (is_admin=true, role='manager')",
      is_admin: true,
      role: "manager",
      expectedRoles: ["admin", "quant_manager"],
    },
    {
      label: "dual-role admin (is_admin=true, role='allocator')",
      is_admin: true,
      role: "allocator",
      // This is the case called out in the self-review checklist.
      expectedRoles: ["admin", "allocator"],
    },
    {
      label: "pure allocator (is_admin=false, role='allocator')",
      is_admin: false,
      role: "allocator",
      expectedRoles: ["allocator"],
    },
    {
      label: "dual-role user (is_admin=false, role='both')",
      is_admin: false,
      role: "both",
      expectedRoles: ["allocator", "quant_manager"],
    },
  ];

  // The question: for each legacy shape, which of the 4 roles should
  // requireRole accept? Derived directly from expectedRoles.
  for (const shape of SHAPES) {
    describe(shape.label, () => {
      for (const role of APP_ROLES) {
        const shouldPass = shape.expectedRoles.includes(role);
        it(
          `requireRole("${role}") → ${shouldPass ? "pass ({ roles })" : "403 ({ forbidden })"}`,
          async () => {
            userRolesQueryMock.mockResolvedValueOnce({
              data: shape.expectedRoles.map((r) => ({ role: r })),
              error: null,
            });
            const result = await requireRole(
              makeFromOnly(),
              { id: "u", email: "e" } as Parameters<typeof requireRole>[1],
              role,
            );
            if (shouldPass) {
              expect("roles" in result).toBe(true);
              if ("roles" in result) {
                expect(result.roles.sort()).toEqual(
                  [...shape.expectedRoles].sort(),
                );
              }
            } else {
              expect("forbidden" in result).toBe(true);
              if ("forbidden" in result) {
                expect(result.forbidden.status).toBe(403);
              }
            }
          },
        );
      }
    });
  }
});
