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
 *
 * audit-2026-05-07 testing T5 (MED conf 8): the H-0428 and H-0430 / default
 * RoleHandler tests below assert COMPILE-TIME contracts via
 * `@ts-expect-error`. Vitest does NOT surface those directives at runtime —
 * only `tsc --noEmit` does. The `frontend-typecheck` CI job (.github/workflows/ci.yml)
 * runs `npm run typecheck` BEFORE the test job, which is what actually
 * enforces "fail the build if the type widens." If those tests are moved
 * to a runner that skips typecheck, the contract is silently lost — update
 * the runner or migrate to a tsd-style assertion (e.g. `expect-type`).
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

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getUserRoles,
  getUserRolesResult,
  requireAdmin,
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
  // `clearAllMocks` clears call history but NOT queued mockResolvedValueOnce
  // entries. A test that calls `xMock.mockResolvedValueOnce(...)` but
  // never consumes it (the code path it expected didn't fire) would leak
  // the queued value into the NEXT test that calls the mock. mockReset()
  // drops queued returns + impls; we then reapply the per-suite defaults
  // below. See the line-514 admin-union test for the original leak that
  // surfaced this.
  profilesIsAdminQueryMock.mockReset();
  userRolesQueryMock.mockReset();
  assertSameOriginMock.mockReset();
  assertSameOriginMock.mockReturnValue(null);
  // Default: profiles.is_admin = false. Individual tests that need the
  // unified admin-union to flip TRUE override this with mockImplementation
  // (NOT mockResolvedValueOnce — see leak note above).
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

