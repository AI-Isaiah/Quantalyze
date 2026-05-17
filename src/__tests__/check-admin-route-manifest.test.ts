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
  stripUnreachableIfFalseBlocks,
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

// audit-2026-05-07 red-team (HIGH conf 8): the STRING-literal bypass.
// The string contains `withRole("admin")` as message text — the route's
// REAL gate is the inline `isAdminUser` call. Pre-fix `stripComments`
// only stripped `//` and `/* */`, so this would classify as `withRole`.
const STRING_LITERAL_WITH_ROLE_BUT_REAL_ISADMIN_ROUTE = `import { isAdminUser } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const deprecationHint = JSON.stringify({ hint: "withRole(\\"admin\\") deprecated" });
  if (!isAdminUser(supabase, user)) {
    return new Response(deprecationHint, { status: 403 });
  }
  return new Response("ok");
}
`;

// Template-literal bypass — same shape, backtick-delimited so the
// `${...}` substitution path of the tokenizer also gets exercised.
const TEMPLATE_LITERAL_WITH_ROLE_BUT_REAL_ISADMIN_ROUTE = `import { isAdminUser } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
const role = "admin";
const ERROR = \`use withRole(\${role}) instead — see ADR-0005\`;
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdminUser(supabase, user)) {
    return new Response(ERROR, { status: 403 });
  }
  return new Response("ok");
}
`;

// The line-comment-inside-string hazard. Pre-fix the regex
// `/\\/\\/[^\\n]*/g` would destroy the rest of the line starting at the
// `//` INSIDE the string literal, masking the real `isAdminUser(` call
// that follows on the same physical line. Post-fix the tokenizer is
// inside a string state at the `//` and treats it as inert content.
const SAME_LINE_URL_AND_ISADMIN_ROUTE = `import { isAdminUser } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const docs = "https://docs/withRole"; if (!isAdminUser(supabase, user)) return new Response("nope", { status: 403 });
  return new Response(docs);
}
`;

// audit-2026-05-07 red-team (MED conf 8): dead-code closure bypass. A
// `withRole('admin')(...)` guarded inside an `if (false) { ... }` is
// statically unreachable; the real export is UNGATED. Pre-fix the
// detector returned `withRole`, letting the manifest gate pass on a
// route that has NO runtime gate.
const DEAD_CODE_WITH_ROLE_BUT_UNGATED_ROUTE = `import { withRole } from "@/lib/auth";
export async function GET() {
  if (false) {
    return withRole("admin")(async () => new Response("dead"))(new Request("http://x"));
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
    // Tokenizer pass replaces each comment char with a space rather than
    // deleting it, so line numbers stay aligned. We only care that the
    // matchable `withRole` token is gone post-strip.
    expect(stripComments("// withRole('admin')\nfoo()").includes("withRole")).toBe(false);
  });
  it("removes block comments (multiline)", () => {
    const src = "/*\n  withRole('admin')\n*/\nfoo()";
    expect(stripComments(src).includes("withRole")).toBe(false);
  });
  it("preserves non-comment code", () => {
    // The tokenizer erases STRING contents, so the substring `'admin'`
    // inside the string literal is replaced with whitespace. The
    // surrounding `withRole(` call IS a real call (not a string) and
    // survives — that is what detectMechanism keys on.
    const stripped = stripComments("const x = withRole('admin');");
    expect(stripped.includes("withRole(")).toBe(true);
    expect(stripped.includes("'admin'")).toBe(false);
  });

  // audit-2026-05-07 red-team (HIGH conf 8): the string + template bypass.
  it("red-team: strips DOUBLE-QUOTED string contents", () => {
    const src = `const msg = "withRole(\\"admin\\")"; foo();`;
    const stripped = stripComments(src);
    expect(stripped.includes("withRole")).toBe(false);
    // `foo()` is real code and must survive.
    expect(stripped.includes("foo()")).toBe(true);
  });

  it("red-team: strips SINGLE-QUOTED string contents", () => {
    const src = `const msg = 'withRole("admin")'; foo();`;
    const stripped = stripComments(src);
    expect(stripped.includes("withRole")).toBe(false);
    expect(stripped.includes("foo()")).toBe(true);
  });

  it("red-team: strips TEMPLATE-LITERAL contents (including substitutions)", () => {
    const src = "const msg = `use withRole(${role}) instead`; foo();";
    const stripped = stripComments(src);
    expect(stripped.includes("withRole")).toBe(false);
    expect(stripped.includes("foo()")).toBe(true);
  });

  it("red-team: a `//` INSIDE a string literal does NOT eat the rest of the line", () => {
    // Pre-fix the bare line-comment regex `/\/\/[^\n]*/g` would match
    // the `//` inside `"https://docs/..."` and delete EVERYTHING that
    // followed — including a real `isAdminUser(` call on the same line.
    // The tokenizer is in a string state at the `//` and treats it as
    // inert content, so the real call survives.
    const src = `const docs = "https://docs/withRole"; isAdminUser(supabase, user);`;
    const stripped = stripComments(src);
    expect(stripped.includes("withRole")).toBe(false);
    // Real call survives.
    expect(stripped.includes("isAdminUser(")).toBe(true);
  });

  it("red-team: respects escape sequences inside strings (`\\\"` does not terminate)", () => {
    const src = `const msg = "a \\"withRole(\\\\\\"admin\\\\\\")\\" b"; foo();`;
    const stripped = stripComments(src);
    // The whole string is one token — the embedded escaped quote does
    // not exit string state.
    expect(stripped.includes("withRole")).toBe(false);
    expect(stripped.includes("foo()")).toBe(true);
  });

  it("red-team: preserves newlines so any future line-aware diagnostic stays aligned", () => {
    const src = "/* line 1\nline 2 */\nfoo();";
    const stripped = stripComments(src);
    // Two newlines preserved (one in the block comment, one between */
    // and `foo();`).
    expect((stripped.match(/\n/g) ?? []).length).toBe(2);
  });
});

