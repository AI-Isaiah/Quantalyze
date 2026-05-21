/**
 * audit-2026-05-07 P459 + P699 + P703 — RBAC consolidation regression test.
 *
 * Before this lane's fix there were THREE parallel admin gates that
 * could disagree:
 *
 *   - `isAdminUser` (src/lib/admin.ts): only consulted profiles.is_admin
 *     and the ADMIN_EMAIL env fallback. A user with ONLY a
 *     user_app_roles 'admin' row would FAIL this gate.
 *   - `withRole('admin')` (src/lib/auth.ts): only consulted
 *     user_app_roles. A user with ONLY profiles.is_admin=TRUE (or
 *     ADMIN_EMAIL-matched email) would FAIL this gate.
 *   - The ADMIN_EMAIL env fallback inside isAdminUser was invisible to
 *     anything that checked user_app_roles directly.
 *
 * This test pins the post-fix invariant: BOTH gates consult the SAME
 * union source. A grant in ANY ONE of the three signals lights up BOTH
 * gates. A user with NO grant in any signal fails BOTH.
 *
 * The pre-fix code would fail this test on the cases where the grant
 * is present in a signal that the gate didn't previously consult.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const {
  getUserMock,
  assertSameOriginMock,
  userAppRolesQueryMock,
  profilesIsAdminMock,
  auditRpcMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn<
    () => Promise<{ data: { user: { id: string; email?: string } | null } }>
  >(),
  assertSameOriginMock: vi.fn<(r: unknown) => Response | null>(() => null),
  // Returns the rows for the current scenario. Test cases set this per-it.
  userAppRolesQueryMock: vi.fn<
    () => Promise<{ data: { role: string }[] | null; error: unknown }>
  >(),
  profilesIsAdminMock: vi.fn<
    () => Promise<{ data: { is_admin: boolean } | null; error: unknown }>
  >(),
  auditRpcMock: vi.fn(),
}));

function makeSupabaseClient() {
  return {
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table === "user_app_roles") {
        return {
          select: () => ({
            eq: (col1: string, val1: string) => {
              const bare = userAppRolesQueryMock();
              return Object.assign(bare, {
                eq: (_col2: string, val2: string) => ({
                  limit: async (_n: number) => {
                    const res = await userAppRolesQueryMock();
                    if (res.error) return res;
                    const filtered = (res.data ?? []).filter(
                      (r) => r.role === val2,
                    );
                    return { data: filtered, error: null };
                  },
                }),
              });
              void col1;
              void val1;
            },
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () => profilesIsAdminMock(),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
    rpc: auditRpcMock,
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeSupabaseClient()),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (req: unknown) => assertSameOriginMock(req),
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdminUser } from "@/lib/admin";
import { withRole } from "@/lib/auth";

function makeRequest(method = "GET"): Request {
  return new Request("http://localhost:3000/api/test", {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  assertSameOriginMock.mockReturnValue(null);
  auditRpcMock.mockResolvedValue({ data: null, error: null });
  // Defaults: neither signal grants admin.
  userAppRolesQueryMock.mockResolvedValue({ data: [], error: null });
  profilesIsAdminMock.mockResolvedValue({
    data: { is_admin: false },
    error: null,
  });
});

describe("audit-2026-05-07 P459 — isAdminUser unified across all three signals", () => {
  it("grants admin when ONLY user_app_roles has the row (pre-fix: would fail; post-fix: passes)", async () => {
    userAppRolesQueryMock.mockResolvedValue({
      data: [{ role: "admin" }],
      error: null,
    });
    profilesIsAdminMock.mockResolvedValue({
      data: { is_admin: false },
      error: null,
    });

    const ok = await isAdminUser(
      makeSupabaseClient() as unknown as SupabaseClient,
      { id: "u-1", email: "u1@test.com" },
    );

    expect(ok).toBe(true);
  });

  it("grants admin when ONLY profiles.is_admin = TRUE (back-compat path retained)", async () => {
    userAppRolesQueryMock.mockResolvedValue({ data: [], error: null });
    profilesIsAdminMock.mockResolvedValue({
      data: { is_admin: true },
      error: null,
    });

    const ok = await isAdminUser(
      makeSupabaseClient() as unknown as SupabaseClient,
      { id: "u-2", email: "u2@test.com" },
    );

    expect(ok).toBe(true);
  });

  it("denies admin when NEITHER user_app_roles nor profiles.is_admin grants", async () => {
    userAppRolesQueryMock.mockResolvedValue({ data: [], error: null });
    profilesIsAdminMock.mockResolvedValue({
      data: { is_admin: false },
      error: null,
    });

    const ok = await isAdminUser(
      makeSupabaseClient() as unknown as SupabaseClient,
      { id: "u-3", email: "u3@test.com" },
    );

    expect(ok).toBe(false);
  });

  it("denies admin when user is null", async () => {
    const ok = await isAdminUser(
      makeSupabaseClient() as unknown as SupabaseClient,
      null,
    );
    expect(ok).toBe(false);
  });

  it("short-circuits on profiles.is_admin (PRIMARY signal) and skips the user_app_roles query", async () => {
    // audit-2026-05-07 C-0144 + C-0150 — contract inversion: profiles.is_admin
    // is now the PRIMARY signal (matches RLS — 19 policy references vs 0 for
    // user_app_roles in non-self-referential policies). When it grants, the
    // additive SECONDARY signal (user_app_roles) is skipped — no wasted DB
    // round-trip.
    profilesIsAdminMock.mockResolvedValue({
      data: { is_admin: true },
      error: null,
    });

    await isAdminUser(
      makeSupabaseClient() as unknown as SupabaseClient,
      { id: "u-4", email: "u4@test.com" },
    );

    expect(userAppRolesQueryMock).not.toHaveBeenCalled();
  });
});

describe("audit-2026-05-07 P703 — withRole('admin') consults the same union as isAdminUser", () => {
  it("passes the gate when ONLY user_app_roles grants (existing path)", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-admin", email: "a@t.com" } },
    });
    userAppRolesQueryMock.mockResolvedValue({
      data: [{ role: "admin" }],
      error: null,
    });

    const handler = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const wrapped = withRole("admin")(handler as never);

    const res = await wrapped(makeRequest("GET") as never);
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("PASSES the gate when ONLY profiles.is_admin grants (pre-fix would 403; post-fix: 200)", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-legacy", email: "legacy@t.com" } },
    });
    // No user_app_roles entry, but legacy profiles.is_admin = TRUE.
    userAppRolesQueryMock.mockResolvedValue({ data: [], error: null });
    profilesIsAdminMock.mockResolvedValue({
      data: { is_admin: true },
      error: null,
    });

    const handler = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const wrapped = withRole("admin")(handler as never);

    const res = await wrapped(makeRequest("GET") as never);

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    // The wrapper synthesizes 'admin' into the resolved role set so
    // handlers reading ctx.roles see a consistent answer.
    const [, ctx] = handler.mock.calls[0];
    expect(ctx.roles).toContain("admin");
  });

  it("DENIES the gate when neither signal grants (regression: must still 403)", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-nobody", email: "n@t.com" } },
    });
    userAppRolesQueryMock.mockResolvedValue({
      data: [{ role: "allocator" }],
      error: null,
    });
    profilesIsAdminMock.mockResolvedValue({
      data: { is_admin: false },
      error: null,
    });

    const handler = vi.fn();
    const wrapped = withRole("admin")(handler as never);

    const res = await wrapped(makeRequest("GET") as never);
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("non-admin role requests (e.g. quant_manager) still rely on user_app_roles alone — no admin fallback", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-q", email: "q@t.com" } },
    });
    // The user has profiles.is_admin = TRUE but no user_app_roles row.
    // withRole('quant_manager') must still 403 — the admin-fallback
    // path is specifically scoped to the 'admin' role request.
    userAppRolesQueryMock.mockResolvedValue({ data: [], error: null });
    profilesIsAdminMock.mockResolvedValue({
      data: { is_admin: true },
      error: null,
    });

    const handler = vi.fn();
    const wrapped = withRole("quant_manager")(handler as never);

    const res = await wrapped(makeRequest("GET") as never);
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});

/**
 * audit-2026-05-07 follow-up — Issue 4
 *
 * Pre-fix, `hasAdminRoleRow` and `hasIsAdminFlag` swallowed ALL Postgres
 * errors unconditionally. A schema-drift error (42P01 "relation does not
 * exist", 42703 "column does not exist") or a statement timeout (57014)
 * silently failed Signal 1, the OR-union leaned on Signals 2/3, and a
 * real admin could get a silent 403 with no breadcrumb.
 *
 * The fix narrows the swallow to ONLY error.code === "42501" (RLS denial,
 * the genuinely expected failure mode) and PGRST116 for the .single()
 * "0 rows" case on profiles. Anything else gets logged via console.error
 * AND captured by Sentry while still returning false (the OR-union
 * fault-tolerance is preserved — we don't escalate one signal hiccup
 * into a full lockout).
 *
 * The test below pins the contract: a non-RLS Postgres error reaches
 * console.error with a stable shape. We cannot easily assert on the
 * Sentry call (lazy `import("@sentry/nextjs")`), but the console.error
 * is the proof-of-life that the silent-swallow regression is closed.
 */
