import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectMechanism,
  runCheck,
  stripComments,
} from "../../scripts/check-admin-route-manifest";
import type { AdminRouteEntry } from "../lib/auth/rbac-manifest";

/**
 * Regression tests for `scripts/check-admin-route-manifest.ts` — the CI
 * drift gate that prevents a new admin route from shipping without an
 * explicit RBAC declaration (audit-2026-05-07 C-0153).
 *
 * audit-2026-05-07 testing T1 (HIGH conf 8): pre-fix the script had ZERO
 * test coverage. A single regex bug or alternation typo silently
 * disabled the gate. These tests drive `runCheck` against a tmp fixture
 * tree covering each violation class plus the security S1 carve-out
 * (comment-only `withRole` mention does NOT count as a real call).
 *
 * Strategy: build a tiny `<root>/src/app/api/admin/<route>/route.ts`
 * tree per test, hand-craft a fixture manifest, and assert the returned
 * violations array. No process exit, no console capture — `runCheck`
 * is pure and that's the point of the T1 refactor.
 */

let fixtureRoot: string;

function writeRoute(relativePath: string, contents: string): void {
  const abs = join(fixtureRoot, relativePath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, contents, "utf-8");
}

const WITH_ROLE_ROUTE = `import { withRole } from "@/lib/auth";
export const POST = withRole("admin")(async () => {
  return new Response("ok");
});
`;

const ISADMIN_INLINE_ROUTE = `import { isAdminUser } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdminUser(supabase, user)) {
    return new Response("forbidden", { status: 403 });
  }
  return new Response("ok");
}
`;

const WITH_ADMIN_AUTH_ROUTE = `import { withAdminAuth } from "@/lib/api/withAdminAuth";
export const POST = withAdminAuth(async () => {
  return new Response("ok");
});
`;

const AUTHENTICATED_NON_ADMIN_ROUTE = `import { createClient } from "@/lib/supabase/server";
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("unauth", { status: 401 });
  return new Response("ok");
}
`;

const UNGATED_ROUTE = `export async function GET() {
  return new Response("ok");
}
`;

const COMMENT_ONLY_WITH_ROLE_BUT_REAL_ISADMIN_ROUTE = `import { isAdminUser } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
// Migration note: this used to be wrapped with withRole("admin") — see
// the manifest's notes field for the Sprint 7 migration plan.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdminUser(supabase, user)) {
    return new Response("forbidden", { status: 403 });
  }
  return new Response("ok");
}
`;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "check-admin-route-manifest-"));
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("stripComments", () => {
  it("removes line comments", () => {
    expect(stripComments("// withRole('admin')\nfoo()")).toBe("\nfoo()");
  });
  it("removes block comments (multiline)", () => {
    const src = "/*\n  withRole('admin')\n*/\nfoo()";
    expect(stripComments(src).includes("withRole")).toBe(false);
  });
  it("preserves non-comment code", () => {
    expect(stripComments("const x = withRole('admin');")).toBe(
      "const x = withRole('admin');",
    );
  });
});

describe("detectMechanism", () => {
  it("classifies a real withRole call", () => {
    expect(detectMechanism(WITH_ROLE_ROUTE)).toBe("withRole");
  });

  it("classifies a real withAdminAuth call", () => {
    expect(detectMechanism(WITH_ADMIN_AUTH_ROUTE)).toBe("withAdminAuth");
  });

  it("classifies a real isAdminUser inline call", () => {
    expect(detectMechanism(ISADMIN_INLINE_ROUTE)).toBe(
      "isAdminUser-inline",
    );
  });

  it("classifies the authenticated-non-admin carve-out", () => {
    expect(detectMechanism(AUTHENTICATED_NON_ADMIN_ROUTE)).toBe(
      "authenticated-non-admin",
    );
  });

  it("returns UNGATED when no recognizable gate is present", () => {
    expect(detectMechanism(UNGATED_ROUTE)).toBe("UNGATED");
  });

  it("security S1: comment-only `withRole` mention does NOT count as a real call (uses the real gate)", () => {
    // audit-2026-05-07 security S1 (MED conf 8): pre-fix the bare regex
    // matched a comment containing `withRole(`. Post-fix `stripComments`
    // removes the comment before matching — the route's REAL gate
    // (isAdminUser inline) is what surfaces.
    expect(
      detectMechanism(COMMENT_ONLY_WITH_ROLE_BUT_REAL_ISADMIN_ROUTE),
    ).toBe("isAdminUser-inline");
  });
});

