/**
 * Phase 170.1.2 D-01 — /admin/users/[id] reads roles, statuses and the legacy
 * flag as words. The tab title is pinned in `page.metadata.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`unexpected redirect to ${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("unexpected notFound");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }),
    },
  })),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: vi.fn(async () => true),
}));

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

// The panel is a client component with its own suite.
vi.mock("@/components/admin/UserRolesPanel", () => ({
  UserRolesPanel: () => null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = () =>
        Promise.resolve({ data: state.profile, error: null });
      // user_app_roles is awaited directly after .order(); make it thenable.
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: table === "user_app_roles" ? [] : null, error: null });
      return builder;
    },
  }),
}));

import AdminUserDetailPage from "./page";

const params = Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" });

function profile(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    display_name: "Jane",
    company: null,
    email: "jane@example.com",
    role: "manager",
    is_admin: false,
    allocator_status: "newbie",
    manager_status: "verified",
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

/** The <dd> value next to a <dt> label. */
function rowValue(label: string): string {
  const dt = screen.getByText(label);
  return dt.parentElement?.querySelector("dd")?.textContent ?? "";
}

beforeEach(() => {
  state.profile = profile();
});

describe("/admin/users/[id] labels", () => {
  it("reads the role, statuses and the legacy flag as words", async () => {
    render(await AdminUserDetailPage({ params }));
    expect(rowValue("Profile role")).toBe("Asset Manager");
    expect(rowValue("Allocator status")).toBe("New");
    expect(rowValue("Manager status")).toBe("Verified");
    expect(rowValue("Legacy admin flag")).toBe("No");
    expect(screen.queryByText("Legacy is_admin")).toBeNull();
    expect(screen.queryByText("Legacy admin")).toBeNull();
  });

  it("reads a set legacy flag as Yes and shows the Legacy admin badge", async () => {
    state.profile = profile({ is_admin: true });
    render(await AdminUserDetailPage({ params }));
    expect(rowValue("Legacy admin flag")).toBe("Yes");
    expect(screen.getByText("Legacy admin")).toBeTruthy();
  });

  it("reads a role outside the set as Unknown role, never the raw value", async () => {
    state.profile = profile({ role: "zzz" });
    render(await AdminUserDetailPage({ params }));
    expect(rowValue("Profile role")).toBe("Unknown role");
    expect(screen.queryByText("zzz")).toBeNull();
  });
});