describe("Issue 4 — hasAdminRoleRow/hasIsAdminFlag narrow error swallow (audit-2026-05-07 follow-up)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("hasAdminRoleRow surfaces a non-42501 PG error via console.error (no silent swallow)", async () => {
    // 42P01 = "relation does not exist" — classic schema-drift signal.
    userAppRolesQueryMock.mockResolvedValue({
      data: null,
      error: { code: "42P01", message: 'relation "user_app_roles" does not exist' },
    });
    // Defense in depth: make Signal 2 deny so the gate result is FALSE
    // and we can prove Signal 1 logged.
    profilesIsAdminMock.mockResolvedValue({
      data: { is_admin: false },
      error: null,
    });

    const ok = await isAdminUser(
      makeSupabaseClient() as unknown as SupabaseClient,
      { id: "u-drift", email: "drift@t.com" },
    );
    // OR-union still works — Signal 1 returns false (logged) and
    // Signal 2 also returns false, so the gate denies.
    expect(ok).toBe(false);

    const stderr = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(stderr).toContain("hasAdminRoleRow non-RLS error");
  });

  it("hasAdminRoleRow SILENTLY returns false on a 42501 RLS denial (expected path)", async () => {
    userAppRolesQueryMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied for table user_app_roles" },
    });
    profilesIsAdminMock.mockResolvedValue({
      data: { is_admin: false },
      error: null,
    });

    const ok = await isAdminUser(
      makeSupabaseClient() as unknown as SupabaseClient,
      { id: "u-rls", email: "rls@t.com" },
    );
    expect(ok).toBe(false);
    // 42501 must NOT log — it is the expected failure mode.
    const calls = consoleErrorSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("hasAdminRoleRow non-RLS error"),
    );
    expect(calls.length).toBe(0);
  });

  it("hasIsAdminFlag surfaces a non-42501/non-PGRST116 PG error via console.error", async () => {
    userAppRolesQueryMock.mockResolvedValue({ data: [], error: null });
    // 57014 = statement_timeout. A real failure mode under load.
    profilesIsAdminMock.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });

    const ok = await isAdminUser(
      makeSupabaseClient() as unknown as SupabaseClient,
      { id: "u-timeout", email: "t@t.com" },
    );
    expect(ok).toBe(false);

    const stderr = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(stderr).toContain("hasIsAdminFlag non-RLS error");
  });

  it("hasIsAdminFlag SILENTLY returns false on PGRST116 (.single() 0-rows)", async () => {
    userAppRolesQueryMock.mockResolvedValue({ data: [], error: null });
    profilesIsAdminMock.mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "Results contain 0 rows" },
    });

    const ok = await isAdminUser(
      makeSupabaseClient() as unknown as SupabaseClient,
      { id: "u-norow", email: "nr@t.com" },
    );
    expect(ok).toBe(false);
    const calls = consoleErrorSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("hasIsAdminFlag non-RLS error"),
    );
    expect(calls.length).toBe(0);
  });
});
