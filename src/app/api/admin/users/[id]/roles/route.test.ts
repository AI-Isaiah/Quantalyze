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

// NEW-C17-05: the TOCTOU requireAdmin re-check calls isAdminUser (from
// @/lib/admin) on a fresh createClient() before every service-role mutation.
// Rather than plumbing profiles/.single() support into every per-test
// createClient mock, we mock @/lib/admin and control the return value via
// a hoisted state flag. Default: actor is still admin → re-check passes.
// C17-05 sets actorIsAdmin=false to simulate a demoted actor mid-request.
const adminLibState = vi.hoisted(() => ({
  actorIsAdmin: true as boolean,
}));
vi.mock("@/lib/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin")>();
  return {
    ...actual,
    isAdminUser: async () => adminLibState.actorIsAdmin,
    isAdminUserGivenUserAppRoles: async () => adminLibState.actorIsAdmin,
  };
});
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
//
// NEW-C17-01: `targetIsAdmin` — if true, the profiles.is_admin lookup
// returns { is_admin: true }, causing the route to reject admin revoke
// with 409 revoke_admin_ineffective.
// NEW-C17-01: `profileIsAdminError` — inject a PG error on is_admin lookup.
//
// NEW-C17-02: `survivingProfileAdmins` / `survivingRoleAdmins` — count
// of admins surviving the proposed revoke (excluding target).  If both
// are 0 the route returns 409 would_orphan_last_admin.
// NEW-C17-02: `lastAdminCountError` — inject a PG error on count query.
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
  // C17-01
  targetIsAdmin: false as boolean,
  profileIsAdminError: null as null | { code: string | null; message: string },
  // C17-02
  survivingProfileAdmins: 1 as number,
  survivingRoleAdmins: 0 as number,
  lastAdminCountError: null as null | { code: string | null; message: string },
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
          // The route uses THREE different select chains on user_app_roles:
          //   (1) Post-mutation read: `.select("role").eq("user_id", X)`
          //       (awaited directly — returns role rows).
          //   (2) Pre-grant existence check (M-0288):
          //       `.select("granted_at").eq("user_id",X).eq("role",Y).maybeSingle()`
          //   (3) Last-admin count (C17-02):
          //       `.select("user_id",{count:"exact",head:true}).eq("role","admin").neq("user_id",X)`
          //       (awaited directly — data is array whose .length = survivor count).
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
            // Shape (3): head-only count for surviving role admins.
            // Supabase head:true → data=null, count in the `count` field.
            // Pre-fix the mock returned { data: Array.from({length:N}) } which
            // masked the CRITICAL-1 bug (route used data?.length, always 0 for
            // real HEAD responses). Fixed mock returns { count: N, data: null }.
            if (opts?.head) {
              const countVal = adminMockState.lastAdminCountError
                ? null
                : adminMockState.survivingRoleAdmins;
              const countErr = adminMockState.lastAdminCountError ?? null;
              return {
                eq: () => ({
                  neq: async () => ({ data: null, count: countVal, error: countErr }),
                }),
              };
            }
            const postMutationPromise = Promise.resolve({
              data: adminMockState.rolesReadError
                ? null
                : adminMockState.rolesRows,
              error: adminMockState.rolesReadError,
            });
            // First .eq() — shape (1) awaits this directly; shape (2)
            // chains another .eq() + .maybeSingle(); shape (3-non-head)
            // chains .neq() for the last-admin count dedup query:
            //   .select("user_id").eq("role","admin").neq("user_id", X)
            //   → awaited directly, returns { data: [{user_id},...], error }
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
                  // shape (3-non-head): .neq() for last-admin count dedup
                  // Returns surviving role-admin rows as an array so the
                  // route can union them with the profile-admin set.
                  neq: async () => ({
                    data: adminMockState.lastAdminCountError
                      ? null
                      : Array.from(
                          { length: adminMockState.survivingRoleAdmins },
                          (_, i) => ({
                            user_id: `surviving-role-admin-${i}`,
                          }),
                        ),
                    error: adminMockState.lastAdminCountError ?? null,
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
          // The route issues FOUR distinct operations against profiles:
          //   (A) Existence check:   select("id").eq("id",X).maybeSingle()
          //   (B) is_admin check:    select("is_admin").eq("id",X).maybeSingle()
          //   (C) Last-admin count:  select("id").eq("is_admin",true).neq("id",X)
          //       → awaited directly, returns { data: [{id},...], error }
          //       (route unions these with role-admin rows in JS to deduplicate)
          //   (D) Ghost-admin clear: update({is_admin:false}).eq("id",X)
          //       → awaited directly, returns { error }
          // We inspect the first argument to select() to distinguish (A)/(B) from (C).
          //
          // NOTE: the old Shape (C) assumed head:true — the route was updated (C-01
          // red-team fix) to use plain array selects so the JS set-union dedup works.
          // The head path is kept for safety but is no longer reached by route code.
          update: (_vals: Record<string, unknown>) => ({
            // Shape (D): ghost-admin flag clear.
            // update({ is_admin: false }).eq("id", targetUserId) → { error }
            eq: async () => ({
              error: null,
            }),
          }),
          select: (cols: string, opts?: { count?: string; head?: boolean }) => {
            // Shape (C) head variant — kept for safety, not reached by current route.
            if (opts?.head) {
              const countVal = adminMockState.lastAdminCountError
                ? null
                : adminMockState.survivingProfileAdmins;
              const countErr = adminMockState.lastAdminCountError ?? null;
              return {
                eq: () => ({
                  neq: async () => ({ data: null, count: countVal, error: countErr }),
                }),
              };
            }
            // Shape (B): is_admin lookup → .eq().maybeSingle()
            if (cols === "is_admin") {
              return {
                eq: () => ({
                  maybeSingle: async () => ({
                    data: adminMockState.profileIsAdminError
                      ? null
                      : (adminMockState.profileExists
                          ? { is_admin: adminMockState.targetIsAdmin }
                          : null),
                    error: adminMockState.profileIsAdminError,
                  }),
                }),
              };
            }
            // Shape (A) / (C): cols="id"
            // (A): .eq("id",X).maybeSingle()       — profile existence check
            // (C): .eq("is_admin",true).neq("id",X) — last-admin count dedup
            // Distinguish by whether .neq() is chained (C) or .maybeSingle() (A).
            return {
              eq: () => ({
                // Shape (A): awaited via .maybeSingle()
                maybeSingle: async () => ({
                  data: adminMockState.profileExists
                    ? { id: "00000000-0000-0000-0000-000000000999" }
                    : null,
                  error: null,
                }),
                // Shape (C): awaited via .neq(), returns surviving profile-admin rows
                neq: async () => ({
                  data: adminMockState.lastAdminCountError
                    ? null
                    : Array.from(
                        { length: adminMockState.survivingProfileAdmins },
                        (_, i) => ({
                          id: `surviving-profile-admin-${i}`,
                        }),
                      ),
                  error: adminMockState.lastAdminCountError ?? null,
                }),
              }),
            };
          },
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

// Global reset: ensure the TOCTOU admin-lib state flag is always true at the
// start of each test. Tests that need to simulate a demoted actor (C17-05) set
// adminLibState.actorIsAdmin=false in their own body after this runs.
beforeEach(() => {
  adminLibState.actorIsAdmin = true;
});

describe("POST /api/admin/users/[id]/roles — rate limit (I4)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
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
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
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
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
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
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
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

  it("revoke with count=0 does NOT emit role.revoke but DOES emit role.revoke_noop (probe-trail gate)", async () => {
    // audit-2026-05-07 specialist-apply (code-reviewer HIGH + security
    // HIGH + silent-failure M-#4): the no-op path emits a distinct
    // `role.revoke_noop` action so probe activity is still forensically
    // detectable (M-0287's success-toast bug is fixed by the 404 +
    // role-not-held envelope, NOT by removing the audit row).
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
    // The probe-trail invariant: exactly one audit row, and it is the
    // role.revoke_noop action — NOT role.revoke (which would be the
    // M-0287 ghost-row regression).
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const actions = rpcSpy.mock.calls.map(
      (c) => (c[1] as { p_action: string }).p_action,
    );
    expect(actions).toEqual(["role.revoke_noop"]);
    const meta = (
      rpcSpy.mock.calls[0]![1] as { p_metadata: Record<string, unknown> }
    ).p_metadata;
    expect(meta).toMatchObject({
      role: "analyst",
      attempted_by: TEST_ADMIN.id,
      was_held: false,
      removed_rows: 0,
    });
  });

  it("revoke with count>0 still emits the audit RPC and returns 200 with the unified envelope", async () => {
    // Regression guard for M-0287: tightening the no-op path must not
    // affect the happy path.
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
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
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
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
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
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
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
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
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
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
    // role.revoke_noop fires (probe trail) but role.state_observed
    // does NOT — symmetric with the api-contract finding that the
    // grant path now also skips state_observed on no-op (re-grant).
    const actions = rpcSpy.mock.calls.map(
      (c) => (c[1] as { p_action: string }).p_action,
    );
    expect(actions).not.toContain("role.state_observed");
    expect(actions).not.toContain("role.revoke");
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
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
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
    // audit-2026-05-07 specialist-apply (code-reviewer HIGH +
    // security HIGH + api-contract M conf-7): the route now wraps
    // the awaited emit in try/catch and returns a STABLE 500 envelope
    // (code='mutation_succeeded_but_audit_failed') instead of
    // letting the unhandled rejection bubble. The mutation has
    // committed, so the UI must NOT retry — the stable code is the
    // signal to prompt the admin to refresh.
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("mutation_succeeded_but_audit_failed");
    // The upsert MUST have run (we get to the audit emit only after).
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    // Critically: role.state_observed must NOT have been emitted —
    // the gate exits on role.grant emit failure BEFORE the secondary
    // anchor runs. This pins the pr-test M #8 finding "role.state_observed
    // is NOT emitted when role.grant audit emit itself fails".
    const observedCalls = rpcSpy.mock.calls.filter(
      (c) => (c[1] as { p_action: string }).p_action === "role.state_observed",
    );
    expect(observedCalls).toHaveLength(0);
  });
});

/**
 * audit-2026-05-07 specialist-apply (pr-test HIGH conf-9, conf-9, conf-9):
 *
 * The specialists called out FIVE missing test invariants that would
 * silently green critical regressions:
 *  - HIGH #1: ordering between role.grant/role.revoke and role.state_observed
 *  - HIGH #2: inverted-observation interleave (state_observed records
 *    the LOSING write)
 *  - HIGH #3: revoke fetchUserRoles-failure 500 must still have
 *    role.revoke emitted, must NOT have role.state_observed
 *  - HIGH #4: role.state_observed emit-failure must NOT change
 *    response status (fail-soft after specialist apply)
 *  - HIGH #5: role.grant emit failure → role.state_observed not emitted
 *
 * Plus M #6 (revoke ordering), M #7 (removed_rows=count when count>1).
 */
describe("specialist-apply red-team — pr-test HIGH (audit-2026-05-07)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("HIGH #1 grant ORDER: role.grant emit happens BEFORE role.state_observed", async () => {
    adminMockState.rolesRows = [{ role: "analyst" }];
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: TEST_ADMIN }, error: null }) },
        rpc: rpcSpy,
        from: () => ({ select: () => ({ eq: async () => ({ data: [{ role: "admin" }], error: null }) }) }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const actions = rpcSpy.mock.calls.map((c) => (c[1] as { p_action: string }).p_action);
    const idxGrant = actions.indexOf("role.grant");
    const idxObs = actions.indexOf("role.state_observed");
    expect(idxGrant).toBeGreaterThanOrEqual(0);
    expect(idxObs).toBeGreaterThan(idxGrant);
  });

  it("HIGH #1 + M #6 revoke ORDER: role.revoke emit happens BEFORE role.state_observed", async () => {
    adminMockState.rolesRows = [];
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: TEST_ADMIN }, error: null }) },
        rpc: rpcSpy,
        from: () => ({ select: () => ({ eq: async () => ({ data: [{ role: "admin" }], error: null }) }) }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const actions = rpcSpy.mock.calls.map((c) => (c[1] as { p_action: string }).p_action);
    expect(actions.indexOf("role.revoke")).toBeLessThan(
      actions.indexOf("role.state_observed"),
    );
  });

  it("HIGH #2 inverted-observation interleave: revoke commits but concurrent grant lands → state_observed records holds_role=true, 409 revoke_did_not_take", async () => {
    // Race scenario: this request DELETEd the row (revokeCount=1) but
    // between the DELETE and the post-mutation re-read another admin's
    // concurrent grant inserted it. The role IS in the post-read set —
    // state_observed must record that observation truthfully.
    //
    // NEW-C17-06: when holdsRoleAfterRevoke=true, the route now returns 409
    // revoke_did_not_take (pre-fix: 200). The role.state_observed audit anchor
    // is still emitted before the 409 response.
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    adminMockState.rolesRows = [{ role: "analyst" }];
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: TEST_ADMIN }, error: null }) },
        rpc: rpcSpy,
        from: () => ({ select: () => ({ eq: async () => ({ data: [{ role: "admin" }], error: null }) }) }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    // C17-06: role still held → 409 (pre-fix was 200).
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("revoke_did_not_take");
    // role.state_observed must still have been emitted (forensic anchor).
    const stateCall = rpcSpy.mock.calls.find(
      (c) => (c[1] as { p_action: string }).p_action === "role.state_observed",
    );
    expect(stateCall).toBeDefined();
    expect(
      (stateCall![1] as { p_metadata: Record<string, unknown> }).p_metadata,
    ).toMatchObject({
      following_action: "revoke",
      holds_role: true,
    });
  });

  it("HIGH #3 revoke post-read failure: role.revoke emitted, role.state_observed NOT emitted, 500 surfaced", async () => {
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    adminMockState.rolesReadError = {
      code: "57014",
      message: "statement timeout",
    };
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: TEST_ADMIN }, error: null }) },
        rpc: rpcSpy,
        from: () => ({ select: () => ({ eq: async () => ({ data: [{ role: "admin" }], error: null }) }) }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("mutation_succeeded_but_read_failed");
    const actions = rpcSpy.mock.calls.map((c) => (c[1] as { p_action: string }).p_action);
    expect(actions).toContain("role.revoke");
    expect(actions).not.toContain("role.state_observed");
  });

  it("HIGH #4 role.state_observed emit failure on grant: route still returns 200 (fail-soft after specialist apply)", async () => {
    // Pre-apply: the emit threw → unhandled rejection → 500. Post-apply:
    // state_observed is fail-soft (forensic anchor only), so the
    // primary mutation + role.grant audit row is honored with a 200.
    adminMockState.rolesRows = [{ role: "analyst" }];
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async (_n, args) => {
      if (args.p_action === "role.state_observed") {
        return { data: null, error: { code: "42501", message: "permission denied" } };
      }
      return { data: null, error: null };
    });
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: TEST_ADMIN }, error: null }) },
        rpc: rpcSpy,
        from: () => ({ select: () => ({ eq: async () => ({ data: [{ role: "admin" }], error: null }) }) }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const actions = rpcSpy.mock.calls.map((c) => (c[1] as { p_action: string }).p_action);
    expect(actions).toContain("role.grant");
    expect(actions).toContain("role.state_observed");
  });

  it("HIGH #4 role.state_observed emit failure on revoke: route still returns 200 (fail-soft)", async () => {
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    adminMockState.rolesRows = [];
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async (_n, args) => {
      if (args.p_action === "role.state_observed") {
        return { data: null, error: { code: "42501", message: "permission denied" } };
      }
      return { data: null, error: null };
    });
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: TEST_ADMIN }, error: null }) },
        rpc: rpcSpy,
        from: () => ({ select: () => ({ eq: async () => ({ data: [{ role: "admin" }], error: null }) }) }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
  });

  it("M #7 removed_rows reflects the ACTUAL delete count (not hardcoded 1)", async () => {
    adminMockState.revokeCount = 3;
    adminMockState.rolesRows = [];
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: TEST_ADMIN }, error: null }) },
        rpc: rpcSpy,
        from: () => ({ select: () => ({ eq: async () => ({ data: [{ role: "admin" }], error: null }) }) }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    const revokeCall = rpcSpy.mock.calls.find(
      (c) => (c[1] as { p_action: string }).p_action === "role.revoke",
    );
    expect(
      (revokeCall![1] as { p_metadata: Record<string, unknown> }).p_metadata,
    ).toMatchObject({ removed_rows: 3 });
  });
});

