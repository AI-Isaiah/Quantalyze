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
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

type ManifestEntry = {
  route: string;
  current:
    | "withRole"
    | "withAdminAuth"
    | "isAdminUser-inline"
    | "authenticated-non-admin";
};

function loadManifest(): ManifestEntry[] {
  const manifestPath = resolve(
    REPO_ROOT,
    "src/lib/auth/rbac-manifest.ts",
  );
  const src = readFileSync(manifestPath, "utf-8");
  // Parse the ADMIN_ROUTE_MANIFEST literal by extracting each
  // `{ route: "...", current: "...", ... }` block. Deliberately simple
  // regex so the script does not depend on a TS parser at CI time.
  const blockRegex =
    /\{\s*route:\s*"([^"]+)",\s*current:\s*"(withRole|withAdminAuth|isAdminUser-inline|authenticated-non-admin)"/g;
  const entries: ManifestEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(src)) !== null) {
    entries.push({
      route: m[1] as string,
      current: m[2] as ManifestEntry["current"],
    });
  }
  if (entries.length === 0) {
    throw new Error(
      "[check-admin-route-manifest] No entries parsed from rbac-manifest.ts — script is broken or manifest is empty.",
    );
  }
  return entries;
}

function detectMechanism(
  contents: string,
):
  | "withRole"
  | "withAdminAuth"
  | "isAdminUser-inline"
  | "authenticated-non-admin"
  | "UNGATED" {
  if (/\bwithRole\s*[<(]/.test(contents)) return "withRole";
  if (/\bwithAdminAuth\s*\(/.test(contents)) return "withAdminAuth";
  // Only count a real CALL to isAdminUser, not just a comment mention.
  if (/\bisAdminUser\s*\(/.test(contents)) return "isAdminUser-inline";
  // No admin gate detected, but the route still gates on auth via
  // supabase.auth.getUser() + an early `!user` 401. The manifest entry
  // must declare this carve-out explicitly via current === "authenticated-non-admin".
  if (
    /supabase\.auth\.getUser\s*\(/.test(contents) &&
    /!\s*user\b/.test(contents)
  ) {
    return "authenticated-non-admin";
  }
  return "UNGATED";
}

/**
 * Recursive walk for `route.ts` files under a root. Avoids node:fs.globSync
 * which is not yet declared in the `@types/node` we ship with.
 */
function findRouteFiles(root: string): string[] {
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

function main(): void {
  const manifest = loadManifest();
  const manifestByRoute = new Map<string, ManifestEntry>();
  for (const entry of manifest) manifestByRoute.set(entry.route, entry);

  const adminRoutes = findRouteFiles(
    resolve(REPO_ROOT, "src/app/api/admin"),
  ).map((abs) => relative(REPO_ROOT, abs));

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
    const fileSrc = readFileSync(resolve(REPO_ROOT, route), "utf-8");
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

  console.log(
    `[check-admin-route-manifest] OK — ${adminRoutes.length} admin routes, all declared in manifest.`,
  );
}

main();
