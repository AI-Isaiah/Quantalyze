/** @vitest-environment node */
/**
 * D-17 (DOMAINONE, founder 2026-10-07) — the dashboard layout reads the count
 * of unprocessed for-quants leads for the admin sidebar badge.
 *
 * The contract under test is the WIRING between the layout and the read, since
 * the helper and the Sidebar are tested on their own:
 *   - the count is read ONLY after the admin check passes: a non-admin never
 *     triggers the service-role read at all;
 *   - an admin gets the measured count handed to DashboardChrome;
 *   - a failed read hands DashboardChrome NO count (never a fake 0 that would
 *     read as "all caught up") and the failure is logged.
 *
 * The real `countUnprocessedForQuantsLeads` runs against a stubbed admin
 * client, so "the read" is observable as a call to `createAdminClient`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("unexpected redirect");
  }),
}));

const state = vi.hoisted(
  (): {
    profile: Record<string, unknown> | null;
    claimAdmin: boolean;
    countResult: { count: number | null; error: unknown };
    adminThrows: boolean;
    adminCalls: number;
  } => ({
    profile: null,
    claimAdmin: false,
    countResult: { count: 0, error: null },
    adminThrows: false,
    adminCalls: 0,
  }),
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.profile }) }),
      }),
    }),
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => state.claimAdmin,
}));

vi.mock("@/lib/queries", () => ({
  getPopulatedCategorySlugs: async () => [],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.adminCalls += 1;
    if (state.adminThrows) throw new Error("admin client unavailable");
    return {
      from: () => ({
        select: () => ({ is: async () => state.countResult }),
      }),
    };
  },
}));

// DashboardChrome is a client component; the layout only needs to hand it
// props, so a stub keeps the element inspectable without rendering it.
vi.mock("@/components/layout/DashboardChrome", () => ({
  DashboardChrome: () => null,
}));

async function renderedProps(): Promise<Record<string, unknown>> {
  const { default: DashboardLayout } = await import("./layout");
  const el = await DashboardLayout({ children: null });
  return (el as { props: Record<string, unknown> }).props;
}

const ADMIN_PROFILE = {
  role: "both",
  allocator_status: "verified",
  manager_status: "verified",
  is_admin: true,
};
const ALLOCATOR_PROFILE = {
  role: "allocator",
  allocator_status: "verified",
  manager_status: "newbie",
  is_admin: false,
};

describe("(dashboard)/layout — unprocessed-leads badge count (D-17)", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.profile = null;
    state.claimAdmin = false;
    state.countResult = { count: 0, error: null };
    state.adminThrows = false;
    state.adminCalls = 0;
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it("an admin with unprocessed leads gets the measured count", async () => {
    state.profile = ADMIN_PROFILE;
    state.countResult = { count: 4, error: null };
    const props = await renderedProps();
    expect(props.isAdmin).toBe(true);
    expect(props.unprocessedLeadsCount).toBe(4);
    expect(state.adminCalls).toBe(1);
  });

  it("an admin with zero unprocessed leads gets 0 (the Sidebar draws nothing for it)", async () => {
    state.profile = ADMIN_PROFILE;
    state.countResult = { count: 0, error: null };
    const props = await renderedProps();
    expect(props.unprocessedLeadsCount).toBe(0);
  });

  it("an admin known only through the claim-set check still gets the count", async () => {
    state.profile = { ...ALLOCATOR_PROFILE, is_admin: false };
    state.claimAdmin = true;
    state.countResult = { count: 2, error: null };
    const props = await renderedProps();
    expect(props.isAdmin).toBe(true);
    expect(props.unprocessedLeadsCount).toBe(2);
  });

  it("a non-admin never triggers the count read and gets no count", async () => {
    state.profile = ALLOCATOR_PROFILE;
    const props = await renderedProps();
    expect(props.isAdmin).toBe(false);
    expect(props.unprocessedLeadsCount).toBeUndefined();
    expect(state.adminCalls).toBe(0);
  });

  it("a failed count read hands over NO count (not 0) and logs", async () => {
    state.profile = ADMIN_PROFILE;
    state.countResult = { count: null, error: { message: "boom" } };
    const props = await renderedProps();
    expect(props.isAdmin).toBe(true);
    expect(props.unprocessedLeadsCount).toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      "[for-quants-leads-admin] unprocessed count failed:",
      { message: "boom" },
    );
  });

  it("an admin client that throws also yields no count, logged, and does not break the layout", async () => {
    state.profile = ADMIN_PROFILE;
    state.adminThrows = true;
    const props = await renderedProps();
    expect(props.isAdmin).toBe(true);
    expect(props.unprocessedLeadsCount).toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});
