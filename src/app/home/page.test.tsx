/**
 * Phase 199 MANAGERHOME (CD-07, CD-08, ROUTE-01) - /home is the one server
 * role-home redirect.
 *
 * The proxy cannot read a profile (cookie-only), so every site that has no
 * profile in hand links here and this page redirects by `roleHomeFor`.
 *
 * `isAdminUser` is NOT mocked: the supabase client is, so the admin read can
 * fail the way a real one does (a returned `{ error }`, never a throw).
 *
 * Fails when: a role lands on another role's page; /home decides admin on
 * anything but the `isAdminUser` answer the admin page guards use, which would
 * put /home and those guards on different predicates and loop between them
 * (T-199-08); a database error on the admin read is taken for "not admin"
 * (landing a true `profiles.is_admin` on a non-admin home) instead of
 * reporting and throwing; a failed profile read, or a missing profile row,
 * redirects to a guessed home instead of throwing to the error boundary
 * (T-199-09); a signed-out visit does not go to /.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

let sessionUser: { id: string; email?: string } | null = null;
let profileResult: { data: Record<string, unknown> | null; error: unknown } = {
  data: null,
  error: null,
};
// The two reads `isAdminUser` makes: profiles.is_admin (`.single()`) and
// user_app_roles (`.limit()`). Both answer `{ data, error }` like supabase-js.
let adminFlagResult: { data: { is_admin: boolean } | null; error: unknown } = {
  data: { is_admin: false },
  error: null,
};
let adminRoleRowsResult: { data: { role: string }[] | null; error: unknown } = {
  data: [],
  error: null,
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser } }) },
    from: (table: string) =>
      table === "user_app_roles"
        ? {
            select: () => ({
              eq: () => ({
                eq: () => ({ limit: async () => adminRoleRowsResult }),
              }),
            }),
          }
        : {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => profileResult,
                single: async () => adminFlagResult,
              }),
            }),
          },
  }),
}));

// admin.ts reports non-RLS read errors through a lazy Sentry import.
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const captureToSentryMock = vi.fn();
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (...args: unknown[]) => captureToSentryMock(...args),
}));

import RoleHomePage from "./page";

function profile(overrides: Record<string, unknown>) {
  return {
    role: "allocator",
    allocator_status: "verified",
    manager_status: null,
    is_admin: false,
    ...overrides,
  };
}

async function landing(): Promise<string> {
  try {
    await RoleHomePage();
  } catch (err) {
    const m = /^NEXT_REDIRECT:(.*)$/.exec((err as Error).message);
    if (m) return m[1];
    throw err;
  }
  throw new Error("RoleHomePage returned without redirecting");
}

beforeEach(() => {
  redirectMock.mockClear();
  adminFlagResult = { data: { is_admin: false }, error: null };
  adminRoleRowsResult = { data: [], error: null };
  captureToSentryMock.mockClear();
  sessionUser = { id: "user-1", email: "u@example.com" };
  profileResult = { data: profile({}), error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/home redirects by role (CD-07, CD-08)", () => {
  it("a signed-out visit goes to /", async () => {
    sessionUser = null;
    expect(await landing()).toBe("/");
  });

  it("an allocator lands on /allocations", async () => {
    profileResult = { data: profile({ role: "allocator" }), error: null };
    expect(await landing()).toBe("/allocations");
  });

  it("a manager lands on /strategies", async () => {
    profileResult = {
      data: profile({
        role: "manager",
        allocator_status: null,
        manager_status: "verified",
      }),
      error: null,
    };
    expect(await landing()).toBe("/strategies");
  });

  it("role both (not admin) lands on /allocations", async () => {
    profileResult = {
      data: profile({
        role: "both",
        allocator_status: "verified",
        manager_status: "verified",
      }),
      error: null,
    };
    expect(await landing()).toBe("/allocations");
  });

  it("a profile with is_admin lands on /admin, whatever its role", async () => {
    profileResult = {
      data: profile({ role: "both", is_admin: true }),
      error: null,
    };
    adminFlagResult = { data: { is_admin: true }, error: null };
    expect(await landing()).toBe("/admin");
  });

  // WR-03: the admin pages refuse on isAdminUser alone. If /home trusted the
  // profile row's flag over a false isAdminUser, /admin would refuse to /home
  // and /home would send the admin straight back to /admin, forever.
  it("follows isAdminUser over the profile flag, so a refused admin page never bounces back to /admin", async () => {
    profileResult = {
      data: profile({ role: "both", is_admin: true, allocator_status: "verified", manager_status: "verified" }),
      error: null,
    };
    adminFlagResult = { data: { is_admin: false }, error: null };
    expect(await landing()).toBe("/allocations");
  });

  it("an admin known only through a user_app_roles admin row lands on /admin", async () => {
    // Same predicate the admin page guards use: is_admin, else the role row.
    // Without it /home would send this admin to /allocations while the
    // guards treat them as admin (T-199-08).
    profileResult = {
      data: profile({ role: "allocator", is_admin: false }),
      error: null,
    };
    adminRoleRowsResult = { data: [{ role: "admin" }], error: null };
    expect(await landing()).toBe("/admin");
  });

  it("an unapproved profile lands on /pending-approval", async () => {
    profileResult = {
      data: profile({ role: "allocator", allocator_status: "newbie" }),
      error: null,
    };
    expect(await landing()).toBe("/pending-approval");
  });

  // SFH-02: a profile row is created at signup, so a missing one is a
  // data-integrity fault. Sending it to /pending-approval hides it behind a
  // plausible page; it throws to the error boundary and reports instead.
  it("a missing profile row throws and reports, never lands on /pending-approval", async () => {
    profileResult = { data: null, error: null };
    await expect(RoleHomePage()).rejects.toThrow("Profile row missing for auth user");
    expect(redirectMock).not.toHaveBeenCalled();
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock.mock.calls[0][1]).toMatchObject({
      tags: { route: "home", stage: "profile-missing" },
    });
  });

  // SFH-R2-01: isAdminUser never throws on its own, so a database error on the
  // admin read used to read as "not admin". /home would then override a true
  // `profiles.is_admin` and land that admin on a role surface or
  // /pending-approval. It now asks for the strict form, reports and throws.
  it("a database error on the profiles.is_admin read reports and throws, never overrides a true is_admin", async () => {
    const dbError = { code: "57014", message: "statement timeout" };
    profileResult = {
      data: profile({ role: "manager", manager_status: "verified", is_admin: true }),
      error: null,
    };
    adminFlagResult = { data: null, error: dbError };
    await expect(RoleHomePage()).rejects.toBe(dbError);
    expect(redirectMock).not.toHaveBeenCalled();
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock.mock.calls[0][1]).toMatchObject({
      tags: { route: "home", stage: "admin" },
      level: "error",
    });
  });

  it("a database error on the user_app_roles read throws too, rather than landing on a non-admin home", async () => {
    const dbError = { code: "57014", message: "statement timeout" };
    profileResult = { data: profile({ role: "manager", manager_status: "verified" }), error: null };
    adminRoleRowsResult = { data: null, error: dbError };
    await expect(RoleHomePage()).rejects.toBe(dbError);
    expect(redirectMock).not.toHaveBeenCalled();
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
  });
});

describe("/home on a failed profile read (T-199-09)", () => {
  it("throws to the error boundary and never redirects on a guess", async () => {
    const dbError = { code: "57014", message: "statement timeout" };
    profileResult = { data: null, error: dbError };
    await expect(RoleHomePage()).rejects.toBe(dbError);
    expect(redirectMock).not.toHaveBeenCalled();
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
  });
});
