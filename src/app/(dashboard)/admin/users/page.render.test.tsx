/**
 * Phase 170.1.2 D-01 — /admin/users shows profile roles and app-role badges as
 * words. The source-regex pin of the `.limit()` calls stays in `page.test.tsx`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`unexpected redirect to ${to}`);
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

const DATA = vi.hoisted(
  () =>
    ({
      profiles: [
        { id: "u1", display_name: "Ann", company: null, email: "ann@example.com", is_admin: false, role: "allocator", created_at: "2026-01-02T00:00:00Z" },
        { id: "u2", display_name: "Bob", company: null, email: "bob@example.com", is_admin: true, role: "manager", created_at: "2026-01-01T00:00:00Z" },
      ],
      user_app_roles: [
        { user_id: "u1", role: "allocator" },
        { user_id: "u2", role: "quant_manager" },
      ],
    }) as Record<string, unknown[]>,
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "order", "limit"]) {
        builder[method] = () => builder;
      }
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: DATA[table], error: null });
      return builder;
    },
  }),
}));

import AdminUsersPage from "./page";

describe("/admin/users labels", () => {
  it("reads profile roles and app-role badges as words", async () => {
    const { container } = render(await AdminUsersPage());
    const text = container.textContent ?? "";

    // Profile role cell for manager reads "Asset Manager".
    expect(text).toContain("Asset Manager");
    // allocator appears as a profile role and as an app-role badge.
    expect(screen.getAllByText("Allocator").length).toBeGreaterThanOrEqual(1);
    // App-role badge for quant_manager.
    expect(text).toContain("Quant manager");
    expect(text).toContain("Legacy admin");
    // Raw values never render.
    expect(text).not.toContain("quant_manager");
    expect(text).not.toContain("legacy admin");
  });
});