describe("stripUnreachableIfFalseBlocks", () => {
  // audit-2026-05-07 red-team (MED conf 8): dead-code closure bypass.
  it("erases the body of an `if (false) { ... }` block", () => {
    const src = "before(); if (false) { withRole('admin')(...) } after();";
    const stripped = stripUnreachableIfFalseBlocks(src);
    expect(stripped.includes("withRole")).toBe(false);
    expect(stripped.includes("before()")).toBe(true);
    expect(stripped.includes("after()")).toBe(true);
  });

  it("handles arbitrary whitespace between `if`, `(`, `false`, `)`, `{`", () => {
    const src = "if   (\n  false\n)  {\n  withRole('admin')(...)\n}\nafter();";
    const stripped = stripUnreachableIfFalseBlocks(src);
    expect(stripped.includes("withRole")).toBe(false);
    expect(stripped.includes("after()")).toBe(true);
  });

  it("handles nested braces inside the dead block", () => {
    const src = "if (false) { { withRole('admin')(...) } } after();";
    const stripped = stripUnreachableIfFalseBlocks(src);
    expect(stripped.includes("withRole")).toBe(false);
    expect(stripped.includes("after()")).toBe(true);
  });

  it("does NOT erase a live `if (someCondition)` block", () => {
    const src = "if (cond) { withRole('admin')(...) } after();";
    const stripped = stripUnreachableIfFalseBlocks(src);
    // Live branch — keep the call.
    expect(stripped.includes("withRole")).toBe(true);
  });

  it("does NOT match identifier prefixes (e.g. `iffalse`, `if_x`)", () => {
    // The function name `iffoo` happens to start with `if` followed by
    // an identifier-continue char — must not trigger the dead-code
    // stripper.
    const src = "function iffoo() { withRole('admin')(); }";
    const stripped = stripUnreachableIfFalseBlocks(src);
    expect(stripped.includes("withRole")).toBe(true);
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

  it("red-team: string-literal-only `withRole` mention does NOT classify (uses the real gate)", () => {
    // audit-2026-05-07 red-team (HIGH conf 8): the string-literal
    // bypass. `withRole("admin")` inside a `JSON.stringify` argument is
    // not a real call. Post-fix the tokenizer erases the string body
    // before regex matching — the real gate (isAdminUser inline) is
    // what surfaces.
    expect(
      detectMechanism(STRING_LITERAL_WITH_ROLE_BUT_REAL_ISADMIN_ROUTE),
    ).toBe("isAdminUser-inline");
  });

  it("red-team: template-literal `withRole(${role})` does NOT classify (uses the real gate)", () => {
    expect(
      detectMechanism(TEMPLATE_LITERAL_WITH_ROLE_BUT_REAL_ISADMIN_ROUTE),
    ).toBe("isAdminUser-inline");
  });

  it("red-team: `//` inside a URL string + same-line isAdminUser still detects the gate", () => {
    // Pre-fix: the line-comment regex matched `//` inside
    // `"https://docs/withRole"` and ate everything after, including the
    // real `isAdminUser(` call later on the line — flipping detection
    // to UNGATED. Post-fix the tokenizer treats `//` inside a string
    // as inert content and the call survives stripping.
    expect(detectMechanism(SAME_LINE_URL_AND_ISADMIN_ROUTE)).toBe(
      "isAdminUser-inline",
    );
  });

  it("red-team: dead-code `if (false) { withRole('admin')(...) }` does NOT classify (UNGATED)", () => {
    // audit-2026-05-07 red-team (MED conf 8): closure / dead-branch
    // bypass. The route's REAL export is unauth — the dead branch is
    // statically unreachable. Pre-fix the detector returned `withRole`.
    // Post-fix `stripUnreachableIfFalseBlocks` erases the block before
    // regex matching.
    expect(detectMechanism(DEAD_CODE_WITH_ROLE_BUT_UNGATED_ROUTE)).toBe(
      "UNGATED",
    );
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
