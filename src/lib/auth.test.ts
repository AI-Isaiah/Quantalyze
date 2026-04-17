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
} = vi.hoisted(() => ({
  getUserMock: vi.fn<
    () => Promise<{ data: { user: unknown } }>
  >(),
  assertSameOriginMock: vi.fn<(req: unknown) => Response | null>(() => null),
  // Used for a simple `.from("user_app_roles").select("role").eq("user_id", id)` chain.
  userRolesQueryMock: vi.fn<
    (userId: string) => Promise<{ data: { role: string }[] | null; error: unknown }>
  >(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table !== "user_app_roles") {
        throw new Error(`Unexpected table in test: ${table}`);
      }
      return {
        select: () => ({
          eq: (_col: string, userId: string) =>
            userRolesQueryMock(userId),
        }),
      };
    },
  })),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (req: unknown) => assertSameOriginMock(req),
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserRoles, requireRole, withRole, APP_ROLES } from "./auth";

function makeFromOnly(): SupabaseClient {
  // Minimal mock that satisfies getUserRoles (only calls .from().select().eq()).
  const client = {
    from: (table: string) => {
      if (table !== "user_app_roles") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select: () => ({
          eq: (_col: string, userId: string) => userRolesQueryMock(userId),
        }),
      };
    },
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

  it("returns an empty array on error and logs to stderr", async () => {
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    userRolesQueryMock.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    const roles = await getUserRoles(makeFromOnly(), "u-3");
    expect(roles).toEqual([]);
    expect(spy).toHaveBeenCalledWith(
      "[auth] getUserRoles failed:",
      expect.objectContaining({ user_id: "u-3" }),
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

  it("returns { roles } pass-through when roles list is empty", async () => {
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "allocator" }],
      error: null,
    });
    const result = await requireRole(makeFromOnly(), mockUser);
    expect("roles" in result).toBe(true);
    if ("roles" in result) {
      expect(result.roles).toEqual(["allocator"]);
    }
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
    const csrfResponse = new Response("csrf denied", { status: 403 });
    assertSameOriginMock.mockReturnValueOnce(csrfResponse as never);

    const handler = vi.fn();
    const wrapped = withRole("admin")(handler as never);

    const res = await wrapped(makeRequest({ body: { action: "grant" } }) as never);
    expect(res).toBe(csrfResponse);
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
