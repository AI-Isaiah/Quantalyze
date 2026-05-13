import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * P463 (audit-2026-05-07) — structural gate ensuring the /admin/users
 * page query against `user_app_roles` is bounded.
 *
 * Pre-fix the join read was:
 *   admin.from("user_app_roles").select("user_id, role")
 *
 * with no .limit() — which OOMs the admin route handler once the role
 * table grows past a few thousand rows. The page already capped
 * `profiles` at 500, so the unbounded join was a single-row regression
 * waiting to land.
 *
 * Why a source-level gate rather than a full RTL render: this is a
 * server component inside a route group `(dashboard)` that calls
 * `redirect()` and pulls in the admin Supabase client transitively
 * through `isAdminUser`. Wiring a full mock harness for a structural
 * regression is overkill; reading the file and asserting the limit
 * literal is a 5-line check that fails fast on the only mutation
 * anyone could make to reintroduce the bug.
 */

const PAGE_PATH = join(
  __dirname,
  "page.tsx",
);

describe("/admin/users page — P463 user_app_roles read bounded", () => {
  it("calls .limit(...) on the user_app_roles query", () => {
    const src = readFileSync(PAGE_PATH, "utf-8");

    // Find the user_app_roles select. Use a regex that tolerates the
    // chained .select(...).limit(...) and the named-const variant.
    const match = src.match(
      /from\(\s*["']user_app_roles["']\s*\)[\s\S]{0,200}\.limit\(/,
    );
    expect(
      match,
      "user_app_roles query must include .limit(...) — see P463",
    ).not.toBeNull();
  });

  it("caps the user_app_roles read at 500 (matches profiles cap)", () => {
    const src = readFileSync(PAGE_PATH, "utf-8");
    // The bound is exposed as USER_APP_ROLES_LIMIT = 500. Either inline
    // 500 or the named constant satisfies the gate; the production code
    // uses the named constant for the footer reference.
    expect(src).toMatch(/USER_APP_ROLES_LIMIT\s*=\s*500/);
  });

  it("renders a 'refine search' footer when the limit is reached", () => {
    const src = readFileSync(PAGE_PATH, "utf-8");
    expect(src).toMatch(/Showing 500 most recent/i);
    expect(src).toMatch(/user-app-roles-limit-notice/);
  });
});