/**
 * audit-2026-05-07 specialist-apply — silent-failure HIGH #1 (rate-limit
 * misconfigured → 503, not 429): mask-the-Upstash-outage regression
 * guard.
 */
describe("specialist-apply — rate-limit misconfigured 503 (audit-2026-05-07)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.resetModules();
  });

  it("POST returns 503 (not 429) when checkLimit reports ratelimit_misconfigured", async () => {
    vi.doMock("@/lib/ratelimit", async () => {
      const actual = await vi.importActual<typeof import("@/lib/ratelimit")>(
        "@/lib/ratelimit",
      );
      return {
        ...actual,
        checkLimit: async () => ({
          success: false,
          retryAfter: 30,
          reason: "ratelimit_misconfigured" as const,
        }),
      };
    });
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("ratelimit_misconfigured");
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("POST still returns 429 (not 503) when checkLimit reports normal exhaustion (no `reason`)", async () => {
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
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(429);
  });
});

/**
 * audit-2026-05-07 specialist-apply — api-contract HIGH #1: POST now
 * performs the same profile-existence check as GET so missing-user is
 * a uniform 404 user_not_found across both verbs.
 */
describe("specialist-apply — POST profile-existence (api-contract HIGH)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("POST returns 404 user_not_found when target profile is missing — mutation does NOT run", async () => {
    adminMockState.profileExists = false;
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("user_not_found");
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("POST 404 user_not_found is symmetric for revoke", async () => {
    adminMockState.profileExists = false;
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("user_not_found");
  });
});

