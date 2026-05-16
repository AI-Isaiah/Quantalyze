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
//
// audit-2026-05-07 fix M-0288: `preExistingGrant` controls the pre-upsert
// select-by-(user_id,role).maybeSingle() the route now does to populate
// `was_new_grant` in the role.grant audit metadata. `null` = new grant;
// `{granted_at: "..."}` = re-grant.
//
// audit-2026-05-07 fix M-0287 / M-0289: `revokeCount` controls the
// rows-affected count on the delete chain so tests can pin the no-op
// revoke (count=0 → 404) vs successful revoke (count>0) behavior.
const adminMockState = vi.hoisted(() => ({
  profileExists: true as boolean,
  rolesRows: [
    { role: "analyst" },
  ] as Array<{ role: string }>,
  rolesReadError: null as
    | null
    | { code: string | null; message: string },
  preExistingGrant: null as null | { granted_at: string },
  preExistingGrantError: null as
    | null
    | { code: string | null; message: string },
  revokeCount: 1 as number,
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
              eq: async () => ({
                error: null,
                count: adminMockState.revokeCount,
              }),
            }),
          }),
          // The route now uses TWO different select chains:
          //   (1) Post-mutation read: `.select("role").eq("user_id", X)`
          //       (awaited directly — returns role rows).
          //   (2) Pre-grant existence check (M-0288):
          //       `.select("granted_at").eq("user_id", X).eq("role", Y).maybeSingle()`
          //       (returns single row or null).
          // The chain object exposes BOTH the directly-awaited shape (for
          // shape (1)) and a second `.eq().maybeSingle()` for shape (2).
          select: (_cols: string) => {
            const postMutationPromise = Promise.resolve({
              data: adminMockState.rolesReadError
                ? null
                : adminMockState.rolesRows,
              error: adminMockState.rolesReadError,
            });
            // First .eq() — shape (1) awaits this directly; shape (2)
            // chains another .eq() + .maybeSingle().
            return {
              eq: (...args: unknown[]) => {
                void args;
                const node = {
                  // shape (1): direct await on first .eq()
                  then: postMutationPromise.then.bind(postMutationPromise),
                  catch: postMutationPromise.catch.bind(postMutationPromise),
                  finally:
                    postMutationPromise.finally.bind(postMutationPromise),
                  // shape (2): another .eq(), then .maybeSingle()
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: adminMockState.preExistingGrant,
                      error: adminMockState.preExistingGrantError,
                    }),
                  }),
                };
                return node;
              },
            };
          },
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
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
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
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
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
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
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

/**
 * audit-2026-05-07 fix M-0287 + M-0289 (silent-failure-hunter + code-reviewer
 * conf-8): revoke on a role the user does not hold must NOT emit a
 * role.revoke audit row and must NOT echo a 2xx (which the UI parrots as
 * "Revoked '<role>'" — a false success). Pre-fix the route emitted the
 * audit row + 200 envelope with `removed_rows: 0` metadata, producing
 * ghost-revoke entries in the audit_log that say "admin X revoked role Y
 * from user Z" when Y was never granted.
 *
 * These tests pin:
 *   - count=0 → 404 with `code: "role_not_held"`.
 *   - count=0 → NO audit RPC is fired (no log_audit_event call lands).
 *   - count=0 → the response body is the error envelope, not the unified
 *     `{ user_id, roles[] }` shape.
 *   - count>0 → the existing happy path still passes (regression guard).
 */