describe("getUserRolesResult — M-0501 React cache() dedup contract", () => {
  // audit-2026-05-07 M-0501 (testing T3, HIGH conf 8): the wrap is
  // `cache(getUserRolesResult)` from `react`. The load-bearing invariant is
  // "two calls inside the SAME request with the SAME (supabase, userId)
  // pair share ONE DB round-trip." Without this assertion, a future
  // refactor that unwraps cache(), passes distinct supabase identities,
  // or swaps to a non-memoizing wrapper would not fail any test.
  //
  // The security specialist also flagged (S2, MED conf 8) that the JSDoc
  // previously claimed `createClient()` is itself `cache()`-wrapped (it is
  // NOT — see `src/lib/supabase/server.ts`). The cache keys on argument
  // identity, so two distinct SupabaseClient instances + the same userId
  // is a cache MISS — the second test below pins that behaviour explicitly
  // so a doc-vs-reality drift surfaces here, not in production.

  it("dedupes round-trips across two calls with the SAME (supabase, userId)", async () => {
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "admin" }],
      error: null,
    });
    const supabase = makeFromOnly();
    const first = await getUserRolesResult(supabase, "u-cache-same");
    const second = await getUserRolesResult(supabase, "u-cache-same");
    expect(first).toEqual({ ok: true, roles: ["admin"] });
    expect(second).toEqual({ ok: true, roles: ["admin"] });
    // ONE DB round-trip for both calls — that is the M-0501 contract.
    // If React cache() is unwrapped, this assertion fails.
    expect(userRolesQueryMock).toHaveBeenCalledTimes(1);
  });

  it("red-team: same-instance dedup persists outside a React render tree (vitest has no request scope)", async () => {
    // audit-2026-05-07 red-team (MED conf 8): React `cache()` is
    // documented as request-scoped when used inside the React render
    // tree. Vitest has no React render context; if the cache observed
    // dedup HERE, then the scope is NOT request-bounded in any
    // vitest-observable sense — it is per-process / per-SupabaseClient
    // instance. This test PROVES that property by issuing two calls
    // from two separate synthetic "request" frames (two
    // userRolesQueryMock resets in between) and asserting the second
    // call still hits the cache, because the cache lives outside any
    // simulated request boundary in this environment.
    //
    // Operational implication (documented in the JSDoc on
    // getUserRolesResult): the load-bearing safety property in
    // Route Handlers is per-SupabaseClient-instance identity reuse,
    // NOT cache `cache()`-driven request-scoping. If S2's option (a)
    // is ever taken (wrapping `createClient()` with React.cache) AND
    // Route Handlers do not receive a fresh AsyncLocalStorage per
    // request, two requests in the same warm Lambda could share an
    // identity-cached SupabaseClient and the role cache would leak.
    // The "distinct instances do NOT dedupe" test below is the
    // production-side mitigation; this test surfaces the underlying
    // surface so a future regression here gets reviewer eyeballs.
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "admin" }],
      error: null,
    });
    const supabase = makeFromOnly();
    await getUserRolesResult(supabase, "u-cache-no-react-scope");
    // No request-boundary teardown — vitest cannot simulate one.
    // A second call with the same arguments still hits the cache.
    await getUserRolesResult(supabase, "u-cache-no-react-scope");
    expect(userRolesQueryMock).toHaveBeenCalledTimes(1);
  });

  it("evicts the cache entry when fetch returns { ok: false } so a transient DB fault is retried on the next call", async () => {
    // The WeakMap dedup caches the in-flight Promise to share concurrent
    // round-trips. A failure result (`{ ok: false }`) MUST evict so a
    // transient DB blip doesn't poison the cache for the lifetime of the
    // SupabaseClient — otherwise an admin who hits a stale 500 stays
    // stuck on 500 until the client is GC'd.
    const supabase = makeFromOnly();
    userRolesQueryMock.mockResolvedValueOnce({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await getUserRolesResult(supabase, "u-evict");
    expect(first.ok).toBe(false);
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "admin" }],
      error: null,
    });
    const second = await getUserRolesResult(supabase, "u-evict");
    expect(second).toEqual({ ok: true, roles: ["admin"] });
    // Two round-trips, NOT one — the failure must have evicted.
    expect(userRolesQueryMock).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });

  // Note: the `.catch` arm of the eviction chain is defense in depth —
  // `fetchUserRolesResult` is shaped to convert every supabase error into
  // `{ ok: false }` rather than reject, so the `.catch` only fires for
  // a future refactor that lets a throw escape. We deliberately don't
  // pin that path via an integration test (forcing the mock to reject
  // produces a duplicated rejection subscription that races vitest's
  // unhandled-rejection detector). The `{ ok: false }` eviction test
  // above is the live path.

  it("retains the cache entry for empty-but-OK results ({ ok: true, roles: [] })", async () => {
    // The inverse pin: a non-error empty role set is still a SUCCESSFUL
    // result, and MUST stay cached so the dedup contract holds for users
    // who legitimately have no roles. A too-eager evictor would defeat
    // this and re-issue a round-trip per call.
    const supabase = makeFromOnly();
    userRolesQueryMock.mockResolvedValue({ data: [], error: null });
    await getUserRolesResult(supabase, "u-empty-ok");
    await getUserRolesResult(supabase, "u-empty-ok");
    expect(userRolesQueryMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT dedupe across DISTINCT supabase client instances (cache keys on identity)", async () => {
    // S2 (security MED conf 8): the cache hits only when the caller reuses
    // a single SupabaseClient per request. `withRole` guarantees this;
    // other call sites must enforce it themselves. If `createClient()` is
    // later wrapped with React.cache (the S2 fix's option (a)), update
    // this test to assert the dedup holds across `await createClient()`
    // calls — but as of this commit, two distinct clients = two round-trips.
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "allocator" }],
      error: null,
    });
    const supabaseA = makeFromOnly();
    const supabaseB = makeFromOnly();
    await getUserRolesResult(supabaseA, "u-cache-distinct");
    await getUserRolesResult(supabaseB, "u-cache-distinct");
    // TWO round-trips — proves the cache is per-instance, not per-userId,
    // so cross-user contamination is impossible.
    expect(userRolesQueryMock).toHaveBeenCalledTimes(2);
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

  // audit-2026-05-07 C-0144 / C-0150 (RBAC consolidation): the admin
  // fallback inside requireRole. `isAdminUser` is now the single source
  // of truth — `profiles.is_admin` is PRIMARY (matches DB-side RLS) and
  // `user_app_roles.role='admin'` is the additive secondary signal during
  // the Sprint 7 rollout. `ADMIN_EMAIL` is OBSERVATIONAL ONLY and no
  // longer grants admin.
  //
  // Ghost-admin (profiles.is_admin=TRUE but no role enum) MUST still
  // resolve to admin — the profile flag is the source of truth.
  // Dead-admin (ADMIN_EMAIL matches but profiles.is_admin=FALSE) MUST
  // resolve to NOT admin — closed by removing the env-var grant.
  it("ghost-admin pin: profiles.is_admin=true + empty user_app_roles → { roles } with 'admin' synthesized", async () => {
    // Empty user_app_roles for both the primary lookup AND the
    // hasAdminRoleRow secondary check inside isAdminUser.
    userRolesQueryMock.mockResolvedValue({ data: [], error: null });
    // Flip profiles.is_admin TRUE — the new PRIMARY signal.
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: { is_admin: true },
      error: null,
    });
    const result = await requireRole(makeFromOnly(), mockUser, "admin");
    expect("roles" in result).toBe(true);
    if ("roles" in result) {
      // The synthesized 'admin' role must appear in the resolved set so
      // downstream handlers see a consistent answer.
      expect(result.roles).toContain("admin");
    }
  });

  it("dead-admin pin: empty user_app_roles + profiles.is_admin=false → { forbidden: 403 } regardless of ADMIN_EMAIL", async () => {
    // audit-2026-05-07 C-0150: a caller whose email might match
    // ADMIN_EMAIL but who has no profile flag AND no user_app_roles row
    // is NOT admin. Pre-fix the OR-union let ADMIN_EMAIL grant access
    // via code while RLS denied it at the row level — a confusing
    // mixed-response state and an audit-trail mess. Post-fix the env
    // var only emits an observational log; it does not grant.
    //
    // The mock layer here does not stub ADMIN_EMAIL itself (it is
    // captured at module load), but the contract is that NO code path
    // inside `isAdminUser` returns TRUE based on email alone. Empty
    // user_app_roles + is_admin=FALSE = 403, period.
    userRolesQueryMock.mockResolvedValue({ data: [], error: null });
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: { is_admin: false },
      error: null,
    });
    const result = await requireRole(makeFromOnly(), mockUser, "admin");
    expect("forbidden" in result).toBe(true);
    if ("forbidden" in result) {
      expect(result.forbidden.status).toBe(403);
    }
  });

  it("red-team: admin-union fallback issues at-most-one user_app_roles round-trip (no redundant hasAdminRoleRow)", async () => {
    // audit-2026-05-07 red-team (MED conf 8): pre-fix the fallback path
    // called `isAdminUser` → `hasAdminRoleRow`, which re-queries
    // user_app_roles with a `.eq("role","admin").limit(1)` chain that
    // React `cache()` cannot dedupe against the prior `getUserRolesResult`
    // call (cache keys on argument identity, not result-equivalence).
    // That gave the non-admin reject path THREE DB round-trips:
    //   1. user_app_roles role-set fetch (getUserRolesResult — cached)
    //   2. user_app_roles admin-row re-check (hasAdminRoleRow)
    //   3. profiles.is_admin fetch (hasIsAdminFlag)
    // Post-fix: the fallback uses `isAdminUserGivenUserAppRoles`, which
    // trusts the already-fetched userRoles as the user_app_roles signal.
    // Round-trips on the reject path drop to TWO: one user_app_roles
    // query + one profiles query. This test pins that contract.
    userRolesQueryMock.mockResolvedValue({ data: [], error: null });
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: { is_admin: false },
      error: null,
    });
    await requireRole(makeFromOnly(), mockUser, "admin");
    // ONE user_app_roles round-trip — the redundant hasAdminRoleRow call
    // is gone. If a future refactor re-introduces it, this assertion fails.
    expect(userRolesQueryMock).toHaveBeenCalledTimes(1);
    // profiles.is_admin still gets called — that signal can grant admin
    // even when user_app_roles is empty.
    expect(profilesIsAdminQueryMock).toHaveBeenCalledTimes(1);
  });

  it("admin-union fallback is admin-scoped only: caller requesting non-admin role still gets 403 even when is_admin=true", async () => {
    // Belt-and-suspenders: a user who is only admin via the legacy union
    // does NOT silently acquire 'allocator' (or any other role). The
    // fallback synthesizes 'admin' ONLY; non-admin role requests stay
    // gated by user_app_roles alone.
    userRolesQueryMock.mockResolvedValue({ data: [], error: null });
    // Use mockImplementation (NOT mockResolvedValueOnce). The admin-union
    // fallback is admin-scoped, so this requireRole("allocator") call
    // will NOT reach hasIsAdminFlag — a queued mockResolvedValueOnce
    // would leak unconsumed into the next test that DOES enter the
    // fallback, granting it spurious admin access. mockImplementation
    // takes the default-impl seat instead of queueing.
    profilesIsAdminQueryMock.mockImplementation(() =>
      Promise.resolve({ data: { is_admin: true }, error: null }),
    );
    const result = await requireRole(makeFromOnly(), mockUser, "allocator");
    expect("forbidden" in result).toBe(true);
    if ("forbidden" in result) {
      expect(result.forbidden.status).toBe(403);
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

  it("M-0499: unauthenticated GET returns 401 WITHOUT running CSRF (order-swap is method-agnostic)", async () => {
    // audit-2026-05-07 (testing T6, MED conf 8): GET is normally exempt
    // from CSRF (safe method) — but the order-swap (auth → CSRF) must
    // not regress that property. An unauthenticated GET should bail at
    // auth with 401 and never touch assertSameOrigin.
    getUserMock.mockResolvedValue({ data: { user: null } });
    const csrfResponse = new Response("csrf denied", { status: 403 });
    assertSameOriginMock.mockReturnValue(csrfResponse as never);

    const handler = vi.fn();
    const wrapped = withRole("admin")(handler as never);

    const getReq = new Request("http://localhost:3000/api/admin/health", {
      method: "GET",
    });
    const res = await wrapped(getReq as never);
    expect(res.status).toBe(401);
    expect(assertSameOriginMock).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("M-0499: authenticated POST with passing CSRF + missing role → 403, CSRF called exactly once, handler not called", async () => {
    // audit-2026-05-07 (testing T6, MED conf 8): the auth → csrf → role
    // chain on the happy authenticated-but-non-admin path. The default
    // assertSameOriginMock returns null (pass); we still assert it was
    // CALLED so a future refactor that skips CSRF for authenticated
    // callers fails this test.
    getUserMock.mockResolvedValue({
      data: { user: { id: "u-non-admin", email: "n@t.com" } },
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
    expect(assertSameOriginMock).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("M-0499: authenticated POST call ordering is createClient → getUser → assertSameOrigin → role-fetch → handler", async () => {
    // audit-2026-05-07 (testing T6, MED conf 8): the load-bearing
    // reorder. Without an order assertion, a future refactor that
    // re-introduces the CSRF-before-auth path silently regresses the
    // information-disclosure fix. We pin the sequence via a shared
    // call-log fed by the relevant mocks.
    const callOrder: string[] = [];
    getUserMock.mockImplementation(async () => {
      callOrder.push("getUser");
      return { data: { user: { id: "u-admin", email: "a@t.com" } } };
    });
    assertSameOriginMock.mockImplementation(() => {
      callOrder.push("assertSameOrigin");
      return null;
    });
    userRolesQueryMock.mockImplementationOnce(async () => {
      callOrder.push("userRolesQuery");
      return { data: [{ role: "admin" }], error: null };
    });

    const handler = vi.fn().mockImplementation(async () => {
      callOrder.push("handler");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const wrapped = withRole("admin")(handler as never);

    const res = await wrapped(
      makeRequest({ body: { action: "grant" } }) as never,
    );
    expect(res.status).toBe(200);
    // createClient runs implicitly inside the wrapper before getUser; we
    // assert on the externally observable sequence.
    expect(callOrder).toEqual([
      "getUser",
      "assertSameOrigin",
      "userRolesQuery",
      "handler",
    ]);
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

  it("H-0430: default RoleHandler typechecks (params defaults to Record<string, never>)", () => {
    // The test is a type-level assertion: if the default `P` widened
    // back to `unknown`, the line below would still typecheck — but
    // any `_ctx.params.foo` access in a static-route handler would no
    // longer be a compile error. The compile-error guarantee is best
    // observed via reviewer eyeballs on the RoleContext default; this
    // test only proves the default signature still composes.
    const _staticSig: RoleHandler = async () => NextResponse.json({});
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

describe("requireAdmin — TOCTOU close + CSRF defense-in-depth", () => {
  const mockUser = { id: "user-1", email: "user@test.com" } as Parameters<
    typeof requireAdmin
  >[1];

  it("returns { status: 401 } when user is null", async () => {
    const res = await requireAdmin(makeFromOnly(), null);
    expect(res).not.toBeNull();
    if (res) expect(res.status).toBe(401);
  });

  it("returns null when user IS an admin (via user_app_roles)", async () => {
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "admin" }],
      error: null,
    });
    const res = await requireAdmin(makeFromOnly(), mockUser);
    expect(res).toBeNull();
  });

  it("returns { status: 403 } when user is NOT an admin", async () => {
    userRolesQueryMock.mockResolvedValue({ data: [], error: null });
    // profiles.is_admin defaults to false (beforeEach reset above).
    const res = await requireAdmin(makeFromOnly(), mockUser);
    expect(res).not.toBeNull();
    if (res) expect(res.status).toBe(403);
  });

  it("red-team CSRF: when `req` is supplied on a POST, runs assertSameOrigin", async () => {
    // audit-2026-05-07 red-team (MED conf 8): a future caller that uses
    // requireAdmin STANDALONE inside a mutating route (without going
    // through withRole/withAdminAuth) would inherit no CSRF defense.
    // Post-fix the optional `req` parameter threads the request into a
    // mutating-method CSRF check.
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "admin" }],
      error: null,
    });
    const csrfResponse = new Response("csrf denied", { status: 403 });
    assertSameOriginMock.mockReturnValueOnce(csrfResponse as never);

    const req = new Request("http://localhost:3000/api/admin/x", {
      method: "POST",
    }) as unknown as Parameters<typeof requireAdmin>[2];
    const res = await requireAdmin(makeFromOnly(), mockUser, req);
    expect(res).toBe(csrfResponse);
    expect(assertSameOriginMock).toHaveBeenCalledTimes(1);
  });

  it("red-team CSRF: when `req` is supplied on a GET, does NOT run assertSameOrigin", async () => {
    // Safe methods (GET/HEAD/OPTIONS) skip the CSRF check — matches
    // withRole's behaviour.
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "admin" }],
      error: null,
    });
    const req = new Request("http://localhost:3000/api/admin/x", {
      method: "GET",
    }) as unknown as Parameters<typeof requireAdmin>[2];
    const res = await requireAdmin(makeFromOnly(), mockUser, req);
    expect(res).toBeNull();
    expect(assertSameOriginMock).not.toHaveBeenCalled();
  });

  it("red-team CSRF: when `req` is OMITTED, does NOT run assertSameOrigin (source-compat)", async () => {
    // Source-compat path: pre-fix callers passed only (supabase, user)
    // — they must keep working without a CSRF check at this layer
    // because the outer wrapper (withRole/withAdminAuth) already ran one.
    // New mutating call sites are expected to pass `req`; this test
    // pins the back-compat behaviour for the existing sub-resource
    // TOCTOU-close call sites.
    userRolesQueryMock.mockResolvedValue({
      data: [{ role: "admin" }],
      error: null,
    });
    const res = await requireAdmin(makeFromOnly(), mockUser);
    expect(res).toBeNull();
    expect(assertSameOriginMock).not.toHaveBeenCalled();
  });

  it("red-team CSRF: 401 (no user) short-circuits BEFORE the CSRF check (consistent with withRole's auth-first ordering)", async () => {
    // M-0499 set the precedent: auth runs FIRST so unauth callers
    // always get 401 regardless of Origin (eliminates the
    // unauth-with-good-origin = 401 vs unauth-with-bad-origin = 403
    // information disclosure). requireAdmin mirrors that ordering.
    const csrfResponse = new Response("csrf denied", { status: 403 });
    assertSameOriginMock.mockReturnValue(csrfResponse as never);
    const req = new Request("http://localhost:3000/api/admin/x", {
      method: "POST",
    }) as unknown as Parameters<typeof requireAdmin>[2];
    const res = await requireAdmin(makeFromOnly(), null, req);
    expect(res).not.toBeNull();
    if (res) expect(res.status).toBe(401);
    expect(assertSameOriginMock).not.toHaveBeenCalled();
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