/**
 * audit-2026-05-07 red-team #5: assert role.revoke_noop fail-soft.
 * If the audit emit throws (permission_denied), the route MUST still
 * return 404 with code='role_not_held' — the probe-trail invariant
 * must not become a control-flow oracle.
 */
describe("red-team — role.revoke_noop fail-soft (audit-2026-05-07)", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 0;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("role.revoke_noop emit failure leaves the 404 response unchanged", async () => {
    const rpcSpy = vi.fn<(name: string, args: { p_action: string; p_entity_type: string; p_entity_id: string; p_metadata: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>>(async (_n, args) => {
      if (args.p_action === "role.revoke_noop") {
        return { data: null, error: { code: "42501", message: "permission denied" } };
      }
      return { data: null, error: null };
    });
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: TEST_ADMIN }, error: null }) },
        rpc: rpcSpy,
        from: () => ({ select: () => ({ eq: async () => ({ data: [{ role: "admin" }], error: null }) }) }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("role_not_held");
  });
});

/**
 * NEW-C17-03 (code-review H conf=8): self-revoke admin rail must be
 * case-insensitive. An uppercase variant of the admin's own UUID bypasses
 * the prior string-equality guard (`===`) but matches Postgres's
 * case-insensitive UUID `.eq()` — a self-lockout through the rail that
 * was meant to prevent it.
 *
 * FIX: `targetUserId` is normalized to lowercase immediately after the
 * null-check so all comparisons (guard + DB) use the canonical form.
 *
 * This test FAILS on pre-fix code (uppercase UUID bypasses guard → DELETE
 * runs → 200 returned instead of 403).
 */