describe("revoke no-op suppression — M-0287 + M-0289 (audit-2026-05-07)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("revoke with count=0 returns 404 with code=role_not_held and the error envelope", async () => {
    adminMockState.revokeCount = 0;
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("role_not_held");
    // Crucial: the unified `{ user_id, roles[] }` happy-path envelope
    // must NOT be returned — that would let the UI flash "Revoked
    // 'analyst'" as a success toast for a no-op.
    expect(body).not.toHaveProperty("roles");
    expect(body).not.toHaveProperty("user_id");
  });

  it("revoke with count=0 does NOT emit a role.revoke audit RPC (audit-ghost-row gate)", async () => {
    // Capture every RPC call against the user-scoped supabase client.
    // The route now uses awaited `emit()` from @/lib/audit — if the
    // no-op revoke path leaks an audit emit, the rpc spy will see it.
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: TEST_ADMIN },
            error: null,
          }),
        },
        rpc: rpcSpy,
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ role: "admin" }],
              error: null,
            }),
          }),
        }),
      }),
    }));
    adminMockState.revokeCount = 0;
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(404);
    // Pre-fix this would have been 1 (the role.revoke ghost row).
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("revoke with count>0 still emits the audit RPC and returns 200 with the unified envelope", async () => {
    // Regression guard for M-0287: tightening the no-op path must not
    // affect the happy path.
    adminMockState.revokeCount = 1;
    adminMockState.rolesRows = [];
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: TEST_ADMIN },
            error: null,
          }),
        },
        rpc: rpcSpy,
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ role: "admin" }],
              error: null,
            }),
          }),
        }),
      }),
    }));
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
    // role.revoke + role.state_observed = 2 RPC calls.
    expect(rpcSpy).toHaveBeenCalledTimes(2);
    const actions = rpcSpy.mock.calls.map(
      (c) => (c[1] as { p_action: string }).p_action,
    );
    expect(actions).toContain("role.revoke");
    expect(actions).toContain("role.state_observed");
  });
});

/**
 * audit-2026-05-07 fix M-0288 (silent-failure-hunter conf-8): the grant
 * path's `.upsert(..., { ignoreDuplicates: true })` returns `{ error: null }`
 * whether a new row landed or a duplicate was ignored. Pre-fix the route
 * emitted role.grant with NO discriminator — every UI double-click
 * looked exactly like a fresh grant and the forensic query "when did
 * user X first acquire admin" silently returned the latest re-grant
 * timestamp instead of the original.
 *
 * The fix reads the existing (user_id, role) row BEFORE the upsert and
 * threads `was_new_grant: boolean` into the audit metadata — analogous
 * to `was_first_run` in account.sanitize.
 */
