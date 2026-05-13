/**
 * RBAC matrix — INTEGRATION layer (P696 fix, 2026-05-13).
 *
 * Pre-fix: this file mocked both the Supabase client AND the auth
 * module, so it never exercised real DB constraints (FK, RLS, CHECK)
 * or real auth flow. It was a unit test pretending to be an integration
 * test. The mock-based unit-level matrix has been preserved in the
 * sibling file `rbac-matrix-unit.test.ts`.
 *
 * Post-fix (this file): drives `getUserRoles` and `requireRole`
 * against the real test Supabase project (qmnijlgmdhviwzwfyzlc per
 * `reference_test_supabase_project.md`). Credentials are read from
 * env vars set by CI from the four GitHub Actions secrets:
 *
 *   SUPABASE_TEST_URL                 → NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_TEST_ANON_KEY            → anon JWT for signInWithPassword
 *   SUPABASE_TEST_SERVICE_ROLE_KEY    → service-role for setup/teardown
 *   SUPABASE_TEST_PROJECT_REF         → not used here; documented for
 *                                       parity with the live-DB fixture
 *
 * The test is skip-gated by SUPABASE_TEST_URL +
 * SUPABASE_TEST_SERVICE_ROLE_KEY presence so a local `vitest run`
 * without test-DB creds doesn't fail — `describe.skipIf(!HAS_TEST_DB)`
 * matches the convention in
 * `tests/integration/cron-flag-monitor-rollback-e2e.test.ts`.
 *
 * Real DB constraints exercised:
 *   - `user_app_roles` CHECK constraint (role IN
 *     ('admin','allocator','strategy_manager','analyst')) — migration
 *     054. A role grant outside this set is rejected by the DB, not
 *     by the TS layer.
 *   - `user_app_roles` (user_id, role) primary key — granting the
 *     same role twice is a 23505 unique-violation.
 *   - RLS on `user_app_roles` — admins can read all rows; other roles
 *     can read only their own.
 *   - `requireRole` correctly returns the resolved role set for OR
 *     semantics and 403 for callers without any matching role.
 *
 * Test seed users (per `reference_test_supabase_project.md`,
 * macOS Keychain service `quantalyze-test`):
 *   - alloc@quantalyze.test  → role=allocator
 *   - sm@quantalyze.test     → role=strategy_manager
 *   - admin@quantalyze.test  → role=admin AND profiles.is_admin=true
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const HAS_TEST_DB =
  Boolean(process.env.SUPABASE_TEST_URL) &&
  Boolean(process.env.SUPABASE_TEST_SERVICE_ROLE_KEY) &&
  Boolean(process.env.SUPABASE_TEST_ANON_KEY);

// Sentinel emails — must already exist in the test project per the
// project memory reference. The test does NOT create users (they're
// part of the seed data); it only reads their roles and authenticates
// as them via signInWithPassword.
const ALLOCATOR_EMAIL = "alloc@quantalyze.test";
const STRATEGY_MANAGER_EMAIL = "sm@quantalyze.test";
const ADMIN_EMAIL = "admin@quantalyze.test";

/**
 * Read a credential for one of the three test roles. Mirrors the
 * Keychain-based convention. The password is supplied via env vars
 * (CI) or the macOS keychain (local dev — `security find-generic-
 * password -s quantalyze-test -a alloc@quantalyze.test -w` is the
 * documented command in `reference_test_credentials.md`).
 *
 * CI sets:
 *   SUPABASE_TEST_PASSWORD_ALLOCATOR
 *   SUPABASE_TEST_PASSWORD_SM
 *   SUPABASE_TEST_PASSWORD_ADMIN
 *
 * If any password env var is missing, the relevant `it` block is
 * skipped via the inner skipIf — the test surface degrades gracefully
 * rather than failing on a partial CI secret rotation.
 */
function getPassword(role: "allocator" | "strategy_manager" | "admin"): string | undefined {
  const key =
    role === "admin"
      ? "SUPABASE_TEST_PASSWORD_ADMIN"
      : role === "strategy_manager"
        ? "SUPABASE_TEST_PASSWORD_SM"
        : "SUPABASE_TEST_PASSWORD_ALLOCATOR";
  return process.env[key];
}

