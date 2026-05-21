/**
 * C-0017 (audit-2026-05-07) regression — /scenarios role gate.
 *
 * Pre-fix the page only checked `if (!user) redirect(...)`. Any
 * authenticated user — including non-allocator managers — could navigate
 * directly to /scenarios and pull raw daily_returns + codename mapping
 * for the institutional-tier strategy universe via the RSC payload,
 * because the server uses `createAdminClient()` to fetch the data
 * (RLS-bypassed) and the sidebar gate is purely UI.
 *
 * Fix: add a `profiles.role` lookup; redirect non-allocators to "/" so
 * the route enforces the same gate the sidebar already does. The contract
 * matches `withAllocatorAuth` and the dashboard layout —
 * `role IN ('allocator','both')`.
 *
 * These tests prove the gate runs BEFORE the admin-client read. If they
 * fail (e.g. someone removes the role check), the route would silently
 * leak the strategy universe to managers again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectMock(path);
    // Mirror next/navigation's contract: redirect throws to unwind the
    // RSC render. The page handler depends on this for control flow.
    throw new Error(`__REDIRECT__:${path}`);
  },
}));

// PageHeader + ScenarioBuilder are RSC-side stubs so the page can import
// them without dragging in client-only deps.
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: () => null,
}));
vi.mock("@/components/scenarios/ScenarioBuilder", () => ({
  ScenarioBuilder: () => null,
}));

// The page uses the admin client to fetch the strategy universe. If this
// mock is invoked, the role gate has FAILED CLOSED — we count calls and
// assert zero in the manager-rejection test.
const adminFromMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (...args: unknown[]) => {
      adminFromMock(...args);
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: async () => ({ data: [], error: null }),
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(onF),
      };
      return builder;
    },
  }),
}));

type Role = "allocator" | "both" | "manager" | null;

const supabaseState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profileRole: null as Role,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: supabaseState.user },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table !== "profiles") {
        throw new Error(`Unexpected table on user client: ${table}`);
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        async maybeSingle() {
          if (!supabaseState.user) {
            return { data: null, error: null };
          }
          return {
            data:
              supabaseState.profileRole === null
                ? null
                : { role: supabaseState.profileRole },
            error: null,
          };
        },
      };
      return builder;
    },
  }),
}));

describe("ScenariosPage role gate (C-0017)", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    adminFromMock.mockClear();
    supabaseState.user = null;
    supabaseState.profileRole = null;
  });

  it("redirects unauthenticated callers to /login (existing contract)", async () => {
    const { default: ScenariosPage } = await import("./page");
    await expect(ScenariosPage()).rejects.toThrow(/__REDIRECT__:\/login/);
    expect(redirectMock).toHaveBeenCalledWith("/login?next=/scenarios");
    // Admin client must NOT be invoked for unauthenticated callers.
    expect(adminFromMock).not.toHaveBeenCalled();
  });

  it("redirects authenticated non-allocators (manager) to / before any admin read", async () => {
    supabaseState.user = { id: "11111111-1111-1111-1111-111111111111" };
    supabaseState.profileRole = "manager";
    const { default: ScenariosPage } = await import("./page");
    await expect(ScenariosPage()).rejects.toThrow(/__REDIRECT__:\//);
    expect(redirectMock).toHaveBeenCalledWith("/");
    // CRITICAL: the admin client must not be touched on the reject path,
    // proving the gate fires BEFORE the institutional-strategy fetch.
    expect(adminFromMock).not.toHaveBeenCalled();
  });

  it("redirects authenticated users with missing profile row to /", async () => {
    supabaseState.user = { id: "22222222-2222-2222-2222-222222222222" };
    supabaseState.profileRole = null; // no profile row
    const { default: ScenariosPage } = await import("./page");
    await expect(ScenariosPage()).rejects.toThrow(/__REDIRECT__:\//);
    expect(redirectMock).toHaveBeenCalledWith("/");
    expect(adminFromMock).not.toHaveBeenCalled();
  });

  it("allows role='allocator' past the gate (reaches admin-client fetch)", async () => {
    supabaseState.user = { id: "33333333-3333-3333-3333-333333333333" };
    supabaseState.profileRole = "allocator";
    const { default: ScenariosPage } = await import("./page");
    // Page renders to completion (no redirect). We do not assert the
    // RSC output here; the important contract is "gate did not reject".
    await ScenariosPage();
    expect(redirectMock).not.toHaveBeenCalled();
    // Gate passed → admin client WAS reached.
    expect(adminFromMock).toHaveBeenCalled();
  });

  it("allows role='both' past the gate", async () => {
    supabaseState.user = { id: "44444444-4444-4444-4444-444444444444" };
    supabaseState.profileRole = "both";
    const { default: ScenariosPage } = await import("./page");
    await ScenariosPage();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(adminFromMock).toHaveBeenCalled();
  });
});