describe("NEW-C17-03 — self-revoke admin rail is case-insensitive", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "admin" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("UPPERCASE own UUID → 403 (not 200), mutation NOT run", async () => {
    const { POST } = await import("./route");
    const uppercasedOwnId = TEST_ADMIN.id.toUpperCase();
    const req = new NextRequest(
      `http://localhost:3000/api/admin/users/${uppercasedOwnId}/roles`,
      {
        method: "POST",
        headers: VALID_ORIGIN,
        body: JSON.stringify({ action: "revoke", role: "admin" }),
      },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: uppercasedOwnId }),
    });
    // Pre-fix: `uppercasedOwnId !== user.id` (string) → guard passes →
    // DELETE runs → 200. Post-fix: lowercased → guard fires → 403.
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/another admin must act/i);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("lowercase own UUID still returns 403 (regression guard for existing rail)", async () => {
    const { POST } = await import("./route");
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
  });

  it("uppercase OTHER user UUID revokes successfully (no false-positive 403)", async () => {
    adminMockState.rolesRows = [];
    const { POST } = await import("./route");
    const otherUppercase = "00000000-0000-0000-0000-000000000999".toUpperCase();
    const req = new NextRequest(
      `http://localhost:3000/api/admin/users/${otherUppercase}/roles`,
      {
        method: "POST",
        headers: VALID_ORIGIN,
        body: JSON.stringify({ action: "revoke", role: "analyst" }),
      },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: otherUppercase }),
    });
    // Should NOT be 403 — different user from admin.
    expect(res.status).not.toBe(403);
  });
});