describe("runCheck", () => {
  it("returns no violations on the golden path (manifest matches disk)", () => {
    writeRoute("src/app/api/admin/golden/route.ts", WITH_ROLE_ROUTE);
    const manifest: AdminRouteEntry[] = [
      {
        route: "src/app/api/admin/golden/route.ts",
        current: "withRole",
        target: "withRole",
        notes: "",
      },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations).toEqual([]);
  });

  it("emits MISSING when a route exists on disk but is absent from the manifest", () => {
    writeRoute("src/app/api/admin/orphan/route.ts", WITH_ROLE_ROUTE);
    const violations = runCheck(fixtureRoot, []);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(
      /^MISSING: admin route src\/app\/api\/admin\/orphan\/route\.ts/,
    );
  });

  it("emits STALE when a manifest entry has no matching file on disk", () => {
    const manifest: AdminRouteEntry[] = [
      {
        route: "src/app/api/admin/ghost/route.ts",
        current: "withRole",
        target: "withRole",
        notes: "",
      },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(
      /^STALE: manifest entry src\/app\/api\/admin\/ghost\/route\.ts/,
    );
  });

  it("emits UNGATED when a route has no recognizable admin gate", () => {
    writeRoute("src/app/api/admin/ungated/route.ts", UNGATED_ROUTE);
    const manifest: AdminRouteEntry[] = [
      {
        route: "src/app/api/admin/ungated/route.ts",
        current: "withRole",
        target: "withRole",
        notes: "",
      },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(
      /^UNGATED: admin route src\/app\/api\/admin\/ungated\/route\.ts/,
    );
  });

  it("emits DRIFT when the route's actual mechanism != the manifest's declared `current`", () => {
    writeRoute("src/app/api/admin/drift/route.ts", ISADMIN_INLINE_ROUTE);
    const manifest: AdminRouteEntry[] = [
      {
        route: "src/app/api/admin/drift/route.ts",
        // Manifest LIES — it claims withRole, but the file uses isAdminUser inline.
        current: "withRole",
        target: "withRole",
        notes: "",
      },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(
      /^DRIFT: admin route src\/app\/api\/admin\/drift\/route\.ts uses isAdminUser-inline but the manifest declares withRole/,
    );
  });

  it("security S1: a route whose only `withRole` reference is in a comment + real isAdminUser gate → DRIFT (not OK)", () => {
    // Pre-fix the bare regex matched the comment and classified the
    // route as `withRole` — the manifest entry saying `withRole` then
    // silently agreed. Post-fix the comment is stripped, the actual
    // mechanism (isAdminUser-inline) is detected, and the mismatch
    // surfaces as DRIFT. This is the bypass the security specialist
    // flagged (MED conf 8).
    writeRoute(
      "src/app/api/admin/comment-bypass/route.ts",
      COMMENT_ONLY_WITH_ROLE_BUT_REAL_ISADMIN_ROUTE,
    );
    const manifest: AdminRouteEntry[] = [
      {
        route: "src/app/api/admin/comment-bypass/route.ts",
        current: "withRole",
        target: "withRole",
        notes: "",
      },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/^DRIFT: /);
    expect(violations[0]).toMatch(/uses isAdminUser-inline/);
  });

  it("accepts the authenticated-non-admin carve-out when the manifest declares it", () => {
    writeRoute(
      "src/app/api/admin/notify-submission/route.ts",
      AUTHENTICATED_NON_ADMIN_ROUTE,
    );
    const manifest: AdminRouteEntry[] = [
      {
        route: "src/app/api/admin/notify-submission/route.ts",
        current: "authenticated-non-admin",
        target: "authenticated-non-admin",
        notes: "carve-out",
      },
    ];
    const violations = runCheck(fixtureRoot, manifest);
    expect(violations).toEqual([]);
  });
});