describe("grant was_new_grant discriminator — M-0288 (audit-2026-05-07)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("first-time grant: audit metadata carries was_new_grant=true", async () => {
    adminMockState.preExistingGrant = null;
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: TEST_ADMIN },
            error: null,
          }),
        },
        rpc: rpcSpy,
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ role: "admin" }],
              error: null,
            }),
          }),
        }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const grantCall = rpcSpy.mock.calls.find(
      (c) => (c[1] as { p_action: string }).p_action === "role.grant",
    );
    expect(grantCall).toBeDefined();
    expect(
      (grantCall![1] as { p_metadata: Record<string, unknown> }).p_metadata,
    ).toMatchObject({
      role: "analyst",
      granted_by: TEST_ADMIN.id,
      was_new_grant: true,
    });
  });

  it("re-grant on existing row: audit metadata carries was_new_grant=false", async () => {
    // Pre-existing row → re-grant. The route MUST emit role.grant
    // unconditionally (operator intent), but the metadata must
    // distinguish this from a fresh grant.
    adminMockState.preExistingGrant = {
      granted_at: "2026-01-01T00:00:00.000Z",
    };
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: TEST_ADMIN },
            error: null,
          }),
        },
        rpc: rpcSpy,
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ role: "admin" }],
              error: null,
            }),
          }),
        }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const grantCall = rpcSpy.mock.calls.find(
      (c) => (c[1] as { p_action: string }).p_action === "role.grant",
    );
    expect(grantCall).toBeDefined();
    expect(
      (grantCall![1] as { p_metadata: Record<string, unknown> }).p_metadata,
    ).toMatchObject({
      role: "analyst",
      granted_by: TEST_ADMIN.id,
      was_new_grant: false,
    });
  });

  it("pre-existing read failure surfaces 500 — mutation does NOT run", async () => {
    // If the pre-upsert SELECT fails we cannot compute was_new_grant.
    // Returning 500 BEFORE the upsert is correct: we'd rather refuse a
    // grant we can't audit honestly than land a row with a missing
    // discriminator.
    adminMockState.preExistingGrantError = {
      code: "57014",
      message: "statement timeout",
    };
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(500);
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

/**
 * audit-2026-05-07 fix C-0066 (api-contract conf-7): self-action
 * rejection across admin routes must agree on the HTTP status code.
 * Pre-fix this route returned 400 for self-revoke while the sibling
 * deletion-requests routes returned 403 (via _shared.ts:84-94) for the
 * same conceptual error class. The fix standardizes on 403.
 */
describe("self-action 403 standardization — C-0066 (audit-2026-05-07)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "admin" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("admin self-revoking their own admin role returns 403 (not 400)", async () => {
    const { POST } = await import("./route");
    // Target the admin themself.
    const req = new NextRequest(
      `http://localhost:3000/api/admin/users/${TEST_ADMIN.id}/roles`,
      {
        method: "POST",
        headers: VALID_ORIGIN,
        body: JSON.stringify({ action: "revoke", role: "admin" }),
      },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: TEST_ADMIN.id }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    // Same envelope shape as deletion-requests/_shared.ts:84-94: a
    // single `error` field with a "another admin must act" message.
    expect(body.error).toMatch(/another admin must act/i);
    // Mutation must NOT have run.
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

/**
 * audit-2026-05-07 fix C-0067 (red-team conf-7): emit
 * `role.state_observed` with the post-write boolean so concurrent
 * grant+revoke races have a forensic anchor. The audit_log is the
 * source of truth; the observed-state event records what THIS request
 * saw, which is the only signal that survives the interleave.
 *
 * NOTE: this does NOT serialize the underlying race — the fix is
 * observability, not synchronization. The brief's option (b) was
 * chosen over (a) [advisory lock RPC] because the user_app_roles row
 * is a cached enforcement substrate, not the source of truth.
 */
describe("role.state_observed anchor — C-0067 (audit-2026-05-07)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("grant path emits role.state_observed with holds_role=true on successful grant", async () => {
    // Post-mutation re-read returns rolesRows = [{role: "analyst"}],
    // so holds_role for "analyst" should be true.
    adminMockState.rolesRows = [{ role: "analyst" }];
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: TEST_ADMIN },
            error: null,
          }),
        },
        rpc: rpcSpy,
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ role: "admin" }],
              error: null,
            }),
          }),
        }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const stateCall = rpcSpy.mock.calls.find(
      (c) =>
        (c[1] as { p_action: string }).p_action === "role.state_observed",
    );
    expect(stateCall).toBeDefined();
    expect(
      (stateCall![1] as { p_metadata: Record<string, unknown> }).p_metadata,
    ).toMatchObject({
      role: "analyst",
      observed_by: TEST_ADMIN.id,
      following_action: "grant",
      holds_role: true,
    });
  });

  it("revoke path emits role.state_observed with holds_role=false on successful revoke", async () => {
    // Post-revoke role set is empty, so holds_role should be false.
    adminMockState.rolesRows = [];
    adminMockState.revokeCount = 1;
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: TEST_ADMIN },
            error: null,
          }),
        },
        rpc: rpcSpy,
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ role: "admin" }],
              error: null,
            }),
          }),
        }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const stateCall = rpcSpy.mock.calls.find(
      (c) =>
        (c[1] as { p_action: string }).p_action === "role.state_observed",
    );
    expect(stateCall).toBeDefined();
    expect(
      (stateCall![1] as { p_metadata: Record<string, unknown> }).p_metadata,
    ).toMatchObject({
      role: "analyst",
      observed_by: TEST_ADMIN.id,
      following_action: "revoke",
      holds_role: false,
    });
  });

  it("no-op revoke does NOT emit role.state_observed (state did not change because of this call)", async () => {
    adminMockState.revokeCount = 0;
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: TEST_ADMIN },
            error: null,
          }),
        },
        rpc: rpcSpy,
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ role: "admin" }],
              error: null,
            }),
          }),
        }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(404);
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

