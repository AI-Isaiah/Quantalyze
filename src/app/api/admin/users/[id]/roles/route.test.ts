import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 review fix I4 (red-team conf 9) — route-level coverage
 * for the rate-limit added on top of the existing withRole CSRF + admin
 * guard. The narrow contract: a compromised admin session cannot spam
 * unbounded role grants — the route surfaces 429 once the bucket is
 * exhausted, BEFORE the user_app_roles mutation runs.
 *
 * Companion grep gate: src/__tests__/admin-csrf-ratelimit-grep.test.ts
 * (this route is now removed from RATE_LIMIT_EXEMPTIONS as the proof of
 * concept that the C1 fix's exemption list is closeable).
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const TEST_ADMIN = vi.hoisted(() => ({
  id: "00000000-0000-0000-0000-000000000201",
  email: "admin@quantalyze.test",
}));

const upsertSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: TEST_ADMIN }, error: null }),
    },
    rpc: async () => ({ data: null, error: null }),
    from: (table: string) => {
      if (table === "user_app_roles") {
        return {
          select: () => ({
            eq: async () => ({
              data: [{ role: "admin" }],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table on user client: ${table}`);
    },
  }),
}));

// adminMock state: per-test toggle controls whether the profile lookup
// returns a row (user exists) or null (404 path for GET). The user_app_roles
// rows the mock returns from `.select(...).eq(...)` are the post-mutation
// (or pre-existing) role set used by the unified envelope.
//
// Issue 3 (audit-2026-05-07 follow-up): `rolesReadError` lets a test
// inject a Postgres-style error into the post-mutation re-read so we can
// pin the "mutation succeeded but read failed → 500" contract.
const adminMockState = vi.hoisted(() => ({
  profileExists: true as boolean,
  rolesRows: [
    { role: "analyst" },
  ] as Array<{ role: string }>,
  rolesReadError: null as
    | null
    | { code: string | null; message: string },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "user_app_roles") {
        return {
          upsert: async (...args: unknown[]) => {
            upsertSpy(...args);
            return { error: null };
          },
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null, count: 1 }),
            }),
          }),
          select: (_cols: string) => ({
            eq: async () => ({
              data: adminMockState.rolesReadError
                ? null
                : adminMockState.rolesRows,
              error: adminMockState.rolesReadError,
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: (_cols: string) => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: adminMockState.profileExists
                  ? { id: "00000000-0000-0000-0000-000000000999" }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table on admin client: ${table}`);
    },
  }),
}));

function makeReq(
  body: Record<string, unknown> = { action: "grant", role: "analyst" },
): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/admin/users/00000000-0000-0000-0000-000000000999/roles",
    {
      method: "POST",
      headers: VALID_ORIGIN,
      body: JSON.stringify(body),
    },
  );
}

function makeCtx() {
  return {
    params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000999" }),
  };
}

describe("POST /api/admin/users/[id]/roles — rate limit (I4)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.resetModules();
  });

  it("surfaces 429 with Retry-After when adminActionLimiter denies", async () => {
    vi.doMock("@/lib/ratelimit", async () => {
      const actual = await vi.importActual<typeof import("@/lib/ratelimit")>(
        "@/lib/ratelimit",
      );
      return {
        ...actual,
        checkLimit: async () => ({ success: false, retryAfter: 23 }),
      };
    });
    const { POST } = await import("./route");
    const res = await POST(makeReq(), makeCtx());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("23");
    // The mutation must NOT have run — the gate sits BEFORE the upsert.
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("denies all 100 of 100 rapid requests when bucket is exhausted", async () => {
    // Tightened from the prior `denied > 0` (I3): with the mock denying
    // every call, ALL 100 must come back 429 — anything less means the
    // route bypassed the gate at least once.
    vi.doMock("@/lib/ratelimit", async () => {
      const actual = await vi.importActual<typeof import("@/lib/ratelimit")>(
        "@/lib/ratelimit",
      );
      return {
        ...actual,
        checkLimit: async () => ({ success: false, retryAfter: 60 }),
      };
    });
    const { POST } = await import("./route");
    const statuses: number[] = [];
    for (let i = 0; i < 100; i++) {
      const res = await POST(makeReq(), makeCtx());
      statuses.push(res.status);
    }
    const denied = statuses.filter((s) => s === 429).length;
    expect(denied).toBe(100);
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

/**
 * audit-2026-05-07 P442 + P462 — coverage for the new GET handler and
 * the unified `{ user_id, roles[] }` response envelope. The pre-fix POST
 * grant returned `{ success, action, role }` and revoke returned
 * `{ success, action, role, removed_rows }`; the new GET didn't exist.
 *
 * These tests would FAIL on pre-fix code:
 *   - "GET returns 200 with envelope": no GET export, returns 405.
 *   - "GET returns 404 when user not found": no GET export.
 *   - "POST grant returns unified envelope": grant body is missing
 *     `user_id` + `roles`, has stray `action`/`role`/`success`.
 *   - "POST revoke returns unified envelope": revoke body is missing
 *     `user_id` + `roles`, has stray `removed_rows`.
 *   - "grant and revoke return the same envelope shape": pre-fix the
 *     two response bodies have different keys.
 */
function makeGetReq(): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/admin/users/00000000-0000-0000-0000-000000000999/roles",
    { method: "GET" },
  );
}

describe("GET /api/admin/users/[id]/roles (P442)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }, { role: "admin" }];
    adminMockState.rolesReadError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    // Wipe any vi.doMock("@/lib/ratelimit") left over from the rate-limit
    // suite above — those registrations persist across describe blocks
    // and would force a 429 here even though GET has no rate limit.
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("GET returns 200 with { user_id, roles[] } envelope", async () => {
    const mod = await import("./route");
    // Pre-fix: `mod.GET` was undefined, so this import path itself is
    // proof of the gap. We still call it to validate the envelope.
    expect(typeof mod.GET).toBe("function");
    const res = await mod.GET!(makeGetReq(), makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user_id: "00000000-0000-0000-0000-000000000999",
      roles: expect.arrayContaining(["analyst", "admin"]),
    });
    // Envelope-key gate: ONLY user_id + roles. Drift back to
    // `{ success, action, role }` would fail this.
    expect(Object.keys(body).sort()).toEqual(["roles", "user_id"]);
  });

  it("GET returns 404 when target user does not exist", async () => {
    adminMockState.profileExists = false;
    const mod = await import("./route");
    expect(typeof mod.GET).toBe("function");
    const res = await mod.GET!(makeGetReq(), makeCtx());
    expect(res.status).toBe(404);
  });
});

