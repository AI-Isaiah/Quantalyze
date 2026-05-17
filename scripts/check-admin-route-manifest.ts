#!/usr/bin/env -S npx tsx
/**
 * CI hook — fail if `src/app/api/admin/**\/route.ts` and the
 * `ADMIN_ROUTE_MANIFEST` constant in `src/lib/auth/rbac-manifest.ts`
 * diverge.
 *
 * audit-2026-05-07 C-0153 (api-contract). The codebase has three
 * parallel admin-gate mechanisms (`withRole`, `withAdminAuth`,
 * `isAdminUser`-inline) and no single source of truth tracked which
 * route uses which. The manifest is that source of truth; this script
 * is the gate that prevents drift.
 *
 * Rules enforced
 * --------------
 *   1. Every `route.ts` under `src/app/api/admin` MUST have an
 *      entry in the manifest.
 *   2. Every manifest entry MUST point at a file that exists.
 *   3. Each entry's `current` field must match what the route actually
 *      imports: a file declaring `withRole` is "withRole", a file
 *      declaring `withAdminAuth` is "withAdminAuth", and a file that
 *      uses `isAdminUser` inline (but neither wrapper) is
 *      "isAdminUser-inline". A route that has NONE of the three is a
 *      hard error — it's an admin route with no gate.
 *
 * Exit codes
 * ----------
 *   0  manifest matches reality.
 *   1  drift detected (one or more violations).
 *
 * Invocation
 * ----------
 * Wired into `npm run check:admin-route-manifest` (package.json) and
 * `npm run lint`, which is the CI hook in `.github/workflows/ci.yml`
 * (frontend-lint job). To run by itself: `npm run check:admin-route-manifest`.
 *
 * audit-2026-05-07 testing T1 (HIGH conf 8) + security S1 (MED conf 8) +
 * maintainability M2 (MED conf 8): split into pure helpers + a
 * `runCheck(rootDir)` entry point so the regression suite at
 * `src/__tests__/check-admin-route-manifest.test.ts` can drive it
 * against a tmp fixture tree. The `detectMechanism` helper now strips
 * comments before regex matching (S1) and the mechanism alternation is
 * derived from the imported `AdminGateMechanism` union (M2 — no more
 * three-copy DRY violation).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, join } from "node:path";

import {
  ADMIN_ROUTE_MANIFEST,
  type AdminGateMechanism,
  type AdminRouteEntry,
} from "../src/lib/auth/rbac-manifest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

/**
 * Strip line + block comments before mechanism detection. Without this,
 * a comment containing `// withRole("admin")` would classify the file
 * as `withRole` even if the runtime body uses `isAdminUser` inline (or
 * nothing). Security S1 (audit-2026-05-07, MED conf 8): comment-only
 * mention is not a real call.
 *
 * Deliberately simple — no string-aware tokenizer. A literal containing
 * the substring `//` is rare in route handlers; if it becomes a problem,
 * swap to ts-morph or the TypeScript compiler API for AST walking. The
 * fingerprint here is "good enough" to defeat the documented bypass.
 */
export function stripComments(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/\/\/[^\n]*/g, ""); // line comments
}

export function detectMechanism(
  contents: string,
): AdminGateMechanism | "UNGATED" {
  const stripped = stripComments(contents);
  if (/\bwithRole\s*[<(]/.test(stripped)) return "withRole";
  if (/\bwithAdminAuth\s*\(/.test(stripped)) return "withAdminAuth";
  // Only count a real CALL to isAdminUser, not just a comment mention.
  if (/\bisAdminUser\s*\(/.test(stripped)) return "isAdminUser-inline";
  // No admin gate detected, but the route still gates on auth via
  // supabase.auth.getUser() + an early `!user` 401. The manifest entry
  // must declare this carve-out explicitly via current === "authenticated-non-admin".
  if (
    /supabase\.auth\.getUser\s*\(/.test(stripped) &&
    /!\s*user\b/.test(stripped)
  ) {
    return "authenticated-non-admin";
  }
  return "UNGATED";
}

/**
 * Recursive walk for `route.ts` files under a root. Avoids node:fs.globSync
 * which is not yet declared in the `@types/node` we ship with.
 */
export function findRouteFiles(root: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...findRouteFiles(full));
    } else if (st.isFile() && name === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

/**
 * Pure entry point for the gate. Takes a root directory (so tests can
 * drive a tmp fixture tree) and an explicit manifest (so tests can
 * inject fixture entries without monkey-patching the import). Returns
 * the violation list — empty list = pass. The CLI `main()` below
 * exit-codes based on whether the list is empty.
 *
 * audit-2026-05-07 testing T1 (HIGH conf 8): this shape is exactly
 * what the regression suite needs.
 */
export function runCheck(
  rootDir: string,
  manifest: readonly AdminRouteEntry[] = ADMIN_ROUTE_MANIFEST,
): string[] {
  const manifestByRoute = new Map<string, AdminRouteEntry>();
  for (const entry of manifest) manifestByRoute.set(entry.route, entry);

  const adminRoutes = findRouteFiles(
    resolve(rootDir, "src/app/api/admin"),
  ).map((abs) => relative(rootDir, abs));

  const violations: string[] = [];

  // Rule 1: every route is in the manifest.
  for (const route of adminRoutes) {
    const entry = manifestByRoute.get(route);
    if (!entry) {
      violations.push(
        `MISSING: admin route ${route} has no entry in ADMIN_ROUTE_MANIFEST (src/lib/auth/rbac-manifest.ts). Add an entry declaring its current gate mechanism.`,
      );
      continue;
    }
    // Rule 3: declared mechanism matches reality.
    const fileSrc = readFileSync(resolve(rootDir, route), "utf-8");
    const actual = detectMechanism(fileSrc);
    if (actual === "UNGATED") {
      violations.push(
        `UNGATED: admin route ${route} has no recognizable admin gate (withRole, withAdminAuth, or isAdminUser). This is a security risk — admin routes MUST declare an RBAC gate.`,
      );
      continue;
    }
    if (actual !== entry.current) {
      violations.push(
        `DRIFT: admin route ${route} uses ${actual} but the manifest declares ${entry.current}. Update the manifest's "current" field (and "notes" if the change is intentional).`,
      );
    }
  }

  // Rule 2: every manifest entry points at a real file.
  const adminRouteSet = new Set(adminRoutes);
  for (const entry of manifest) {
    if (!adminRouteSet.has(entry.route)) {
      violations.push(
        `STALE: manifest entry ${entry.route} does not exist on disk. Remove the entry or restore the file.`,
      );
    }
  }

  return violations;
}

function main(): void {
  const violations = runCheck(REPO_ROOT);

  if (violations.length > 0) {
    console.error(
      `[check-admin-route-manifest] ${violations.length} violation(s):\n`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      "\nManifest: src/lib/auth/rbac-manifest.ts\nFinding: audit-2026-05-07 C-0153",
    );
    process.exit(1);
  }

  const adminRoutes = findRouteFiles(
    resolve(REPO_ROOT, "src/app/api/admin"),
  );
  console.log(
    `[check-admin-route-manifest] OK — ${adminRoutes.length} admin routes, all declared in manifest.`,
  );
}

// Only run the CLI when invoked directly (not when imported by tests).
// Vitest/Node import this file via the .ts extension and never matches
// process.argv[1] — main() stays dormant under tests.
if (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "")
) {
  main();
}