/**
 * audit-2026-05-07 fix C-0065 (red-team conf-6): RBAC-mutating routes
 * await the audit emit synchronously so the RPC runs under the still-
 * valid admin session. Pre-fix the emit was scheduled via `after()`,
 * which on Vercel runs after the response flushes — if the admin's
 * session was revoked or expired in that window, the log_audit_event
 * RPC raised (auth.uid() = NULL) and the emit dropped silently to
 * console.error.
 *
 * This test pins the timing contract: by the time POST returns, the
 * audit RPC has ALREADY been invoked. Pre-fix this would race —
 * `after()` schedules the emit and the response can flush first.
 */
describe("synchronous audit emit — C-0065 (audit-2026-05-07)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("audit RPC has been called by the time POST resolves (no after()-scheduling)", async () => {
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: TEST_ADMIN },
            error: null,
          }),
        },
        rpc: rpcSpy,
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ role: "admin" }],
              error: null,
            }),
          }),
        }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    // The crucial assertion: the audit RPC has ALREADY landed by the
    // time the route Promise resolves. NO vi.waitFor needed. Pre-fix
    // the emit was deferred via after() and this would zero out.
    expect(rpcSpy).toHaveBeenCalled();
    const actions = rpcSpy.mock.calls.map(
      (c) => (c[1] as { p_action: string }).p_action,
    );
    expect(actions).toContain("role.grant");
  });

  // Adversarial / red-team D.6 — when the synchronous emit throws
  // (permission_denied per audit.ts:474), the route surfaces a 500.
  // This is the correct fail-loud behavior: the prior after()-deferred
  // emit would have swallowed this and the grant would have looked
  // successful while the audit row silently dropped. With synchronous
  // emit, the route signals the audit-emit failure to the caller so it
  // can be investigated.
  it("when role.grant audit emit throws (permission_denied), the route returns 500", async () => {
    const rpcSpy = vi.fn<
      (
        name: string,
        args: {
          p_action: string;
          p_entity_type: string;
          p_entity_id: string;
          p_metadata: Record<string, unknown>;
        },
      ) => Promise<{ data: unknown; error: unknown }>
    >(async (_name, args) => {
      // Simulate the permission_denied RPC error path that emit()
      // re-throws (audit.ts:461-474).
      if (args.p_action === "role.grant") {
        return {
          data: null,
          error: { code: "42501", message: "permission denied" },
        };
      }
      return { data: null, error: null };
    });
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getUser: async () => ({
            data: { user: TEST_ADMIN },
            error: null,
          }),
        },
        rpc: rpcSpy,
        from: () => ({
          select: () => ({
            eq: async () => ({
              data: [{ role: "admin" }],
              error: null,
            }),
          }),
        }),
      }),
    }));
    const { POST } = await import("./route");
    // The route should propagate the throw — we wrap in try/catch.
    // Pre-fix (with after()-deferred emit) this would silently 200
    // and the audit row would drop in the background scope.
    let caught: unknown = null;
    let res: Response | null = null;
    try {
      res = await POST(
        makeReq({ action: "grant", role: "analyst" }),
        makeCtx(),
      );
    } catch (err) {
      caught = err;
    }
    // emit() re-throws on permission_denied — the route does not
    // wrap it, so the rejection bubbles to the caller. EITHER a
    // thrown promise OR a 500 is acceptable evidence of fail-loud
    // behavior; a 2xx would be the regression.
    expect(res?.status === 500 || caught != null).toBe(true);
    // The upsert MUST have run (we get to the audit emit only after).
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });
});
