import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for src/lib/admin.ts — the SINGLE SOURCE OF TRUTH for
 * admin decisions (audit-2026-05-07 C-0144 + C-0150).
 *
 * The contract pinned here:
 *
 *     admin = (profiles.is_admin = TRUE)            -- PRIMARY (matches DB RLS)
 *           OR (user_app_roles.role='admin')        -- additive secondary
 *
 * `ADMIN_EMAIL` is OBSERVATIONAL ONLY — it no longer grants admin.
 *
 *   - Ghost-admin (profile flag TRUE, no role enum) → admin ✓
 *   - Dead-admin  (ADMIN_EMAIL match, profile flag FALSE) → NOT admin ✗
 *
 * The dead-admin case is the load-bearing C-0150 fix. Pre-fix the
 * env-var fallback granted admin via code while RLS denied it at the
 * row level; post-fix the env var only emits an observational log.
 */

vi.mock("server-only", () => ({}));

const { userRolesQueryMock, profilesIsAdminQueryMock } = vi.hoisted(() => ({
  userRolesQueryMock: vi.fn<
    (userId: string) => Promise<{ data: { role: string }[] | null; error: unknown }>
  >(),
  profilesIsAdminQueryMock: vi.fn<
    (userId: string) => Promise<{ data: { is_admin: boolean } | null; error: unknown }>
  >(),
}));

function buildFromMock() {
  return (table: string) => {
    if (table === "user_app_roles") {
      return {
        select: () => ({
          eq: (_col1: string, val1: string) => ({
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
          }),
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

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isAdmin,
  isAdminUser,
  isAdminUserGivenUserAppRoles,
} from "./admin";

function makeSupabase(): SupabaseClient {
  return {
    from: buildFromMock(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as unknown as SupabaseClient;
}

const USER = { id: "u-1", email: "user@test.com" };

beforeEach(() => {
  userRolesQueryMock.mockReset();
  profilesIsAdminQueryMock.mockReset();
  // Defaults: not admin via either signal. Tests override per-case.
  userRolesQueryMock.mockResolvedValue({ data: [], error: null });
  profilesIsAdminQueryMock.mockResolvedValue({
    data: { is_admin: false },
    error: null,
  });
});

describe("isAdmin (email-only pure check, used by proxy.ts)", () => {
  it("returns false when email is null/undefined", () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it("returns false when email does not match ADMIN_EMAIL", () => {
    // ADMIN_EMAIL is captured at module load. Whatever value it has in
    // this test env, a random email is guaranteed not to match.
    expect(isAdmin("definitely-not-the-admin@example.test")).toBe(false);
  });
});

describe("isAdminUser — C-0144 + C-0150 single-source-of-truth contract", () => {
  it("returns false when user is null", async () => {
    const result = await isAdminUser(makeSupabase(), null);
    expect(result).toBe(false);
  });

  it("returns false when user is undefined", async () => {
    const result = await isAdminUser(makeSupabase(), undefined);
    expect(result).toBe(false);
  });

  it("PRIMARY signal: profiles.is_admin=TRUE → admin (regardless of user_app_roles)", async () => {
    // Even with NO user_app_roles row, the profile flag grants admin —
    // this is the ghost-admin case (the contract per C-0144).
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: { is_admin: true },
      error: null,
    });
    userRolesQueryMock.mockResolvedValueOnce({ data: [], error: null });
    const result = await isAdminUser(makeSupabase(), USER);
    expect(result).toBe(true);
  });

  it("SECONDARY signal: user_app_roles.admin=TRUE → admin even when profile flag is FALSE", async () => {
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: { is_admin: false },
      error: null,
    });
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "admin" }],
      error: null,
    });
    const result = await isAdminUser(makeSupabase(), USER);
    expect(result).toBe(true);
  });

  it("ghost-admin pin: profiles.is_admin=TRUE + role enum='allocator' → admin", async () => {
    // The C-0144 contract: profile flag wins. Even if `user_app_roles`
    // only contains a non-admin role, the profile flag grants admin.
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: { is_admin: true },
      error: null,
    });
    userRolesQueryMock.mockResolvedValueOnce({
      data: [{ role: "allocator" }],
      error: null,
    });
    const result = await isAdminUser(makeSupabase(), USER);
    expect(result).toBe(true);
  });

  it("dead-admin pin: empty user_app_roles + profiles.is_admin=FALSE → NOT admin", async () => {
    // audit-2026-05-07 C-0150: pre-fix a caller whose email matched the
    // ADMIN_EMAIL env var would have been granted admin via the
    // env-fallback signal even with profiles.is_admin=FALSE — a code
    // grant that RLS would deny at the row level (mixed-response chaos).
    // Post-fix the env var no longer grants. With both DB signals
    // negative the answer is unambiguously NOT admin.
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: { is_admin: false },
      error: null,
    });
    userRolesQueryMock.mockResolvedValueOnce({ data: [], error: null });
    const result = await isAdminUser(makeSupabase(), USER);
    expect(result).toBe(false);
  });

  it("returns false when both DB reads error with non-RLS codes (logs but does not throw)", async () => {
    // Defense in depth: a real fault on one or both signals must NOT
    // throw to the caller — `isAdminUser` returns false and lets the
    // route layer surface a 403. The Sentry/console emission is logged
    // observationally.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    });
    userRolesQueryMock.mockResolvedValueOnce({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    });
    const result = await isAdminUser(makeSupabase(), USER);
    expect(result).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns false when profile row simply does not exist (PGRST116)", async () => {
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116", message: "no rows" },
    });
    userRolesQueryMock.mockResolvedValueOnce({ data: [], error: null });
    const result = await isAdminUser(makeSupabase(), USER);
    expect(result).toBe(false);
  });

  it("PRIMARY signal short-circuits: when profiles.is_admin=TRUE, user_app_roles is NOT queried", async () => {
    // The new order checks profiles.is_admin FIRST (matches RLS). A hit
    // there skips the user_app_roles round-trip. This is the
    // performance contract; a regression here doubles the read load on
    // every admin request.
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: { is_admin: true },
      error: null,
    });
    const result = await isAdminUser(makeSupabase(), USER);
    expect(result).toBe(true);
    expect(profilesIsAdminQueryMock).toHaveBeenCalledTimes(1);
    expect(userRolesQueryMock).not.toHaveBeenCalled();
  });
});