/**
 * NEW-C17-05 (security+red-team H conf=7): TOCTOU requireAdmin re-check.
 * A just-demoted admin (concurrent revoke between withRole check and the
 * service-role mutation) must be blocked; a fresh client re-check is
 * performed before createAdminClient() is called.
 *
 * This test FAILS on pre-fix code (no re-check → mutation reaches
 * createAdminClient even after demotion).
 */
describe("NEW-C17-05 — requireAdmin TOCTOU re-check before mutation", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("demoted-mid-request admin is rejected 403, mutation does NOT run", async () => {
    // Simulate a concurrent admin revoke that stripped the actor's admin
    // status between the withRole wrapper check and the service-role mutation.
    // Set actorIsAdmin=false so the hoisted vi.mock("@/lib/admin") returns
    // isAdminUser=false — requireAdmin TOCTOU re-check fires → 403 before
    // the DELETE runs.
    //
    // The TOCTOU re-check (route.ts ~L835) only runs on the REVOKE path,
    // immediately before the service-role DELETE. We must send action:revoke
    // (non-admin role so the self-revoke guard and last-admin guard are
    // bypassed) to reach that checkpoint.
    //
    // Pre-fix: no re-check → DELETE runs → 200.
    // Post-fix: re-check fires → 403 Forbidden, DELETE not reached.
    adminLibState.actorIsAdmin = false;
    adminMockState.rolesRows = [];
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(403);
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

/**
 * NEW-C17-01 (security H conf=8): revoke admin is ineffective for users
 * with profiles.is_admin=TRUE ("ghost-admin"). The route must refuse with
 * 409 revoke_admin_ineffective instead of returning 200 with misleading
 * "Revoked admin" while leaving the profile flag untouched.
 *
 * This test FAILS on pre-fix code (DELETE runs, 200 returned, is_admin
 * still TRUE → target retains access).
 */
describe("NEW-C17-01 — ghost-admin revoke refused with 409", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "admin" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("revoke admin on ghost-admin (is_admin=TRUE) clears the flag and returns 200", async () => {
    // C-01 (red-team): the previous behaviour was to block with 409
    // `revoke_admin_ineffective` leaving the ghost-admin permanently
    // privileged — the endpoint detected the condition but never fixed it.
    // The red-team pass changed the contract: the route now clears
    // profiles.is_admin=FALSE via the service-role client as an atomic
    // prerequisite step, then proceeds with the user_app_roles DELETE.
    // This fully removes access regardless of which signal was authoritative.
    //
    // Verify: flag-clear succeeds + DELETE runs + post-read shows no admin
    // → 200 with unified { user_id, roles[] } envelope.
    adminMockState.targetIsAdmin = true;
    adminMockState.rolesRows = []; // post-delete re-read: role removed
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "admin" }),
      makeCtx(),
    );
    // C-01: 200 — ghost-admin flag cleared + role row deleted.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user_id: "00000000-0000-0000-0000-000000000999",
      roles: [],
    });
  });

  it("revoke admin on non-ghost-admin (is_admin=FALSE) proceeds normally", async () => {
    adminMockState.targetIsAdmin = false;
    adminMockState.rolesRows = [];
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "admin" }),
      makeCtx(),
    );
    // Should NOT be 409 — regular role-row only admin.
    expect(res.status).not.toBe(409);
  });

  it("revoke non-admin role skips the is_admin check entirely", async () => {
    // Ensure the ghost-admin guard only runs for role==='admin'
    adminMockState.targetIsAdmin = true;
    adminMockState.rolesRows = [];
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    // analyst revoke should not 409 even if target has is_admin=TRUE
    expect(res.status).not.toBe(409);
  });

  it("profiles.is_admin lookup failure returns 500 profile_read_failed", async () => {
    adminMockState.profileIsAdminError = {
      code: "57014",
      message: "statement timeout",
    };
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "admin" }),
      makeCtx(),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("profile_read_failed");
  });
});