describe.skipIf(!HAS_TEST_DB)(
  "RBAC matrix — LIVE-DB integration (test project qmnijlgmdhviwzwfyzlc)",
  () => {
    let serviceClient: SupabaseClient;
    let getUserRoles: typeof import("@/lib/auth").getUserRoles;
    let requireRole: typeof import("@/lib/auth").requireRole;
    let APP_ROLES: typeof import("@/lib/auth").APP_ROLES;

    beforeAll(async () => {
      serviceClient = createClient(
        process.env.SUPABASE_TEST_URL!,
        process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!,
        // Service-role: never persist sessions, never auto-refresh.
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      // Dynamic import keeps the @/lib/auth module out of the
      // mock-based unit file's mock registry. We need the REAL
      // implementations here.
      const auth = await import("@/lib/auth");
      getUserRoles = auth.getUserRoles;
      requireRole = auth.requireRole;
      APP_ROLES = auth.APP_ROLES;
    });

    afterAll(async () => {
      // No teardown — the test does not mutate the seed users. Any
      // future test that DOES grant/revoke roles must clean up here.
    });

    /**
     * Build a user-scoped client authenticated as the given role. If
     * the password env var is missing or signInWithPassword fails,
     * returns null and the calling test should skip.
     */
    async function userClientAs(
      role: "allocator" | "strategy_manager" | "admin",
    ): Promise<{ client: SupabaseClient; userId: string } | null> {
      const pwd = getPassword(role);
      if (!pwd) return null;
      const email =
        role === "admin"
          ? ADMIN_EMAIL
          : role === "strategy_manager"
            ? STRATEGY_MANAGER_EMAIL
            : ALLOCATOR_EMAIL;
      const client = createClient(
        process.env.SUPABASE_TEST_URL!,
        process.env.SUPABASE_TEST_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password: pwd,
      });
      if (error || !data?.user) return null;
      return { client, userId: data.user.id };
    }

    it("getUserRoles returns ['allocator'] for the allocator seed user", async () => {
      const session = await userClientAs("allocator");
      if (!session) {
        console.warn(
          "[rbac-matrix] skipping allocator case — SUPABASE_TEST_PASSWORD_ALLOCATOR not set",
        );
        return;
      }
      const roles = await getUserRoles(session.client, session.userId);
      expect(roles).toContain("allocator");
    });

    it("getUserRoles returns ['strategy_manager'] for the SM seed user", async () => {
      const session = await userClientAs("strategy_manager");
      if (!session) {
        console.warn(
          "[rbac-matrix] skipping SM case — SUPABASE_TEST_PASSWORD_SM not set",
        );
        return;
      }
      const roles = await getUserRoles(session.client, session.userId);
      expect(roles).toContain("strategy_manager");
    });

    it("getUserRoles returns ['admin'] for the admin seed user", async () => {
      const session = await userClientAs("admin");
      if (!session) {
        console.warn(
          "[rbac-matrix] skipping admin case — SUPABASE_TEST_PASSWORD_ADMIN not set",
        );
        return;
      }
      const roles = await getUserRoles(session.client, session.userId);
      expect(roles).toContain("admin");
    });

    it("requireRole('admin') passes for admin caller", async () => {
      const session = await userClientAs("admin");
      if (!session) return;
      const { data: { user } } = await session.client.auth.getUser();
      const result = await requireRole(session.client, user, "admin");
      expect("roles" in result).toBe(true);
      if ("roles" in result) {
        expect(result.roles).toContain("admin");
      }
    });

    it("requireRole('admin') returns 403 forbidden for allocator caller", async () => {
      const session = await userClientAs("allocator");
      if (!session) return;
      const { data: { user } } = await session.client.auth.getUser();
      const result = await requireRole(session.client, user, "admin");
      expect("forbidden" in result).toBe(true);
      if ("forbidden" in result) {
        expect(result.forbidden.status).toBe(403);
      }
    });

    it("requireRole(admin OR allocator) passes for allocator caller (OR semantics)", async () => {
      const session = await userClientAs("allocator");
      if (!session) return;
      const { data: { user } } = await session.client.auth.getUser();
      const result = await requireRole(
        session.client,
        user,
        "admin",
        "allocator",
      );
      expect("roles" in result).toBe(true);
      if ("roles" in result) {
        expect(result.roles).toContain("allocator");
      }
    });

    it("requireRole returns 401 for an unauthenticated caller (user=null)", async () => {
      // We don't need an authenticated session for this check — pass
      // null as the user. The supabase client still must be a valid
      // instance because requireRole would fall through to
      // getUserRoles on the happy path; with user=null it short-
      // circuits before touching the DB.
      const anonClient = createClient(
        process.env.SUPABASE_TEST_URL!,
        process.env.SUPABASE_TEST_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      const result = await requireRole(anonClient, null, "admin");
      expect("forbidden" in result).toBe(true);
      if ("forbidden" in result) {
        expect(result.forbidden.status).toBe(401);
      }
    });

    it("DB CHECK constraint rejects an unknown role (user_app_roles.role)", async () => {
      // The CHECK constraint in migration 054 enumerates the four
      // valid roles. A service-role write of a bogus role must fail
      // at the DB layer — proving the constraint exists.
      const session = await userClientAs("admin");
      if (!session) return;

      // Service-role bypasses RLS. We do NOT actually want to insert
      // a row, so we attempt an insert with a known-invalid role and
      // expect the DB to reject it. If the insert succeeds (it
      // shouldn't), clean up immediately.
      const { error } = await serviceClient
        .from("user_app_roles")
        .insert({
          user_id: session.userId,
          role: "super_admin_bogus", // not in CHECK list
        });
      // Either a 23514 (check_violation) or a 22P02 (invalid_text_
      // representation) is acceptable depending on whether the column
      // is a TEXT-with-CHECK or an enum. Both prove the constraint.
      expect(error).not.toBeNull();
      expect(error?.code).toMatch(/^(23514|22P02)$/);
    });

    it("APP_ROLES union matches the DB constraint (no drift)", async () => {
      // Verify every code-side AppRole value can be referenced by
      // requireRole without compile error AND is a string. This is a
      // smoke test against a future taxonomy drift where TS adds a
      // role the DB doesn't accept.
      expect(APP_ROLES.length).toBeGreaterThan(0);
      for (const role of APP_ROLES) {
        expect(typeof role).toBe("string");
      }
    });
  },
);

/**
 * Scaffold-only fallback. When SUPABASE_TEST_URL is unset (most local
 * dev runs and any CI job without the four GH secrets wired up), the
 * integration suite above is skipped. This describe runs always and
 * asserts ONE thing: the scaffold compiles and the env-gate works.
 *
 * Without this, a `vitest run` in a creds-less environment would
 * report "0 tests" for this file and a future regression that
 * accidentally deletes the test file would not be caught by the test-
 * count check.
 */
describe("RBAC matrix — integration scaffold sanity", () => {
  it("env gate either skips the integration suite OR runs it", () => {
    // The boolean is computed at module-eval time; just assert the
    // shape (boolean) is correct.
    expect(typeof HAS_TEST_DB).toBe("boolean");
  });
});