describe("isAdminUserGivenUserAppRoles — admin-fallback optimisation path", () => {
  it("returns false when user is null", async () => {
    const result = await isAdminUserGivenUserAppRoles(
      makeSupabase(),
      null,
      ["admin"],
    );
    expect(result).toBe(false);
  });

  it("PRIMARY signal: profiles.is_admin=TRUE → admin", async () => {
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: { is_admin: true },
      error: null,
    });
    const result = await isAdminUserGivenUserAppRoles(
      makeSupabase(),
      USER,
      [],
    );
    expect(result).toBe(true);
    // No user_app_roles round-trip — the caller already supplied the
    // role set, and the primary signal short-circuited.
    expect(userRolesQueryMock).not.toHaveBeenCalled();
  });

  it("SECONDARY signal: caller-supplied userAppRoles includes 'admin' → admin", async () => {
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: { is_admin: false },
      error: null,
    });
    const result = await isAdminUserGivenUserAppRoles(
      makeSupabase(),
      USER,
      ["admin"],
    );
    expect(result).toBe(true);
    // The redundant hasAdminRoleRow round-trip is gone — the caller's
    // pre-fetched set is consulted in memory.
    expect(userRolesQueryMock).not.toHaveBeenCalled();
  });

  it("dead-admin pin: empty userAppRoles + profiles.is_admin=FALSE → NOT admin (even if ADMIN_EMAIL would match)", async () => {
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: { is_admin: false },
      error: null,
    });
    const result = await isAdminUserGivenUserAppRoles(
      makeSupabase(),
      USER,
      [],
    );
    expect(result).toBe(false);
  });

  it("ghost-admin pin: userAppRoles=['allocator'] + profiles.is_admin=TRUE → admin", async () => {
    profilesIsAdminQueryMock.mockResolvedValueOnce({
      data: { is_admin: true },
      error: null,
    });
    const result = await isAdminUserGivenUserAppRoles(
      makeSupabase(),
      USER,
      ["allocator"],
    );
    expect(result).toBe(true);
  });
});