describe("response envelope consistency (P462)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("POST grant returns unified { user_id, roles[] } envelope", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user_id: "00000000-0000-0000-0000-000000000999",
      roles: ["analyst"],
    });
    // Stray pre-fix keys must NOT be present.
    expect(body).not.toHaveProperty("action");
    expect(body).not.toHaveProperty("role");
    expect(body).not.toHaveProperty("success");
  });

  it("POST revoke returns unified { user_id, roles[] } envelope", async () => {
    adminMockState.rolesRows = [];
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user_id: "00000000-0000-0000-0000-000000000999",
      roles: [],
    });
    // Stray pre-fix keys must NOT be present.
    expect(body).not.toHaveProperty("removed_rows");
    expect(body).not.toHaveProperty("action");
    expect(body).not.toHaveProperty("role");
    expect(body).not.toHaveProperty("success");
  });

  it("grant and revoke return the same envelope shape", async () => {
    const { POST } = await import("./route");
    const grantRes = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    adminMockState.rolesRows = [];
    vi.resetModules();
    const { POST: POST2 } = await import("./route");
    const revokeRes = await POST2(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    const grantBody = await grantRes.json();
    const revokeBody = await revokeRes.json();
    expect(Object.keys(grantBody).sort()).toEqual(
      Object.keys(revokeBody).sort(),
    );
  });
});

/**
 * audit-2026-05-07 follow-up — Issue 3
 *
 * Pre-fix, `fetchUserRoles` swallowed every PG error and returned `[]`.
 * After a successful grant/revoke, a transient PG error on the
 * post-mutation re-read therefore made the response look like
 * "user has zero roles" — tempting the admin to re-grant and producing
 * a duplicate audit row for one logical operation. The fix returns 500
 * with a stable code so the UI can prompt a refresh rather than retry.
 *
 * The tests below pin:
 *   - GET surfaces 500 with code=roles_read_failed on read error.
 *   - POST grant surfaces 500 with code=mutation_succeeded_but_read_failed
 *     when the post-mutation re-read fails (mutation already committed).
 *   - POST revoke surfaces the same 500.
 *   - The pre-fix `{ user_id, roles: [] }` body is NOT returned on a read
 *     failure path — proving the silent-zero-roles regression is closed.
 */
describe("Issue 3 — fetchUserRoles error propagation (audit-2026-05-07 follow-up)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("GET returns 500 with code=roles_read_failed when fetchUserRoles errors", async () => {
    adminMockState.rolesReadError = {
      code: "57014",
      message: "statement timeout",
    };
    const mod = await import("./route");
    const res = await mod.GET!(makeGetReq(), makeCtx());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("roles_read_failed");
    // Crucial: must NOT silently produce a `{ roles: [] }` body — that
    // is exactly the regression Issue 3 closes.
    expect(body).not.toHaveProperty("roles");
  });

  it("POST grant returns 500 with code=mutation_succeeded_but_read_failed when re-read fails", async () => {
    adminMockState.rolesReadError = {
      code: "57014",
      message: "statement timeout",
    };
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    // The upsert ITSELF succeeded (its mock returns `{ error: null }`),
    // so the mutation has committed. The 500 is a hint to refresh, not
    // a signal to retry the grant.
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("mutation_succeeded_but_read_failed");
    expect(body).not.toHaveProperty("roles");
  });

  it("POST revoke returns 500 with code=mutation_succeeded_but_read_failed when re-read fails", async () => {
    adminMockState.rolesReadError = {
      code: "57014",
      message: "statement timeout",
    };
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("mutation_succeeded_but_read_failed");
    expect(body).not.toHaveProperty("roles");
  });
});