/**
 * NEW-C17-02 (red-team H conf=8): last-admin lockout guard. Revoking the
 * last admin (across BOTH profiles.is_admin=TRUE and user_app_roles rows)
 * must return 409 would_orphan_last_admin.
 *
 * This test FAILS on pre-fix code (DELETE runs, org left with zero
 * reachable admins).
 */
describe("NEW-C17-02 — last-admin lockout guard", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "admin" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    // Default: 1 surviving profile admin → safe
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("zero surviving admins from both sources → 409 would_orphan_last_admin", async () => {
    adminMockState.survivingProfileAdmins = 0;
    adminMockState.survivingRoleAdmins = 0;
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "admin" }),
      makeCtx(),
    );
    // Pre-fix: DELETE runs. Post-fix: 409 before DELETE.
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("would_orphan_last_admin");
    expect(body.error).toMatch(/last admin/i);
  });

  it("1 surviving profile admin → revoke proceeds (no lockout)", async () => {
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.rolesRows = [];
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "admin" }),
      makeCtx(),
    );
    expect(res.status).not.toBe(409);
  });

  it("1 surviving role admin (no profile admin) → revoke proceeds", async () => {
    adminMockState.survivingProfileAdmins = 0;
    adminMockState.survivingRoleAdmins = 1;
    adminMockState.rolesRows = [];
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "admin" }),
      makeCtx(),
    );
    expect(res.status).not.toBe(409);
  });

  it("last-admin count query failure returns 500 last_admin_count_failed", async () => {
    adminMockState.lastAdminCountError = {
      code: "57014",
      message: "statement timeout",
    };
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "admin" }),
      makeCtx(),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("last_admin_count_failed");
  });

  it("last-admin guard only runs for role==='admin', not for other roles", async () => {
    adminMockState.survivingProfileAdmins = 0;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.rolesRows = [];
    const { POST } = await import("./route");
    // Revoking a non-admin role must not trigger the lockout guard
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).not.toBe(409);
  });
});

/**
 * NEW-C17-04 (security H conf=7): captureToSentry is called on every
 * admin role grant so rogue elevation surfaces to on-call in real time.
 *
 * This test FAILS on pre-fix code (no Sentry call is made).
 */
describe("NEW-C17-04 — Sentry alert on admin role grant", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "admin" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("granting admin role calls captureToSentry with level=warning", async () => {
    const sentryCaptureSpy = vi.fn();
    vi.doMock("@/lib/sentry-capture", () => ({
      captureToSentry: sentryCaptureSpy,
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "admin" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    // Pre-fix: sentryCaptureSpy is never called.
    // Post-fix: must be called exactly once with level=warning.
    expect(sentryCaptureSpy).toHaveBeenCalledTimes(1);
    const [, opts] = sentryCaptureSpy.mock.calls[0] as [unknown, { tags: Record<string, string>; level: string }];
    expect(opts.level).toBe("warning");
    expect(opts.tags.role).toBe("admin");
    expect(opts.tags.action).toBe("role.grant");
  });

  it("granting a non-admin role does NOT call captureToSentry", async () => {
    const sentryCaptureSpy = vi.fn();
    vi.doMock("@/lib/sentry-capture", () => ({
      captureToSentry: sentryCaptureSpy,
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "grant", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    expect(sentryCaptureSpy).not.toHaveBeenCalled();
  });
});

/**
 * NEW-C17-06 (silent-failure H conf=7): revoke returns 409
 * revoke_did_not_take when the role is still observed as held after the
 * DELETE (e.g. concurrent re-grant). Pre-fix the route returned 200 and
 * the UI flashed a false "Revoked" success toast.
 *
 * This test FAILS on pre-fix code (200 returned even when
 * holdsRoleAfterRevoke=true).
 */
describe("NEW-C17-06 — revoke returns 409 when holdsRoleAfterRevoke=true", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    adminMockState.profileExists = true;
    adminMockState.rolesRows = [{ role: "analyst" }];
    adminMockState.rolesReadError = null;
    adminMockState.preExistingGrant = null;
    adminMockState.preExistingGrantError = null;
    adminMockState.revokeCount = 1;
    adminMockState.targetIsAdmin = false;
    adminMockState.profileIsAdminError = null;
    adminMockState.survivingProfileAdmins = 1;
    adminMockState.survivingRoleAdmins = 0;
    adminMockState.lastAdminCountError = null;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.doUnmock("@/lib/ratelimit");
    vi.resetModules();
  });

  it("role still held after revoke (concurrent re-grant) → 409 revoke_did_not_take", async () => {
    // revokeCount=1 (DELETE ran) but post-mutation read still includes
    // the role (concurrent re-grant).
    adminMockState.revokeCount = 1;
    adminMockState.rolesRows = [{ role: "analyst" }]; // role still there
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    // Pre-fix: 200 with false "Revoked" toast.
    // Post-fix: 409 so operator knows access was NOT removed.
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("revoke_did_not_take");
    expect(body.error).toMatch(/still observed as held/i);
  });

  it("role NOT held after revoke → normal 200 (no regression)", async () => {
    adminMockState.revokeCount = 1;
    adminMockState.rolesRows = []; // role successfully removed
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
  });

  it("role.state_observed is emitted BEFORE the 409 revoke_did_not_take response", async () => {
    adminMockState.revokeCount = 1;
    adminMockState.rolesRows = [{ role: "analyst" }];
    const rpcSpy = vi.fn<(name: string, args: { p_action: string }) => Promise<{ data: unknown; error: unknown }>>(
      async () => ({ data: null, error: null }),
    );
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: TEST_ADMIN }, error: null }) },
        rpc: rpcSpy,
        from: () => ({ select: () => ({ eq: async () => ({ data: [{ role: "admin" }], error: null }) }) }),
      }),
    }));
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ action: "revoke", role: "analyst" }),
      makeCtx(),
    );
    expect(res.status).toBe(409);
    // The forensic anchor must still have fired even on the 409 path.
    const actions = rpcSpy.mock.calls.map((c) => (c[1] as { p_action: string }).p_action);
    expect(actions).toContain("role.state_observed");
    const stateCall = rpcSpy.mock.calls.find(
      (c) => (c[1] as { p_action: string }).p_action === "role.state_observed",
    );
    expect(
      (stateCall![1] as { p_metadata: Record<string, unknown> }).p_metadata,
    ).toMatchObject({ holds_role: true, following_action: "revoke" });
  });
});
